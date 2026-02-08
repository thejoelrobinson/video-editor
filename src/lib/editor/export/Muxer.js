// Mux encoded video bitstream + audio into container using FFmpeg (copy mode, no re-encode)
import logger from '../../utils/logger.js';

export async function muxToContainer(ffmpegBridge, videoData, audioData, config) {
  const isH264 = config.codec.startsWith('avc1');
  const isVP9 = config.codec.startsWith('vp09');
  const videoExt = isH264 ? 'h264' : isVP9 ? 'ivf' : 'raw';
  const videoFile = `video.${videoExt}`;
  const outputFile = `output.${config.format || 'mp4'}`;

  // Write video + audio to VFS in parallel
  const writes = [ffmpegBridge.writeFile(videoFile, videoData)];
  let hasAudio = false;
  if (audioData && audioData.byteLength > 0) {
    writes.push(ffmpegBridge.writeFile('audio.wav', new Uint8Array(audioData)));
    hasAudio = true;
  }
  await Promise.all(writes);

  // Build FFmpeg args — copy mode (no re-encoding)
  // Framerate MUST be specified for raw bitstreams (H.264 Annex B has no fps metadata)
  const fps = config.fps || 30;
  const args = ['-r', String(fps), '-i', videoFile];

  if (hasAudio) {
    args.push('-i', 'audio.wav');
  }

  // Video: copy (already encoded)
  args.push('-c:v', 'copy');

  // Audio: encode to AAC (from WAV)
  if (hasAudio) {
    args.push('-c:a', 'aac');
    if (config.audioBitrate) args.push('-b:a', config.audioBitrate);
    if (config.audioSampleRate) args.push('-ar', String(config.audioSampleRate));
  }

  // Set exact output duration (like Premiere: sequence length or in/out range)
  // This ensures audio is padded/trimmed to match the video duration exactly
  if (config.duration) {
    args.push('-t', String(config.duration.toFixed(6)));
  }
  args.push('-y', outputFile);

  const cmd = `ffmpeg ${args.join(' ')}`;
  logger.info(`Muxing: ${cmd}`);
  if (typeof self !== 'undefined' && self.postMessage) {
    try { self.postMessage({ type: 'log', message: `[Worker Mux] ${cmd}` }); } catch (_) {}
  }
  await ffmpegBridge.exec(args);

  // Read output
  const outputData = await ffmpegBridge.readFile(outputFile);

  // Cleanup (parallel deletes)
  const deletes = [ffmpegBridge.deleteFile(videoFile), ffmpegBridge.deleteFile(outputFile)];
  if (hasAudio) deletes.push(ffmpegBridge.deleteFile('audio.wav'));
  await Promise.all(deletes);

  return outputData;
}

export default muxToContainer;
