// Export Worker — renders frames + encodes video off the main thread
// Message protocol: init → start → progress/complete/error

import { createWorkerMediaDecoder } from './WorkerMediaDecoder.js';
import { createWorkerCompositor } from './WorkerCompositor.js';
import { ffmpegBridge } from './FFmpegBridge.js';
import logger from '../../utils/logger.js';

// Show FFmpeg internal logs during export for diagnostics
logger.setLevel('DEBUG');

let mediaDecoder = null;
let compositor = null;
let cancelled = false;

self.onmessage = async (e) => {
  const { type, data } = e.data;

  try {
    switch (type) {
      case 'init':
        await handleInit(data);
        break;
      case 'start':
        await handleStart(data);
        break;
      case 'cancel':
        cancelled = true;
        break;
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      error: err.message || 'Export worker error'
    });
  }
};

async function handleInit(data) {
  const { width, height, media, effectRegistry } = data;

  mediaDecoder = createWorkerMediaDecoder();

  for (const item of media) {
    if (item.type === 'image') {
      mediaDecoder.registerImage(item.id, item.blob);
    } else if (item.type === 'video') {
      if (item.buffer) {
        mediaDecoder.registerVideo(item.id, item.buffer);
      } else if (item.frames) {
        mediaDecoder.registerFrames(item.id, item.frames);
      } else {
        console.warn(`[ExportWorker] video item ${item.id} has no buffer or frames!`);
      }
    }
  }

  const effectMap = new Map();
  if (effectRegistry) {
    for (const def of effectRegistry) {
      effectMap.set(def.id, def);
    }
  }

  const effectRegistryGet = (id) => effectMap.get(id);
  // Resolve effect params for export with linear keyframe interpolation.
  // Easing modes (ease-in/out, bezier, hold) are approximated as linear here.
  const keyframeResolve = (fx, frame) => {
    const resolved = { ...fx.params };
    if (fx.keyframes) {
      for (const [paramId, kfs] of Object.entries(fx.keyframes)) {
        if (!kfs || kfs.length === 0) continue;
        // Simple interpolation: find surrounding keyframes
        if (frame <= kfs[0].frame) { resolved[paramId] = kfs[0].value; continue; }
        if (frame >= kfs[kfs.length - 1].frame) { resolved[paramId] = kfs[kfs.length - 1].value; continue; }
        for (let i = 0; i < kfs.length - 1; i++) {
          if (frame >= kfs[i].frame && frame <= kfs[i + 1].frame) {
            const t = (frame - kfs[i].frame) / (kfs[i + 1].frame - kfs[i].frame);
            resolved[paramId] = kfs[i].value + (kfs[i + 1].value - kfs[i].value) * t;
            break;
          }
        }
      }
    }
    return resolved;
  };

  compositor = createWorkerCompositor(
    width, height,
    mediaDecoder,
    effectRegistryGet,
    keyframeResolve
  );

  self.postMessage({ type: 'init_complete' });
}

async function handleStart(data) {
  const { preset, tracks, inPoint, outPoint, fps, mediaItems, audioWavData } = data;
  cancelled = false;

  const totalFrames = outPoint - inPoint;

  // Step 1: Load FFmpeg
  self.postMessage({ type: 'progress', stage: 'loading', progress: 0 });
  await ffmpegBridge.load();
  self.postMessage({ type: 'progress', stage: 'loading', progress: 1 });

  if (cancelled) { self.postMessage({ type: 'cancelled' }); return; }

  // Set the actual project fps (compositor was created with default 30)
  compositor.setFps(fps);

  const mediaMap = new Map();
  for (const item of mediaItems) {
    mediaMap.set(item.id, item);
  }

  // Step 2: Check audio availability (don't write to FFmpeg VFS yet —
  // ffmpeg.writeFile transfers the ArrayBuffer internally, detaching it.
  // The Muxer will write audio.wav itself for WebCodecs path.
  // JPEG fallback writes it just before FFmpeg exec.)
  let hasAudio = !!(audioWavData && audioWavData.byteLength > 0);
  if (hasAudio) {
    self.postMessage({ type: 'log', message: `[Worker] Audio available: ${(audioWavData.byteLength / 1024).toFixed(0)}KB` });
  } else {
    self.postMessage({ type: 'log', message: `[Worker] No audio data received` });
  }

  // Quick sanity check: verify at least one video track has clips with valid data
  {
    let hasVideoClip = false;
    for (const t of tracks) {
      if (t.type !== 'video' || t.muted) continue;
      for (const c of t.clips) {
        if (!c.disabled && c.sourceOutFrame > c.sourceInFrame) {
          hasVideoClip = true;
          break;
        }
      }
      if (hasVideoClip) break;
    }
    if (!hasVideoClip) {
      throw new Error('Worker export: no valid video clips found in timeline');
    }
  }

  // Step 3: Try WebCodecs encode path first (composite + encode in one pass)
  const useWebCodecs = typeof VideoEncoder !== 'undefined' && preset.webCodecsCodec;

  if (useWebCodecs) {
    try {
      const { createWebCodecsEncoder } = await import('./WebCodecsEncoder.js');
      const { muxToContainer } = await import('./Muxer.js');

      const wcEncoder = createWebCodecsEncoder({
        codec: preset.webCodecsCodec,
        width: compositor.canvas.width,
        height: compositor.canvas.height,
        bitrate: preset.videoBitrate,
        fps
      });

      await wcEncoder.init();
      self.postMessage({ type: 'log', message: `[Worker] WebCodecs path: ${totalFrames} frames, ${fps}fps, hasAudio: ${hasAudio}` });

      // Composite and encode each frame directly (no JPEG intermediates)
      self.postMessage({ type: 'progress', stage: 'encoding', progress: 0 });

      let encoded = 0;
      for (let frame = inPoint; frame < outPoint; frame++) {
        if (cancelled) { wcEncoder.close(); self.postMessage({ type: 'cancelled' }); return; }

        const canvas = await compositor.compositeFrame(frame, tracks, (id) => mediaMap.get(id));
        const timestampUs = Math.round((encoded / fps) * 1000000);
        wcEncoder.encodeFrame(canvas, timestampUs);

        encoded++;
        self.postMessage({
          type: 'progress',
          stage: 'encoding',
          progress: encoded / totalFrames,
          current: encoded,
          total: totalFrames
        });
      }

      await wcEncoder.flush();
      const videoData = wcEncoder.getEncodedData();
      wcEncoder.close();

      // Mux with FFmpeg (copy mode — very fast)
      self.postMessage({ type: 'progress', stage: 'muxing', progress: 0 });

      const outputData = await muxToContainer(ffmpegBridge, videoData, audioWavData, {
        codec: preset.webCodecsCodec,
        format: preset.format,
        fps,
        duration: totalFrames / fps,
        audioBitrate: preset.audioBitrate,
        audioSampleRate: preset.audioSampleRate
      });

      // audio.wav is cleaned up by muxToContainer itself

      const mimeType = preset.format === 'webm' ? 'video/webm' : 'video/mp4';
      const buffer = outputData.buffer;

      self.postMessage({ type: 'complete', buffer, mimeType }, [buffer]);
      if (compositor) compositor.cleanup();
      if (mediaDecoder) mediaDecoder.cleanup();
      return;

    } catch (wcErr) {
      self.postMessage({ type: 'log', message: `[Worker] WebCodecs FAILED: ${wcErr.message}, falling to JPEG` });
    }
  }

  self.postMessage({ type: 'log', message: `[Worker] JPEG+FFmpeg fallback path (${totalFrames} frames, hasAudio: ${hasAudio})` });
  // Step 4: Fallback — render frames as JPEG + FFmpeg full encode
  let rendered = 0;
  self.postMessage({ type: 'progress', stage: 'rendering', progress: 0 });

  for (let frame = inPoint; frame < outPoint; frame++) {
    if (cancelled) { self.postMessage({ type: 'cancelled' }); return; }

    const canvas = await compositor.compositeFrame(frame, tracks, (id) => mediaMap.get(id));

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    const paddedNum = String(rendered).padStart(6, '0');
    await ffmpegBridge.writeFile(`frame_${paddedNum}.jpg`, uint8);

    rendered++;
    self.postMessage({
      type: 'progress',
      stage: 'rendering',
      progress: rendered / totalFrames,
      current: rendered,
      total: totalFrames
    });
  }

  if (cancelled) { self.postMessage({ type: 'cancelled' }); return; }

  // Step 5: FFmpeg encode
  self.postMessage({ type: 'progress', stage: 'encoding', progress: 0 });

  // Write audio to FFmpeg VFS for JPEG path (WebCodecs path handles it in Muxer)
  if (hasAudio && audioWavData && audioWavData.byteLength > 0) {
    await ffmpegBridge.writeFile('audio.wav', new Uint8Array(audioWavData));
  } else if (hasAudio) {
    // audioWavData was detached (shouldn't happen now), skip audio
    hasAudio = false;
  }

  ffmpegBridge.setProgressCallback((progress) => {
    self.postMessage({ type: 'progress', stage: 'encoding', progress });
  });

  const outputFilename = `output.${preset.format}`;
  const args = buildFFmpegArgs(preset, fps, rendered, hasAudio, outputFilename);

  try {
    await ffmpegBridge.exec(args);
  } catch (err) {
    throw new Error(`FFmpeg encoding failed: ${err.message}`);
  } finally {
    ffmpegBridge.setProgressCallback(null);
  }

  // Step 6: Read output
  const outputData = await ffmpegBridge.readFile(outputFilename);
  const mimeType = preset.format === 'webm' ? 'video/webm' :
                   preset.format === 'gif' ? 'image/gif' : 'video/mp4';
  const outputBlob = new Blob([outputData.buffer], { type: mimeType });

  // Cleanup
  for (let i = 0; i < rendered; i++) {
    const paddedNum = String(i).padStart(6, '0');
    await ffmpegBridge.deleteFile(`frame_${paddedNum}.jpg`);
  }
  await ffmpegBridge.deleteFile(outputFilename);
  if (hasAudio) await ffmpegBridge.deleteFile('audio.wav');

  const buffer = await outputBlob.arrayBuffer();
  self.postMessage(
    { type: 'complete', buffer, mimeType },
    [buffer]
  );

  if (compositor) compositor.cleanup();
  if (mediaDecoder) mediaDecoder.cleanup();
}

function buildFFmpegArgs(preset, fps, frameCount, hasAudio, outputFilename) {
  const args = ['-framerate', String(fps), '-i', 'frame_%06d.jpg'];
  if (hasAudio) args.push('-i', 'audio.wav');
  if (preset.videoCodec) args.push('-c:v', preset.videoCodec);
  if (preset.pixelFormat) args.push('-pix_fmt', preset.pixelFormat);
  if (preset.videoBitrate) args.push('-b:v', preset.videoBitrate);
  if (preset.preset) args.push('-preset', preset.preset);
  if (hasAudio && preset.audioCodec) {
    args.push('-c:a', preset.audioCodec);
    if (preset.audioBitrate) args.push('-b:a', preset.audioBitrate);
    if (preset.audioSampleRate) args.push('-ar', String(preset.audioSampleRate));
  }
  if (hasAudio) args.push('-shortest');
  args.push('-y', outputFilename);
  return args;
}
