// Web Worker: pre-encode decoded frames to H.264 at sequence settings.
// Receives ImageBitmaps (transferred), encodes via VideoEncoder, returns Annex B packets.
// Also handles export-mode encoding: fresh frames routed through the SAME encoder
// instance so SPS/PPS headers match the cached conform packets.

let encoder = null;
let encoderConfig = null;
let useQuantizerMode = false;
let exportMode = false; // when true, output callback sends 'export-packet' instead of 'packet'
const QUANTIZER_QP = 18; // H.264 QP: 0=lossless, 51=worst. 18 ≈ visually lossless on HW encoders

function parseBitrate(str) {
  if (typeof str === 'number') return str;
  if (!str) return 15000000;
  const m = String(str).match(/^(\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (!m) return 15000000;
  const n = parseFloat(m[1]);
  const u = (m[2] || '').toLowerCase();
  if (u === 'm') return n * 1000000;
  if (u === 'k') return n * 1000;
  return n;
}

function createEncoder(config) {
  if (encoder) {
    try { encoder.close(); } catch (_) {}
  }

  encoderConfig = config;

  encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);

      if (exportMode) {
        // Export path — send raw packet for collection by ExportPipeline
        self.postMessage({
          type: 'export-packet',
          data,
          isKeyframe: chunk.type === 'key'
        }, [data.buffer]);
      } else {
        // Idle-fill path — send full metadata for cache storage
        self.postMessage({
          type: 'packet',
          packet: {
            data,
            timestamp: chunk.timestamp,
            duration: chunk.duration,
            isKeyframe: chunk.type === 'key',
            decoderConfig: metadata?.decoderConfig || null
          }
        }, [data.buffer]);
      }
    },
    error: (err) => {
      self.postMessage({ type: 'error', error: err.message });
    }
  });

  const isAvc = config.codec.startsWith('avc1');
  let encoderCfg;

  if (useQuantizerMode) {
    encoderCfg = {
      codec: config.codec,
      width: config.width,
      height: config.height,
      framerate: config.fps,
      bitrateMode: 'quantizer',
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'quality',
      avc: isAvc ? { format: 'annexb' } : undefined
    };
  } else {
    encoderCfg = {
      codec: config.codec,
      width: config.width,
      height: config.height,
      bitrate: parseBitrate(config.bitrate) * 2,
      bitrateMode: 'variable',
      framerate: config.fps,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'quality',
      avc: isAvc ? { format: 'annexb' } : undefined
    };
  }

  encoder.configure(encoderCfg);
}

// Build encode options — adds per-frame QP when in quantizer mode
function encodeOpts(forceKeyframe) {
  const opts = { keyFrame: !!forceKeyframe };
  if (useQuantizerMode && encoderConfig.codec.startsWith('avc1')) {
    opts.avc = { quantizer: QUANTIZER_QP };
  }
  return opts;
}

self.onmessage = async (e) => {
  const { type } = e.data;

  switch (type) {
    case 'configure': {
      const { codec, width, height, bitrate, fps } = e.data;
      try {
        const cfg = { codec, width, height, bitrate, fps };
        const isAvc = codec.startsWith('avc1');

        const qCfg = {
          codec, width, height,
          bitrateMode: 'quantizer',
          framerate: fps,
          hardwareAcceleration: 'prefer-hardware',
          latencyMode: 'quality',
          avc: isAvc ? { format: 'annexb' } : undefined
        };

        try {
          const qSupport = await VideoEncoder.isConfigSupported(qCfg);
          if (qSupport.supported) {
            useQuantizerMode = true;
            self.postMessage({ type: 'log', message: `[ConformWorker] Using quantizer mode (QP ${QUANTIZER_QP})` });
          }
        } catch (_) {}

        if (!useQuantizerMode) {
          const vbrCfg = {
            codec, width, height,
            bitrate: parseBitrate(bitrate) * 2,
            bitrateMode: 'variable',
            framerate: fps,
            hardwareAcceleration: 'prefer-hardware',
            latencyMode: 'quality',
            avc: isAvc ? { format: 'annexb' } : undefined
          };
          const support = await VideoEncoder.isConfigSupported(vbrCfg);
          if (!support.supported) {
            self.postMessage({ type: 'configure_error', error: `Codec ${codec} not supported` });
            return;
          }
          self.postMessage({ type: 'log', message: `[ConformWorker] Using VBR mode (${parseBitrate(bitrate) * 2 / 1000000}Mbps ceiling)` });
        }

        createEncoder(cfg);
        self.postMessage({ type: 'configure_done' });
      } catch (err) {
        self.postMessage({ type: 'configure_error', error: err.message });
      }
      break;
    }

    case 'encode': {
      if (!encoder || encoder.state !== 'configured') {
        self.postMessage({ type: 'encode_error', error: 'Encoder not configured', requestId: e.data.requestId });
        return;
      }
      const { bitmap, timestampUs, forceKeyframe, requestId } = e.data;
      try {
        const frame = new VideoFrame(bitmap, {
          timestamp: timestampUs,
          duration: Math.round(1000000 / encoderConfig.fps)
        });
        bitmap.close();
        encoder.encode(frame, encodeOpts(forceKeyframe));
        frame.close();
        self.postMessage({ type: 'encode_accepted', requestId });
      } catch (err) {
        self.postMessage({ type: 'encode_error', error: err.message, requestId });
      }
      break;
    }

    // === Export-mode messages ===
    // Uses the SAME encoder instance as idle-fill, so SPS/PPS match cached packets.

    case 'export-start': {
      exportMode = true;
      self.postMessage({ type: 'export-started' });
      break;
    }

    case 'export-encode': {
      if (!encoder || encoder.state !== 'configured') {
        self.postMessage({ type: 'export-error', error: 'Encoder not configured' });
        return;
      }
      const { bitmap, timestampUs, forceKeyframe } = e.data;
      try {
        const frame = new VideoFrame(bitmap, {
          timestamp: timestampUs,
          duration: Math.round(1000000 / encoderConfig.fps)
        });
        bitmap.close();
        encoder.encode(frame, encodeOpts(forceKeyframe));
        frame.close();
        // Report queue size for backpressure
        self.postMessage({ type: 'export-accepted', queueSize: encoder.encodeQueueSize });
      } catch (err) {
        self.postMessage({ type: 'export-error', error: err.message });
      }
      break;
    }

    case 'export-flush': {
      if (!encoder || encoder.state !== 'configured') {
        self.postMessage({ type: 'export-flush-done' });
        return;
      }
      try {
        await encoder.flush();
        self.postMessage({ type: 'export-flush-done' });
      } catch (err) {
        self.postMessage({ type: 'export-flush-done' }); // resolve anyway
      }
      break;
    }

    case 'export-end': {
      exportMode = false;
      self.postMessage({ type: 'export-ended' });
      break;
    }

    // === Standard messages ===

    case 'flush': {
      if (!encoder || encoder.state !== 'configured') {
        self.postMessage({ type: 'flush_done' });
        return;
      }
      try {
        await encoder.flush();
        self.postMessage({ type: 'flush_done' });
      } catch (err) {
        self.postMessage({ type: 'flush_error', error: err.message });
      }
      break;
    }

    case 'reconfigure': {
      const { codec, width, height, bitrate, fps } = e.data;
      try {
        createEncoder({ codec, width, height, bitrate, fps });
        self.postMessage({ type: 'reconfigure_done' });
      } catch (err) {
        self.postMessage({ type: 'reconfigure_error', error: err.message });
      }
      break;
    }

    case 'close': {
      if (encoder) {
        try { encoder.close(); } catch (_) {}
        encoder = null;
      }
      self.postMessage({ type: 'closed' });
      break;
    }
  }
};
