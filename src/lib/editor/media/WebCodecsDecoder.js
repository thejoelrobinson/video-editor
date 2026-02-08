// WebCodecs VideoDecoder wrapper -- frame-accurate hardware-accelerated decode
import { createDemuxer } from './Demuxer.js';
import logger from '../../utils/logger.js';

export function createWebCodecsDecoder() {
  let demuxer = null;
  let decoder = null;
  let videoConfig = null;
  let chunkMetas = [];       // Lightweight metadata per chunk (no copied data)
  let sourceBuffer = null;   // Original ArrayBuffer — chunks created on demand
  let decodedFrames = [];    // Decoded VideoFrames pending pickup
  let trackInfo = null;
  let initPromise = null;
  let seekLock = null;       // Mutex: serialize concurrent getFrameAt calls
  let sequentialMode = false;
  let lastDecodedIdx = -1;   // Last chunk index decoded in sequential mode
  let seqFrameBuffer = null; // Map<timestamp(us), VideoFrame> for current GOP
  let seqGopKeyIdx = -1;     // keyframe index of current decoded GOP
  let lastError = null;      // Captured from decoder error callback

  // Create an EncodedVideoChunk on demand from stored metadata + source buffer.
  // Avoids keeping ~1.15GB of duplicated chunk data in memory.
  function _createChunk(meta) {
    return new EncodedVideoChunk({
      type: meta.type,
      timestamp: meta.timestamp,
      duration: meta.duration,
      data: new Uint8Array(sourceBuffer, meta.offset, meta.size)
    });
  }

  // Close any orphaned VideoFrames in decodedFrames before resetting
  function _drainDecodedFrames() {
    for (const f of decodedFrames) f.close();
    decodedFrames = [];
  }

  // Create a brand-new VideoDecoder (for error recovery or first use)
  function _createDecoder() {
    if (decoder) {
      try { decoder.close(); } catch (e) { /* already closed */ }
    }
    lastError = null;
    decoder = new VideoDecoder({
      output: (frame) => { decodedFrames.push(frame); },
      error: (err) => {
        lastError = err;
        logger.error('VideoDecoder error:', err);
      }
    });
    decoder.configure({
      ...videoConfig,
      hardwareAcceleration: 'prefer-hardware',
      optimizeForLatency: !sequentialMode
    });
  }

  // Reset existing decoder for normal seeks (reuses hardware resources).
  // Falls back to close+recreate if decoder is in a bad state.
  function _resetDecoder() {
    if (decoder && decoder.state === 'configured' && !lastError) {
      decoder.reset();
      decoder.configure({
        ...videoConfig,
        hardwareAcceleration: 'prefer-hardware',
        optimizeForLatency: !sequentialMode
      });
    } else {
      _createDecoder();
    }
  }

  return {
    async init(mediaId, arrayBuffer) {
      if (initPromise) return initPromise;

      initPromise = (async () => {
        demuxer = createDemuxer();
        sourceBuffer = arrayBuffer;

        const metas = [];
        let config = null;

        await demuxer.init(arrayBuffer, {
          onVideoConfig(cfg) {
            config = cfg;
          },
          onVideoChunk(chunk, sample) {
            // Store lightweight metadata — NOT the EncodedVideoChunk.
            // sample.offset is the byte position in sourceBuffer (fileStart=0).
            // Chunks are created on demand via _createChunk() during decode.
            metas.push({
              type: sample.is_sync ? 'key' : 'delta',
              timestamp: chunk.timestamp,
              duration: chunk.duration,
              offset: sample.offset,
              size: sample.size
            });
          }
        });

        videoConfig = config;
        chunkMetas = metas;
        trackInfo = demuxer.getVideoTrackInfo();

        // Release mp4box internal buffers — saves ~1.15GB for large files.
        // We keep sourceBuffer for on-demand chunk creation.
        demuxer.cleanup();
        demuxer = null;

        if (!videoConfig) {
          throw new Error('No video config from demuxer');
        }

        // Validate config before first use
        const support = await VideoDecoder.isConfigSupported(videoConfig);
        if (!support.supported) {
          throw new Error(`VideoDecoder config not supported: ${videoConfig.codec}`);
        }

        // NOTE: Do NOT sort chunks by timestamp (CTS/presentation order).
        // mp4box delivers samples in DTS (decode) order. H.264 B-frames
        // require decode order — sorting by CTS breaks delta frame decoding.

        logger.info(`WebCodecsDecoder: ${chunkMetas.length} chunks, ${trackInfo.width}x${trackInfo.height}, ${trackInfo.frameRate.toFixed(1)}fps`);
      })();

      return initPromise;
    },

    async getFrameAt(timeSeconds) {
      if (!videoConfig || chunkMetas.length === 0) return null;

      // Serialize concurrent seeks to prevent decoder close/recreate races
      while (seekLock) {
        await seekLock;
      }

      let unlockSeek;
      seekLock = new Promise(resolve => { unlockSeek = resolve; });

      try {
        return await this._decodeFrameAt(timeSeconds);
      } finally {
        seekLock = null;
        unlockSeek();
      }
    },

    async _decodeFrameAt(timeSeconds) {
      const targetUs = timeSeconds * 1000000;

      // Chunks are in DTS (decode) order with CTS (presentation) timestamps.
      // Find the keyframe whose CTS is at or before the target.
      let keyIdx = 0;
      for (let i = chunkMetas.length - 1; i >= 0; i--) {
        if (chunkMetas[i].type === 'key' && chunkMetas[i].timestamp <= targetUs) {
          keyIdx = i;
          break;
        }
      }

      // Find the end index: we must decode all chunks in DTS order from keyIdx
      // until we've covered the chunk closest to our target CTS. Since chunks
      // are in DTS order, the chunk with the target CTS might come before later
      // DTS entries. Scan forward from keyIdx to find the closest CTS match,
      // stopping at the next keyframe (GOP boundary).
      let bestIdx = keyIdx;
      let bestDist = Math.abs(chunkMetas[keyIdx].timestamp - targetUs);
      for (let i = keyIdx + 1; i < chunkMetas.length; i++) {
        if (chunkMetas[i].type === 'key') break; // next GOP
        const dist = Math.abs(chunkMetas[i].timestamp - targetUs);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }

      // Reset decoder for seek — reuses hardware resources when healthy
      _drainDecodedFrames();
      lastError = null;
      _resetDecoder();

      // Decode from keyframe through all DTS-ordered chunks up to bestIdx.
      // Chunks created on demand from sourceBuffer to avoid storing ~1.15GB of copies.
      for (let i = keyIdx; i <= bestIdx; i++) {
        if (decoder.state !== 'configured') break;
        decoder.decode(_createChunk(chunkMetas[i]));
      }

      // Guard flush — continue with partial output if flush fails
      if (decoder.state === 'configured') {
        try {
          await decoder.flush();
        } catch (e) {
          logger.warn('VideoDecoder flush failed, using partial output:', e.message);
        }
      }

      // If decoder errored but we have partial output (e.g. keyframe decoded
      // before a delta frame failed), use the partial result instead of throwing.
      if (lastError) {
        if (decodedFrames.length === 0) {
          throw lastError;
        }
        lastError = null;
      }

      // Find best match from decoded frames
      let best = null;
      let frameDist = Infinity;

      for (const frame of decodedFrames) {
        const dist = Math.abs(frame.timestamp - targetUs);
        if (dist < frameDist) {
          frameDist = dist;
          if (best) best.close();
          best = frame;
        } else {
          frame.close();
        }
      }

      decodedFrames = [];
      return best;
    },

    async getImageBitmapAt(timeSeconds) {
      const frame = await this.getFrameAt(timeSeconds);
      if (!frame) return null;

      try {
        const bitmap = await createImageBitmap(frame);
        frame.close();
        return bitmap;
      } catch (e) {
        frame.close();
        return null;
      }
    },

    // Sequential mode: batch-decode entire GOPs, serve frames from buffer.
    // During export, frames are requested in order. Instead of re-decoding from
    // the nearest keyframe for EVERY frame, we decode the full GOP once and
    // serve each frame from an in-memory buffer. ~30x faster per GOP.
    startSequentialMode() {
      sequentialMode = true;
      lastDecodedIdx = -1;
      seqFrameBuffer = new Map();
      seqGopKeyIdx = -1;
    },

    endSequentialMode() {
      sequentialMode = false;
      lastDecodedIdx = -1;
      if (seqFrameBuffer) {
        for (const bmp of seqFrameBuffer.values()) {
          bmp.close?.();
        }
        seqFrameBuffer = null;
      }
      seqGopKeyIdx = -1;
    },

    async getSequentialImageBitmap(timeSeconds) {
      if (!videoConfig || chunkMetas.length === 0) return null;

      const targetUs = timeSeconds * 1000000;

      // Find the target chunk index
      let targetIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < chunkMetas.length; i++) {
        const dist = Math.abs(chunkMetas[i].timestamp - targetUs);
        if (dist < bestDist) {
          bestDist = dist;
          targetIdx = i;
        }
        if (chunkMetas[i].timestamp > targetUs + 50000) break;
      }

      // Find the keyframe for this target's GOP
      let keyIdx = 0;
      for (let i = targetIdx; i >= 0; i--) {
        if (chunkMetas[i].type === 'key') {
          keyIdx = i;
          break;
        }
      }

      // Decode this GOP if not already buffered
      if (seqGopKeyIdx !== keyIdx) {
        // Find end of this GOP (next keyframe or end of chunks)
        let gopEnd = chunkMetas.length - 1;
        for (let i = keyIdx + 1; i < chunkMetas.length; i++) {
          if (chunkMetas[i].type === 'key') {
            gopEnd = i - 1;
            break;
          }
        }

        // Close old GOP frames
        if (seqFrameBuffer) {
          for (const frame of seqFrameBuffer.values()) {
            frame.close();
          }
          seqFrameBuffer = new Map();
        }

        // Reset decoder for new GOP
        _drainDecodedFrames();
        lastError = null;
        _resetDecoder();

        // Decode entire GOP at once — chunks created on demand from sourceBuffer
        for (let i = keyIdx; i <= gopEnd; i++) {
          if (decoder.state !== 'configured') break;
          decoder.decode(_createChunk(chunkMetas[i]));
        }

        if (decoder.state === 'configured') {
          try {
            await decoder.flush();
          } catch (e) {
            logger.warn('Sequential flush failed, using partial output:', e.message);
          }
        }

        if (lastError) {
          _drainDecodedFrames();
          throw lastError;
        }

        // Convert decoded VideoFrames to ImageBitmaps immediately and close
        // the VideoFrames. VideoFrames hold hardware decoder resources; keeping
        // an entire GOP (120-240 frames at 60fps) as VideoFrames can use 1-2GB.
        for (const frame of decodedFrames) {
          try {
            const bmp = await createImageBitmap(frame);
            seqFrameBuffer.set(frame.timestamp, bmp);
          } catch (e) {
            // Frame corrupt — skip
          }
          frame.close();
        }
        decodedFrames = [];
        seqGopKeyIdx = keyIdx;
      }

      lastDecodedIdx = targetIdx;

      // Find closest frame in the GOP buffer (now holds ImageBitmaps)
      let bestBmp = null;
      let bestFrameDist = Infinity;
      for (const [ts, bmp] of seqFrameBuffer) {
        const dist = Math.abs(ts - targetUs);
        if (dist < bestFrameDist) {
          bestFrameDist = dist;
          bestBmp = bmp;
        }
      }

      if (!bestBmp) return null;

      // Clone the cached ImageBitmap (original stays in GOP buffer for reuse)
      try {
        return await createImageBitmap(bestBmp);
      } catch (e) {
        return null;
      }
    },

    // Expose raw chunk metadata + source buffer for stream copy (packet extraction).
    // Returns metas from the keyframe at or before startTimeUs through the GOP
    // containing endTimeUs. Uses full-GOP collection (not CTS-based cutoff) because
    // chunks are in DTS order and B-frames may have CTS > endTimeUs while being
    // interleaved with earlier-CTS chunks in the same GOP.
    getChunkMetasInRange(startTimeUs, endTimeUs) {
      if (chunkMetas.length === 0) return [];

      // Find keyframe at or before startTimeUs
      let keyIdx = 0;
      for (let i = chunkMetas.length - 1; i >= 0; i--) {
        if (chunkMetas[i].type === 'key' && chunkMetas[i].timestamp <= startTimeUs) {
          keyIdx = i;
          break;
        }
      }

      // Find the last GOP that contains endTimeUs.
      // Walk forward: for each keyframe, check if any chunk in its GOP has CTS <= endTimeUs.
      // Collect all full GOPs from keyIdx through that last GOP.
      let endIdx = chunkMetas.length - 1;
      let foundEndGop = false;
      for (let i = keyIdx; i < chunkMetas.length; i++) {
        // At each new keyframe after keyIdx, check if we've passed endTimeUs.
        // A GOP is "needed" if any of its chunks has CTS <= endTimeUs.
        if (i > keyIdx && chunkMetas[i].type === 'key') {
          // Check if ALL remaining chunks in this new GOP are past endTimeUs
          let gopNeeded = false;
          for (let j = i; j < chunkMetas.length; j++) {
            if (j > i && chunkMetas[j].type === 'key') break;
            if (chunkMetas[j].timestamp <= endTimeUs) {
              gopNeeded = true;
              break;
            }
          }
          if (!gopNeeded) {
            endIdx = i - 1; // stop at end of previous GOP
            foundEndGop = true;
            break;
          }
        }
      }

      const result = [];
      for (let i = keyIdx; i <= endIdx; i++) {
        result.push(chunkMetas[i]);
      }
      return result;
    },

    getSourceBuffer() {
      return sourceBuffer;
    },

    getCodecConfig() {
      return videoConfig;
    },

    isHealthy() {
      // Error callback fired — decoder is compromised
      if (lastError) return false;
      // No VideoDecoder created yet but config is valid — healthy (awaiting first decode)
      if (!decoder && videoConfig) return true;
      return decoder && decoder.state === 'configured';
    },

    getTrackInfo() {
      return trackInfo;
    },

    close() {
      seekLock = null;

      // Close any pending decoded frames
      _drainDecodedFrames();

      // Close sequential mode buffer (ImageBitmaps)
      if (seqFrameBuffer) {
        for (const bmp of seqFrameBuffer.values()) {
          bmp.close?.();
        }
        seqFrameBuffer = null;
      }
      seqGopKeyIdx = -1;
      sequentialMode = false;
      lastDecodedIdx = -1;

      if (decoder) {
        try { decoder.close(); } catch (e) { /* already closed */ }
        decoder = null;
      }

      if (demuxer) {
        demuxer.cleanup();
        demuxer = null;
      }

      chunkMetas = [];
      sourceBuffer = null;
      videoConfig = null;
      trackInfo = null;
      initPromise = null;
      lastError = null;
    }
  };
}

export function isWebCodecsSupported() {
  return typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
}

export default createWebCodecsDecoder;
