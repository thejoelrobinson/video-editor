// Web Worker: pre-encode decoded frames to H.264 at sequence settings.
// Receives ImageBitmaps (transferred), encodes via VideoEncoder, returns Annex B packets.

let encoder = null;
let encoderConfig = null;

function parseBitrate(str) {
  if (typeof str === 'number') return str;
  if (!str) return 8000000;
  const m = String(str).match(/^(\d+(?:\.\d+)?)\s*([kKmM])?$/);
  if (!m) return 8000000;
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
      const packet = {
        data,
        timestamp: chunk.timestamp,
        duration: chunk.duration,
        isKeyframe: chunk.type === 'key',
        decoderConfig: metadata?.decoderConfig || null
      };
      // Send packet back to main thread
      self.postMessage({
        type: 'packet',
        packet: {
          data: packet.data,
          timestamp: packet.timestamp,
          duration: packet.duration,
          isKeyframe: packet.isKeyframe,
          decoderConfig: packet.decoderConfig
        }
      }, [packet.data.buffer]);
    },
    error: (err) => {
      self.postMessage({ type: 'error', error: err.message });
    }
  });

  const encoderCfg = {
    codec: config.codec,
    width: config.width,
    height: config.height,
    bitrate: parseBitrate(config.bitrate),
    framerate: config.fps,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'quality',
    avc: config.codec.startsWith('avc1') ? { format: 'annexb' } : undefined
  };

  encoder.configure(encoderCfg);
}

self.onmessage = async (e) => {
  const { type } = e.data;

  switch (type) {
    case 'configure': {
      const { codec, width, height, bitrate, fps } = e.data;
      try {
        const cfg = { codec, width, height, bitrate, fps };
        const support = await VideoEncoder.isConfigSupported({
          codec, width, height,
          bitrate: parseBitrate(bitrate),
          framerate: fps,
          hardwareAcceleration: 'prefer-hardware',
          latencyMode: 'quality',
          avc: codec.startsWith('avc1') ? { format: 'annexb' } : undefined
        });
        if (!support.supported) {
          self.postMessage({ type: 'configure_error', error: `Codec ${codec} not supported` });
          return;
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
        encoder.encode(frame, { keyFrame: !!forceKeyframe });
        frame.close();
        // Packet will arrive via output callback
        self.postMessage({ type: 'encode_accepted', requestId });
      } catch (err) {
        self.postMessage({ type: 'encode_error', error: err.message, requestId });
      }
      break;
    }

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
