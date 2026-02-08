// Marker and in/out point management
import { editorState } from '../core/EditorState.js';
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS } from '../core/Constants.js';

let markerIdCounter = 0;
const markers = [];

export const MARKER_COLORS = {
  GREEN: '#30d158',
  RED: '#ff3b30',
  BLUE: '#007aff',
  YELLOW: '#ffcc00',
  PURPLE: '#af52de',
  ORANGE: '#ff9500',
  CYAN: '#5ac8fa'
};

export function createMarker(options = {}) {
  return {
    id: options.id || `marker-${++markerIdCounter}`,
    frame: options.frame ?? 0,
    name: options.name || '',
    color: options.color || MARKER_COLORS.GREEN,
    duration: options.duration || 0 // 0 = point marker, >0 = range marker
  };
}

export const markerManager = {
  addMarker(frame, name = '', color = MARKER_COLORS.GREEN) {
    const marker = createMarker({ frame, name, color });
    markers.push(marker);
    markers.sort((a, b) => a.frame - b.frame);
    eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
    return marker;
  },

  addMarkerAtPlayhead(name = '', color = MARKER_COLORS.GREEN) {
    const frame = editorState.get('playback.currentFrame');
    return this.addMarker(frame, name, color);
  },

  removeMarker(markerId) {
    const idx = markers.findIndex(m => m.id === markerId);
    if (idx >= 0) {
      markers.splice(idx, 1);
      eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
      return true;
    }
    return false;
  },

  getMarker(markerId) {
    return markers.find(m => m.id === markerId);
  },

  getAllMarkers() {
    return [...markers];
  },

  getMarkersInRange(startFrame, endFrame) {
    return markers.filter(m => m.frame >= startFrame && m.frame <= endFrame);
  },

  // Navigate to next/previous marker
  getNextMarker(currentFrame) {
    return markers.find(m => m.frame > currentFrame) || null;
  },

  getPreviousMarker(currentFrame) {
    for (let i = markers.length - 1; i >= 0; i--) {
      if (markers[i].frame < currentFrame) return markers[i];
    }
    return null;
  },

  updateMarker(markerId, updates) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker) return false;
    if (updates.name !== undefined) marker.name = updates.name;
    if (updates.color !== undefined) marker.color = updates.color;
    if (updates.frame !== undefined) {
      marker.frame = updates.frame;
      markers.sort((a, b) => a.frame - b.frame);
    }
    if (updates.duration !== undefined) marker.duration = updates.duration;
    eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
    return true;
  },

  clearAllMarkers() {
    markers.length = 0;
    eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
  },

  // In/Out points (shortcut interface)
  setInPoint(frame) {
    editorState.set('playback.inPoint', frame ?? editorState.get('playback.currentFrame'));
  },

  setOutPoint(frame) {
    editorState.set('playback.outPoint', frame ?? editorState.get('playback.currentFrame'));
  },

  clearInOutPoints() {
    editorState.set('playback.inPoint', null);
    editorState.set('playback.outPoint', null);
  },

  getInOutRange() {
    return {
      inPoint: editorState.get('playback.inPoint'),
      outPoint: editorState.get('playback.outPoint')
    };
  }
};

export default markerManager;
