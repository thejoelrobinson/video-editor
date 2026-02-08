// WebCodecs VideoEncoder — hardware-accelerated H.264/VP9 encoding
import logger from '../../utils/logger.js';

export function createWebCodecsEncoder(config) {
  let encoder = null;
  let encodedChunks = [];
  let frameCount = 0;
  let _drainResolve = null;
  let _drainThreshold = 0;

  const _checkDrain = () => {
    if (_drainResolve && encoder && encoder.encodeQueueSize <= _drainThreshold) {
      const resolve = _drainResolve;
      _drainResolve = null;
      resolve();
    }
  };

  return {
    async init() {
      const encoderConfig = {
        codec: config.codec,
        width: config.width,
        height: config.height,
        bitrate: parseBitrate(config.bitrate),
        framerate: config.fps,
        hardwareAcceleration: 'prefer-hardware',
        latencyMode: 'quality',
        avc: config.codec.startsWith('avc1') ? { format: 'annexb' } : undefined
      };

      // Check if codec is supported
      const support = await VideoEncoder.isConfigSupported(encoderConfig);
      if (!support.supported) {
        throw new Error(`Codec ${config.codec} not supported by VideoEncoder`);
      }

      encoder = new VideoEncoder({
        output: (chunk, metadata) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          encodedChunks.push({
            data,
            timestamp: chunk.timestamp,
            duration: chunk.duration,
            type: chunk.type,
            decoderConfig: metadata?.decoderConfig || null
          });
          _checkDrain();
        },
        error: (err) => {
          logger.error('VideoEncoder error:', err);
        }
      });

      encoder.configure(encoderConfig);

      // Listen for dequeue events (Chrome 106+) for more reliable drain notification
      try {
        encoder.addEventListener('dequeue', _checkDrain);
      } catch (_) { /* older browsers lack dequeue event */ }

      logger.info(`WebCodecsEncoder configured: ${config.codec} ${config.width}x${config.height} @ ${config.fps}fps`);
    },

    // Encode a single frame from an OffscreenCanvas or HTMLCanvasElement
    encodeFrame(canvas, timestampUs) {
      if (!encoder || encoder.state !== 'configured') return;

      const frame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: Math.round(1000000 / config.fps)
      });

      // Insert keyframe periodically (every 2 seconds)
      const isKeyframe = frameCount % (config.fps * 2) === 0;
      encoder.encode(frame, { keyFrame: isKeyframe });
      frame.close();
      frameCount++;
    },

    // Encode a single frame forcing an IDR keyframe (used at render segment boundaries)
    encodeFrameKeyframe(canvas, timestampUs) {
      if (!encoder || encoder.state !== 'configured') return;

      const frame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: Math.round(1000000 / config.fps)
      });

      encoder.encode(frame, { keyFrame: true });
      frame.close();
      frameCount++;
    },

    async flush() {
      if (!encoder || encoder.state !== 'configured') return;
      await encoder.flush();
    },

    // Get all encoded data as a single Uint8Array
    getEncodedData() {
      let totalSize = 0;
      for (const chunk of encodedChunks) {
        totalSize += chunk.data.byteLength;
      }

      const result = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of encodedChunks) {
        result.set(chunk.data, offset);
        offset += chunk.data.byteLength;
      }

      return result;
    },

    // Get encoded data and clear the buffer (used by hybrid export for per-segment output)
    getAndClearEncodedData() {
      const data = this.getEncodedData();
      encodedChunks = [];
      return data;
    },

    getChunks() {
      return encodedChunks;
    },

    getFrameCount() {
      return frameCount;
    },

    // Encoder queue depth — used for backpressure during pipelined export
    getQueueSize() {
      return encoder ? encoder.encodeQueueSize : 0;
    },

    // Event-driven backpressure: resolves when encodeQueueSize <= threshold.
    // Returns immediately if already below threshold.
    waitForDrain(threshold) {
      if (!encoder || encoder.encodeQueueSize <= threshold) {
        return Promise.resolve();
      }
      // If there's already a pending drain, resolve it first (shouldn't happen in normal flow)
      if (_drainResolve) {
        const old = _drainResolve;
        _drainResolve = null;
        old();
      }
      _drainThreshold = threshold;
      return new Promise(resolve => { _drainResolve = resolve; });
    },

    close() {
      // Resolve any pending drain promise to unblock export cancellation
      if (_drainResolve) {
        const resolve = _drainResolve;
        _drainResolve = null;
        resolve();
      }
      if (encoder) {
        try { encoder.removeEventListener('dequeue', _checkDrain); } catch (_) {}
        try { encoder.close(); } catch (e) { /* already closed */ }
        encoder = null;
      }
      encodedChunks = [];
      frameCount = 0;
    }
  };
}

// Feature detection
export function isWebCodecsEncodeSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

// Parse bitrate string like '8M' or '5M' to number
function parseBitrate(bitrateStr) {
  if (typeof bitrateStr === 'number') return bitrateStr;
  if (!bitrateStr) return 5000000;
  const match = String(bitrateStr).match(/^(\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (!match) return 5000000;
  const num = parseFloat(match[1]);
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'm') return num * 1000000;
  if (unit === 'k') return num * 1000;
  return num;
}

export default createWebCodecsEncoder;
