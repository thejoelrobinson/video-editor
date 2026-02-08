// Frame-by-frame decode: HTMLVideoElement seeking with
// WebCodecs VideoDecoder for hardware-accelerated performance when available
import { createWebCodecsDecoder, isWebCodecsSupported } from './WebCodecsDecoder.js';
import { editorState } from '../core/EditorState.js';
import logger from '../../utils/logger.js';

export const mediaDecoder = {
  _videoElements: new Map(),      // mediaId -> HTMLVideoElement
  _decoders: new Map(),           // mediaId -> VideoDecoder (legacy)
  _frameCache: new Map(),         // `${mediaId}_${frame}` -> ImageBitmap
  _mediaBuffers: new Map(),       // mediaId -> ArrayBuffer
  _webCodecsDecoders: new Map(),  // mediaId -> WebCodecsDecoder instance
  _webCodecsInitPromises: new Map(), // mediaId -> Promise (dedup concurrent inits)
  _webCodecsFailCount: new Map(), // mediaId -> { count, lastAttempt }
  _cacheLimit: 100,               // Default frame cache limit (recalculated from resolution)
  _sequentialMode: false,         // True during export for GOP-batch decode

  // Get or create a video element for a media item
  getVideoElement(mediaId, url) {
    if (this._videoElements.has(mediaId)) {
      return this._videoElements.get(mediaId);
    }
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = url;
    this._videoElements.set(mediaId, video);
    return video;
  },

  // Seek a video element to a specific time and return when ready
  async seekTo(mediaId, url, timeSeconds) {
    const video = this.getVideoElement(mediaId, url);

    // Wait for metadata if not yet loaded
    if (video.readyState < 1) {
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
      });
    }

    const timeDiff = Math.abs(video.currentTime - timeSeconds);
    if (timeDiff < 0.02) return video; // Close enough

    video.currentTime = timeSeconds;
    await new Promise((resolve) => {
      video.onseeked = resolve;
    });

    return video;
  },

  // Register an ArrayBuffer for WebCodecs decoding
  registerMediaBuffer(mediaId, arrayBuffer) {
    this._mediaBuffers.set(mediaId, arrayBuffer);
  },

  // Public accessor for registered media buffers
  getMediaBuffer(mediaId) {
    return this._mediaBuffers.get(mediaId) || null;
  },

  // Release the raw ArrayBuffer once the decode worker owns it.
  // _shouldTryWebCodecs will return false after this, so no new main-thread
  // WebCodecs decodes will start. Any existing decoder stays alive (its
  // sourceBuffer still references the ArrayBuffer, but with lazy chunk
  // creation the overhead is only ~2.2MB of metadata). The decoder will be
  // cleaned up when the media is removed or the editor closes.
  releaseMediaBuffer(mediaId) {
    this._mediaBuffers.delete(mediaId);
  },

  // Check if WebCodecs should be attempted for this media
  _shouldTryWebCodecs(mediaId) {
    if (!isWebCodecsSupported() || !this._mediaBuffers.has(mediaId)) return false;

    const fail = this._webCodecsFailCount.get(mediaId);
    if (!fail) return true;

    // Allow 3 retries with 2s backoff
    if (fail.count >= 3) return false;
    if (Date.now() - fail.lastAttempt < 2000) return false;
    return true;
  },

  _recordWebCodecsFailure(mediaId) {
    const fail = this._webCodecsFailCount.get(mediaId) || { count: 0, lastAttempt: 0 };
    fail.count++;
    fail.lastAttempt = Date.now();
    this._webCodecsFailCount.set(mediaId, fail);

    // Close and remove the broken decoder so next retry starts fresh
    const decoder = this._webCodecsDecoders.get(mediaId);
    if (decoder) {
      decoder.close();
      this._webCodecsDecoders.delete(mediaId);
    }
  },

  _recordWebCodecsSuccess(mediaId) {
    this._webCodecsFailCount.delete(mediaId);
  },

  // Get a frame as ImageBitmap (cached)
  async getFrame(mediaId, url, timeSeconds, width, height) {
    const cacheKey = `${mediaId}_${Math.round(timeSeconds * 1000)}`;

    if (this._frameCache.has(cacheKey)) {
      // LRU: delete and re-set to move to end of Map iteration order
      const cached = this._frameCache.get(cacheKey);
      this._frameCache.delete(cacheKey);
      this._frameCache.set(cacheKey, cached);
      return cached;
    }

    // WebCodecs decode path — hardware-accelerated, ~100x faster than HTMLVideoElement seeking
    if (this._shouldTryWebCodecs(mediaId)) {
      try {
        const bitmap = await this._getFrameWebCodecs(mediaId, timeSeconds);
        if (bitmap) {
          this._recordWebCodecsSuccess(mediaId);
          this._cacheFrame(cacheKey, bitmap);
          return bitmap;
        }
      } catch (e) {
        logger.warn(`WebCodecs decode failed for ${mediaId}, falling back to HTMLVideoElement:`, e);
        this._recordWebCodecsFailure(mediaId);
      }
    }

    // Fallback: HTMLVideoElement
    const video = await this.seekTo(mediaId, url, timeSeconds);

    try {
      const bitmap = await createImageBitmap(video, {
        resizeWidth: width || video.videoWidth,
        resizeHeight: height || video.videoHeight
      });

      this._cacheFrame(cacheKey, bitmap);
      return bitmap;
    } catch (err) {
      return video;
    }
  },

  async _getFrameWebCodecs(mediaId, timeSeconds) {
    // Deduplicate concurrent init calls — all callers await the same promise
    if (!this._webCodecsDecoders.has(mediaId)) {
      if (!this._webCodecsInitPromises.has(mediaId)) {
        const initPromise = (async () => {
          try {
            const decoder = createWebCodecsDecoder();
            const buffer = this._mediaBuffers.get(mediaId);
            await decoder.init(mediaId, buffer);
            if (this._sequentialMode) {
              decoder.startSequentialMode();
            }
            this._webCodecsDecoders.set(mediaId, decoder);
          } finally {
            this._webCodecsInitPromises.delete(mediaId);
          }
        })();
        this._webCodecsInitPromises.set(mediaId, initPromise);
      }
      await this._webCodecsInitPromises.get(mediaId);
    }

    const decoder = this._webCodecsDecoders.get(mediaId);

    // Health check: if decoder is in a bad state, remove and let retry logic handle it
    if (!decoder.isHealthy()) {
      decoder.close();
      this._webCodecsDecoders.delete(mediaId);
      throw new Error('WebCodecs decoder unhealthy');
    }

    if (this._sequentialMode) {
      return await decoder.getSequentialImageBitmap(timeSeconds);
    }
    return await decoder.getImageBitmapAt(timeSeconds);
  },

  _cacheFrame(cacheKey, bitmap) {
    // LRU eviction: remove oldest entries when over limit
    while (this._frameCache.size >= this._cacheLimit) {
      const firstKey = this._frameCache.keys().next().value;
      const old = this._frameCache.get(firstKey);
      old?.close?.();
      this._frameCache.delete(firstKey);
    }
    this._frameCache.set(cacheKey, bitmap);
  },

  // Calculate resolution-aware cache limit
  recalcCacheLimit(width, height, exportMode = false) {
    const bytesPerFrame = width * height * 4;
    const budgetMB = exportMode ? 256 : 128; // smaller than RenderAheadManager (secondary cache)
    const budgetBytes = budgetMB * 1024 * 1024;
    const computed = Math.floor(budgetBytes / bytesPerFrame);
    this._cacheLimit = Math.max(20, Math.min(300, computed));
  },

  // Toggle export mode — larger cache prevents thrashing during long exports
  setExportMode(enabled) {
    const canvas = editorState.get('project.canvas') || {};
    const w = canvas.width || 1920;
    const h = canvas.height || 1080;
    this.recalcCacheLimit(w, h, enabled);
  },

  // Enable sequential decode mode on all WebCodecs decoders (for export).
  // Also sets a flag so decoders created mid-export get sequential mode.
  startSequentialMode() {
    this._sequentialMode = true;
    for (const [, decoder] of this._webCodecsDecoders) {
      decoder.startSequentialMode();
    }
  },

  endSequentialMode() {
    this._sequentialMode = false;
    for (const [, decoder] of this._webCodecsDecoders) {
      decoder.endSequentialMode();
    }
  },

  // Clear frame cache for a specific media item
  clearCache(mediaId) {
    for (const [key, bitmap] of this._frameCache) {
      if (key.startsWith(`${mediaId}_`)) {
        bitmap?.close?.();
        this._frameCache.delete(key);
      }
    }
  },

  // Pre-fetch frames around current position
  async prefetch(mediaId, url, centerTime, frameCount, fps) {
    const promises = [];
    const halfRange = Math.floor(frameCount / 2);

    for (let i = -halfRange; i <= halfRange; i++) {
      const time = centerTime + (i / fps);
      if (time >= 0) {
        const cacheKey = `${mediaId}_${Math.round(time * 1000)}`;
        if (!this._frameCache.has(cacheKey)) {
          promises.push(this.getFrame(mediaId, url, time));
        }
      }
    }

    await Promise.allSettled(promises);
  },

  cleanup() {
    // Close all ImageBitmaps
    for (const [, bitmap] of this._frameCache) {
      bitmap?.close?.();
    }
    this._frameCache.clear();

    // Release video elements
    for (const [, video] of this._videoElements) {
      video.src = '';
      video.load();
    }
    this._videoElements.clear();
    this._decoders.clear();

    // Close WebCodecs decoders
    for (const [, decoder] of this._webCodecsDecoders) {
      decoder.close();
    }
    this._webCodecsDecoders.clear();
    this._webCodecsInitPromises.clear();
    this._mediaBuffers.clear();
    this._webCodecsFailCount.clear();
  }
};

export default mediaDecoder;
