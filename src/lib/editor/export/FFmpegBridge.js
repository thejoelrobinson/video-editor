// Thin wrapper around @ffmpeg/ffmpeg for VFS + exec operations.
// Handles lazy loading, Cache API pre-warming, and progress callbacks.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import logger from '../../utils/logger.js';

const CORE_VERSION = '0.12.6';
const CDN_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

export const ffmpegBridge = {
  _ffmpeg: null,
  _loaded: false,
  _loading: null,
  _progressCb: null,

  isLoaded() {
    return this._loaded;
  },

  async load(onProgress) {
    if (this._loaded) return;
    if (this._loading) return this._loading;

    this._loading = (async () => {
      const ffmpeg = new FFmpeg();

      ffmpeg.on('log', ({ message }) => {
        logger.debug(`[FFmpeg] ${message}`);
        // Forward to worker message bus if inside a Worker
        if (typeof self !== 'undefined' && self.postMessage) {
          try { self.postMessage({ type: 'log', message: `[FFmpeg] ${message}` }); } catch (_) {}
        }
      });

      ffmpeg.on('progress', ({ progress }) => {
        if (this._progressCb) this._progressCb(progress);
      });

      onProgress?.(0.1);

      const coreURL = await toBlobURL(`${CDN_BASE}/ffmpeg-core.js`, 'text/javascript');
      onProgress?.(0.4);
      const wasmURL = await toBlobURL(`${CDN_BASE}/ffmpeg-core.wasm`, 'application/wasm');
      onProgress?.(0.8);

      await ffmpeg.load({ coreURL, wasmURL });

      this._ffmpeg = ffmpeg;
      this._loaded = true;
      onProgress?.(1);
      logger.info('FFmpeg loaded');
    })();

    return this._loading;
  },

  async writeFile(name, data) {
    if (!this._ffmpeg) throw new Error('FFmpeg not loaded');
    await this._ffmpeg.writeFile(name, data);
  },

  async readFile(name) {
    if (!this._ffmpeg) throw new Error('FFmpeg not loaded');
    return await this._ffmpeg.readFile(name);
  },

  async deleteFile(name) {
    if (!this._ffmpeg) throw new Error('FFmpeg not loaded');
    try {
      await this._ffmpeg.deleteFile(name);
    } catch (_) {
      // Ignore — file may already be deleted
    }
  },

  async exec(args) {
    if (!this._ffmpeg) throw new Error('FFmpeg not loaded');
    const ret = await this._ffmpeg.exec(args);
    if (ret !== 0) {
      throw new Error(`FFmpeg exited with code ${ret}`);
    }
  },

  setProgressCallback(fn) {
    this._progressCb = fn;
  },

  // Pre-warm: fetch core files into browser Cache API so Worker loads instantly
  async ensureCacheWarm() {
    if (typeof caches === 'undefined') return;
    try {
      const urls = [
        `${CDN_BASE}/ffmpeg-core.js`,
        `${CDN_BASE}/ffmpeg-core.wasm`
      ];
      for (const url of urls) {
        const resp = await fetch(url, { cache: 'force-cache' });
        if (!resp.ok) logger.warn(`Cache warm failed for ${url}: ${resp.status}`);
      }
    } catch (err) {
      logger.warn('FFmpeg cache warm failed:', err.message);
    }
  }
};

export default ffmpegBridge;
