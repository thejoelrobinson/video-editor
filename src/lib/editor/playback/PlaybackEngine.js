// rAF-based playback loop with frame-accurate seeking and speed control
import { editorState } from '../core/EditorState.js';
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS } from '../core/Constants.js';
import { frameToSeconds, secondsToFrame } from '../timeline/TimelineMath.js';
import { timelineEngine } from '../timeline/TimelineEngine.js';
import { getClipEndFrame } from '../timeline/Clip.js';
import { renderAheadManager } from '../media/RenderAheadManager.js';
import { audioMixer } from './AudioMixer.js';
import { rafScheduler, PRIORITY } from '../core/RafScheduler.js';
import logger from '../../utils/logger.js';

export const playbackEngine = {
  _rafId: null,
  _schedulerId: null,
  _startTime: 0,
  _startFrame: 0,
  _lastRenderedFrame: -1,
  _droppedFrameCount: 0,
  _audioStartCtxTime: 0,

  getDroppedFrameCount() {
    return this._droppedFrameCount;
  },

  init() {
    if (!this._schedulerId) {
      this._schedulerId = rafScheduler.register((ts) => this._tick(ts), PRIORITY.PLAYBACK);
    }
  },

  play() {
    if (editorState.get('playback.playing')) return;
    editorState.set('playback.playing', true);
    this._startTime = performance.now();
    this._startFrame = editorState.get('playback.currentFrame');
    this._lastRenderedFrame = this._startFrame;
    this._droppedFrameCount = 0;
    // Capture AudioContext time at play start for A/V sync
    const ctx = audioMixer.getContext();
    this._audioStartCtxTime = ctx ? ctx.currentTime : 0;
    if (this._schedulerId) {
      rafScheduler.activate(this._schedulerId);
    } else {
      this._tick();
    }
    eventBus.emit(EDITOR_EVENTS.PLAYBACK_START);
  },

  pause() {
    if (!editorState.get('playback.playing')) return;
    editorState.set('playback.playing', false);
    if (this._schedulerId) {
      rafScheduler.deactivate(this._schedulerId);
    }
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    eventBus.emit(EDITOR_EVENTS.PLAYBACK_STOP);
  },

  togglePlay() {
    if (editorState.get('playback.playing')) {
      this.pause();
    } else {
      this.play();
    }
  },

  stop() {
    this.pause();
    this.seek(0);
  },

  seek(frame) {
    frame = Math.max(0, Math.round(frame));
    const duration = timelineEngine.getDuration();
    if (frame > duration) frame = duration;
    editorState.set('playback.currentFrame', frame);
    if (editorState.get('playback.playing')) {
      this._startTime = performance.now();
      this._startFrame = frame;
      this._lastRenderedFrame = frame;
      const ctx = audioMixer.getContext();
      this._audioStartCtxTime = ctx ? ctx.currentTime : 0;
    }
    eventBus.emit(EDITOR_EVENTS.PLAYBACK_SEEK, { frame });
    eventBus.emit(EDITOR_EVENTS.PLAYBACK_FRAME, { frame });

    // Pre-fill buffer around seek position
    renderAheadManager.requestAhead(frame, 10);
  },

  seekRelative(deltaFrames) {
    const current = editorState.get('playback.currentFrame');
    this.seek(current + deltaFrames);
  },

  setSpeed(speed) {
    const wasPlaying = editorState.get('playback.playing');
    if (wasPlaying) {
      // Recalculate start to maintain position
      this._startFrame = editorState.get('playback.currentFrame');
      this._startTime = performance.now();
      this._lastRenderedFrame = this._startFrame;
      const ctx = audioMixer.getContext();
      this._audioStartCtxTime = ctx ? ctx.currentTime : 0;
    }
    editorState.set('playback.speed', speed);
  },

  getCurrentFrame() {
    return editorState.get('playback.currentFrame');
  },

  _getEditPoints() {
    const points = new Set([0, timelineEngine.getDuration()]);
    for (const track of timelineEngine.getTracks()) {
      if (track.locked) continue;
      for (const clip of track.clips) {
        points.add(clip.startFrame);
        points.add(getClipEndFrame(clip));
      }
    }
    return Array.from(points).sort((a, b) => a - b);
  },

  seekToNextEditPoint() {
    const current = this.getCurrentFrame();
    const points = this._getEditPoints();
    const next = points.find(p => p > current);
    this.seek(next !== undefined ? next : timelineEngine.getDuration());
  },

  seekToPreviousEditPoint() {
    const current = this.getCurrentFrame();
    const points = this._getEditPoints();
    let prev = 0;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i] < current) {
        prev = points[i];
        break;
      }
    }
    this.seek(prev);
  },

  _tick() {
    if (!editorState.get('playback.playing')) {
      if (this._schedulerId) rafScheduler.deactivate(this._schedulerId);
      return;
    }

    const speed = editorState.get('playback.speed');
    const fps = editorState.get('project.frameRate');

    // Derive target frame from AudioContext time (authoritative) or wall-clock fallback
    let elapsed;
    const ctx = audioMixer.getContext();
    if (ctx && ctx.state === 'running') {
      elapsed = (ctx.currentTime - this._audioStartCtxTime) * speed;
    } else {
      elapsed = ((performance.now() - this._startTime) / 1000) * speed;
    }
    const frameOffset = Math.floor(elapsed * fps);
    let targetFrame = this._startFrame + frameOffset;

    const duration = timelineEngine.getDuration();
    const loop = editorState.get('playback.loop');
    const inPoint = editorState.get('playback.inPoint');
    const outPoint = editorState.get('playback.outPoint');

    // Use in/out points for loop region if set
    const loopStart = inPoint ?? 0;
    const loopEnd = outPoint ?? duration;

    if (targetFrame >= loopEnd) {
      if (loop) {
        targetFrame = loopStart;
        this._startFrame = loopStart;
        this._startTime = performance.now();
        this._lastRenderedFrame = loopStart;
        this._audioStartCtxTime = ctx ? ctx.currentTime : 0;
      } else {
        targetFrame = loopEnd;
        this.pause();
      }
    }

    // Count dropped frames (frames we skipped over without rendering)
    const skipped = targetFrame - this._lastRenderedFrame - 1;
    if (skipped > 0) {
      this._droppedFrameCount += skipped;
    }
    this._lastRenderedFrame = targetFrame;

    // Periodic dropped frame logging (every 30 rendered frames)
    if (this._droppedFrameCount > 0 && targetFrame % 30 === 0) {
      logger.debug(`[PlaybackEngine] Dropped ${this._droppedFrameCount} frames so far`);
    }

    editorState.set('playback.currentFrame', targetFrame);
    eventBus.emit(EDITOR_EVENTS.PLAYBACK_FRAME, { frame: targetFrame });

    // Keep render-ahead buffer filled during playback (throttle to every 5 frames)
    if (targetFrame % 5 === 0) {
      renderAheadManager.requestAhead(targetFrame, 15);
    }

    // Self-schedule only if not using the centralized scheduler
    if (!this._schedulerId) {
      this._rafId = requestAnimationFrame(() => this._tick());
    }
  }
};

export default playbackEngine;
