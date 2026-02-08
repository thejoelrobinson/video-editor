// Premiere-style keyboard shortcut map
import { editorState } from '../core/EditorState.js';
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS, TOOL_TYPES } from '../core/Constants.js';
import { playbackEngine } from '../playback/PlaybackEngine.js';
import { clipOperations } from '../timeline/ClipOperations.js';
import { timelineEngine } from '../timeline/TimelineEngine.js';
import { history } from '../core/History.js';
import { toolbar } from './Toolbar.js';
import { projectManager } from '../project/ProjectManager.js';
import { exportDialog } from './ExportDialog.js';
import { menuBar } from './MenuBar.js';
import { markerManager } from '../timeline/Markers.js';

export const keyboardShortcuts = {
  _active: false,
  _handler: null,

  init() {
    this._handler = (e) => this._handleKeydown(e);
    this._active = true;
    document.addEventListener('keydown', this._handler);
  },

  _handleKeydown(e) {
    if (!this._active) return;

    // Don't intercept when typing in input fields
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Don't intercept when not on the editor screen
    const editorScreen = document.getElementById('video-editor');
    if (!editorScreen || editorScreen.classList.contains('hidden')) return;

    const key = e.key;
    const ctrl = e.ctrlKey || e.metaKey;

    // Playback
    if (key === ' ') {
      e.preventDefault();
      playbackEngine.togglePlay();
      return;
    }

    // Loop toggle (Shift+L — must be before JKL shuttle)
    if (key === 'L' && e.shiftKey && !ctrl) {
      e.preventDefault();
      editorState.set('playback.loop', !editorState.get('playback.loop'));
      return;
    }

    // JKL shuttle
    if (key === 'j' || key === 'J') {
      e.preventDefault();
      const speed = editorState.get('playback.speed');
      playbackEngine.setSpeed(Math.max(-8, speed - 1));
      if (!editorState.get('playback.playing')) playbackEngine.play();
      return;
    }
    if (key === 'k' || key === 'K') {
      e.preventDefault();
      playbackEngine.pause();
      return;
    }
    if (key === 'l' || key === 'L') {
      e.preventDefault();
      const speed = editorState.get('playback.speed');
      playbackEngine.setSpeed(Math.min(8, speed + 1));
      if (!editorState.get('playback.playing')) playbackEngine.play();
      return;
    }

    // Arrow keys
    if (key === 'ArrowLeft') {
      e.preventDefault();
      playbackEngine.seekRelative(e.shiftKey ? -10 : -1);
      return;
    }
    if (key === 'ArrowRight') {
      e.preventDefault();
      playbackEngine.seekRelative(e.shiftKey ? 10 : 1);
      return;
    }
    if (key === 'ArrowUp') {
      e.preventDefault();
      playbackEngine.seekToPreviousEditPoint();
      return;
    }
    if (key === 'ArrowDown') {
      e.preventDefault();
      playbackEngine.seekToNextEditPoint();
      return;
    }

    // Home/End
    if (key === 'Home') {
      e.preventDefault();
      playbackEngine.seek(0);
      return;
    }
    if (key === 'End') {
      e.preventDefault();
      playbackEngine.seek(timelineEngine.getDuration());
      return;
    }

    // Undo/Redo
    if (ctrl && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        history.redo();
      } else {
        history.undo();
      }
      return;
    }
    if (ctrl && key === 'y') {
      e.preventDefault();
      history.redo();
      return;
    }

    // Save
    if (ctrl && key === 's') {
      e.preventDefault();
      projectManager.save().catch(() => {});
      return;
    }

    // Export
    if (ctrl && key === 'e') {
      e.preventDefault();
      exportDialog.show();
      return;
    }

    // Default transition at playhead (Ctrl+D, like Premiere Pro)
    if (ctrl && key === 'd') {
      e.preventDefault();
      timelineEngine.addDefaultTransitionAtPlayhead();
      return;
    }

    // Split at playhead (Ctrl+B, like Premiere Pro)
    if (ctrl && key === 'b') {
      e.preventDefault();
      menuBar._executeAction('clip:split');
      return;
    }

    // Link/Unlink (Ctrl+L, like Premiere Pro)
    if (ctrl && key === 'l') {
      e.preventDefault();
      const selected = editorState.get('selection.clipIds');
      if (selected.length === 1) {
        const clip = timelineEngine.getClip(selected[0]);
        if (clip && clip.linkedClipId) timelineEngine.unlinkClip(clip.id);
      } else if (selected.length === 2) {
        const clipA = timelineEngine.getClip(selected[0]);
        const clipB = timelineEngine.getClip(selected[1]);
        if (clipA && clipB) {
          if (clipA.linkedClipId) {
            timelineEngine.unlinkClip(clipA.id);
          } else {
            timelineEngine.linkClips(selected[0], selected[1]);
          }
        }
      }
      return;
    }

    // Delete
    if (key === 'Delete' || key === 'Backspace') {
      // Check for selected gap first (ripple delete gap)
      const selectedGap = editorState.get('selection.gap');
      if (selectedGap) {
        e.preventDefault();
        clipOperations.closeGap(selectedGap.trackId, selectedGap.startFrame, selectedGap.endFrame);
        editorState.set('selection.gap', null);
        return;
      }

      // Check for selected transition
      const selectedTransId = editorState.get('selection.transitionId');
      if (selectedTransId) {
        e.preventDefault();
        const track = timelineEngine.getTransitionTrack(selectedTransId);
        if (track) {
          timelineEngine.removeTransition(track.id, selectedTransId);
        }
        editorState.set('selection.transitionId', null);
        return;
      }

      const selectedIds = editorState.get('selection.clipIds');
      if (selectedIds.length > 0) {
        e.preventDefault();
        clipOperations.deleteClips(selectedIds);
        editorState.set('selection.clipIds', []);
        return;
      }
    }

    // Tool shortcuts (Premiere: V A B N C Y U P H Z)
    if (!ctrl && !e.altKey && !e.shiftKey) {
      const toolKeys = ['v', 'a', 'b', 'n', 'c', 'y', 'u', 'p', 'h', 'z'];
      if (toolKeys.includes(key.toLowerCase())) {
        e.preventDefault();
        toolbar.selectToolByKey(key);
        return;
      }
    }

    // In/Out points (I = set in, O = set out, Alt+X = clear both)
    if (key === 'i' || key === 'I') {
      e.preventDefault();
      editorState.set('playback.inPoint', editorState.get('playback.currentFrame'));
      return;
    }
    if (key === 'o' || key === 'O') {
      e.preventDefault();
      editorState.set('playback.outPoint', editorState.get('playback.currentFrame'));
      return;
    }
    if ((key === 'x' || key === 'X') && e.altKey) {
      e.preventDefault();
      editorState.set('playback.inPoint', null);
      editorState.set('playback.outPoint', null);
      return;
    }

    // Snap toggle
    if (key === 's' || key === 'S') {
      if (!ctrl) {
        e.preventDefault();
        const snap = !editorState.get('ui.snapEnabled');
        editorState.set('ui.snapEnabled', snap);
        return;
      }
    }

    // Play In-to-Out (/ key — seek to in point, play to out point)
    if (key === '/') {
      e.preventDefault();
      const inPt = editorState.get('playback.inPoint');
      if (inPt !== null) playbackEngine.seek(inPt);
      playbackEngine.play();
      return;
    }

    // Copy (Ctrl+C)
    if (ctrl && key === 'c') {
      const selectedIds = editorState.get('selection.clipIds');
      if (selectedIds.length > 0) {
        e.preventDefault();
        clipOperations.copyClips(selectedIds);
        return;
      }
    }

    // Cut (Ctrl+X)
    if (ctrl && key === 'x') {
      const selectedIds = editorState.get('selection.clipIds');
      if (selectedIds.length > 0) {
        e.preventDefault();
        clipOperations.cutClips(selectedIds);
        editorState.set('selection.clipIds', []);
        return;
      }
    }

    // Paste (Ctrl+V)
    if (ctrl && key === 'v') {
      e.preventDefault();
      clipOperations.pasteClips();
      return;
    }

    // Duplicate (Ctrl+Shift+D)
    if (ctrl && e.shiftKey && (key === 'd' || key === 'D')) {
      e.preventDefault();
      const selectedIds = editorState.get('selection.clipIds');
      if (selectedIds.length > 0) {
        clipOperations.duplicateClips(selectedIds);
      }
      return;
    }

    // Go to timecode (Ctrl+G)
    if (ctrl && key === 'g') {
      e.preventDefault();
      eventBus.emit(EDITOR_EVENTS.GOTO_TIMECODE);
      return;
    }

    // Add marker at playhead
    if ((key === 'm' || key === 'M') && !ctrl) {
      e.preventDefault();
      markerManager.addMarkerAtPlayhead();
      return;
    }
  },

  setActive(active) {
    this._active = active;
  },

  cleanup() {
    if (this._handler) {
      document.removeEventListener('keydown', this._handler);
    }
  }
};

export default keyboardShortcuts;
