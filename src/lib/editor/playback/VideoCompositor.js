// Multi-track video compositing on a canvas
// Supports two modes:
//   1. OffscreenCanvas worker (default) — compositing off the main thread
//   2. Main-thread fallback — direct Canvas2D rendering (used if worker unavailable or for export)
import { editorState } from '../core/EditorState.js';
import { timelineEngine } from '../timeline/TimelineEngine.js';
import { clipContainsFrame, getSourceFrameAtPlayhead } from '../timeline/Clip.js';
import { frameToSeconds } from '../timeline/TimelineMath.js';
import { MEDIA_TYPES } from '../core/Constants.js';
import { mediaManager } from '../media/MediaManager.js';
import { mediaDecoder } from '../media/MediaDecoder.js';
import { renderAheadManager } from '../media/RenderAheadManager.js';
import { effectRegistry } from '../effects/EffectRegistry.js';
import { keyframeEngine } from '../effects/KeyframeEngine.js';
import { transitions } from '../effects/Transitions.js';
import { glEffectRenderer } from '../effects/GLEffectRenderer.js';
import logger from '../../utils/logger.js';

export const videoCompositor = {
  _canvas: null,
  _ctx: null,
  _offscreenCanvas: null,
  _offscreenCtx: null,
  _transCanvases: [null, null],
  _transCtxs: [null, null],
  _glAvailable: false,
  _exportCanvases: null,

  // Worker compositing state
  _worker: null,
  _workerReady: false,
  _workerBusy: false,
  _useWorker: false,
  _pendingResolve: null,
  _displayCanvas: null,  // the visible <canvas> element (for worker mode)
  _displayCtx: null,

  init(canvas) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d', { alpha: false });
    this._resizeCanvas();
    this._glAvailable = glEffectRenderer.isSupported() && glEffectRenderer.init();

    // Resize compositor canvas when sequence resolution changes
    editorState.subscribe('project.canvas', () => this._resizeCanvas());
  },

  // Initialize compositor worker with OffscreenCanvas transfer.
  // displayCanvas is the visible <canvas> element shown to the user.
  // Returns true if worker was successfully set up.
  initWorker(displayCanvas) {
    if (this._worker) return true;

    // Feature-detect OffscreenCanvas transfer
    if (typeof displayCanvas.transferControlToOffscreen !== 'function') {
      logger.warn('[VideoCompositor] OffscreenCanvas not supported, using main-thread rendering');
      return false;
    }

    try {
      this._worker = new Worker(
        new URL('./CompositorWorker.js', import.meta.url),
        { type: 'module' }
      );
    } catch (err) {
      logger.warn('[VideoCompositor] Failed to create compositor worker:', err.message);
      return false;
    }

    this._displayCanvas = displayCanvas;

    let offscreen;
    try {
      offscreen = displayCanvas.transferControlToOffscreen();
    } catch (err) {
      logger.warn('[VideoCompositor] Failed to transfer canvas to offscreen:', err.message);
      this._worker.terminate();
      this._worker = null;
      return false;
    }

    const { width, height } = editorState.get('project.canvas');

    this._worker.onmessage = (e) => this._onWorkerMessage(e);
    this._worker.onerror = (err) => {
      logger.warn('[VideoCompositor] Worker error:', err.message || err);
    };

    this._worker.postMessage(
      { type: 'init', canvas: offscreen, width, height },
      [offscreen]
    );

    this._useWorker = true;
    logger.info('[VideoCompositor] Compositor worker initialized');
    return true;
  },

  _onWorkerMessage(e) {
    const { type } = e.data;

    if (type === 'init_done') {
      this._workerReady = true;
      logger.info(`[VideoCompositor] Worker ready (GL: ${e.data.glAvailable})`);
      return;
    }

    if (type === 'rendered') {
      this._workerBusy = false;
      if (this._pendingResolve) {
        const resolve = this._pendingResolve;
        this._pendingResolve = null;
        resolve();
      }
      return;
    }
  },

  isWorkerBusy() {
    return this._workerBusy;
  },

  // Build a serializable render command for the worker.
  // Resolves keyframes, fetches frames, collects effect params — all on main thread.
  // Returns { command, transferables } where transferables is an array of ImageBitmaps.
  async _buildRenderCommand(frame) {
    const { width: canvasWidth, height: canvasHeight } = editorState.get('project.canvas');
    const videoTracks = timelineEngine.getVideoTracks();
    const trackCommands = [];
    const transferables = [];

    // Iterate forward so the worker's reverse loop draws bottom tracks first,
    // top tracks last (matching main-thread compositing order).
    for (let i = 0; i < videoTracks.length; i++) {
      const track = videoTracks[i];
      if (track.muted) continue;

      const activeTrans = this._getActiveTransitions(track, frame);
      const transClipIds = new Set();
      for (const t of activeTrans) {
        transClipIds.add(t.clipAId);
        transClipIds.add(t.clipBId);
      }

      const clipCommands = [];
      const transCommands = [];

      // Build clip commands (non-transition clips)
      for (const clip of track.clips) {
        if (clip.disabled) continue;
        if (!clipContainsFrame(clip, frame)) continue;
        if (transClipIds.has(clip.id)) continue;

        const mediaItem = mediaManager.getItem(clip.mediaId);
        if (!mediaItem) continue;

        const clipCmd = await this._buildClipCommand(clip, mediaItem, frame, canvasWidth, canvasHeight);
        if (clipCmd) {
          clipCommands.push(clipCmd.command);
          transferables.push(...clipCmd.transferables);
        }
      }

      // Build transition commands
      for (const trans of activeTrans) {
        const clipA = track.clips.find(c => c.id === trans.clipAId);
        const clipB = track.clips.find(c => c.id === trans.clipBId);
        if (!clipA || !clipB) continue;

        const progress = (frame - clipB.startFrame) / trans.duration;
        let clipACmd = null;
        let clipBCmd = null;

        const mediaA = mediaManager.getItem(clipA.mediaId);
        if (mediaA) {
          const srcA = getSourceFrameAtPlayhead(clipA, frame);
          if (srcA !== null) {
            const result = await this._buildClipCommand(clipA, mediaA, frame, canvasWidth, canvasHeight);
            if (result) {
              clipACmd = result.command;
              transferables.push(...result.transferables);
            }
          }
        }

        const mediaB = mediaManager.getItem(clipB.mediaId);
        if (mediaB) {
          const srcB = getSourceFrameAtPlayhead(clipB, frame);
          if (srcB !== null) {
            const result = await this._buildClipCommand(clipB, mediaB, frame, canvasWidth, canvasHeight);
            if (result) {
              clipBCmd = result.command;
              transferables.push(...result.transferables);
            }
          }
        }

        transCommands.push({
          type: trans.type,
          progress,
          clipA: clipACmd,
          clipB: clipBCmd
        });
      }

      trackCommands.push({ clips: clipCommands, transitions: transCommands });
    }

    return {
      command: { canvasWidth, canvasHeight, tracks: trackCommands },
      transferables
    };
  },

  // Build a single clip's render command.
  // Returns { command, transferables } or null if no frame available.
  async _buildClipCommand(clip, mediaItem, frame, canvasWidth, canvasHeight) {
    const sourceFrame = getSourceFrameAtPlayhead(clip, frame);
    const sourceTime = frameToSeconds(sourceFrame);

    // Fetch the frame as ImageBitmap
    let bitmap = null;
    if (mediaItem.type === MEDIA_TYPES.VIDEO) {
      bitmap = renderAheadManager.getFrame(mediaItem.id, sourceTime);
      if (!bitmap) {
        bitmap = await mediaDecoder.getFrame(mediaItem.id, mediaItem.url, sourceTime);
      }
    } else if (mediaItem.type === MEDIA_TYPES.IMAGE) {
      bitmap = await this._getImageBitmap(mediaItem);
    }

    if (!bitmap) return null;

    // Pass cached ImageBitmaps directly — structured clone in postMessage
    // copies them efficiently (browser-optimized, often GPU-accelerated).
    // Do NOT transfer (detaches from cache) or clone via createImageBitmap
    // (slow ~2-5ms per 1080p frame). If a bitmap was .close()'d by cache
    // eviction between here and postMessage, the DataCloneError is caught
    // in _compositeFrameWorker and falls back to main-thread rendering.
    const transferBitmap = bitmap;

    // Resolve effects
    const effects = (clip.effects || []).filter(fx => fx.enabled);
    const needsProcessing = effects.some(fx => {
      if (fx.intrinsic && fx.effectId === 'opacity') {
        return (fx.keyframes?.opacity?.length > 0) || fx.params.opacity !== 100;
      }
      if (fx.intrinsic && fx.effectId === 'audio-volume') return false;
      if (fx.intrinsic && fx.effectId === 'motion') {
        return this._motionNeedsProcessing(fx, canvasWidth, canvasHeight);
      }
      if (fx.intrinsic && fx.effectId === 'time-remap') return false;
      if (fx.intrinsic && (fx.effectId === 'panner' || fx.effectId === 'channel-volume')) return false;
      return true;
    });

    const resolvedEffects = [];
    for (const fx of effects) {
      const def = effectRegistry.get(fx.effectId);
      if (!def || def.type !== 'video') continue;
      const resolvedParams = keyframeEngine.resolveParams(fx, frame);
      // Replace non-cloneable GL texture handles with raw Uint8Array data for worker
      // (WebGLTexture objects cause DataCloneError during structured clone)
      let workerParams = resolvedParams;
      if (resolvedParams._curveLUT || resolvedParams._hslCurveLUT) {
        workerParams = { ...resolvedParams };
        delete workerParams._curveLUT;
        delete workerParams._hslCurveLUT;
        // Pass raw LUT data so the worker can upload its own textures
        // _curveLUTData / _hslCurveLUTData are Uint8Arrays (cloneable)
      }
      resolvedEffects.push({
        effectId: fx.effectId,
        intrinsic: !!fx.intrinsic,
        type: def.type,
        resolvedParams: workerParams
      });
    }

    return {
      command: {
        clipId: clip.id,
        frame: transferBitmap,
        needsProcessing,
        effects: resolvedEffects
      },
      // Intentionally empty — bitmaps use structured clone (not transfer) to preserve render-ahead cache references
      transferables: []
    };
  },

  // Get an ImageBitmap from an image media item (cached)
  async _getImageBitmap(mediaItem) {
    let img = this._getImageCache(mediaItem.id);
    if (!img) {
      img = new Image();
      img.src = mediaItem.url;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      this._setImageCache(mediaItem.id, img);
    }
    return img;
  },

  // Primary compositing entry point.
  // If worker is available: builds render command, sends to worker.
  // Otherwise: renders on main thread (original path).
  async compositeFrame(frame) {
    if (this._useWorker && this._workerReady) {
      return this._compositeFrameWorker(frame);
    }
    return this._compositeFrameMainThread(frame);
  },

  async _compositeFrameWorker(frame) {
    if (this._workerBusy) return; // Backpressure: skip if worker still rendering
    this._workerBusy = true;

    try {
      const { command, transferables } = await this._buildRenderCommand(frame);

      return new Promise((resolve) => {
        this._pendingResolve = resolve;
        try {
          this._worker.postMessage(
            { type: 'render', frame, command },
            transferables
          );
        } catch (postErr) {
          // DataCloneError: a cached ImageBitmap was .close()'d between
          // buildRenderCommand and postMessage (rare race with cache eviction).
          // Fall back to main-thread rendering for this frame.
          this._workerBusy = false;
          this._pendingResolve = null;
          resolve();
          this._compositeFrameMainThread(frame);
        }
      });
    } catch (e) {
      this._workerBusy = false;
      return this._compositeFrameMainThread(frame);
    }
  },

  // Original main-thread compositing (kept as fallback + used by export)
  async _compositeFrameMainThread(frame) {
    if (!this._canvas) return;

    const ctx = this._ctx;
    const { width, height } = editorState.get('project.canvas');

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const videoTracks = timelineEngine.getVideoTracks();

    for (let i = videoTracks.length - 1; i >= 0; i--) {
      const track = videoTracks[i];
      if (track.muted) continue;

      const activeTrans = this._getActiveTransitions(track, frame);
      const transClipIds = new Set();
      for (const t of activeTrans) {
        transClipIds.add(t.clipAId);
        transClipIds.add(t.clipBId);
      }

      for (const clip of track.clips) {
        if (clip.disabled) continue;
        if (!clipContainsFrame(clip, frame)) continue;
        if (transClipIds.has(clip.id)) continue;

        const mediaItem = mediaManager.getItem(clip.mediaId);
        if (!mediaItem) continue;

        const sourceFrame = getSourceFrameAtPlayhead(clip, frame);
        const sourceTime = frameToSeconds(sourceFrame);

        await this._renderClip(ctx, mediaItem, sourceTime, width, height, clip, frame);
      }

      for (const trans of activeTrans) {
        await this._renderTransition(ctx, track, trans, frame, width, height);
      }
    }
  },

  _resizeCanvas() {
    const { width, height } = editorState.get('project.canvas');
    if (this._canvas) {
      this._canvas.width = width;
      this._canvas.height = height;
    }
    // Resize worker canvas too
    if (this._worker && this._workerReady) {
      this._worker.postMessage({ type: 'resize', width, height });
    }
  },

  _getOffscreenCtx(width, height) {
    if (!this._offscreenCanvas) {
      this._offscreenCanvas = document.createElement('canvas');
      this._offscreenCtx = this._offscreenCanvas.getContext('2d');
    }
    if (this._offscreenCanvas.width !== width) this._offscreenCanvas.width = width;
    if (this._offscreenCanvas.height !== height) this._offscreenCanvas.height = height;
    return this._offscreenCtx;
  },

  async _renderClip(ctx, mediaItem, sourceTime, canvasWidth, canvasHeight, clip, frame) {
    const effects = (clip.effects || []).filter(fx => fx.enabled);

    const needsProcessing = effects.some(fx => {
      if (fx.intrinsic && fx.effectId === 'opacity') {
        return (fx.keyframes?.opacity?.length > 0) || fx.params.opacity !== 100;
      }
      if (fx.intrinsic && fx.effectId === 'audio-volume') return false;
      if (fx.intrinsic && fx.effectId === 'motion') {
        return this._motionNeedsProcessing(fx, canvasWidth, canvasHeight);
      }
      if (fx.intrinsic && fx.effectId === 'time-remap') return false;
      if (fx.intrinsic && (fx.effectId === 'panner' || fx.effectId === 'channel-volume')) return false;
      return true;
    });

    if (!needsProcessing) {
      if (mediaItem.type === MEDIA_TYPES.IMAGE) {
        await this._renderImage(ctx, mediaItem, canvasWidth, canvasHeight, clip);
      } else if (mediaItem.type === MEDIA_TYPES.VIDEO) {
        await this._renderVideo(ctx, mediaItem, sourceTime, canvasWidth, canvasHeight, clip);
      }
      return;
    }

    const offCtx = this._getOffscreenCtx(canvasWidth, canvasHeight);
    offCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    if (mediaItem.type === MEDIA_TYPES.IMAGE) {
      await this._renderImage(offCtx, mediaItem, canvasWidth, canvasHeight, clip);
    } else if (mediaItem.type === MEDIA_TYPES.VIDEO) {
      await this._renderVideo(offCtx, mediaItem, sourceTime, canvasWidth, canvasHeight, clip);
    }

    let motionParams = null;
    let transformParams = null;
    let opacity = 1;
    const pixelEffects = [];

    for (const fx of effects) {
      const def = effectRegistry.get(fx.effectId);
      if (!def || def.type !== 'video') continue;

      const params = keyframeEngine.resolveParams(fx, frame);

      if (fx.effectId === 'motion' && fx.intrinsic) {
        motionParams = params;
      } else if (fx.effectId === 'transform') {
        transformParams = params;
      } else if (fx.effectId === 'opacity') {
        opacity = params.opacity / 100;
      } else if (fx.effectId === 'crop') {
        def.apply(offCtx, params);
      } else if (fx.effectId === 'time-remap') {
        // Handled by clip source frame calc
      } else {
        pixelEffects.push({ fx, def, params });
      }
    }

    if (pixelEffects.length > 0) {
      const useGL = this._glAvailable &&
        pixelEffects.every(e => glEffectRenderer.hasShader(e.fx.effectId));

      if (useGL) {
        glEffectRenderer.uploadSource(this._offscreenCanvas, canvasWidth, canvasHeight);
        for (const { fx, params } of pixelEffects) {
          glEffectRenderer.applyEffect(fx.effectId, params);
        }
        offCtx.clearRect(0, 0, canvasWidth, canvasHeight);
        glEffectRenderer.readResult(offCtx);
      } else {
        for (const { def, params } of pixelEffects) {
          def.apply(offCtx, params);
        }
      }
    }

    if (motionParams) {
      this._applyMotionCrop(offCtx, motionParams, canvasWidth, canvasHeight);
    }

    ctx.save();

    if (motionParams) {
      const sy = motionParams.scale / 100;
      const sx = motionParams.uniformScale ? sy : motionParams.scaleWidth / 100;
      ctx.translate(motionParams.posX, motionParams.posY);
      ctx.rotate((motionParams.rotation * Math.PI) / 180);
      ctx.scale(sx, sy);
      ctx.translate(-motionParams.anchorX, -motionParams.anchorY);
    }

    if (transformParams) {
      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;
      ctx.translate(cx + transformParams.posX, cy + transformParams.posY);
      ctx.rotate((transformParams.rotation * Math.PI) / 180);
      ctx.scale(transformParams.scaleX / 100, transformParams.scaleY / 100);
      ctx.translate(-cx, -cy);
    }

    ctx.globalAlpha = opacity;
    ctx.drawImage(this._offscreenCanvas, 0, 0);
    ctx.restore();
  },

  async _renderImage(ctx, mediaItem, canvasWidth, canvasHeight, clip) {
    let img = this._getImageCache(mediaItem.id);
    if (!img) {
      img = new Image();
      img.src = mediaItem.url;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      this._setImageCache(mediaItem.id, img);
    }

    this._drawFit(ctx, img, canvasWidth, canvasHeight);
  },

  async _renderVideo(ctx, mediaItem, sourceTime, canvasWidth, canvasHeight, clip) {
    let frame = renderAheadManager.getFrame(mediaItem.id, sourceTime);
    if (!frame) {
      frame = await mediaDecoder.getFrame(mediaItem.id, mediaItem.url, sourceTime);
    }
    if (frame) {
      this._drawFit(ctx, frame, canvasWidth, canvasHeight);
    }
  },

  _drawFit(ctx, source, canvasWidth, canvasHeight) {
    const srcW = source.videoWidth || source.naturalWidth || source.width;
    const srcH = source.videoHeight || source.naturalHeight || source.height;
    if (!srcW || !srcH) return;

    const x = (canvasWidth - srcW) / 2;
    const y = (canvasHeight - srcH) / 2;

    ctx.drawImage(source, x, y, srcW, srcH);
  },

  _getTransCtx(index, width, height) {
    if (!this._transCanvases[index]) {
      this._transCanvases[index] = document.createElement('canvas');
      this._transCtxs[index] = this._transCanvases[index].getContext('2d');
    }
    const c = this._transCanvases[index];
    if (c.width !== width) c.width = width;
    if (c.height !== height) c.height = height;
    return { canvas: c, ctx: this._transCtxs[index] };
  },

  _getActiveTransitions(track, frame) {
    if (!track.transitions || track.transitions.length === 0) return [];
    return track.transitions.filter(t => {
      const clipB = track.clips.find(c => c.id === t.clipBId);
      if (!clipB) return false;
      return frame >= clipB.startFrame && frame < clipB.startFrame + t.duration;
    });
  },

  _getExportCanvases(width, height) {
    if (this._exportCanvases && this._exportCanvases.width === width && this._exportCanvases.height === height) {
      return this._exportCanvases;
    }
    const makeCanvas = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return { canvas: c, ctx: c.getContext('2d') };
    };
    this._exportCanvases = {
      width, height,
      off: makeCanvas(width, height),
      transA: makeCanvas(width, height),
      transB: makeCanvas(width, height)
    };
    return this._exportCanvases;
  },

  // Export path — always main-thread (ExportWorker has its own WorkerCompositor)
  async compositeFrameTo(frame, targetCtx, width, height) {
    targetCtx.fillStyle = '#000000';
    targetCtx.fillRect(0, 0, width, height);

    const ec = this._getExportCanvases(width, height);
    const { canvas: offCanvas, ctx: offCtx } = ec.off;
    const { canvas: transCanvasA, ctx: transCtxA } = ec.transA;
    const { canvas: transCanvasB, ctx: transCtxB } = ec.transB;

    const videoTracks = timelineEngine.getVideoTracks();

    for (let i = videoTracks.length - 1; i >= 0; i--) {
      const track = videoTracks[i];
      if (track.muted) continue;

      const activeTrans = this._getActiveTransitions(track, frame);
      const transClipIds = new Set();
      for (const t of activeTrans) {
        transClipIds.add(t.clipAId);
        transClipIds.add(t.clipBId);
      }

      for (const clip of track.clips) {
        if (clip.disabled) continue;
        if (!clipContainsFrame(clip, frame)) continue;
        if (transClipIds.has(clip.id)) continue;

        const mediaItem = mediaManager.getItem(clip.mediaId);
        if (!mediaItem) continue;

        const sourceFrame = getSourceFrameAtPlayhead(clip, frame);
        const sourceTime = frameToSeconds(sourceFrame);

        await this._renderClipTo(targetCtx, offCtx, offCanvas, mediaItem, sourceTime, width, height, clip, frame);
      }

      for (const trans of activeTrans) {
        await this._renderTransitionTo(targetCtx, track, trans, frame, width, height, transCanvasA, transCtxA, transCanvasB, transCtxB, offCtx, offCanvas);
      }
    }
  },

  async _renderClipTo(ctx, offCtx, offCanvas, mediaItem, sourceTime, canvasWidth, canvasHeight, clip, frame) {
    const effects = (clip.effects || []).filter(fx => fx.enabled);

    const needsProcessing = effects.some(fx => {
      if (fx.intrinsic && fx.effectId === 'opacity') {
        return (fx.keyframes?.opacity?.length > 0) || fx.params.opacity !== 100;
      }
      if (fx.intrinsic && fx.effectId === 'audio-volume') return false;
      if (fx.intrinsic && fx.effectId === 'motion') {
        return this._motionNeedsProcessing(fx, canvasWidth, canvasHeight);
      }
      if (fx.intrinsic && fx.effectId === 'time-remap') return false;
      if (fx.intrinsic && (fx.effectId === 'panner' || fx.effectId === 'channel-volume')) return false;
      return true;
    });

    if (!needsProcessing) {
      if (mediaItem.type === MEDIA_TYPES.IMAGE) {
        await this._renderImage(ctx, mediaItem, canvasWidth, canvasHeight, clip);
      } else if (mediaItem.type === MEDIA_TYPES.VIDEO) {
        await this._renderVideo(ctx, mediaItem, sourceTime, canvasWidth, canvasHeight, clip);
      }
      return;
    }

    offCtx.clearRect(0, 0, canvasWidth, canvasHeight);

    if (mediaItem.type === MEDIA_TYPES.IMAGE) {
      await this._renderImage(offCtx, mediaItem, canvasWidth, canvasHeight, clip);
    } else if (mediaItem.type === MEDIA_TYPES.VIDEO) {
      await this._renderVideo(offCtx, mediaItem, sourceTime, canvasWidth, canvasHeight, clip);
    }

    let motionParams = null;
    let transformParams = null;
    let opacity = 1;
    const pixelEffects = [];

    for (const fx of effects) {
      const def = effectRegistry.get(fx.effectId);
      if (!def || def.type !== 'video') continue;
      const params = keyframeEngine.resolveParams(fx, frame);
      if (fx.effectId === 'motion' && fx.intrinsic) {
        motionParams = params;
      } else if (fx.effectId === 'transform') {
        transformParams = params;
      } else if (fx.effectId === 'opacity') {
        opacity = params.opacity / 100;
      } else if (fx.effectId === 'crop') {
        def.apply(offCtx, params);
      } else if (fx.effectId === 'time-remap') {
        // Handled by clip source frame calc
      } else {
        pixelEffects.push({ fx, def, params });
      }
    }

    if (pixelEffects.length > 0) {
      const useGL = this._glAvailable &&
        pixelEffects.every(e => glEffectRenderer.hasShader(e.fx.effectId));

      if (useGL) {
        glEffectRenderer.uploadSource(offCanvas, canvasWidth, canvasHeight);
        for (const { fx, params } of pixelEffects) {
          glEffectRenderer.applyEffect(fx.effectId, params);
        }
        offCtx.clearRect(0, 0, canvasWidth, canvasHeight);
        glEffectRenderer.readResult(offCtx);
      } else {
        for (const { def, params } of pixelEffects) {
          def.apply(offCtx, params);
        }
      }
    }

    if (motionParams) {
      this._applyMotionCrop(offCtx, motionParams, canvasWidth, canvasHeight);
    }

    ctx.save();

    if (motionParams) {
      const sy = motionParams.scale / 100;
      const sx = motionParams.uniformScale ? sy : motionParams.scaleWidth / 100;
      ctx.translate(motionParams.posX, motionParams.posY);
      ctx.rotate((motionParams.rotation * Math.PI) / 180);
      ctx.scale(sx, sy);
      ctx.translate(-motionParams.anchorX, -motionParams.anchorY);
    }

    if (transformParams) {
      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;
      ctx.translate(cx + transformParams.posX, cy + transformParams.posY);
      ctx.rotate((transformParams.rotation * Math.PI) / 180);
      ctx.scale(transformParams.scaleX / 100, transformParams.scaleY / 100);
      ctx.translate(-cx, -cy);
    }
    ctx.globalAlpha = opacity;
    ctx.drawImage(offCanvas, 0, 0);
    ctx.restore();
  },

  async _renderTransitionTo(ctx, track, trans, frame, width, height, transCanvasA, transCtxA, transCanvasB, transCtxB, offCtx, offCanvas) {
    const clipA = track.clips.find(c => c.id === trans.clipAId);
    const clipB = track.clips.find(c => c.id === trans.clipBId);
    if (!clipA || !clipB) return;

    const progress = (frame - clipB.startFrame) / trans.duration;

    transCtxA.clearRect(0, 0, width, height);
    const mediaA = mediaManager.getItem(clipA.mediaId);
    if (mediaA) {
      const srcA = getSourceFrameAtPlayhead(clipA, frame);
      if (srcA !== null) {
        await this._renderClipTo(transCtxA, offCtx, offCanvas, mediaA, frameToSeconds(srcA), width, height, clipA, frame);
      }
    }

    transCtxB.clearRect(0, 0, width, height);
    const mediaB = mediaManager.getItem(clipB.mediaId);
    if (mediaB) {
      const srcB = getSourceFrameAtPlayhead(clipB, frame);
      if (srcB !== null) {
        await this._renderClipTo(transCtxB, offCtx, offCanvas, mediaB, frameToSeconds(srcB), width, height, clipB, frame);
      }
    }

    transitions.render(ctx, transCanvasA, transCanvasB, trans.type, progress, width, height);
  },

  async _renderTransition(ctx, track, trans, frame, width, height) {
    const clipA = track.clips.find(c => c.id === trans.clipAId);
    const clipB = track.clips.find(c => c.id === trans.clipBId);
    if (!clipA || !clipB) return;

    const progress = (frame - clipB.startFrame) / trans.duration;

    const { canvas: canvasA, ctx: ctxA } = this._getTransCtx(0, width, height);
    ctxA.clearRect(0, 0, width, height);
    const mediaA = mediaManager.getItem(clipA.mediaId);
    if (mediaA) {
      const srcA = getSourceFrameAtPlayhead(clipA, frame);
      if (srcA !== null) {
        await this._renderClip(ctxA, mediaA, frameToSeconds(srcA), width, height, clipA, frame);
      }
    }

    const { canvas: canvasB, ctx: ctxB } = this._getTransCtx(1, width, height);
    ctxB.clearRect(0, 0, width, height);
    const mediaB = mediaManager.getItem(clipB.mediaId);
    if (mediaB) {
      const srcB = getSourceFrameAtPlayhead(clipB, frame);
      if (srcB !== null) {
        await this._renderClip(ctxB, mediaB, frameToSeconds(srcB), width, height, clipB, frame);
      }
    }

    transitions.render(ctx, canvasA, canvasB, trans.type, progress, width, height);
  },

  _motionNeedsProcessing(fx, canvasWidth, canvasHeight) {
    const p = fx.params;
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    if (p.posX !== cx || p.posY !== cy) return true;
    if (p.scale !== 100 || p.scaleWidth !== 100) return true;
    if (p.rotation !== 0) return true;
    if (p.anchorX !== cx || p.anchorY !== cy) return true;
    if (p.antiFlicker !== 0) return true;
    if (p.cropLeft !== 0 || p.cropTop !== 0 || p.cropRight !== 0 || p.cropBottom !== 0) return true;
    const kf = fx.keyframes;
    if (kf) {
      for (const key of Object.keys(kf)) {
        if (kf[key] && kf[key].length > 0) return true;
      }
    }
    return false;
  },

  _applyMotionCrop(ctx, motionParams, canvasWidth, canvasHeight) {
    const { cropLeft, cropTop, cropRight, cropBottom } = motionParams;
    if (cropLeft <= 0 && cropTop <= 0 && cropRight <= 0 && cropBottom <= 0) return;

    const w = canvasWidth;
    const h = canvasHeight;
    const left = (cropLeft / 100) * w;
    const top = (cropTop / 100) * h;
    const right = (cropRight / 100) * w;
    const bottom = (cropBottom / 100) * h;

    ctx.fillStyle = '#000';
    if (top > 0) ctx.fillRect(0, 0, w, top);
    if (bottom > 0) ctx.fillRect(0, h - bottom, w, bottom);
    if (left > 0) ctx.fillRect(0, 0, left, h);
    if (right > 0) ctx.fillRect(w - right, 0, right, h);
  },

  _imageCache: new Map(),

  _getImageCache(mediaId) {
    return this._imageCache.get(mediaId);
  },

  _setImageCache(mediaId, img) {
    this._imageCache.set(mediaId, img);
  },

  getVideoElement(mediaId) {
    return mediaDecoder.getVideoElement(mediaId);
  },

  cleanup() {
    // Terminate compositor worker
    if (this._worker) {
      this._worker.postMessage({ type: 'destroy' });
      this._worker.terminate();
      this._worker = null;
      this._workerReady = false;
      this._workerBusy = false;
      this._useWorker = false;
      this._pendingResolve = null;
      this._displayCanvas = null;
      this._displayCtx = null;
    }
    mediaDecoder.cleanup();
    this._imageCache.clear();
    this._offscreenCanvas = null;
    this._offscreenCtx = null;
    this._transCanvases = [null, null];
    this._transCtxs = [null, null];
    this._exportCanvases = null;
  }
};

export default videoCompositor;
