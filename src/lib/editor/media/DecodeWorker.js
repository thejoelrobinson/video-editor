// Web Worker for off-main-thread video decoding via WebCodecs
// Messages: init, decode, close
import { createWebCodecsDecoder } from './WebCodecsDecoder.js';

const decoders = new Map(); // mediaId -> WebCodecsDecoder instance

self.onmessage = async (e) => {
  const { type, mediaId, requestId } = e.data;

  if (type === 'init') {
    try {
      const decoder = createWebCodecsDecoder();
      await decoder.init(mediaId, e.data.arrayBuffer);
      decoders.set(mediaId, decoder);
      // Send track info back so main thread can enrich the media item
      // with codec/fps/resolution for stream copy eligibility checks
      const trackInfo = decoder.getTrackInfo();
      self.postMessage({ type: 'init_done', mediaId, trackInfo });
    } catch (err) {
      self.postMessage({ type: 'init_error', mediaId, error: err.message });
    }
    return;
  }

  if (type === 'decode') {
    const decoder = decoders.get(mediaId);
    if (!decoder) {
      self.postMessage({ type: 'decode_error', mediaId, requestId, error: 'No decoder for ' + mediaId });
      return;
    }

    const times = e.data.times;
    const frames = [];
    const bitmaps = [];

    if (times.length === 1) {
      // Single frame — use direct decode (no sequential overhead)
      try {
        const bitmap = await decoder.getImageBitmapAt(times[0]);
        if (bitmap) {
          frames.push({ time: times[0], bitmap });
          bitmaps.push(bitmap);
        }
      } catch (err) {
        // Skip — main thread will fall back to sync decode
      }
    } else {
      // Batch decode — use sequential mode so each GOP is decoded only once.
      // getSequentialImageBitmap() decodes the full GOP on the first call
      // and serves subsequent same-GOP frames from its internal buffer.
      decoder.startSequentialMode();
      try {
        // Sort times ascending so sequential mode advances through GOPs in order,
        // minimizing GOP re-decodes when the batch spans multiple GOPs.
        const sorted = [...times].sort((a, b) => a - b);

        for (const time of sorted) {
          try {
            const bitmap = await decoder.getSequentialImageBitmap(time);
            if (bitmap) {
              frames.push({ time, bitmap });
              bitmaps.push(bitmap);
            }
          } catch (err) {
            // Skip failed frames — main thread will fall back to sync decode
          }
        }
      } finally {
        decoder.endSequentialMode();
      }
    }

    self.postMessage(
      { type: 'frames', mediaId, requestId, frames },
      bitmaps // Transfer ImageBitmaps for zero-copy
    );
    return;
  }

  if (type === 'extract_packets') {
    const decoder = decoders.get(mediaId);
    if (!decoder) {
      self.postMessage({ type: 'extract_error', mediaId, requestId, error: 'No decoder for ' + mediaId });
      return;
    }

    try {
      const startTimeUs = e.data.startTimeUs;
      const endTimeUs = e.data.endTimeUs;
      const prependConfig = e.data.prependConfig !== false; // default true

      const metas = decoder.getChunkMetasInRange(startTimeUs, endTimeUs);
      const srcBuf = decoder.getSourceBuffer();

      if (!srcBuf || metas.length === 0) {
        self.postMessage({ type: 'extract_error', mediaId, requestId, error: 'No data available' });
        return;
      }

      // AVCC → Annex B conversion:
      // mp4box stores NALUs with length-prefixed format (AVCC). FFmpeg raw H.264
      // needs Annex B start codes (00 00 00 01). The NALU length prefix size is
      // specified in the avcC box (lengthSizeMinusOne field, byte 4 lower 2 bits).
      // Virtually all H.264 MP4s use 4-byte length, but spec allows 1, 2, or 4.
      const START_CODE = new Uint8Array([0, 0, 0, 1]);

      // Determine NALU length prefix size from avcC description
      const config = decoder.getCodecConfig();
      let naluLenSize = 4; // default
      if (config && config.description && config.description.byteLength >= 5) {
        const desc = config.description instanceof Uint8Array
          ? config.description : new Uint8Array(config.description);
        naluLenSize = (desc[4] & 0x03) + 1; // lengthSizeMinusOne + 1
      }

      // Helper: read NALU length of `naluLenSize` bytes at position `pos`
      const readNaluLen = (data, pos) => {
        if (naluLenSize === 4) {
          return (data[pos] << 24) | (data[pos + 1] << 16) |
                 (data[pos + 2] << 8) | data[pos + 3];
        } else if (naluLenSize === 2) {
          return (data[pos] << 8) | data[pos + 1];
        } else { // 1
          return data[pos];
        }
      };

      // Pre-calculate total size to avoid reallocations
      let totalSize = 0;

      // SPS/PPS from codec config (if requested)
      let configNalus = null;
      if (prependConfig) {
        if (config && config.description) {
          configNalus = _parseAvcCToNalus(config.description);
          for (const nalu of configNalus) {
            totalSize += 4 + nalu.byteLength; // start code + data
          }
        }
      }

      for (const meta of metas) {
        let pos = 0;
        const chunkData = new Uint8Array(srcBuf, meta.offset, meta.size);
        while (pos + naluLenSize <= chunkData.length) {
          const naluLen = readNaluLen(chunkData, pos);
          if (naluLen <= 0 || pos + naluLenSize + naluLen > chunkData.length) break;
          totalSize += 4 + naluLen; // Annex B start code is always 4 bytes
          pos += naluLenSize + naluLen;
        }
      }

      // Guard against OOM — 512MB is a generous limit for a single extraction
      const MAX_EXTRACT_BYTES = 512 * 1024 * 1024;
      if (totalSize > MAX_EXTRACT_BYTES) {
        self.postMessage({
          type: 'extract_error', mediaId, requestId,
          error: `Bitstream too large for stream copy (${(totalSize / 1024 / 1024).toFixed(0)}MB > 512MB limit)`
        });
        return;
      }

      // Build Annex B bitstream
      const annexB = new Uint8Array(totalSize);
      let offset = 0;

      // Prepend SPS/PPS NALUs
      if (configNalus) {
        for (const nalu of configNalus) {
          annexB.set(START_CODE, offset);
          offset += 4;
          annexB.set(nalu, offset);
          offset += nalu.byteLength;
        }
      }

      // Convert each chunk's NALUs
      for (const meta of metas) {
        let pos = 0;
        const chunkData = new Uint8Array(srcBuf, meta.offset, meta.size);
        while (pos + naluLenSize <= chunkData.length) {
          const naluLen = readNaluLen(chunkData, pos);
          if (naluLen <= 0 || pos + naluLenSize + naluLen > chunkData.length) break;
          annexB.set(START_CODE, offset);
          offset += 4;
          annexB.set(chunkData.subarray(pos + naluLenSize, pos + naluLenSize + naluLen), offset);
          offset += naluLen;
          pos += naluLenSize + naluLen;
        }
      }

      self.postMessage(
        { type: 'packets', mediaId, requestId, data: annexB },
        [annexB.buffer] // Transfer for zero-copy
      );
    } catch (err) {
      self.postMessage({ type: 'extract_error', mediaId, requestId, error: err.message });
    }
    return;
  }

  if (type === 'close') {
    const decoder = decoders.get(mediaId);
    if (decoder) {
      decoder.close();
      decoders.delete(mediaId);
    }
    return;
  }
};

// Parse AVCDecoderConfigurationRecord (avcC box) into individual SPS/PPS NALUs.
// The description Uint8Array is the raw avcC bytes from VideoDecoder config.
function _parseAvcCToNalus(description) {
  const nalus = [];
  if (!description || description.byteLength < 7) return nalus;

  const data = description instanceof Uint8Array ? description : new Uint8Array(description);
  let offset = 5; // skip: version(1) + profile(1) + compat(1) + level(1) + lengthSize(1)

  // SPS count (lower 5 bits)
  const numSPS = data[offset++] & 0x1F;
  for (let i = 0; i < numSPS; i++) {
    if (offset + 2 > data.length) break;
    const len = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    if (offset + len > data.length) break;
    nalus.push(data.subarray(offset, offset + len));
    offset += len;
  }

  // PPS count
  if (offset >= data.length) return nalus;
  const numPPS = data[offset++] & 0xFF;
  for (let i = 0; i < numPPS; i++) {
    if (offset + 2 > data.length) break;
    const len = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    if (offset + len > data.length) break;
    nalus.push(data.subarray(offset, offset + len));
    offset += len;
  }

  return nalus;
}
