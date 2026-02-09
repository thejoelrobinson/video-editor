// Pre-encode conforming: composite + encode frames to H.264 at sequence settings during idle.
// Export can then stream-copy cached packets instead of re-compositing/encoding.
//
// Per-sequence caching: each sequence gets its own SeqConformState containing
// sourceCache, packetCache, conformedFrames, etc. Switching sequences preserves
// all cached packets. Each sequence is conformed only when it's active.
//
// Dual-keyed cache (per sequence):
//   sourceCache: clipId:sourceFrame:effectsHash → packet  (durable, survives clip moves)
//   packetCache: timelineFrame → packet                    (rebuilt on timeline changes)
//
// When a clip moves, sourceCache retains the encoded data and packetCache is rebuilt
// to reflect the new timeline positions. Only effect changes or sequence setting changes
// invalidate the source-keyed packets.
import { eventBus } from '../core/EventBus.js';
import { editorState } from '../core/EditorState.js';
import { EDITOR_EVENTS, MEDIA_TYPES, getAvcCodecForResolution } from '../core/Constants.js';
import { timelineEngine } from '../timeline/TimelineEngine.js';
import { clipContainsFrame, getSourceFrameAtPlayhead } from '../timeline/Clip.js';
import { frameToSeconds } from '../timeline/TimelineMath.js';
import { mediaManager } from './MediaManager.js';
import { renderAheadManager } from './RenderAheadManager.js';
import { videoCompositor } from '../playback/VideoCompositor.js';
import logger from '../../utils/logger.js';

function createSeqConformState(settings) {
  return {
    sourceCache: new Map(),       // 'clipId:sourceFrame:fxHash' -> packet
    packetCache: new Map(),       // frame number -> packet
    conformedFrames: new Set(),   // which frame numbers have cached packets
    conformableRanges: null,      // cached analysis: Array<{start, end}>
    idleFillFrame: 0,             // scan position for this sequence
    settings                      // { codec, width, height, fps, bitrate }
  };
}

export const conformEncoder = {
  _worker: null,
  _seqStates: new Map(),          // seqId → SeqConformState
  _currentWorkerSettings: null,   // what the worker is currently configured for
  _offscreenCanvas: null,
  _offscreenCtx: null,
  _initialized: false,
  _idleFillTimer: null,
  _idleFillRunning: false,        // true while an async tick is executing
  _eventHandlers: null,
  _unsubs: [],                    // EditorState unsubscribe functions
  _pendingEncodes: 0,             // track in-flight encodes for backpressure
  _encodeQueue: [],               // FIFO of { frame, sourceKey, seqId } awaiting packet callbacks
  _exportPaused: false,           // true while export is active
  _maxMemoryMB: 500,              // cap encoded packet cache (across all sequences)
  _maxPerTick: 16,                // max frames composited+submitted per idle tick
  _maxPending: 16,                // max in-flight encodes to worker

  init() {
    if (this._initialized) return;
    if (typeof VideoEncoder === 'undefined') {
      logger.warn('[ConformEncoder] VideoEncoder not available, skipping');
      return;
    }

    try {
      this._worker = new Worker(
        new URL('./ConformWorker.js', import.meta.url),
        { type: 'module' }
      );
      this._worker.onmessage = (e) => this._onWorkerMessage(e);
      this._worker.onerror = (err) => {
        logger.warn('[ConformEncoder] Worker error:', err.message || err);
      };
    } catch (err) {
      logger.warn('[ConformEncoder] Failed to create worker:', err.message);
      return;
    }

    // Initialize offscreen canvas + configure worker for active sequence
    const activeId = editorState.getActiveSequenceId();
    const ss = this._getSeqState(activeId);
    this._setupOffscreenCanvas(ss.settings);
    this._configureWorker(ss.settings);

    this._eventHandlers = {
      timelineUpdated: () => {
        const seqId = editorState.getActiveSequenceId();
        this._rebuildFrameIndex(seqId);
        this._restartIdleFill();
      },
      playbackStop: () => { this._restartIdleFill(); },
      playbackSeek: () => { if (!editorState.get('playback.playing')) this._restartIdleFill(); },
      playbackStart: () => { this._stopIdleFill(); },
      sequenceChanged: () => {
        const seqId = editorState.getActiveSequenceId();
        const newSettings = this._readSettingsForSequence(seqId);
        this._invalidateSequence(seqId);
        const ss = this._getSeqState(seqId);
        ss.settings = newSettings;
        this._setupOffscreenCanvas(newSettings);
        this._ensureWorkerConfigured(newSettings);
        this._restartIdleFill();
      }
    };

    eventBus.on(EDITOR_EVENTS.TIMELINE_UPDATED, this._eventHandlers.timelineUpdated);
    eventBus.on(EDITOR_EVENTS.PLAYBACK_STOP, this._eventHandlers.playbackStop);
    eventBus.on(EDITOR_EVENTS.PLAYBACK_SEEK, this._eventHandlers.playbackSeek);
    eventBus.on(EDITOR_EVENTS.PLAYBACK_START, this._eventHandlers.playbackStart);

    const paths = ['project.codec', 'project.bitrate', 'project.canvas', 'project.frameRate'];
    for (const path of paths) {
      const unsub = editorState.subscribe(path, this._eventHandlers.sequenceChanged);
      this._unsubs.push(unsub);
    }

    this._eventHandlers.mediaImported = () => {
      for (const ss of this._seqStates.values()) {
        ss.conformableRanges = null;
      }
    };
    eventBus.on(EDITOR_EVENTS.MEDIA_IMPORTED, this._eventHandlers.mediaImported);

    // When active sequence changes, preserve caches — just switch context
    this._eventHandlers.sequenceActivated = () => {
      this._stopIdleFill();
      this._idleFillRunning = false;

      // Abandon in-flight encodes from the previous sequence
      this._encodeQueue = [];
      this._pendingEncodes = 0;

      const seqId = editorState.getActiveSequenceId();
      const ss = this._getSeqState(seqId);

      this._setupOffscreenCanvas(ss.settings);
      this._ensureWorkerConfigured(ss.settings);

      this._restartIdleFill();
    };
    eventBus.on(EDITOR_EVENTS.SEQUENCE_ACTIVATED, this._eventHandlers.sequenceActivated);

    // Clean up deleted sequences
    this._eventHandlers.sequenceDeleted = (data) => {
      const id = data?.id;
      if (id) this._seqStates.delete(id);
    };
    eventBus.on(EDITOR_EVENTS.SEQUENCE_DELETED, this._eventHandlers.sequenceDeleted);

    this._initialized = true;
    logger.info('[ConformEncoder] Initialized');
  },

  // Read settings for a specific sequence by ID
  _readSettingsForSequence(seqId) {
    const seq = editorState.getSequence(seqId);
    if (!seq) return null;
    let codec = seq.codec;
    if (codec && codec.startsWith('avc1')) {
      codec = getAvcCodecForResolution(seq.canvas.width, seq.canvas.height);
    }
    return {
      codec,
      width: seq.canvas.width,
      height: seq.canvas.height,
      fps: seq.frameRate,
      bitrate: seq.bitrate
    };
  },

  // Lazy-create a SeqConformState for any sequence
  _getSeqState(seqId) {
    let ss = this._seqStates.get(seqId);
    if (!ss) {
      const settings = this._readSettingsForSequence(seqId);
      ss = createSeqConformState(settings);
      this._seqStates.set(seqId, ss);
    }
    return ss;
  },

  _setupOffscreenCanvas(settings) {
    if (!settings) return;
    if (!this._offscreenCanvas ||
        this._offscreenCanvas.width !== settings.width ||
        this._offscreenCanvas.height !== settings.height) {
      this._offscreenCanvas = new OffscreenCanvas(settings.width, settings.height);
      this._offscreenCtx = this._offscreenCanvas.getContext('2d', { alpha: false });
    }
  },

  _configureWorker(settings) {
    if (!this._worker || !settings) return;
    this._worker.postMessage({
      type: 'configure',
      codec: settings.codec,
      width: settings.width,
      height: settings.height,
      bitrate: settings.bitrate,
      fps: settings.fps
    });
    this._currentWorkerSettings = { ...settings };
  },

  // Reconfigure worker only if settings differ from current
  _ensureWorkerConfigured(settings) {
    if (!this._worker || !settings) return;
    const cur = this._currentWorkerSettings;
    if (cur &&
        cur.codec === settings.codec &&
        cur.width === settings.width &&
        cur.height === settings.height &&
        cur.bitrate === settings.bitrate &&
        cur.fps === settings.fps) {
      return;
    }
    this._worker.postMessage({
      type: 'reconfigure',
      codec: settings.codec,
      width: settings.width,
      height: settings.height,
      bitrate: settings.bitrate,
      fps: settings.fps
    });
    this._currentWorkerSettings = { ...settings };
  },

  _onWorkerMessage(e) {
    const msg = e.data;
    switch (msg.type) {
      case 'packet': {
        const entry = this._encodeQueue.shift();
        if (entry === undefined) break;
        this._pendingEncodes--;

        const packet = {
          data: msg.packet.data,
          isKeyframe: msg.packet.isKeyframe,
          decoderConfig: msg.packet.decoderConfig
        };

        const ss = this._seqStates.get(entry.seqId);
        if (ss) {
          if (entry.sourceKey) ss.sourceCache.set(entry.sourceKey, packet);

          if (!entry.orphaned) {
            ss.packetCache.set(entry.frame, packet);
            ss.conformedFrames.add(entry.frame);
            eventBus.emit(EDITOR_EVENTS.CONFORM_BUFFER_CHANGED);
          }
        }
        break;
      }
      case 'log':
        logger.info(msg.message);
        break;
      case 'configure_done':
        logger.info('[ConformEncoder] Worker configured');
        break;
      case 'configure_error':
        logger.warn('[ConformEncoder] Worker configure failed:', msg.error);
        break;
      case 'reconfigure_done':
        logger.info('[ConformEncoder] Worker reconfigured');
        break;
      case 'encode_accepted':
        break;
      case 'encode_error':
        this._encodeQueue.shift();
        this._pendingEncodes--;
        logger.warn('[ConformEncoder] Encode error:', msg.error);
        break;
      case 'flush_done':
        break;
      // Export-mode messages
      case 'export-started':
        break;
      case 'export-packet':
        this._exportPackets.push(msg.data);
        this._exportPending--;
        if (this._exportDrainResolve && this._exportPending <= this._exportDrainThreshold) {
          const resolve = this._exportDrainResolve;
          this._exportDrainResolve = null;
          resolve();
        }
        break;
      case 'export-accepted':
        break;
      case 'export-flush-done':
        if (this._exportFlushResolve) {
          this._exportFlushResolve();
          this._exportFlushResolve = null;
        }
        break;
      case 'export-ended':
        break;
      case 'export-error':
        logger.warn('[ConformEncoder] Export encode error:', msg.error);
        this._exportPending--;
        break;
      case 'error':
        logger.warn('[ConformEncoder] Worker error:', msg.error);
        this._encodeQueue = [];
        this._pendingEncodes = 0;
        break;
    }
  },

  _sourceKey(clip, sourceFrame) {
    return `${clip.id}:${sourceFrame}:${this._effectsHash(clip)}`;
  },

  _effectsHash(clip) {
    const fx = (clip.effects || []).filter(f => f.enabled && f.effectId !== 'audio-volume'
      && f.effectId !== 'panner' && f.effectId !== 'channel-volume');
    if (fx.length === 0) return '0';
    let h = 0;
    const str = JSON.stringify(fx.map(f => ({ id: f.effectId, p: f.params, k: f.keyframes })));
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h.toString(36);
  },

  _resolveSourceInfo(frame) {
    const videoTracks = timelineEngine.getVideoTracks();
    let found = null;

    for (const track of videoTracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clip.disabled) continue;
        if (!clipContainsFrame(clip, frame)) continue;
        const mediaItem = mediaManager.getItem(clip.mediaId);
        if (!mediaItem) continue;
        if (mediaItem.type === MEDIA_TYPES.VIDEO || mediaItem.type === MEDIA_TYPES.IMAGE) {
          if (found) return null;
          found = { clip, mediaItem };
        }
      }
    }

    if (!found) return null;
    const sourceFrame = getSourceFrameAtPlayhead(found.clip, frame);
    const sourceKey = this._sourceKey(found.clip, sourceFrame);
    return { sourceKey, clip: found.clip, sourceFrame };
  },

  _isFrameConformable(frame) {
    const videoTracks = timelineEngine.getVideoTracks();
    for (const track of videoTracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clip.disabled) continue;
        if (!clipContainsFrame(clip, frame)) continue;
        const mediaItem = mediaManager.getItem(clip.mediaId);
        if (!mediaItem) continue;
        if (mediaItem.type === MEDIA_TYPES.VIDEO || mediaItem.type === MEDIA_TYPES.IMAGE) {
          return true;
        }
      }
    }
    return false;
  },

  // Rebuild packetCache and conformedFrames from sourceCache for a specific sequence.
  _rebuildFrameIndex(seqId) {
    // Defer rebuilds during export to prevent clearing packetCache while
    // the export pipeline is reading from it (race condition).
    if (this._exportPaused) {
      this._pendingRebuild = seqId;
      return;
    }
    const ss = this._getSeqState(seqId);
    ss.packetCache.clear();
    ss.conformedFrames.clear();
    ss.conformableRanges = null;

    // Mark in-flight encodes for this sequence as orphaned
    for (const entry of this._encodeQueue) {
      if (entry.seqId === seqId) entry.orphaned = true;
    }

    const duration = timelineEngine.getDuration();
    let recovered = 0;

    const fxHashCache = new Map();
    const getHash = (clip) => {
      let h = fxHashCache.get(clip.id);
      if (h === undefined) {
        h = this._effectsHash(clip);
        fxHashCache.set(clip.id, h);
      }
      return h;
    };

    for (let f = 0; f < duration; f++) {
      const videoTracks = timelineEngine.getVideoTracks();
      let found = null;
      let multi = false;

      for (const track of videoTracks) {
        if (track.muted) continue;
        for (const clip of track.clips) {
          if (clip.disabled) continue;
          if (!clipContainsFrame(clip, f)) continue;
          const mediaItem = mediaManager.getItem(clip.mediaId);
          if (!mediaItem) continue;
          if (mediaItem.type === MEDIA_TYPES.VIDEO || mediaItem.type === MEDIA_TYPES.IMAGE) {
            if (found) { multi = true; break; }
            found = clip;
          }
        }
        if (multi) break;
      }

      if (!found || multi) continue;
      const sourceFrame = getSourceFrameAtPlayhead(found, f);
      const key = `${found.id}:${sourceFrame}:${getHash(found)}`;
      const packet = ss.sourceCache.get(key);
      if (packet) {
        ss.packetCache.set(f, packet);
        ss.conformedFrames.add(f);
        recovered++;
      }
    }

    // Prune source cache: remove entries for deleted clips
    const activeClipIds = new Set();
    for (const track of timelineEngine.getVideoTracks()) {
      for (const clip of track.clips) activeClipIds.add(clip.id);
    }
    for (const key of ss.sourceCache.keys()) {
      const clipId = key.split(':')[0];
      if (!activeClipIds.has(clipId)) ss.sourceCache.delete(key);
    }

    ss.idleFillFrame = 0;

    if (recovered > 0) {
      logger.info(`[ConformEncoder] Rebuilt frame index for ${seqId}: ${recovered} packets recovered`);
    }
    eventBus.emit(EDITOR_EVENTS.CONFORM_BUFFER_CHANGED);
  },

  _getConformableRanges(seqId) {
    const ss = this._getSeqState(seqId);
    if (ss.conformableRanges) return ss.conformableRanges;

    const duration = timelineEngine.getDuration();
    const ranges = [];
    let rangeStart = null;

    for (let f = 0; f < duration; f++) {
      if (this._isFrameConformable(f)) {
        if (rangeStart === null) rangeStart = f;
      } else {
        if (rangeStart !== null) {
          ranges.push({ start: rangeStart, end: f });
          rangeStart = null;
        }
      }
    }
    if (rangeStart !== null) {
      ranges.push({ start: rangeStart, end: duration });
    }

    ss.conformableRanges = ranges;
    return ranges;
  },

  async _conformFrame(frame, seqId) {
    const ss = this._getSeqState(seqId);
    const cw = ss.settings.width;
    const ch = ss.settings.height;
    const ctx = this._offscreenCtx;
    await videoCompositor.compositeFrameTo(frame, ctx, cw, ch);
    const conformedBitmap = this._offscreenCanvas.transferToImageBitmap();

    const ranges = this._getConformableRanges(seqId);
    const isSegmentStart = ranges.some(r => r.start === frame);
    const gopInterval = Math.round(ss.settings.fps * 2);
    const forceKeyframe = isSegmentStart || (frame % gopInterval === 0);

    const timestampUs = Math.round(frameToSeconds(frame) * 1000000);

    const info = this._resolveSourceInfo(frame);
    const sourceKey = info?.sourceKey || null;

    this._encodeQueue.push({ frame, sourceKey, seqId });
    this._pendingEncodes++;

    this._worker.postMessage({
      type: 'encode',
      bitmap: conformedBitmap,
      timestampUs,
      forceKeyframe,
      requestId: frame
    }, [conformedBitmap]);
  },

  isRangeConformed(start, end) {
    const seqId = editorState.getActiveSequenceId();
    const ss = this._getSeqState(seqId);
    for (let f = start; f < end; f++) {
      if (!this._isFrameConformable(f)) continue;
      if (!ss.conformedFrames.has(f)) return false;
    }
    return true;
  },

  isFrameConformed(frame) {
    const seqId = editorState.getActiveSequenceId();
    const ss = this._getSeqState(seqId);
    return ss.conformedFrames.has(frame);
  },

  getProgress() {
    const seqId = editorState.getActiveSequenceId();
    const ranges = this._getConformableRanges(seqId);
    const ss = this._getSeqState(seqId);
    let total = 0;
    let conformed = 0;
    for (const r of ranges) {
      for (let f = r.start; f < r.end; f++) {
        total++;
        if (ss.conformedFrames.has(f)) conformed++;
      }
    }
    return { conformed, total };
  },

  getPacket(frame) {
    const seqId = editorState.getActiveSequenceId();
    const ss = this._getSeqState(seqId);
    return ss.packetCache.get(frame) || null;
  },

  getPacketsForRange(start, end) {
    const seqId = editorState.getActiveSequenceId();
    const ss = this._getSeqState(seqId);
    const packets = [];
    let totalSize = 0;

    for (let f = start; f < end; f++) {
      const p = ss.packetCache.get(f);
      if (!p) continue;
      packets.push(p);
      totalSize += p.data.byteLength;
    }

    if (totalSize === 0) return new Uint8Array(0);

    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const p of packets) {
      result.set(p.data, offset);
      offset += p.data.byteLength;
    }

    return result;
  },

  // Invalidate a single sequence's caches
  _invalidateSequence(seqId) {
    this._stopIdleFill();
    this._idleFillRunning = false;

    const ss = this._seqStates.get(seqId);
    if (!ss) return;
    ss.sourceCache.clear();
    ss.packetCache.clear();
    ss.conformedFrames.clear();
    ss.conformableRanges = null;
    ss.idleFillFrame = 0;

    for (const entry of this._encodeQueue) {
      if (entry.seqId === seqId) entry.orphaned = true;
    }

    eventBus.emit(EDITOR_EVENTS.CONFORM_BUFFER_CHANGED);
  },

  // Full invalidation — clears ALL sequences (used by cleanup and re-conform button)
  _invalidateAll() {
    this._stopIdleFill();
    this._idleFillRunning = false;

    for (const ss of this._seqStates.values()) {
      ss.sourceCache.clear();
      ss.packetCache.clear();
      ss.conformedFrames.clear();
      ss.conformableRanges = null;
      ss.idleFillFrame = 0;
    }

    this._encodeQueue = [];
    this._pendingEncodes = 0;
    eventBus.emit(EDITOR_EVENTS.CONFORM_BUFFER_CHANGED);
  },

  _getMemoryUsageMB() {
    let bytes = 0;
    for (const ss of this._seqStates.values()) {
      for (const [, p] of ss.sourceCache) {
        bytes += p.data.byteLength;
      }
    }
    return bytes / (1024 * 1024);
  },

  pauseForExport() {
    this._exportPaused = true;
    this._pendingRebuild = null;
    this._stopIdleFill();
  },

  resumeAfterExport() {
    this._exportPaused = false;
    // Flush any rebuild that was deferred during export
    if (this._pendingRebuild) {
      const seqId = this._pendingRebuild;
      this._pendingRebuild = null;
      this._rebuildFrameIndex(seqId);
    }
    this._restartIdleFill();
  },

  // === Export-mode API ===
  // Routes fresh-encode frames through the SAME ConformWorker encoder that produced
  // cached packets, guaranteeing identical SPS/PPS for the hybrid bitstream.
  _exportPackets: [],
  _exportPending: 0,
  _exportDrainResolve: null,
  _exportDrainThreshold: 0,
  _exportFlushResolve: null,

  startExportMode() {
    if (!this._worker) return;
    this._exportPackets = [];
    this._exportPending = 0;
    this._worker.postMessage({ type: 'export-start' });
  },

  exportEncode(bitmap, timestampUs, forceKeyframe) {
    if (!this._worker) return;
    this._exportPending++;
    this._worker.postMessage({
      type: 'export-encode',
      bitmap,
      timestampUs,
      forceKeyframe: !!forceKeyframe
    }, [bitmap]);
  },

  // Backpressure: resolves when in-flight export encodes drop to threshold
  waitForExportDrain(threshold) {
    if (this._exportPending <= threshold) return Promise.resolve();
    this._exportDrainThreshold = threshold;
    return new Promise(resolve => { this._exportDrainResolve = resolve; });
  },

  async exportFlush() {
    if (!this._worker) return;
    return new Promise(resolve => {
      this._exportFlushResolve = resolve;
      this._worker.postMessage({ type: 'export-flush' });
    });
  },

  getAndClearExportData() {
    const packets = this._exportPackets;
    this._exportPackets = [];
    const totalSize = packets.reduce((sum, d) => sum + d.byteLength, 0);
    if (totalSize === 0) return new Uint8Array(0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const d of packets) {
      result.set(d, offset);
      offset += d.byteLength;
    }
    return result;
  },

  endExportMode() {
    if (!this._worker) return;
    this._worker.postMessage({ type: 'export-end' });
    this._exportPackets = [];
    this._exportPending = 0;
    this._exportDrainResolve = null;
    this._exportFlushResolve = null;
  },

  _restartIdleFill() {
    if (editorState.get('playback.playing')) return;
    if (this._exportPaused) return;
    if (this._idleFillRunning) return;
    this._stopIdleFill();
    this._idleFillTimer = setTimeout(() => this._idleFillTick(), 100);
  },

  async _idleFillTick() {
    if (this._idleFillRunning) return;
    this._idleFillRunning = true;
    this._idleFillTimer = null;

    try {
      if (editorState.get('playback.playing')) return;
      if (this._exportPaused) return;
      if (!this._worker) return;

      if (this._getMemoryUsageMB() > this._maxMemoryMB) {
        logger.info(`[ConformEncoder] Memory cap reached (${this._maxMemoryMB}MB), stopping idle fill`);
        return;
      }

      const activeSeqId = editorState.getActiveSequenceId();
      const activeSS = this._getSeqState(activeSeqId);
      if (!activeSS.settings) return;

      const submitted = await this._fillSequenceBatch(activeSeqId, activeSS);

      if (submitted > 0) {
        this._idleFillTimer = setTimeout(() => this._idleFillTick(), 50);
        return;
      }

      // Batch returned 0 — check if fully conformed or need to wrap around
      const activeProgress = this.getProgress();
      if (activeProgress.conformed < activeProgress.total) {
        if (activeSS.idleFillFrame >= timelineEngine.getDuration()) {
          activeSS.idleFillFrame = 0;
          this._idleFillTimer = setTimeout(() => this._idleFillTick(), 2000);
        } else {
          this._idleFillTimer = setTimeout(() => this._idleFillTick(), 500);
        }
      }
      // else: fully conformed — stop polling, restart on next timeline change

    } catch (err) {
      logger.warn('[ConformEncoder] Idle fill tick error:', err.message || err);
      if (this._idleFillTimer === null && !this._exportPaused) {
        this._idleFillTimer = setTimeout(() => this._idleFillTick(), 2000);
      }
    } finally {
      renderAheadManager._startIdleFill();
      this._idleFillRunning = false;
    }
  },

  async _fillSequenceBatch(seqId, ss) {
    const duration = timelineEngine.getDuration();
    const BATCH = this._maxPerTick;
    const batch = [];

    while (ss.idleFillFrame < duration && batch.length < BATCH) {
      const f = ss.idleFillFrame++;
      if (this._isFrameConformable(f) && !ss.conformedFrames.has(f)) batch.push(f);
    }

    if (batch.length === 0) return 0;

    renderAheadManager._stopIdleFill();

    const minFrame = batch[0];
    const maxFrame = batch[batch.length - 1];
    try {
      await renderAheadManager.ensureBuffered(minFrame, maxFrame - minFrame + 1);
    } catch (err) {
      logger.warn('[ConformEncoder] ensureBuffered failed:', err);
    }

    if (editorState.get('playback.playing') || this._exportPaused) return 0;

    let submitted = 0;
    for (const f of batch) {
      if (editorState.get('playback.playing') || this._exportPaused) break;
      if (ss.conformedFrames.has(f)) continue;
      if (this._pendingEncodes >= this._maxPending) {
        await new Promise(r => setTimeout(r, 50));
        if (this._pendingEncodes >= this._maxPending) break;
      }

      try {
        await this._conformFrame(f, seqId);
        submitted++;
      } catch (err) {
        logger.warn(`[ConformEncoder] Frame ${f} conform failed, skipping:`, err.message || err);
      }
    }

    return submitted;
  },

  _stopIdleFill() {
    if (this._idleFillTimer !== null) {
      clearTimeout(this._idleFillTimer);
      this._idleFillTimer = null;
    }
  },

  cleanup() {
    this._stopIdleFill();

    if (this._eventHandlers) {
      eventBus.off(EDITOR_EVENTS.TIMELINE_UPDATED, this._eventHandlers.timelineUpdated);
      eventBus.off(EDITOR_EVENTS.PLAYBACK_STOP, this._eventHandlers.playbackStop);
      eventBus.off(EDITOR_EVENTS.PLAYBACK_SEEK, this._eventHandlers.playbackSeek);
      eventBus.off(EDITOR_EVENTS.PLAYBACK_START, this._eventHandlers.playbackStart);
      eventBus.off(EDITOR_EVENTS.MEDIA_IMPORTED, this._eventHandlers.mediaImported);
      eventBus.off(EDITOR_EVENTS.SEQUENCE_ACTIVATED, this._eventHandlers.sequenceActivated);
      eventBus.off(EDITOR_EVENTS.SEQUENCE_DELETED, this._eventHandlers.sequenceDeleted);
      this._eventHandlers = null;
    }

    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];

    if (this._worker) {
      this._worker.postMessage({ type: 'close' });
      this._worker.terminate();
      this._worker = null;
    }

    this._seqStates.clear();
    this._currentWorkerSettings = null;
    this._encodeQueue = [];
    this._pendingEncodes = 0;
    this._idleFillRunning = false;
    this._exportPaused = false;
    this._initialized = false;
  }
};

export default conformEncoder;
