// Output preview canvas with fit-to-panel scaling
// Supports two modes:
//   1. Worker mode: display canvas transferred to CompositorWorker via OffscreenCanvas.
//      Worker draws directly to the visible canvas. ProgramMonitor only manages sizing.
//   2. Main-thread mode (fallback): compositor renders to hidden canvas,
//      ProgramMonitor blits to display canvas.
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS } from '../core/Constants.js';
import { editorState } from '../core/EditorState.js';
import { videoCompositor } from '../playback/VideoCompositor.js';
import logger from '../../utils/logger.js';

export const programMonitor = {
  _container: null,
  _canvas: null,          // Hidden compositing canvas (main-thread mode only)
  _displayCanvas: null,   // Visible canvas element
  _displayCtx: null,      // 2D context (main-thread mode only; null in worker mode)
  _resizeObserver: null,
  _rendering: false,
  _pendingFrame: null,
  _workerMode: false,     // True if compositor worker owns the display canvas

  init(container) {
    if (!container) {
      this._container = document.querySelector('.nle-program-monitor');
    } else {
      this._container = container;
    }
    if (!this._container) return;

    this._previewArea = this._container.querySelector('.nle-program-preview');
    if (!this._previewArea) {
      this._previewArea = this._container;
    }

    // Create (or find) the display canvas
    this._displayCanvas = this._previewArea.querySelector('.nle-program-canvas');
    if (!this._displayCanvas) {
      this._displayCanvas = document.createElement('canvas');
      this._displayCanvas.className = 'nle-program-canvas';
      this._displayCanvas.width = 960;
      this._displayCanvas.height = 540;
      this._previewArea.appendChild(this._displayCanvas);
    }

    // Try to set up compositor worker with the display canvas.
    // If successful, the worker owns the display canvas (OffscreenCanvas) and
    // draws directly to it. We don't need a separate compositing canvas.
    this._workerMode = videoCompositor.initWorker(this._displayCanvas);

    if (this._workerMode) {
      // Worker mode: create a hidden compositing canvas for the main-thread
      // fallback path (compositeFrameTo for export still needs it).
      this._canvas = document.createElement('canvas');
      videoCompositor.init(this._canvas);
      // No display context — worker draws directly to the display canvas
      this._displayCtx = null;
    } else {
      // Main-thread mode: same as before
      this._displayCtx = this._displayCanvas.getContext('2d', { alpha: false });
      this._canvas = document.createElement('canvas');
      videoCompositor.init(this._canvas);
    }

    // Resize display canvas to fit panel
    this._resizeObserver = new ResizeObserver(() => {
      this._fitCanvas();
      const clips = editorState.get('timeline.tracks');
      if (!clips || clips.length === 0) {
        if (!this._workerMode) this._drawPlaceholder();
      } else {
        this._requestRender();
      }
    });
    this._resizeObserver.observe(this._previewArea);
    this._fitCanvas();

    if (!this._workerMode) {
      this._drawPlaceholder();
    }

    // Refit display canvas when sequence resolution changes
    editorState.subscribe('project.canvas', () => {
      this._fitCanvas();
      this._requestRender();
    });

    // Listen for frame updates
    eventBus.on(EDITOR_EVENTS.PLAYBACK_FRAME, () => this._requestRender());
    eventBus.on(EDITOR_EVENTS.PLAYBACK_SEEK, () => this._requestRender());
    eventBus.on(EDITOR_EVENTS.TIMELINE_UPDATED, () => this._requestRender());

    // On sequence switch, refit canvas for new resolution
    eventBus.on(EDITOR_EVENTS.SEQUENCE_ACTIVATED, () => {
      this._fitCanvas();
      this._requestRender();
    });
  },

  _drawPlaceholder() {
    if (!this._displayCtx || !this._displayCanvas) return;
    const w = this._displayCanvas.width;
    const h = this._displayCanvas.height;
    this._displayCtx.fillStyle = '#000';
    this._displayCtx.fillRect(0, 0, w, h);
    this._displayCtx.fillStyle = '#555';
    this._displayCtx.font = '14px sans-serif';
    this._displayCtx.textAlign = 'center';
    this._displayCtx.textBaseline = 'middle';
    this._displayCtx.fillText('No Sequence', w / 2, h / 2);
  },

  _fitCanvas() {
    if (!this._previewArea || !this._displayCanvas) return;
    const rect = this._previewArea.getBoundingClientRect();
    const { width: projW, height: projH } = editorState.get('project.canvas');

    const containerW = rect.width - 16;
    const containerH = rect.height - 16;
    const scale = Math.min(containerW / projW, containerH / projH);

    const newW = Math.round(projW * scale);
    const newH = Math.round(projH * scale);

    if (this._workerMode) {
      // In worker mode, the worker owns the canvas bitmap dimensions (project resolution).
      // We only update CSS sizing here to scale the canvas to fit the panel.
      this._displayCanvas.style.width = `${newW}px`;
      this._displayCanvas.style.height = `${newH}px`;
    } else {
      this._displayCanvas.width = newW;
      this._displayCanvas.height = newH;
      this._displayCanvas.style.width = `${newW}px`;
      this._displayCanvas.style.height = `${newH}px`;
    }
  },

  _requestRender() {
    const frame = editorState.get('playback.currentFrame');
    if (this._rendering) {
      this._pendingFrame = frame;
      return;
    }
    this._processRender(frame);
  },

  async _processRender(frame) {
    this._rendering = true;
    this._pendingFrame = null;

    try {
      await this._renderFrame(frame);
    } catch (e) {
      logger.warn('ProgramMonitor render error:', e);
    }

    this._rendering = false;

    if (this._pendingFrame !== null) {
      const next = this._pendingFrame;
      this._pendingFrame = null;
      this._processRender(next);
    }
  },

  async _renderFrame(frame) {
    if (this._workerMode) {
      // Worker mode: just tell the compositor to render.
      // The worker draws directly to the OffscreenCanvas (display canvas).
      await videoCompositor.compositeFrame(frame);
      // No blit needed — the worker canvas IS the display canvas.
    } else {
      // Main-thread mode: compositor renders to hidden canvas, we blit to display.
      await videoCompositor.compositeFrame(frame);

      if (this._displayCtx && this._canvas) {
        this._displayCtx.clearRect(0, 0, this._displayCanvas.width, this._displayCanvas.height);
        this._displayCtx.drawImage(
          this._canvas,
          0, 0, this._canvas.width, this._canvas.height,
          0, 0, this._displayCanvas.width, this._displayCanvas.height
        );
      }
    }
  },

  cleanup() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
    this._rendering = false;
    this._pendingFrame = null;
    this._workerMode = false;
    videoCompositor.cleanup();
  }
};

export default programMonitor;
