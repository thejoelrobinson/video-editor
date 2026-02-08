// Worker-safe media access -- decodes images and video without DOM
import { createWebCodecsDecoder } from '../media/WebCodecsDecoder.js';
import logger from '../../utils/logger.js';

export function createWorkerMediaDecoder() {
  const imageBitmaps = new Map(); // mediaId -> ImageBitmap
  const videoBuffers = new Map(); // mediaId -> { type, blob/buffer/frames }

  return {
    // Register media transferred from main thread
    registerImage(mediaId, blob) {
      videoBuffers.set(mediaId, { type: 'image', blob });
    },

    registerVideo(mediaId, arrayBuffer) {
      videoBuffers.set(mediaId, { type: 'video', buffer: arrayBuffer });
    },

    // Get an ImageBitmap for an image media item
    async getImageBitmap(mediaId) {
      if (imageBitmaps.has(mediaId)) {
        return imageBitmaps.get(mediaId);
      }

      const entry = videoBuffers.get(mediaId);
      if (!entry || entry.type !== 'image') return null;

      const bitmap = await createImageBitmap(entry.blob);
      imageBitmaps.set(mediaId, bitmap);
      return bitmap;
    },

    // Get a video frame as ImageBitmap at the given time
    // Uses pre-decoded frames from main thread, or WebCodecs if available
    async getVideoFrame(mediaId, timeSeconds) {
      const entry = videoBuffers.get(mediaId);
      if (!entry) return null;

      // If we received pre-decoded ImageBitmaps (keyed by time in ms)
      if (entry.type === 'frames') {
        const key = Math.round(timeSeconds * 1000);
        return entry.frames.get(key) || null;
      }

      // If we have WebCodecs available and raw buffer
      if (entry.type === 'video' && typeof VideoDecoder !== 'undefined') {
        try {
          if (!entry.decoder) {
            console.log(`[WorkerMediaDecoder] Creating WebCodecsDecoder for ${mediaId}, buffer=${entry.buffer.byteLength} bytes`);
            entry.decoder = createWebCodecsDecoder();
            await entry.decoder.init(mediaId, entry.buffer);
            console.log(`[WorkerMediaDecoder] Decoder initialized for ${mediaId}`);
          }
          const bitmap = await entry.decoder.getImageBitmapAt(timeSeconds);
          if (!bitmap) {
            console.warn(`[WorkerMediaDecoder] getImageBitmapAt(${timeSeconds}) returned null for ${mediaId}`);
          }
          return bitmap;
        } catch (e) {
          console.error(`[WorkerMediaDecoder] WebCodecs decode FAILED for ${mediaId}: ${e.message}`, e);
          entry.decoder = null; // Reset so next call retries init
          return null;
        }
      }

      console.warn(`[WorkerMediaDecoder] No decode path for ${mediaId}: type=${entry.type}, VideoDecoder=${typeof VideoDecoder}`);

      return null;
    },

    registerFrames(mediaId, framesMap) {
      videoBuffers.set(mediaId, { type: 'frames', frames: framesMap });
    },

    cleanup() {
      for (const [, bitmap] of imageBitmaps) {
        bitmap.close();
      }
      imageBitmaps.clear();

      for (const [, entry] of videoBuffers) {
        if (entry.decoder) entry.decoder.close();
      }
      videoBuffers.clear();
    }
  };
}

export default createWorkerMediaDecoder;
