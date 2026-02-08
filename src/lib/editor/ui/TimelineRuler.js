// Timecode ruler with zoom-adaptive tick marks
import { editorState } from '../core/EditorState.js';
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS, TIMELINE_DEFAULTS } from '../core/Constants.js';
import { frameToPixel, frameToTimecode, getRulerTickInterval, pixelToFrame } from '../timeline/TimelineMath.js';
import { timelineEngine } from '../timeline/TimelineEngine.js';
import { playbackEngine } from '../playback/PlaybackEngine.js';
import { renderBarOverlay } from './RenderBarOverlay.js';
import { conformBarOverlay } from './ConformBarOverlay.js';

export const timelineRuler = {
  _canvas: null,
  _ctx: null,
  _container: null,

  init(container) {
    this._container = container;
    this._canvas = container.querySelector('.nle-ruler-canvas');
    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
      this._canvas.className = 'nle-ruler-canvas';
      container.appendChild(this._canvas);
    }
    this._ctx = this._canvas.getContext('2d', { alpha: false });

    // Click to seek
    this._canvas.addEventListener('mousedown', (e) => {
      this._handleSeek(e);
      const onMove = (e2) => this._handleSeek(e2);
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    eventBus.on(EDITOR_EVENTS.PLAYBACK_FRAME, () => this.render());
    eventBus.on(EDITOR_EVENTS.ZOOM_CHANGED, () => this.render());
    eventBus.on(EDITOR_EVENTS.SCROLL_CHANGED, () => this.render());
    eventBus.on(EDITOR_EVENTS.TIMELINE_UPDATED, () => this.render());
    eventBus.on(EDITOR_EVENTS.RENDER_BUFFER_CHANGED, () => this.render());
    eventBus.on(EDITOR_EVENTS.CONFORM_BUFFER_CHANGED, () => this.render());

    // Re-render when in/out points change
    editorState.subscribe('playback.inPoint', () => this.render());
    editorState.subscribe('playback.outPoint', () => this.render());

    new ResizeObserver(() => this.render()).observe(container);
    this.render();
  },

  _handleSeek(e) {
    const rect = this._canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const scrollX = editorState.get('timeline.scrollX');
    const frame = pixelToFrame(x + scrollX);
    playbackEngine.seek(Math.max(0, frame));
  },

  render() {
    if (!this._canvas || !this._ctx) return;

    const container = this._container;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this._canvas.width = rect.width * dpr;
    this._canvas.height = TIMELINE_DEFAULTS.RULER_HEIGHT * dpr;
    this._canvas.style.width = `${rect.width}px`;
    this._canvas.style.height = `${TIMELINE_DEFAULTS.RULER_HEIGHT}px`;

    const ctx = this._ctx;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = TIMELINE_DEFAULTS.RULER_HEIGHT;
    const scrollX = editorState.get('timeline.scrollX');
    const interval = getRulerTickInterval();
    const fps = editorState.get('project.frameRate');

    // Background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, w, h);

    // Ticks and labels
    const startFrame = pixelToFrame(scrollX);
    const endFrame = pixelToFrame(scrollX + w);
    const firstTick = Math.floor(startFrame / interval) * interval;

    ctx.fillStyle = '#888';
    ctx.strokeStyle = '#555';
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';

    for (let frame = firstTick; frame <= endFrame; frame += interval) {
      const x = frameToPixel(frame) - scrollX;

      // Major tick
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, h - 10);
      ctx.stroke();

      // Label
      ctx.fillText(frameToTimecode(frame), x, h - 14);

      // Minor ticks (subdivide)
      const subInterval = interval / 4;
      if (subInterval >= 1) {
        for (let sub = 1; sub < 4; sub++) {
          const subFrame = frame + sub * subInterval;
          const subX = frameToPixel(subFrame) - scrollX;
          ctx.beginPath();
          ctx.moveTo(subX, h);
          ctx.lineTo(subX, h - 5);
          ctx.stroke();
        }
      }
    }

    // Render bars (green/yellow/red performance indicators)
    renderBarOverlay.draw(ctx, w, h, scrollX);

    // Conform bars (blue — pre-encoded at sequence settings)
    conformBarOverlay.draw(ctx, w, h, scrollX);

    // In/Out point region (like Premiere's blue highlight between I and O)
    const inPoint = editorState.get('playback.inPoint');
    const outPoint = editorState.get('playback.outPoint');

    if (inPoint !== null || outPoint !== null) {
      const inX = inPoint !== null ? frameToPixel(inPoint) - scrollX : 0;
      const outX = outPoint !== null ? frameToPixel(outPoint) - scrollX : w;

      // Shaded region between in and out
      ctx.fillStyle = 'rgba(66, 133, 244, 0.15)';
      ctx.fillRect(inX, 0, outX - inX, h);

      // Dim regions outside in/out range
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      if (inPoint !== null && inX > 0) {
        ctx.fillRect(0, 0, inX, h);
      }
      if (outPoint !== null && outX < w) {
        ctx.fillRect(outX, 0, w - outX, h);
      }

      // In point bracket
      if (inPoint !== null) {
        ctx.fillStyle = '#4285f4';
        ctx.fillRect(inX, 0, 2, h);
        // Bracket shape
        ctx.fillRect(inX, 0, 6, 2);
        ctx.fillRect(inX, h - 2, 6, 2);
      }

      // Out point bracket
      if (outPoint !== null) {
        ctx.fillStyle = '#4285f4';
        ctx.fillRect(outX - 2, 0, 2, h);
        // Bracket shape
        ctx.fillRect(outX - 6, 0, 6, 2);
        ctx.fillRect(outX - 6, h - 2, 6, 2);
      }
    }

    // Playhead indicator
    const currentFrame = editorState.get('playback.currentFrame');
    const playheadX = frameToPixel(currentFrame) - scrollX;
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.moveTo(playheadX - 5, 0);
    ctx.lineTo(playheadX + 5, 0);
    ctx.lineTo(playheadX + 5, 8);
    ctx.lineTo(playheadX, 14);
    ctx.lineTo(playheadX - 5, 8);
    ctx.closePath();
    ctx.fill();

    // Bottom border
    ctx.strokeStyle = '#333';
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();
  }
};

export default timelineRuler;
