// Editor constants, enums, defaults, and limits

export const FRAME_RATES = {
  FPS_24: 24,
  FPS_25: 25,
  FPS_30: 30,
  FPS_48: 48,
  FPS_50: 50,
  FPS_60: 60
};

export const DEFAULT_FRAME_RATE = FRAME_RATES.FPS_30;

export const TRACK_TYPES = {
  VIDEO: 'video',
  AUDIO: 'audio',
  TITLE: 'title'
};

export const TOOL_TYPES = {
  SELECTION: 'selection',
  TRACK_SELECT: 'track-select',
  RIPPLE_EDIT: 'ripple-edit',
  ROLLING_EDIT: 'rolling-edit',
  RAZOR: 'razor',
  SLIP: 'slip',
  SLIDE: 'slide',
  PEN: 'pen',
  HAND: 'hand',
  ZOOM: 'zoom'
};

export const EDIT_MODES = {
  OVERWRITE: 'overwrite',
  INSERT: 'insert',
  REPLACE: 'replace'
};

export const SNAP_THRESHOLD_PX = 8;

export const ZOOM_LEVELS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5,
  1, 2, 5, 10, 20, 50, 100
];
export const DEFAULT_ZOOM_INDEX = 6; // 1 px/frame

export const TIMELINE_DEFAULTS = {
  TRACK_HEIGHT: 48,
  TRACK_HEADER_WIDTH: 180,
  RULER_HEIGHT: 32,
  MIN_CLIP_WIDTH_PX: 4,
  PLAYHEAD_WIDTH: 2
};

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4, 8];

export const SEQUENCE_CODECS = {
  H264: 'avc1.640028',
  VP9: 'vp09.00.10.08'
};

// Derive AVC codec string with appropriate level for the given resolution.
// Level 4.0 (0x28) handles up to 1920x1080, level 5.1 (0x33) handles up to 4096x2160.
export function getAvcCodecForResolution(width, height) {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  // Level 4.0: 8192 MBs (2048x1024 = ~1920x1080)
  // Level 4.2: 8704 MBs (~2048x1088)
  // Level 5.0: 22080 MBs (~3672x1536 = ~2560x1440+)
  // Level 5.1: 36864 MBs (~4096x2160)
  // Level 5.2: 36864 MBs (same MBs, higher bitrate)
  let level;
  if (macroblocks <= 8192) level = '28';       // 4.0
  else if (macroblocks <= 8704) level = '2a';  // 4.2
  else if (macroblocks <= 22080) level = '32'; // 5.0
  else level = '33';                           // 5.1
  return `avc1.6400${level}`;
}

export const DEFAULT_SEQUENCE_CODEC = SEQUENCE_CODECS.H264;
export const DEFAULT_SEQUENCE_BITRATE = '8M';

export const SEQUENCE_BITRATE_OPTIONS = ['5M', '8M', '15M', '25M', '50M'];

export const MEDIA_TYPES = {
  VIDEO: 'video',
  AUDIO: 'audio',
  IMAGE: 'image'
};

export const SUPPORTED_EXTENSIONS = {
  VIDEO: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'ogv', 'm4v'],
  AUDIO: ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'weba'],
  IMAGE: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
};

export const CANVAS_PRESETS = {
  '1920x1080': { width: 1920, height: 1080, label: '1080p (16:9)' },
  '3840x2160': { width: 3840, height: 2160, label: '4K (16:9)' },
  '1280x720': { width: 1280, height: 720, label: '720p (16:9)' },
  '1080x1920': { width: 1080, height: 1920, label: '1080p Vertical (9:16)' },
  '1080x1080': { width: 1080, height: 1080, label: 'Square (1:1)' }
};

export const DEFAULT_CANVAS = { width: 1920, height: 1080 };

export const EDITOR_EVENTS = {
  // State
  STATE_CHANGED: 'state:changed',
  // Timeline
  TIMELINE_UPDATED: 'timeline:updated',
  TRACK_ADDED: 'track:added',
  TRACK_REMOVED: 'track:removed',
  CLIP_ADDED: 'clip:added',
  CLIP_REMOVED: 'clip:removed',
  CLIP_MOVED: 'clip:moved',
  CLIP_TRIMMED: 'clip:trimmed',
  CLIP_SPLIT: 'clip:split',
  CLIP_SELECTED: 'clip:selected',
  CLIP_DESELECTED: 'clip:deselected',
  // Playback
  PLAYBACK_START: 'playback:start',
  PLAYBACK_STOP: 'playback:stop',
  PLAYBACK_FRAME: 'playback:frame',
  PLAYBACK_SEEK: 'playback:seek',
  // Media
  MEDIA_IMPORTED: 'media:imported',
  MEDIA_REMOVED: 'media:removed',
  MEDIA_THUMBNAILS_READY: 'media:thumbnails-ready',
  // UI
  TOOL_CHANGED: 'tool:changed',
  ZOOM_CHANGED: 'zoom:changed',
  SCROLL_CHANGED: 'scroll:changed',
  SELECTION_CHANGED: 'selection:changed',
  // Transitions
  TRANSITION_ADDED: 'transition:added',
  TRANSITION_REMOVED: 'transition:removed',
  // History
  HISTORY_PUSH: 'history:push',
  HISTORY_UNDO: 'history:undo',
  HISTORY_REDO: 'history:redo',
  // Layout
  LAYOUT_RESIZED: 'layout:resized',
  // Render-ahead
  RENDER_BUFFER_CHANGED: 'render:buffer:changed',
  // Conform (pre-encode)
  CONFORM_BUFFER_CHANGED: 'conform:buffer:changed',
  SEQUENCE_SETTINGS_CHANGED: 'sequence:settings:changed',
  // Sequences
  SEQUENCE_ACTIVATED: 'sequence:activated',
  SEQUENCE_CREATED: 'sequence:created',
  SEQUENCE_DELETED: 'sequence:deleted',
  // Timecode
  GOTO_TIMECODE: 'goto:timecode'
};

// Split-tree workspace presets for DockManager
let _pid = 1;
function _id() { return 'preset-' + (_pid++); }

export const WORKSPACE_PRESETS = {
  editing: {
    name: 'Editing',
    tree: () => {
      _pid = 1;
      return {
        id: _id(), type: 'split', direction: 'v', ratio: 0.6,
        children: [
          {
            id: _id(), type: 'split', direction: 'h', ratio: 0.33,
            children: [
              { id: _id(), type: 'group', tabs: ['source-monitor', 'effect-controls'], activeTab: 'source-monitor' },
              {
                id: _id(), type: 'split', direction: 'h', ratio: 0.65,
                children: [
                  { id: _id(), type: 'group', tabs: ['program-monitor'], activeTab: 'program-monitor' },
                  { id: _id(), type: 'group', tabs: ['properties', 'audio-meters', 'sequence-settings'], activeTab: 'properties' }
                ]
              }
            ]
          },
          {
            id: _id(), type: 'split', direction: 'h', ratio: 0.3,
            children: [
              { id: _id(), type: 'group', tabs: ['project', 'effects'], activeTab: 'project' },
              { id: _id(), type: 'group', tabs: ['timeline'], activeTab: 'timeline' }
            ]
          }
        ]
      };
    }
  },
  color: {
    name: 'Color',
    tree: () => {
      _pid = 1;
      return {
        id: _id(), type: 'split', direction: 'v', ratio: 0.5,
        children: [
          { id: _id(), type: 'group', tabs: ['program-monitor'], activeTab: 'program-monitor' },
          {
            id: _id(), type: 'split', direction: 'h', ratio: 0.3,
            children: [
              { id: _id(), type: 'group', tabs: ['effect-controls', 'properties'], activeTab: 'effect-controls' },
              { id: _id(), type: 'group', tabs: ['timeline'], activeTab: 'timeline' }
            ]
          }
        ]
      };
    }
  },
  audio: {
    name: 'Audio',
    tree: () => {
      _pid = 1;
      return {
        id: _id(), type: 'split', direction: 'v', ratio: 0.35,
        children: [
          {
            id: _id(), type: 'split', direction: 'h', ratio: 0.5,
            children: [
              { id: _id(), type: 'group', tabs: ['source-monitor', 'effect-controls'], activeTab: 'source-monitor' },
              { id: _id(), type: 'group', tabs: ['program-monitor', 'audio-meters'], activeTab: 'program-monitor' }
            ]
          },
          {
            id: _id(), type: 'split', direction: 'h', ratio: 0.25,
            children: [
              { id: _id(), type: 'group', tabs: ['project', 'effects'], activeTab: 'project' },
              { id: _id(), type: 'group', tabs: ['timeline'], activeTab: 'timeline' }
            ]
          }
        ]
      };
    }
  }
};
