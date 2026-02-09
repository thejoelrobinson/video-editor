// JSON schema for project save/load (v2: multi-sequence)
import { DEFAULT_FRAME_RATE, DEFAULT_CANVAS, DEFAULT_SEQUENCE_CODEC, DEFAULT_SEQUENCE_BITRATE } from '../core/Constants.js';

export const PROJECT_VERSION = 2;

// Strip non-serializable params (WebGLTexture handles, raw typed arrays used as
// transient GPU data). Keys prefixed with '_' are runtime-only and must not be
// persisted to IndexedDB (structured clone throws on WebGLTexture).
function filterSerializableParams(params) {
  const out = {};
  for (const key of Object.keys(params)) {
    if (key.startsWith('_')) continue;
    out[key] = params[key];
  }
  return out;
}

function serializeTracks(tracks) {
  return tracks.map(track => ({
    id: track.id,
    name: track.name,
    type: track.type,
    muted: track.muted,
    solo: track.solo,
    locked: track.locked,
    height: track.height,
    clips: track.clips.map(clip => ({
      id: clip.id,
      mediaId: clip.mediaId,
      trackId: clip.trackId,
      name: clip.name,
      startFrame: clip.startFrame,
      sourceInFrame: clip.sourceInFrame,
      sourceOutFrame: clip.sourceOutFrame,
      speed: clip.speed,
      color: clip.color,
      volume: clip.volume,
      disabled: clip.disabled,
      effects: clip.effects.map(fx => ({
        id: fx.id,
        effectId: fx.effectId,
        name: fx.name,
        enabled: fx.enabled,
        intrinsic: fx.intrinsic || false,
        params: filterSerializableParams(fx.params),
        keyframes: fx.keyframes ? JSON.parse(JSON.stringify(fx.keyframes)) : {}
      }))
    }))
  }));
}

export function serializeProject(editorState, timelineEngine, mediaManager) {
  const state = editorState.getState();
  const sequences = editorState.getAllSequences();
  const mediaItems = mediaManager.getAllItems();

  const serializedSequences = {};
  for (const seq of sequences) {
    serializedSequences[seq.id] = {
      id: seq.id,
      name: seq.name,
      frameRate: seq.frameRate,
      canvas: { ...seq.canvas },
      codec: seq.codec,
      bitrate: seq.bitrate,
      tracks: serializeTracks(seq.tracks),
      duration: seq.duration,
      playback: {
        inPoint: seq.playback?.inPoint ?? null,
        outPoint: seq.playback?.outPoint ?? null
      }
    };
  }

  return {
    version: PROJECT_VERSION,
    savedAt: Date.now(),
    project: {
      name: state.project.name,
      nextSequenceId: state.project.nextSequenceId
    },
    activeSequenceId: state.activeSequenceId,
    sequences: serializedSequences,
    media: mediaItems.map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      duration: item.duration,
      width: item.width,
      height: item.height,
      size: item.size
      // Note: actual file data stored separately in IDB media cache
    }))
  };
}

// Migrate v1 project data to v2 format
export function migrateV1ToV2(data) {
  const seqId = 'seq-1';
  return {
    version: 2,
    savedAt: data.savedAt,
    project: {
      name: data.project.name,
      nextSequenceId: 2
    },
    activeSequenceId: seqId,
    sequences: {
      [seqId]: {
        id: seqId,
        name: 'Sequence 1',
        frameRate: data.project.frameRate || DEFAULT_FRAME_RATE,
        canvas: data.project.canvas ? { ...data.project.canvas } : { ...DEFAULT_CANVAS },
        codec: data.project.codec || DEFAULT_SEQUENCE_CODEC,
        bitrate: data.project.bitrate || DEFAULT_SEQUENCE_BITRATE,
        tracks: data.timeline.tracks,
        duration: 0,
        playback: {
          inPoint: data.playback?.inPoint ?? null,
          outPoint: data.playback?.outPoint ?? null
        }
      }
    },
    media: data.media || []
  };
}

export function validateProject(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.project) return false;

  // v1 format: has timeline.tracks + project.frameRate
  if (data.version === 1) {
    if (!data.timeline || !Array.isArray(data.timeline.tracks)) return false;
    if (!data.project.frameRate || !data.project.canvas) return false;
    return true;
  }

  // v2 format: has sequences map
  if (data.version === 2) {
    if (!data.sequences || typeof data.sequences !== 'object') return false;
    if (!data.activeSequenceId) return false;
    // Check at least one sequence exists
    const seqIds = Object.keys(data.sequences);
    if (seqIds.length === 0) return false;
    return true;
  }

  return false;
}

export default { serializeProject, validateProject, migrateV1ToV2, PROJECT_VERSION };
