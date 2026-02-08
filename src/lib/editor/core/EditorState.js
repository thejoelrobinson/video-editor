// Observable state store for the editor
import { eventBus } from './EventBus.js';
import { DEFAULT_FRAME_RATE, DEFAULT_CANVAS, TOOL_TYPES, DEFAULT_ZOOM_INDEX, EDITOR_EVENTS, DEFAULT_SEQUENCE_CODEC, DEFAULT_SEQUENCE_BITRATE } from './Constants.js';

// Default sequence factory
function createDefaultSequence(id, name) {
  return {
    id,
    name: name || 'Sequence 1',
    frameRate: DEFAULT_FRAME_RATE,
    canvas: { ...DEFAULT_CANVAS },
    codec: DEFAULT_SEQUENCE_CODEC,
    bitrate: DEFAULT_SEQUENCE_BITRATE,
    tracks: [],
    duration: 0,
    playback: { inPoint: null, outPoint: null }
  };
}

const DEFAULT_SEQ_ID = 'seq-1';

const state = {
  // Project (global)
  project: {
    name: 'Untitled Project',
    dirty: false,
    _autosaveId: null,
    nextSequenceId: 2
  },

  // Sequences map
  sequences: {
    [DEFAULT_SEQ_ID]: createDefaultSequence(DEFAULT_SEQ_ID, 'Sequence 1')
  },

  // Active sequence pointer
  activeSequenceId: DEFAULT_SEQ_ID,

  // Timeline (UI viewport state — global, not per-sequence)
  timeline: {
    scrollX: 0,
    scrollY: 0,
    zoomIndex: DEFAULT_ZOOM_INDEX
  },

  // Selection
  selection: {
    clipIds: [],
    trackId: null,
    gap: null  // { trackId, startFrame, endFrame } when a gap is selected
  },

  // Playback
  playback: {
    playing: false,
    currentFrame: 0,
    speed: 1,
    loop: false
  },

  // UI
  ui: {
    activeTool: TOOL_TYPES.SELECTION,
    activePanel: null,
    snapEnabled: true,
    linkedSelection: true,
    nestSequences: false,
    showThumbnails: true,
    showWaveforms: true,
    showDuplicateFrames: false,
    showCaptions: false
  },

  // Media bin
  media: {
    items: new Map()
  }
};

const subscribers = new Map();

// Paths that shim from project.* / timeline.* / playback.* into the active sequence
const SEQ_PROJECT_FIELDS = new Set(['frameRate', 'canvas', 'codec', 'bitrate']);
const SEQ_TIMELINE_FIELDS = new Set(['tracks', 'duration']);
const SEQ_PLAYBACK_FIELDS = new Set(['inPoint', 'outPoint']);

// Resolve a path that may need shimming to the active sequence
function resolveShimPath(path) {
  const parts = path.split('.');
  const seqId = state.activeSequenceId;
  const seq = state.sequences[seqId];
  if (!seq) return null;

  // project.frameRate → sequences[activeId].frameRate
  if (parts[0] === 'project' && parts.length >= 2 && SEQ_PROJECT_FIELDS.has(parts[1])) {
    return { target: seq, key: parts[1], remaining: parts.slice(2) };
  }
  // timeline.tracks → sequences[activeId].tracks
  // timeline.duration → sequences[activeId].duration
  if (parts[0] === 'timeline' && parts.length >= 2 && SEQ_TIMELINE_FIELDS.has(parts[1])) {
    return { target: seq, key: parts[1], remaining: parts.slice(2) };
  }
  // playback.inPoint / playback.outPoint → sequences[activeId].playback.*
  if (parts[0] === 'playback' && parts.length >= 2 && SEQ_PLAYBACK_FIELDS.has(parts[1])) {
    return { target: seq.playback, key: parts[1], remaining: parts.slice(2) };
  }

  return null;
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

export const editorState = {
  get(path) {
    if (!path) return state;

    // Shim: redirect sequence-specific paths
    const shim = resolveShimPath(path);
    if (shim) {
      let val = shim.target[shim.key];
      for (const k of shim.remaining) {
        val = val?.[k];
      }
      return val;
    }

    return getNestedValue(state, path);
  },

  set(path, value) {
    // Shim: redirect sequence-specific paths
    const shim = resolveShimPath(path);
    if (shim) {
      if (shim.remaining.length === 0) {
        shim.target[shim.key] = value;
      } else {
        let obj = shim.target[shim.key];
        for (let i = 0; i < shim.remaining.length - 1; i++) {
          obj = obj[shim.remaining[i]];
        }
        obj[shim.remaining[shim.remaining.length - 1]] = value;
      }
      this._notify(path, value);
      return;
    }

    setNestedValue(state, path, value);
    this._notify(path, value);
  },

  update(path, updater) {
    const current = this.get(path);
    const next = updater(current);
    this.set(path, next);
  },

  subscribe(path, callback) {
    if (!subscribers.has(path)) {
      subscribers.set(path, new Set());
    }
    subscribers.get(path).add(callback);
    return () => {
      const subs = subscribers.get(path);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) subscribers.delete(path);
      }
    };
  },

  _notify(changedPath, value) {
    // Notify exact match and parent paths
    for (const [path, subs] of subscribers) {
      if (changedPath === path || changedPath.startsWith(path + '.') || path.startsWith(changedPath + '.')) {
        for (const cb of subs) {
          try {
            cb(value, changedPath);
          } catch (err) {
            console.error(`[EditorState] Subscriber error for "${path}":`, err);
          }
        }
      }
    }
    eventBus.emit(EDITOR_EVENTS.STATE_CHANGED, { path: changedPath, value });
  },

  getState() {
    return state;
  },

  // --- Sequence helpers ---

  getActiveSequence() {
    return state.sequences[state.activeSequenceId] || null;
  },

  getActiveSequenceId() {
    return state.activeSequenceId;
  },

  getSequence(id) {
    return state.sequences[id] || null;
  },

  getAllSequences() {
    return Object.values(state.sequences);
  },

  createSequence(settings = {}) {
    const id = `seq-${state.project.nextSequenceId++}`;
    const seq = createDefaultSequence(id, settings.name || `Sequence ${state.project.nextSequenceId - 1}`);
    if (settings.frameRate) seq.frameRate = settings.frameRate;
    if (settings.canvas) seq.canvas = { ...settings.canvas };
    if (settings.codec) seq.codec = settings.codec;
    if (settings.bitrate) seq.bitrate = settings.bitrate;
    state.sequences[id] = seq;
    eventBus.emit(EDITOR_EVENTS.SEQUENCE_CREATED, { id, sequence: seq });
    this.markDirty();
    return seq;
  },

  deleteSequence(id) {
    const seqIds = Object.keys(state.sequences);
    if (seqIds.length <= 1) return false;
    if (!state.sequences[id]) return false;

    const wasActive = state.activeSequenceId === id;
    delete state.sequences[id];

    eventBus.emit(EDITOR_EVENTS.SEQUENCE_DELETED, { id });
    this.markDirty();

    // If deleted the active sequence, switch to first remaining via TimelineEngine
    // (imported lazily to avoid circular dependency)
    if (wasActive) {
      const remaining = Object.keys(state.sequences);
      state.activeSequenceId = remaining[0];
      // Reset playback state for the new active sequence
      state.playback.playing = false;
      state.playback.currentFrame = 0;
      state.selection.clipIds = [];
      state.selection.trackId = null;
      eventBus.emit(EDITOR_EVENTS.PLAYBACK_STOP);
      eventBus.emit(EDITOR_EVENTS.SEQUENCE_ACTIVATED, { id: state.activeSequenceId });
      eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
    }
    return true;
  },

  setActiveSequenceId(id) {
    if (!state.sequences[id]) return false;
    if (state.activeSequenceId === id) return true;
    state.activeSequenceId = id;
    return true;
  },

  markDirty() {
    state.project.dirty = true;
  },

  markClean() {
    state.project.dirty = false;
  }
};

export default editorState;
