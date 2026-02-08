// Audio peak analysis via OfflineAudioContext for waveform display
import { MEDIA_TYPES } from '../core/Constants.js';
import logger from '../../utils/logger.js';

const PEAKS_PER_SECOND = 50; // Resolution of waveform data

export const waveformGenerator = {
  async generateWaveform(mediaItem) {
    if (mediaItem.type !== MEDIA_TYPES.AUDIO && mediaItem.type !== MEDIA_TYPES.VIDEO) {
      return null;
    }

    try {
      const response = await fetch(mediaItem.url);
      const arrayBuffer = await response.arrayBuffer();

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      audioCtx.close();

      const peaks = this._extractPeaks(audioBuffer);
      mediaItem.waveform = peaks;
      logger.info(`Waveform generated for ${mediaItem.name}: ${peaks.length} peaks`);
      return peaks;
    } catch (err) {
      logger.warn(`Failed to generate waveform for ${mediaItem.name}:`, err);
      return null;
    }
  },

  _extractPeaks(audioBuffer) {
    const channelData = audioBuffer.getChannelData(0); // Use first channel
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    const totalPeaks = Math.ceil(duration * PEAKS_PER_SECOND);
    const samplesPerPeak = Math.floor(channelData.length / totalPeaks);

    const peaks = new Float32Array(totalPeaks);

    for (let i = 0; i < totalPeaks; i++) {
      const start = i * samplesPerPeak;
      const end = Math.min(start + samplesPerPeak, channelData.length);
      let max = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > max) max = abs;
      }
      peaks[i] = max;
    }

    return peaks;
  },

  // Render waveform to a canvas for a clip
  renderWaveform(canvas, peaks, startRatio, endRatio, color = '#56b6c2') {
    if (!peaks || peaks.length === 0) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const midY = h / 2;

    const startIdx = Math.floor(startRatio * peaks.length);
    const endIdx = Math.ceil(endRatio * peaks.length);
    const visiblePeaks = endIdx - startIdx;
    if (visiblePeaks <= 0) return;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;

    const barWidth = Math.max(1, w / visiblePeaks);

    for (let i = 0; i < visiblePeaks; i++) {
      const peak = peaks[startIdx + i] || 0;
      const barHeight = peak * midY * 0.9;
      const x = (i / visiblePeaks) * w;

      // Draw mirrored bar (up and down from center)
      ctx.fillRect(x, midY - barHeight, barWidth, barHeight * 2);
    }
  }
};

export default waveformGenerator;
