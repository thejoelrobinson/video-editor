// Project bin: import, organize, metadata catalog
import { editorState } from '../core/EditorState.js';
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS, MEDIA_TYPES, SUPPORTED_EXTENSIONS } from '../core/Constants.js';
import { mediaDecoder } from './MediaDecoder.js';
import logger from '../../utils/logger.js';

let mediaIdCounter = 0;

function getMediaType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (SUPPORTED_EXTENSIONS.VIDEO.includes(ext)) return MEDIA_TYPES.VIDEO;
  if (SUPPORTED_EXTENSIONS.AUDIO.includes(ext)) return MEDIA_TYPES.AUDIO;
  if (SUPPORTED_EXTENSIONS.IMAGE.includes(ext)) return MEDIA_TYPES.IMAGE;
  return null;
}

function probeMedia(file) {
  return new Promise((resolve, reject) => {
    const type = getMediaType(file.name);
    if (!type) {
      reject(new Error(`Unsupported file type: ${file.name}`));
      return;
    }

    const url = URL.createObjectURL(file);

    if (type === MEDIA_TYPES.IMAGE) {
      const img = new Image();
      img.onload = () => {
        resolve({
          type,
          duration: 5, // Default 5s for images
          width: img.naturalWidth,
          height: img.naturalHeight,
          url
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Failed to load image: ${file.name}`));
      };
      img.src = url;
      return;
    }

    // Video or audio
    const el = type === MEDIA_TYPES.VIDEO
      ? document.createElement('video')
      : document.createElement('audio');

    el.preload = 'metadata';

    el.onloadedmetadata = () => {
      const info = {
        type,
        duration: el.duration || 0,
        width: el.videoWidth || 0,
        height: el.videoHeight || 0,
        url
      };
      resolve(info);
    };

    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to probe media: ${file.name}`));
    };

    el.src = url;
  });
}

export const mediaManager = {
  async importFiles(fileList) {
    const items = [];
    for (const file of fileList) {
      try {
        const info = await probeMedia(file);
        const item = {
          id: `media-${++mediaIdCounter}`,
          name: file.name,
          file,
          type: info.type,
          duration: info.duration,
          width: info.width,
          height: info.height,
          url: info.url,
          size: file.size,
          thumbnails: [],
          waveform: null
        };
        editorState.get('media.items').set(item.id, item);

        // Store ArrayBuffer for WebCodecs decoding
        if (info.type === MEDIA_TYPES.VIDEO && file.arrayBuffer) {
          try {
            const buffer = await file.arrayBuffer();
            mediaDecoder.registerMediaBuffer(item.id, buffer);
          } catch (e) {
            // Non-critical, WebCodecs will fall back to HTMLVideoElement
          }
        }

        items.push(item);
        logger.info(`Imported media: ${file.name} (${info.type}, ${info.duration.toFixed(1)}s)`);
        eventBus.emit(EDITOR_EVENTS.MEDIA_IMPORTED, { item });
      } catch (err) {
        logger.error(`Failed to import ${file.name}:`, err);
      }
    }
    return items;
  },

  getItem(id) {
    return editorState.get('media.items').get(id);
  },

  getAllItems() {
    return [...editorState.get('media.items').values()];
  },

  removeItem(id) {
    const items = editorState.get('media.items');
    const item = items.get(id);
    if (item) {
      if (item.url) URL.revokeObjectURL(item.url);
      items.delete(id);
      eventBus.emit(EDITOR_EVENTS.MEDIA_REMOVED, { id });
    }
  },

  cleanup() {
    const items = editorState.get('media.items');
    for (const [id, item] of items) {
      if (item.url) URL.revokeObjectURL(item.url);
    }
    items.clear();
  },

  // Open file picker
  async openFilePicker() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = [
        ...SUPPORTED_EXTENSIONS.VIDEO.map(e => `.${e}`),
        ...SUPPORTED_EXTENSIONS.AUDIO.map(e => `.${e}`),
        ...SUPPORTED_EXTENSIONS.IMAGE.map(e => `.${e}`)
      ].join(',');

      input.onchange = async () => {
        if (input.files.length > 0) {
          const items = await this.importFiles(input.files);
          resolve(items);
        } else {
          resolve([]);
        }
      };

      input.click();
    });
  }
};

export default mediaManager;
