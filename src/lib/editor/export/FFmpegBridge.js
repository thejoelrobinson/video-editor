// FFmpeg.wasm lifecycle: load, writeFile, exec, readFile, progress
import logger from '../../utils/logger.js';

let ffmpeg = null;
let loaded = false;
let progressCallback = null;

export const ffmpegBridge = {
  async load(onProgress) {
    if (loaded && ffmpeg) return;

    try {
      onProgress?.(0.05);
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');

      ffmpeg = new FFmpeg();

      ffmpeg.on('log', ({ message }) => {
        logger.debug(`[FFmpeg] ${message}`);
      });

      ffmpeg.on('progress', ({ progress, time }) => {
        if (progressCallback) {
          progressCallback(progress, time);
        } else if (onProgress) {
          onProgress(progress, time);
        }
      });

      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      const coreFile = `${baseURL}/ffmpeg-core.js`;
      const wasmFile = `${baseURL}/ffmpeg-core.wasm`;

      let coreURL, wasmURL;

      // Try Cache API first — avoids re-downloading 30MB WASM on every page load
      const cached = await this._loadFromCache(coreFile, wasmFile);
      if (cached) {
        onProgress?.(0.7);
        logger.info('Loading FFmpeg from cache...');
        coreURL = cached.coreURL;
        wasmURL = cached.wasmURL;
      } else {
        // Download from CDN, cache for next time
        onProgress?.(0.1);
        logger.info('Downloading FFmpeg core JS...');
        const coreResp = await fetch(coreFile);

        onProgress?.(0.4);
        logger.info('Downloading FFmpeg WASM (~30MB)...');
        const wasmResp = await fetch(wasmFile);

        // Cache the responses (clone before consuming, since body is single-use)
        this._cacheResponses(coreFile, coreResp.clone(), wasmFile, wasmResp.clone());

        // Create blob URLs from the fetched data
        const coreBlob = await coreResp.blob();
        const wasmBlob = await wasmResp.blob();
        coreURL = URL.createObjectURL(new Blob([coreBlob], { type: 'text/javascript' }));
        wasmURL = URL.createObjectURL(new Blob([wasmBlob], { type: 'application/wasm' }));
      }

      onProgress?.(0.8);
      logger.info('Initializing FFmpeg...');
      await ffmpeg.load({ coreURL, wasmURL });

      loaded = true;
      onProgress?.(1.0);
      logger.info('FFmpeg.wasm loaded successfully');
    } catch (err) {
      logger.error('Failed to load FFmpeg.wasm:', err);
      ffmpeg = null;
      throw err;
    }
  },

  // Cache API helpers — persist FFmpeg WASM across page loads
  _CACHE_NAME: 'ffmpeg-wasm-v0.12.6',

  async _loadFromCache(coreFile, wasmFile) {
    try {
      if (typeof caches === 'undefined') return null;
      const cache = await caches.open(this._CACHE_NAME);
      const coreResp = await cache.match(coreFile);
      const wasmResp = await cache.match(wasmFile);
      if (!coreResp || !wasmResp) return null;

      const coreBlob = await coreResp.blob();
      const wasmBlob = await wasmResp.blob();
      const coreURL = URL.createObjectURL(new Blob([coreBlob], { type: 'text/javascript' }));
      const wasmURL = URL.createObjectURL(new Blob([wasmBlob], { type: 'application/wasm' }));
      return { coreURL, wasmURL };
    } catch (e) {
      logger.debug('Cache API read failed:', e);
      return null;
    }
  },

  // Store already-fetched responses in Cache API (no re-download)
  async _cacheResponses(coreFile, coreResp, wasmFile, wasmResp) {
    try {
      if (typeof caches === 'undefined') return;
      const cache = await caches.open(this._CACHE_NAME);
      await Promise.all([
        cache.put(coreFile, coreResp),
        cache.put(wasmFile, wasmResp)
      ]);
      logger.info('FFmpeg WASM cached for next session');
    } catch (e) {
      logger.debug('FFmpeg cache write failed (non-fatal):', e);
    }
  },

  isLoaded() {
    return loaded;
  },

  setProgressCallback(fn) {
    progressCallback = fn;
  },

  async writeFile(path, data) {
    if (!ffmpeg) throw new Error('FFmpeg not loaded');
    await ffmpeg.writeFile(path, data);
  },

  async readFile(path) {
    if (!ffmpeg) throw new Error('FFmpeg not loaded');
    return await ffmpeg.readFile(path);
  },

  async exec(args) {
    if (!ffmpeg) throw new Error('FFmpeg not loaded');
    logger.info(`[FFmpeg] exec: ffmpeg ${args.join(' ')}`);
    await ffmpeg.exec(args);
  },

  async deleteFile(path) {
    if (!ffmpeg) throw new Error('FFmpeg not loaded');
    try {
      await ffmpeg.deleteFile(path);
    } catch (e) {
      // File may not exist
    }
  },

  // Ensure FFmpeg WASM files are in Cache API (for Worker pre-warming)
  // Call this BEFORE spawning ExportWorker so the worker loads from cache instantly
  async ensureCacheWarm() {
    if (typeof caches === 'undefined') return false;

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    const coreFile = `${baseURL}/ffmpeg-core.js`;
    const wasmFile = `${baseURL}/ffmpeg-core.wasm`;

    // Check if already cached
    const cached = await this._loadFromCache(coreFile, wasmFile);
    if (cached) {
      // Revoke the blob URLs we just created (we only needed to verify cache)
      URL.revokeObjectURL(cached.coreURL);
      URL.revokeObjectURL(cached.wasmURL);
      logger.info('FFmpeg cache is warm (ready for Worker)');
      return true;
    }

    // Download and cache for the worker
    logger.info('Pre-warming FFmpeg cache for Worker export...');
    try {
      const [coreResp, wasmResp] = await Promise.all([
        fetch(coreFile),
        fetch(wasmFile)
      ]);
      await this._cacheResponses(coreFile, coreResp, wasmFile, wasmResp);
      logger.info('FFmpeg cache warmed successfully');
      return true;
    } catch (e) {
      logger.warn('Failed to pre-warm FFmpeg cache:', e);
      return false;
    }
  },

  async cleanup() {
    if (ffmpeg) {
      ffmpeg.terminate();
      ffmpeg = null;
      loaded = false;
    }
  }
};

export default ffmpegBridge;
