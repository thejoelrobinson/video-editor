// Extract frame thumbnails from video files using OffscreenCanvas
import { MEDIA_TYPES } from '../core/Constants.js';
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS } from '../core/Constants.js';

const THUMB_HEIGHT = 40;
const THUMB_INTERVAL_SEC = 2; // One thumbnail every 2 seconds

export const thumbnailGenerator = {
  async generateThumbnails(mediaItem, count = null) {
    if (mediaItem.type === MEDIA_TYPES.AUDIO) return [];
    if (mediaItem.type === MEDIA_TYPES.IMAGE) {
      return this._generateImageThumbnail(mediaItem);
    }
    return this._generateVideoThumbnails(mediaItem, count);
  },

  async _generateVideoThumbnails(mediaItem, count) {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = mediaItem.url;

    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = reject;
    });

    const duration = video.duration;
    if (!count) {
      count = Math.max(1, Math.ceil(duration / THUMB_INTERVAL_SEC));
    }
    count = Math.min(count, 60); // Cap

    const aspectRatio = video.videoWidth / video.videoHeight;
    const thumbWidth = Math.round(THUMB_HEIGHT * aspectRatio);

    const canvas = document.createElement('canvas');
    canvas.width = thumbWidth;
    canvas.height = THUMB_HEIGHT;
    const ctx = canvas.getContext('2d');

    const thumbnails = [];
    for (let i = 0; i < count; i++) {
      const time = (i / count) * duration;
      video.currentTime = time;

      await new Promise((resolve) => {
        video.onseeked = resolve;
      });

      ctx.drawImage(video, 0, 0, thumbWidth, THUMB_HEIGHT);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      thumbnails.push({
        time,
        url: dataUrl,
        width: thumbWidth,
        height: THUMB_HEIGHT
      });
    }

    video.src = '';
    mediaItem.thumbnails = thumbnails;
    eventBus.emit(EDITOR_EVENTS.MEDIA_THUMBNAILS_READY, { mediaId: mediaItem.id });
    return thumbnails;
  },

  async _generateImageThumbnail(mediaItem) {
    const img = new Image();
    img.src = mediaItem.url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const aspectRatio = img.naturalWidth / img.naturalHeight;
    const thumbWidth = Math.round(THUMB_HEIGHT * aspectRatio);

    const canvas = document.createElement('canvas');
    canvas.width = thumbWidth;
    canvas.height = THUMB_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, thumbWidth, THUMB_HEIGHT);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    const thumbnails = [{
      time: 0,
      url: dataUrl,
      width: thumbWidth,
      height: THUMB_HEIGHT
    }];

    mediaItem.thumbnails = thumbnails;
    eventBus.emit(EDITOR_EVENTS.MEDIA_THUMBNAILS_READY, { mediaId: mediaItem.id });
    return thumbnails;
  }
};

export default thumbnailGenerator;
