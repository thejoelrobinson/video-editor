// Render-ahead frame buffer + decode worker coordination + complexity scoring
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS } from '../core/Constants.js';
import { timelineEngine } from '../timeline/TimelineEngine.js';
import { clipContainsFrame, getSourceFrameAtPlayhead } from '../timeline/Clip.js';
import { frameToSeconds } from '../timeline/TimelineMath.js';
import { mediaManager } from './MediaManager.js';
import { mediaDecoder } from './MediaDecoder.js';
import { MEDIA_TYPES } from '../core/Constants.js';
import { editorState } from '../core/EditorState.js';
import logger from '../../utils/logger.js';

export const renderAheadManager = {
  _frameBuffer: new Map(),     // `${mediaId}_${timeMs}` -> ImageBitmap
  _bufferLimit: 150,           // max total frames — recalculated on init from resolution
  _memoryBudgetMB: 512,        // target GPU memory budget in MB
  _worker: null,
  _pendingRequests: new Map(), // requestId -> { mediaId, times }
  _ensureCallbacks: new Map(), // requestId -> { remaining: Set, resolve, timeoutId }
  _complexityCache: new Map(),  // frame -> { score: number, hasVideo: boolean } | null (cached)
  _decodedSources: new Set(),   // `${mediaId}_${timeMs}` keys for all ever-decoded frames (lightweight)
  _requestId: 0,
  _initialized: false,
  _registeredMedia: new Set(), // media IDs confirmed ready by worker
  _pendingInits: new Set(),    // media IDs sent to worker but not yet confirmed
  _idleFillTimer: null,         // setTimeout ID for idle pre-render
  _idleFillFrame: 0,            // next frame to request in forward fill
  _idleFillPhase: 0,            // 0=forward from playhead, 1=backward, 2=done
  _idleFillBackFrame: 0,        // next frame for backward fill
  _eventHandlers: null,          // stored event handlers for cleanup
  _exportPaused: false,          // true while export is active (prevents decode contention)

  init() {
    if (this._initialized) return;

    try {
      this._worker = new Worker(
        new URL('./DecodeWorker.js', import.meta.url),
        { type: 'module' }
      );

      this._worker.onmessage = (e) => this._onWorkerMessage(e);
      this._worker.onerror = (err) => {
        logger.warn('[RenderAhead] Worker error:', err.message || err);
      };
    } catch (err) {
      logger.warn('[RenderAhead] Failed to create decode worker:', err.message);
      this._worker = null;
    }

    // Store handler references for cleanup
    this._eventHandlers = {
      timelineUpdated: (data) => {
        // Only clear complexity cache (timeline positions changed), NOT the frame buffer.
        // The frame buffer is keyed by source media time — decoded frames are valid
        // regardless of clip position. This makes green bars "travel" with clips on move.
        if (data && data.ranges && data.ranges.length > 0) {
          const merged = this._mergeRanges(data.ranges);
          for (const { start, end } of merged) {
            for (let f = start; f <= end; f++) {
              this._complexityCache.delete(f);
            }
          }
        } else {
          this._complexityCache.clear();
        }
        eventBus.emit(EDITOR_EVENTS.RENDER_BUFFER_CHANGED);
        this._startIdleFill();
      },
      playbackStop: () => { this._startIdleFill(); },
      playbackSeek: () => { if (!editorState.get('playback.playing')) this._startIdleFill(); },
      playbackStart: () => { this._stopIdleFill(); },
      mediaImported: () => { this._startIdleFill(); },
      sequenceActivated: () => {
        this._invalidateAll();
        this._recalcBufferLimit();
      }
    };

    eventBus.on(EDITOR_EVENTS.TIMELINE_UPDATED, this._eventHandlers.timelineUpdated);
    eventBus.on(EDITOR_EVENTS.PLAYBACK_STOP, this._eventHandlers.playbackStop);
    eventBus.on(EDITOR_EVENTS.PLAYBACK_SEEK, this._eventHandlers.playbackSeek);
    eventBus.on(EDITOR_EVENTS.PLAYBACK_START, this._eventHandlers.playbackStart);
    eventBus.on(EDITOR_EVENTS.MEDIA_IMPORTED, this._eventHandlers.mediaImported);
    eventBus.on(EDITOR_EVENTS.SEQUENCE_ACTIVATED, this._eventHandlers.sequenceActivated);

    // Calculate resolution-aware buffer limit from project canvas size
    this._recalcBufferLimit();
    editorState.subscribe('project.canvas', () => this._recalcBufferLimit());

    this._initialized = true;
    logger.info(`[RenderAhead] Initialized (buffer limit: ${this._bufferLimit} frames)`);
  },

  _onWorkerMessage(e) {
    const { type, mediaId, requestId, frames, error } = e.data;

    if (type === 'init_done') {
      this._pendingInits.delete(mediaId);
      this._registeredMedia.add(mediaId);
      // Worker owns the decode for this media now. Release the main-thread
      // buffer copy to save memory (can be 1GB+ for long 1080p videos).
      // Main-thread WebCodecs fallback will be unavailable, but the worker
      // handles decode; HTMLVideoElement fallback still works without the buffer.
      mediaDecoder.releaseMediaBuffer(mediaId);

      // Enrich media item with codec/fps from decoder track info.
      // These fields aren't available from HTMLVideoElement probe — they come
      // from mp4box demuxer. Needed for stream copy eligibility checks.
      const trackInfo = e.data.trackInfo;
      if (trackInfo) {
        const item = mediaManager.getItem(mediaId);
        if (item) {
          if (trackInfo.codec && !item.codec) item.codec = trackInfo.codec;
          if (trackInfo.frameRate && !item.fps) item.fps = trackInfo.frameRate;
          // Update dimensions if probe gave 0 (audio-only probe edge case)
          if (trackInfo.width && !item.width) item.width = trackInfo.width;
          if (trackInfo.height && !item.height) item.height = trackInfo.height;
        }
      }

      logger.info(`[RenderAhead] Worker initialized decoder for ${mediaId}`);
      // Restart idle fill — previous ticks may have skipped this media
      this._startIdleFill();
      return;
    }

    if (type === 'init_error') {
      this._pendingInits.delete(mediaId);
      logger.warn(`[RenderAhead] Worker init failed for ${mediaId}: ${error}`);
      return;
    }

    if (type === 'frames') {
      this._pendingRequests.delete(requestId);
      this._resolveEnsureCallback(requestId);

      let added = 0;
      for (const { time, bitmap } of frames) {
        const timeMs = Math.round(time * 1000);
        const key = `${mediaId}_${timeMs}`;
        // Close existing bitmap if overwriting
        const old = this._frameBuffer.get(key);
        if (old) old.close?.();
        this._frameBuffer.set(key, bitmap);
        this._decodedSources.add(key);
        added++;
      }

      // Evict oldest if over limit
      this._evict();

      // Emit buffer changed so render bars update (live buffer check, no cache clear needed)
      if (added > 0) {
        eventBus.emit(EDITOR_EVENTS.RENDER_BUFFER_CHANGED);
      }
      return;
    }

    if (type === 'decode_error') {
      this._pendingRequests.delete(requestId);
      this._resolveEnsureCallback(requestId);
      return;
    }
  },

  // Register media with the decode worker
  registerMedia(mediaId) {
    if (!this._worker) return;
    if (this._registeredMedia.has(mediaId)) return;
    if (this._pendingInits.has(mediaId)) return;

    const buffer = mediaDecoder.getMediaBuffer(mediaId);
    if (!buffer) return;

    this._pendingInits.add(mediaId);

    // Copy the buffer since transfer moves ownership to the worker
    const copy = buffer.slice(0);
    this._worker.postMessage(
      { type: 'init', mediaId, arrayBuffer: copy },
      [copy]
    );
  },

  // Get a pre-decoded frame (non-blocking, returns null if not cached)
  getFrame(mediaId, timeSeconds) {
    const timeMs = Math.round(timeSeconds * 1000);
    const key = `${mediaId}_${timeMs}`;
    return this._frameBuffer.get(key) || null;
  },

  // Request decode-ahead for upcoming frames
  requestAhead(currentFrame, count) {
    if (!this._worker) return;

    const videoTracks = timelineEngine.getVideoTracks();

    // Collect needed frames per media
    const needed = new Map(); // mediaId -> [timeSeconds]

    for (let offset = 0; offset < count; offset++) {
      const frame = currentFrame + offset;

      for (const track of videoTracks) {
        if (track.muted) continue;

        for (const clip of track.clips) {
          if (clip.disabled) continue;
          if (!clipContainsFrame(clip, frame)) continue;

          const mediaItem = mediaManager.getItem(clip.mediaId);
          if (!mediaItem || mediaItem.type !== MEDIA_TYPES.VIDEO) continue;

          // Ensure worker knows about this media
          this.registerMedia(clip.mediaId);

          // Skip if worker decoder not ready yet (will catch on next cycle)
          if (!this._registeredMedia.has(clip.mediaId)) {
            continue;
          }

          const sourceFrame = getSourceFrameAtPlayhead(clip, frame);
          const sourceTime = frameToSeconds(sourceFrame);
          const timeMs = Math.round(sourceTime * 1000);
          const key = `${clip.mediaId}_${timeMs}`;

          // Skip if already decoded (in buffer or previously decoded)
          if (this._decodedSources.has(key)) continue;

          if (!needed.has(clip.mediaId)) {
            needed.set(clip.mediaId, []);
          }
          needed.get(clip.mediaId).push(sourceTime);
        }
      }
    }

    // Send batch requests to worker (one per media)
    for (const [mediaId, times] of needed) {
      if (times.length === 0) continue;

      // Deduplicate against pending requests
      const pending = this._getPendingTimesForMedia(mediaId);
      const newTimes = times.filter(t => {
        const ms = Math.round(t * 1000);
        return !pending.has(ms);
      });

      if (newTimes.length === 0) continue;

      const requestId = ++this._requestId;
      this._pendingRequests.set(requestId, { mediaId, times: newTimes });

      this._worker.postMessage({
        type: 'decode',
        mediaId,
        times: newTimes,
        requestId
      });
    }
  },

  // Check if every video frame in the range has been decoded at least once
  isRangeDecoded(startFrame, endFrame) {
    const videoTracks = timelineEngine.getVideoTracks();
    for (let frame = startFrame; frame < endFrame; frame++) {
      for (const track of videoTracks) {
        if (track.muted) continue;
        for (const clip of track.clips) {
          if (clip.disabled) continue;
          if (!clipContainsFrame(clip, frame)) continue;
          const mediaItem = mediaManager.getItem(clip.mediaId);
          if (!mediaItem || mediaItem.type !== MEDIA_TYPES.VIDEO) continue;
          const sourceFrame = getSourceFrameAtPlayhead(clip, frame);
          const sourceTime = frameToSeconds(sourceFrame);
          const timeMs = Math.round(sourceTime * 1000);
          const key = `${clip.mediaId}_${timeMs}`;
          if (!this._decodedSources.has(key)) return false;
        }
      }
    }
    return true;
  },

  // Request frames for export — checks _frameBuffer (not _decodedSources) so
  // evicted frames are re-requested from the DecodeWorker.
  // Returns a Promise that resolves when all requested frames are in the buffer.
  ensureBuffered(startFrame, count) {
    if (!this._worker) return Promise.resolve();

    const videoTracks = timelineEngine.getVideoTracks();
    const needed = new Map();

    for (let offset = 0; offset < count; offset++) {
      const frame = startFrame + offset;
      for (const track of videoTracks) {
        if (track.muted) continue;
        for (const clip of track.clips) {
          if (clip.disabled) continue;
          if (!clipContainsFrame(clip, frame)) continue;
          const mediaItem = mediaManager.getItem(clip.mediaId);
          if (!mediaItem || mediaItem.type !== MEDIA_TYPES.VIDEO) continue;
          // Auto-register media with the worker if not yet registered
          this.registerMedia(clip.mediaId);
          if (!this._registeredMedia.has(clip.mediaId)) continue;
          const sourceFrame = getSourceFrameAtPlayhead(clip, frame);
          const sourceTime = frameToSeconds(sourceFrame);
          const timeMs = Math.round(sourceTime * 1000);
          const key = `${clip.mediaId}_${timeMs}`;
          // Only request frames NOT currently in the bitmap buffer
          if (this._frameBuffer.has(key)) continue;
          if (!needed.has(clip.mediaId)) needed.set(clip.mediaId, []);
          needed.get(clip.mediaId).push(sourceTime);
        }
      }
    }

    // Count total frames needed
    let totalNeeded = 0;
    for (const [, times] of needed) totalNeeded += times.length;
    if (totalNeeded === 0) return Promise.resolve();

    // Send requests and track completion
    const requestIds = [];
    for (const [mediaId, times] of needed) {
      if (times.length === 0) continue;
      const requestId = ++this._requestId;
      requestIds.push(requestId);
      this._pendingRequests.set(requestId, { mediaId, times });
      this._worker.postMessage({ type: 'decode', mediaId, times, requestId });
    }

    // Event-driven wait: resolve when all request IDs complete via _onWorkerMessage
    return new Promise((resolve) => {
      const remaining = new Set(requestIds);
      const timeoutId = setTimeout(() => {
        // Safety timeout — clean up callbacks and resolve
        for (const id of remaining) this._ensureCallbacks.delete(id);
        const pending = remaining.size;
        logger.warn(`[RenderAhead] ensureBuffered timeout: ${pending}/${requestIds.length} requests still pending after 5s`);
        resolve();
      }, 5000);

      // Register a callback entry for each requestId
      for (const id of requestIds) {
        this._ensureCallbacks.set(id, { remaining, resolve, timeoutId });
      }
    });
  },

  // Extract raw H.264 Annex B packets from source video via DecodeWorker.
  // Returns Promise<Uint8Array> — the bitstream for the given time range.
  extractPackets(mediaId, startTimeUs, endTimeUs, prependConfig = true) {
    if (!this._worker) return Promise.reject(new Error('No decode worker'));
    if (!this._registeredMedia.has(mediaId)) {
      return Promise.reject(new Error('Media not registered with worker: ' + mediaId));
    }

    const requestId = ++this._requestId;
    return new Promise((resolve, reject) => {
      let timeoutId;
      const handler = (e) => {
        const msg = e.data;
        if (msg.requestId !== requestId) return;
        clearTimeout(timeoutId);
        this._worker.removeEventListener('message', handler);
        if (msg.type === 'packets') {
          resolve(msg.data);
        } else if (msg.type === 'extract_error') {
          reject(new Error(msg.error));
        }
      };
      this._worker.addEventListener('message', handler);

      this._worker.postMessage({
        type: 'extract_packets',
        mediaId,
        requestId,
        startTimeUs,
        endTimeUs,
        prependConfig
      });

      // Timeout: packet extraction should be fast (no decode), but protect against hangs
      timeoutId = setTimeout(() => {
        this._worker.removeEventListener('message', handler);
        reject(new Error('extractPackets timeout'));
      }, 10000);
    });
  },

  // Resolve an ensureBuffered callback when a request completes
  _resolveEnsureCallback(requestId) {
    const cb = this._ensureCallbacks.get(requestId);
    if (!cb) return;
    this._ensureCallbacks.delete(requestId);
    cb.remaining.delete(requestId);
    if (cb.remaining.size === 0) {
      clearTimeout(cb.timeoutId);
      cb.resolve();
    }
  },

  _getPendingTimesForMedia(mediaId) {
    const times = new Set();
    for (const [, req] of this._pendingRequests) {
      if (req.mediaId === mediaId) {
        for (const t of req.times) {
          times.add(Math.round(t * 1000));
        }
      }
    }
    return times;
  },

  // Classify a frame's complexity for render bar coloring.
  // Complexity is cached (only changes on timeline edits); buffer state is checked live.
  getSegmentStatus(frame) {
    let cached = this._complexityCache.get(frame);
    if (cached === undefined) {
      cached = this._computeComplexity(frame);
      this._complexityCache.set(frame, cached);
    }
    if (cached === null) return null; // no video at this frame
    if (this._isFrameBuffered(frame)) return 'green';
    if (cached.score <= 1.5) return 'yellow';
    return 'red';
  },

  _computeComplexity(frame) {
    const videoTracks = timelineEngine.getVideoTracks();
    let hasVideo = false;
    let score = 0;

    for (const track of videoTracks) {
      if (track.muted) continue;

      for (const clip of track.clips) {
        if (clip.disabled) continue;
        if (!clipContainsFrame(clip, frame)) continue;

        const mediaItem = mediaManager.getItem(clip.mediaId);
        if (!mediaItem || mediaItem.type !== MEDIA_TYPES.VIDEO) continue;

        hasVideo = true;
        score += 1; // base decode cost

        // Score effects
        const effects = (clip.effects || []).filter(fx => fx.enabled);
        for (const fx of effects) {
          if (fx.effectId === 'transform' || fx.effectId === 'opacity') {
            score += 0.1; // compositing effect
          } else {
            score += 1.5; // pixel effect
          }
        }
      }

      // Check transitions
      if (track.transitions) {
        for (const trans of track.transitions) {
          const clipB = track.clips.find(c => c.id === trans.clipBId);
          if (clipB && frame >= clipB.startFrame && frame < clipB.startFrame + trans.duration) {
            score += 2;
          }
        }
      }
    }

    if (!hasVideo) return null;
    return { score };
  },

  // Check if ALL video clips at this frame have been decoded.
  // Uses _decodedSources (lightweight Set) rather than _frameBuffer so that
  // green bars persist even after ImageBitmaps are LRU-evicted from GPU memory.
  // Evicted frames are quickly re-decoded from the worker's cached GOPs on playback.
  _isFrameBuffered(frame) {
    const videoTracks = timelineEngine.getVideoTracks();
    for (const track of videoTracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clip.disabled) continue;
        if (!clipContainsFrame(clip, frame)) continue;
        const mediaItem = mediaManager.getItem(clip.mediaId);
        if (!mediaItem || mediaItem.type !== MEDIA_TYPES.VIDEO) continue;
        const sourceFrame = getSourceFrameAtPlayhead(clip, frame);
        const sourceTime = frameToSeconds(sourceFrame);
        const timeMs = Math.round(sourceTime * 1000);
        const key = `${clip.mediaId}_${timeMs}`;
        if (!this._decodedSources.has(key)) return false;
      }
    }
    return true;
  },

  // Force-invalidate all buffered frames (used by cleanup and "Delete Render Files" action)
  _invalidateAll() {
    for (const [, bitmap] of this._frameBuffer) {
      bitmap?.close?.();
    }
    this._frameBuffer.clear();
    this._decodedSources.clear();
    this._complexityCache.clear();
    eventBus.emit(EDITOR_EVENTS.RENDER_BUFFER_CHANGED);
    this._startIdleFill();
  },

  _mergeRanges(ranges) {
    if (ranges.length === 0) return [];
    if (ranges.length === 1) return ranges;
    const sorted = ranges.slice().sort((a, b) => a.start - b.start);
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      if (sorted[i].start <= last.end + 1) {
        last.end = Math.max(last.end, sorted[i].end);
      } else {
        merged.push(sorted[i]);
      }
    }
    return merged;
  },

  // Calculate buffer limit based on project resolution and available memory.
  // Each ImageBitmap ≈ width × height × 4 bytes (RGBA) of GPU memory.
  _recalcBufferLimit() {
    const { width, height } = editorState.get('project.canvas');
    const bytesPerFrame = width * height * 4;
    const budgetBytes = this._memoryBudgetMB * 1024 * 1024;

    // Scale budget by device memory if available (default 4GB assumed)
    const deviceGB = navigator.deviceMemory || 4;
    const scaledBudget = deviceGB <= 2 ? budgetBytes * 0.5
      : deviceGB >= 8 ? budgetBytes * 1.5
      : budgetBytes;

    // Clamp to 30..600 frames
    const computed = Math.floor(scaledBudget / bytesPerFrame);
    const oldLimit = this._bufferLimit;
    this._bufferLimit = Math.max(30, Math.min(600, computed));

    // Also recalc MediaDecoder's cache limit (secondary cache, smaller budget)
    mediaDecoder.recalcCacheLimit(width, height);

    if (oldLimit !== this._bufferLimit) {
      logger.info(`[RenderAhead] Buffer limit: ${this._bufferLimit} frames (${width}x${height}, ${deviceGB}GB device)`);
      this._evict(); // trim if new limit is smaller
    }
  },

  _evict() {
    while (this._frameBuffer.size > this._bufferLimit) {
      const firstKey = this._frameBuffer.keys().next().value;
      const old = this._frameBuffer.get(firstKey);
      old?.close?.();
      this._frameBuffer.delete(firstKey);
    }
  },

  // Pause idle fill during export to avoid contention for VideoDecoder.
  // Export's explicit ensureBuffered() calls still work — only background fill is paused.
  pauseForExport() {
    this._exportPaused = true;
    this._stopIdleFill();
  },

  resumeAfterExport() {
    this._exportPaused = false;
    this._startIdleFill();
  },

  // Idle pre-render: fill buffer for entire timeline when paused.
  // Phase 1: fill forward from playhead (highest priority for immediate playback).
  // Phase 2: fill backward from playhead to frame 0.
  // Phase 3: fill forward from end of phase 1 to timeline end.
  // Frames already in the buffer are skipped by requestAhead().
  _startIdleFill() {
    if (editorState.get('playback.playing')) return;
    if (this._exportPaused) return;
    this._stopIdleFill();
    const playhead = editorState.get('playback.currentFrame') || 0;
    this._idleFillFrame = playhead;
    this._idleFillPhase = 0;       // 0=forward from playhead, 1=backward, 2=rest
    this._idleFillBackFrame = playhead - 15;
    this._idleFillTick();
  },

  _idleFillTick() {
    if (editorState.get('playback.playing')) return;
    if (this._exportPaused) return;
    if (!this._worker) return;

    const duration = timelineEngine.getDuration();
    const playhead = editorState.get('playback.currentFrame') || 0;

    if (this._idleFillPhase === 0) {
      // Phase 0: forward from playhead
      if (this._idleFillFrame < duration) {
        this.requestAhead(this._idleFillFrame, 15);
        this._idleFillFrame += 15;
      } else {
        // Forward pass done, start backward
        this._idleFillPhase = 1;
      }
    }

    if (this._idleFillPhase === 1) {
      // Phase 1: backward from playhead to frame 0
      if (this._idleFillBackFrame >= 0) {
        this.requestAhead(Math.max(0, this._idleFillBackFrame), 15);
        this._idleFillBackFrame -= 15;
      } else {
        // Backward pass done — full timeline covered
        this._idleFillPhase = 2;
      }
    }

    if (this._idleFillPhase === 2) {
      // All phases complete
      return;
    }

    this._idleFillTimer = setTimeout(() => this._idleFillTick(), 200);
  },

  _stopIdleFill() {
    if (this._idleFillTimer !== null) {
      clearTimeout(this._idleFillTimer);
      this._idleFillTimer = null;
    }
  },

  cleanup() {
    this._stopIdleFill();

    // Deregister event listeners
    if (this._eventHandlers) {
      eventBus.off(EDITOR_EVENTS.TIMELINE_UPDATED, this._eventHandlers.timelineUpdated);
      eventBus.off(EDITOR_EVENTS.PLAYBACK_STOP, this._eventHandlers.playbackStop);
      eventBus.off(EDITOR_EVENTS.PLAYBACK_SEEK, this._eventHandlers.playbackSeek);
      eventBus.off(EDITOR_EVENTS.PLAYBACK_START, this._eventHandlers.playbackStart);
      eventBus.off(EDITOR_EVENTS.MEDIA_IMPORTED, this._eventHandlers.mediaImported);
      eventBus.off(EDITOR_EVENTS.SEQUENCE_ACTIVATED, this._eventHandlers.sequenceActivated);
      this._eventHandlers = null;
    }

    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }

    for (const [, bitmap] of this._frameBuffer) {
      bitmap?.close?.();
    }
    this._frameBuffer.clear();
    this._decodedSources.clear();
    this._complexityCache.clear();
    this._pendingRequests.clear();
    // Clear safety timeouts from pending ensureBuffered callbacks
    const clearedTimeouts = new Set();
    for (const [, cb] of this._ensureCallbacks) {
      if (cb.timeoutId && !clearedTimeouts.has(cb.timeoutId)) {
        clearTimeout(cb.timeoutId);
        clearedTimeouts.add(cb.timeoutId);
      }
    }
    this._ensureCallbacks.clear();
    this._registeredMedia.clear();
    this._pendingInits.clear();
    this._exportPaused = false;
    this._initialized = false;
  }
};

export default renderAheadManager;
