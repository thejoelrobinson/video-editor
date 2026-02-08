// Web Audio API multi-track audio mixing with effects chain
import { editorState } from '../core/EditorState.js';
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS, TRACK_TYPES } from '../core/Constants.js';
import { timelineEngine } from '../timeline/TimelineEngine.js';
import { clipContainsFrame, getSourceFrameAtPlayhead, getClipDuration, getClipEndFrame } from '../timeline/Clip.js';
import { frameToSeconds, secondsToFrame } from '../timeline/TimelineMath.js';
import { mediaManager } from '../media/MediaManager.js';
import { effectRegistry } from '../effects/EffectRegistry.js';
import { keyframeEngine } from '../effects/KeyframeEngine.js';
import logger from '../../utils/logger.js';

export const audioMixer = {
  _ctx: null,
  _masterGain: null,
  _masterAnalyser: null,
  _trackGains: new Map(),    // trackId -> GainNode
  _trackAnalysers: new Map(), // trackId -> AnalyserNode
  _clipSources: new Map(),   // clipId -> { source, gainNode, effectNodes, mediaElement }
  _audioBuffers: new Map(),  // mediaId -> AudioBuffer
  _isPlaying: false,

  init() {
    this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    this._masterGain = this._ctx.createGain();

    // Master analyser for metering
    this._masterAnalyser = this._ctx.createAnalyser();
    this._masterAnalyser.fftSize = 256;
    this._masterAnalyser.smoothingTimeConstant = 0.8;
    this._masterGain.connect(this._masterAnalyser);
    this._masterAnalyser.connect(this._ctx.destination);

    eventBus.on(EDITOR_EVENTS.PLAYBACK_START, () => this._onPlayStart());
    eventBus.on(EDITOR_EVENTS.PLAYBACK_STOP, () => this._onPlayStop());
    eventBus.on(EDITOR_EVENTS.PLAYBACK_SEEK, ({ frame }) => this._onSeek(frame));
    eventBus.on(EDITOR_EVENTS.PLAYBACK_FRAME, ({ frame }) => this._onFrame(frame));
    eventBus.on(EDITOR_EVENTS.CLIP_SPLIT, ({ original, newClip }) => {
      // Tear down stale audio sources for ALL clips affected by the split:
      // 1. The original clip (boundaries shortened)
      // 2. Its linked audio partner (also shortened by the linked split)
      // 3. The new clip's linked partner (freshly created, shouldn't have a source yet but be safe)
      this._teardownClipSource(original.id);
      if (original.linkedClipId) this._teardownClipSource(original.linkedClipId);
      if (newClip?.linkedClipId) this._teardownClipSource(newClip.linkedClipId);
    });

    logger.info('AudioMixer initialized');
  },

  getContext() {
    return this._ctx;
  },

  isPlaying() {
    return this._isPlaying;
  },

  setMasterVolume(value) {
    if (this._masterGain) {
      this._masterGain.gain.setValueAtTime(
        Math.max(0, Math.min(1, value)),
        this._ctx.currentTime
      );
    }
  },

  setTrackVolume(trackId, value) {
    const gain = this._getTrackGain(trackId);
    gain.gain.setValueAtTime(Math.max(0, Math.min(1, value)), this._ctx.currentTime);
  },

  _getTrackGain(trackId) {
    let gain = this._trackGains.get(trackId);
    if (!gain) {
      gain = this._ctx.createGain();
      // Insert analyser between track gain and master gain
      const analyser = this._ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      gain.connect(analyser);
      analyser.connect(this._masterGain);
      this._trackAnalysers.set(trackId, analyser);
      this._trackGains.set(trackId, gain);
    }
    return gain;
  },

  getMasterAnalyser() {
    return this._masterAnalyser;
  },

  getTrackAnalyser(trackId) {
    return this._trackAnalysers.get(trackId) || null;
  },

  getTrackAnalysers() {
    return this._trackAnalysers;
  },

  async _loadAudioBuffer(mediaItem) {
    if (this._audioBuffers.has(mediaItem.id)) {
      return this._audioBuffers.get(mediaItem.id);
    }
    try {
      const response = await fetch(mediaItem.url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this._ctx.decodeAudioData(arrayBuffer);
      this._audioBuffers.set(mediaItem.id, audioBuffer);
      return audioBuffer;
    } catch (err) {
      logger.warn(`Failed to decode audio for ${mediaItem.name}:`, err);
      return null;
    }
  },

  _createClipMediaElement(mediaItem) {
    // Always create a fresh <audio> element per clip connection.
    // createMediaElementSource() can only be called once per element,
    // so clips sharing the same mediaId each need their own element.
    const el = new Audio();
    el.src = mediaItem.url;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    return el;
  },

  async _onPlayStart() {
    if (this._ctx.state === 'suspended') {
      await this._ctx.resume();
    }
    this._isPlaying = true;
    this._scheduleAudio();
  },

  _onPlayStop() {
    this._isPlaying = false;
    this._stopAllSources();
  },

  _onSeek(frame) {
    if (this._isPlaying) {
      this._stopAllSources();
      this._scheduleAudio();
    }
  },

  _onFrame(frame) {
    if (!this._isPlaying) return;
    this._updateActiveSources(frame);
  },

  _scheduleAudio() {
    const frame = editorState.get('playback.currentFrame');
    const tracks = timelineEngine.getTracks();

    for (const track of tracks) {
      if (track.type !== TRACK_TYPES.AUDIO) continue;
      if (track.muted) continue;

      for (const clip of track.clips) {
        if (clip.disabled) continue;
        if (!clipContainsFrame(clip, frame)) continue;

        this._startClipAudio(clip, track, frame);
      }
    }
  },

  async _startClipAudio(clip, track, currentFrame) {
    const mediaItem = mediaManager.getItem(clip.mediaId);
    if (!mediaItem) return;

    // If this clip already has a live source, just ensure it's playing
    let sourceInfo = this._clipSources.get(clip.id);
    if (sourceInfo) {
      const sourceFrame = getSourceFrameAtPlayhead(clip, currentFrame);
      const sourceTime = frameToSeconds(sourceFrame);
      sourceInfo.mediaElement.currentTime = sourceTime;
      sourceInfo.mediaElement.playbackRate = editorState.get('playback.speed') * clip.speed;
      await sourceInfo.mediaElement.play().catch(err => logger.warn('Audio play failed:', err.message));
      return;
    }

    // Create a fresh audio element for this clip
    const el = this._createClipMediaElement(mediaItem);
    const sourceFrame = getSourceFrameAtPlayhead(clip, currentFrame);
    const sourceTime = frameToSeconds(sourceFrame);

    try {
      const source = this._ctx.createMediaElementSource(el);
      const gainNode = this._ctx.createGain();
      const volFx = clip.effects?.find(fx => fx.intrinsic && fx.effectId === 'audio-volume');
      gainNode.gain.value = volFx ? volFx.params.gain / 100 : (clip.volume ?? 1);

      // Build audio effect chain: source -> [effects] -> gain -> [intrinsics] -> trackGain
      const effectNodes = this._buildAudioEffectChain(clip, this._ctx, currentFrame);
      let lastNode = source;
      for (const node of effectNodes) {
        if (node.input && node.output) {
          lastNode.connect(node.input);
          lastNode = node.output;
        } else {
          lastNode.connect(node);
          lastNode = node;
        }
      }
      lastNode.connect(gainNode);

      // Wire intrinsic audio effects (panner, channel-volume) after gain
      const intrinsicAudioNodes = this._buildIntrinsicAudioChain(clip, this._ctx, currentFrame);
      lastNode = gainNode;
      for (const node of intrinsicAudioNodes) {
        if (node.input && node.output) {
          lastNode.connect(node.input);
          lastNode = node.output;
        } else {
          lastNode.connect(node);
          lastNode = node;
        }
      }
      lastNode.connect(this._getTrackGain(track.id));

      sourceInfo = { source, gainNode, effectNodes, intrinsicAudioNodes, mediaElement: el };
      this._clipSources.set(clip.id, sourceInfo);

      el.currentTime = sourceTime;
      el.playbackRate = editorState.get('playback.speed') * clip.speed;
      await el.play().catch(err => logger.warn('Audio play failed:', err.message));
    } catch (err) {
      logger.warn(`Failed to start audio for clip ${clip.id}:`, err);
    }
  },

  _buildAudioEffectChain(clip, audioCtx, frame) {
    const nodes = [];
    const effects = (clip.effects || []).filter(fx => fx.enabled && !fx.intrinsic);

    for (const fx of effects) {
      const def = effectRegistry.get(fx.effectId);
      if (!def || def.type !== 'audio') continue;

      const params = keyframeEngine.resolveParams(fx, frame);

      if (def.createNode) {
        const node = def.createNode(audioCtx, params);
        if (node) nodes.push(node);
      }
    }

    return nodes;
  },

  _buildIntrinsicAudioChain(clip, audioCtx, frame) {
    const nodes = [];
    const nodeMap = new Map(); // effectId -> node, for per-frame automation
    const intrinsics = (clip.effects || []).filter(
      fx => fx.enabled && fx.intrinsic && fx.effectId !== 'audio-volume' && fx.effectId !== 'opacity' && fx.effectId !== 'motion' && fx.effectId !== 'time-remap'
    );

    for (const fx of intrinsics) {
      const def = effectRegistry.get(fx.effectId);
      if (!def || def.type !== 'audio' || !def.createNode) continue;

      const params = keyframeEngine.resolveParams(fx, frame);
      const node = def.createNode(audioCtx, params);
      if (node) {
        nodes.push(node);
        nodeMap.set(fx.effectId, node);
      }
    }

    // Attach map for automation lookups
    nodes._nodeMap = nodeMap;
    return nodes;
  },

  _updateActiveSources(frame) {
    const tracks = timelineEngine.getTracks();

    // Stop clips that are no longer active
    for (const [clipId, info] of this._clipSources) {
      const clip = timelineEngine.getClip(clipId);
      if (!clip || !clipContainsFrame(clip, frame)) {
        info.mediaElement.pause();
      }
    }

    // Start clips that should be playing
    for (const track of tracks) {
      if (track.type !== TRACK_TYPES.AUDIO) continue;
      if (track.muted) continue;
      for (const clip of track.clips) {
        if (clip.disabled) continue;
        if (!clipContainsFrame(clip, frame)) continue;
        if (!this._clipSources.has(clip.id)) {
          this._startClipAudio(clip, track, frame);
        }
      }
    }

    // Per-frame intrinsic audio updates (keyframe automation)
    for (const [clipId, info] of this._clipSources) {
      const clip = timelineEngine.getClip(clipId);
      if (!clip || !clipContainsFrame(clip, frame)) continue;

      // Volume
      const volFx = clip.effects?.find(fx => fx.intrinsic && fx.effectId === 'audio-volume');
      if (volFx) {
        const params = keyframeEngine.resolveParams(volFx, frame);
        info.gainNode.gain.value = params.gain / 100;
      }

      // Panner + Channel Volume automation on intrinsic nodes (map-based lookup)
      if (info.intrinsicAudioNodes?._nodeMap) {
        const nodeMap = info.intrinsicAudioNodes._nodeMap;
        const intrinsics = (clip.effects || []).filter(
          fx => fx.enabled && fx.intrinsic && fx.effectId !== 'audio-volume' && fx.effectId !== 'opacity' && fx.effectId !== 'motion' && fx.effectId !== 'time-remap'
        );
        for (const fx of intrinsics) {
          const def = effectRegistry.get(fx.effectId);
          if (!def || def.type !== 'audio' || !def.apply) continue;
          const node = nodeMap.get(fx.effectId);
          if (!node) continue;
          const params = keyframeEngine.resolveParams(fx, frame);
          def.apply(this._ctx, params, node);
        }
      }
    }

    // Audio crossfade during transitions (constant power)
    for (const track of tracks) {
      if (!track.transitions) continue;
      for (const trans of track.transitions) {
        const clipB = track.clips.find(c => c.id === trans.clipBId);
        if (!clipB || frame < clipB.startFrame || frame >= clipB.startFrame + trans.duration) continue;
        const progress = (frame - clipB.startFrame) / trans.duration;
        const gainA = Math.cos(progress * Math.PI / 2);
        const gainB = Math.sin(progress * Math.PI / 2);
        const infoA = this._clipSources.get(trans.clipAId);
        const infoB = this._clipSources.get(trans.clipBId);
        if (infoA) infoA.gainNode.gain.value *= gainA;
        if (infoB) infoB.gainNode.gain.value *= gainB;
        // Linked audio partners
        const clipA = track.clips.find(c => c.id === trans.clipAId);
        if (clipA?.linkedClipId) {
          const linked = this._clipSources.get(clipA.linkedClipId);
          if (linked) linked.gainNode.gain.value *= gainA;
        }
        if (clipB?.linkedClipId) {
          const linked = this._clipSources.get(clipB.linkedClipId);
          if (linked) linked.gainNode.gain.value *= gainB;
        }
      }
    }
  },

  _teardownClipSource(clipId) {
    const info = this._clipSources.get(clipId);
    if (!info) return;
    try {
      info.mediaElement.pause();
      info.source.disconnect();
      if (info.effectNodes) {
        for (const node of info.effectNodes) this._disconnectNode(node);
      }
      info.gainNode.disconnect();
      if (info.intrinsicAudioNodes) {
        for (const node of info.intrinsicAudioNodes) this._disconnectNode(node);
      }
    } catch (e) {}
    this._clipSources.delete(clipId);
  },

  _stopAllSources() {
    for (const clipId of [...this._clipSources.keys()]) {
      this._teardownClipSource(clipId);
    }
  },

  _disconnectNode(node) {
    if (node.input && node.output) {
      node.input.disconnect();
      node.output.disconnect();
      if (node._gainL) node._gainL.disconnect();
      if (node._gainR) node._gainR.disconnect();
    } else {
      node.disconnect();
    }
  },

  // Render audio mixdown to a buffer (for export)
  async mixdownToBuffer(startFrame, endFrame) {
    if (!this._ctx) {
      logger.warn('AudioMixer not initialized — cannot mix audio for export');
      return null;
    }

    // Ensure AudioContext is alive (may be suspended if user never played)
    if (this._ctx.state === 'suspended') {
      await this._ctx.resume();
    }

    const fps = editorState.get('project.frameRate');
    const duration = frameToSeconds(endFrame - startFrame);
    const sampleRate = this._ctx.sampleRate;
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);

    const tracks = timelineEngine.getTracks();
    const clipGainNodes = new Map(); // clipId -> gainNode for crossfade
    let audioClipCount = 0;
    let decodedClipCount = 0;

    // Parallel pre-load: fetch + decode all unique audio sources at once
    const neededMedia = new Map();
    for (const track of tracks) {
      if (track.type !== TRACK_TYPES.AUDIO || track.muted) continue;
      for (const clip of track.clips) {
        if (clip.disabled) continue;
        if (getClipEndFrame(clip) <= startFrame || clip.startFrame >= endFrame) continue;
        const item = mediaManager.getItem(clip.mediaId);
        if (item && !neededMedia.has(item.id)) neededMedia.set(item.id, item);
      }
    }
    await Promise.all(
      Array.from(neededMedia.values()).map(item => this._loadAudioBuffer(item))
    );

    for (const track of tracks) {
      if (track.type !== TRACK_TYPES.AUDIO) continue;
      if (track.muted) continue;

      for (const clip of track.clips) {
        if (clip.disabled) continue;
        const clipStart = clip.startFrame;
        const clipEnd = getClipEndFrame(clip);

        // Check overlap with render range
        if (clipEnd <= startFrame || clipStart >= endFrame) continue;

        audioClipCount++;
        const mediaItem = mediaManager.getItem(clip.mediaId);
        if (!mediaItem) { logger.warn(`Audio mixdown: clip ${clip.id} has no media item`); continue; }

        const buffer = await this._loadAudioBuffer(mediaItem);
        if (!buffer) { logger.warn(`Audio mixdown: failed to decode audio for "${mediaItem.name}"`); continue; }
        decodedClipCount++;

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;

        // Use intrinsic volume effect
        const volFx = clip.effects?.find(fx => fx.intrinsic && fx.effectId === 'audio-volume');
        const gainNode = offlineCtx.createGain();
        const baseGain = volFx ? volFx.params.gain / 100 : (clip.volume ?? 1);
        gainNode.gain.value = baseGain;

        // Schedule volume keyframe ramps
        if (volFx?.keyframes?.gain?.length > 0) {
          const kfs = [...volFx.keyframes.gain].sort((a, b) => a.frame - b.frame);
          const renderStart = Math.max(0, frameToSeconds(clipStart - startFrame));
          for (const kf of kfs) {
            const kfTime = renderStart + frameToSeconds(kf.frame - clipStart);
            if (kfTime >= 0 && kfTime <= duration) {
              gainNode.gain.linearRampToValueAtTime(kf.value / 100, kfTime);
            }
          }
        }

        // Wire audio effects into export chain (resolve at clip start frame)
        const effectNodes = this._buildAudioEffectChain(clip, offlineCtx, clip.startFrame);
        let lastNode = source;
        for (const node of effectNodes) {
          if (node.input && node.output) {
            lastNode.connect(node.input);
            lastNode = node.output;
          } else {
            lastNode.connect(node);
            lastNode = node;
          }
        }
        lastNode.connect(gainNode);

        // Wire intrinsic audio effects (panner, channel-volume) after gain
        const intrinsicNodes = this._buildIntrinsicAudioChain(clip, offlineCtx, clip.startFrame);
        lastNode = gainNode;
        for (const node of intrinsicNodes) {
          if (node.input && node.output) {
            lastNode.connect(node.input);
            lastNode = node.output;
          } else {
            lastNode.connect(node);
            lastNode = node;
          }
        }
        lastNode.connect(offlineCtx.destination);
        clipGainNodes.set(clip.id, gainNode);

        // Calculate timing
        const renderStart = Math.max(0, frameToSeconds(clipStart - startFrame));
        const sourceOffset = frameToSeconds(clip.sourceInFrame);
        const clipDuration = frameToSeconds(getClipDuration(clip));

        source.start(renderStart, sourceOffset, clipDuration);
      }

      // Schedule crossfade ramps for transitions on this track
      if (track.transitions) {
        for (const trans of track.transitions) {
          const gainA = clipGainNodes.get(trans.clipAId);
          const gainB = clipGainNodes.get(trans.clipBId);
          if (!gainA || !gainB) continue;

          const clipB = track.clips.find(c => c.id === trans.clipBId);
          if (!clipB) continue;

          const transStart = frameToSeconds(clipB.startFrame - startFrame);
          const transDur = frameToSeconds(trans.duration);
          const transEnd = transStart + transDur;

          // Constant power crossfade approximated with linear ramps
          gainA.gain.setValueAtTime(gainA.gain.value, transStart);
          gainA.gain.linearRampToValueAtTime(0, transEnd);
          gainB.gain.setValueAtTime(0, transStart);
          gainB.gain.linearRampToValueAtTime(gainB.gain.value, transEnd);
        }
      }
    }

    if (audioClipCount === 0) {
      logger.warn('Audio mixdown: no audio clips found in render range');
    } else if (decodedClipCount === 0) {
      logger.warn(`Audio mixdown: ${audioClipCount} clips found but none decoded successfully`);
    } else {
      logger.info(`Audio mixdown: ${decodedClipCount}/${audioClipCount} clips decoded`);
    }

    return offlineCtx.startRendering();
  },

  cleanup() {
    this._stopAllSources();
    this._audioBuffers.clear();
    this._trackGains.clear();
    this._trackAnalysers.clear();
    this._masterAnalyser = null;
    if (this._ctx && this._ctx.state !== 'closed') {
      this._ctx.close().catch(() => {});
    }
  }
};

export default audioMixer;
