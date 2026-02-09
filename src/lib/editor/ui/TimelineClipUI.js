// Clip rendering on timeline (thumbnail filmstrip, label, trim handles)
// Phase C: Event delegation — listeners on track lane, not individual clips
import { editorState } from '../core/EditorState.js';
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS, TOOL_TYPES, MEDIA_TYPES, EDIT_MODES } from '../core/Constants.js';
import { frameToPixel, pixelToFrame, getSnapPoints, snapFrame } from '../timeline/TimelineMath.js';
import { getClipDuration, getClipEndFrame } from '../timeline/Clip.js';
import { clipOperations } from '../timeline/ClipOperations.js';
import { timelineEngine } from '../timeline/TimelineEngine.js';
import { mediaManager } from '../media/MediaManager.js';
import { playbackEngine } from '../playback/PlaybackEngine.js';
import { history } from '../core/History.js';
import { contextMenu } from './ContextMenu.js';
import { waveformGenerator } from '../media/WaveformGenerator.js';
import { frameToSeconds } from '../timeline/TimelineMath.js';
import { TRANSITION_TYPES } from '../effects/Transitions.js';
import { effectRegistry } from '../effects/EffectRegistry.js';
import { keyframeEngine } from '../effects/KeyframeEngine.js';
import { getIntrinsicEffect } from '../timeline/Clip.js';
import { waveformCanvasPool } from './CanvasPool.js';

export const timelineClipUI = {
  _container: null,
  _timelineUI: null,  // Reference to timelineUI for setDragging

  init(container, timelineUI) {
    this._container = container;
    this._timelineUI = timelineUI || null;
  },

  // Phase C: Set up delegated event listeners on a track lane
  setupLaneDelegation(lane, track) {
    // Delegated mousedown — handles clip selection, drag, razor, and trim handles
    lane.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;

      const clipEl = e.target.closest('.nle-clip');
      if (!clipEl) return;

      const clipId = clipEl.dataset.clipId;
      const clip = this._findClip(clipId);
      if (!clip) return;

      // Check for trim handles
      const leftHandle = e.target.closest('.nle-clip-handle-left');
      const rightHandle = e.target.closest('.nle-clip-handle-right');

      if (leftHandle) {
        e.stopPropagation();
        this._startTrimLeft(e, clip);
        return;
      }

      if (rightHandle) {
        e.stopPropagation();
        this._startTrimRight(e, clip);
        return;
      }

      const tool = editorState.get('ui.activeTool');

      if (tool === TOOL_TYPES.RAZOR) {
        e.stopPropagation();
        const rect = clipEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const scrollX = editorState.get('timeline.scrollX');
        // Get the clip's pixel offset from its transform
        const clipX = this._getClipPixelX(clipEl);
        const frame = pixelToFrame(x + clipX + scrollX);
        clipOperations.split(clip.id, frame);
        return;
      }

      if (tool === TOOL_TYPES.PEN) {
        e.stopPropagation();
        this._handlePenTool(e, clip, clipEl);
        return;
      }

      e.stopPropagation();

      // Build selection including linked clips
      let current = editorState.get('selection.clipIds') || [];
      if (e.shiftKey) {
        if (!current.includes(clip.id)) {
          current = [...current, clip.id];
        }
      } else if (e.ctrlKey || e.metaKey) {
        if (current.includes(clip.id)) {
          current = current.filter(id => id !== clip.id);
        } else {
          current = [...current, clip.id];
        }
      } else {
        current = [clip.id];
      }

      // Also select linked clip (Premiere linked selection)
      if (clip.linkedClipId && !e.altKey && editorState.get('ui.linkedSelection')) {
        if (!current.includes(clip.linkedClipId)) {
          current.push(clip.linkedClipId);
        }
      }

      editorState.set('selection.clipIds', current);
      editorState.set('selection.gap', null);
      eventBus.emit(EDITOR_EVENTS.CLIP_SELECTED, { clipId: clip.id });

      if (tool === TOOL_TYPES.SELECTION) {
        this._startDrag(e, clipEl, clip);
      }
    });

    // Delegated context menu
    lane.addEventListener('contextmenu', (e) => {
      const clipEl = e.target.closest('.nle-clip');
      if (!clipEl) return;

      e.preventDefault();
      e.stopPropagation();

      const clipId = clipEl.dataset.clipId;
      const clip = this._findClip(clipId);
      if (!clip) return;

      const selected = editorState.get('selection.clipIds') || [];
      if (!selected.includes(clip.id)) {
        const sel = [clip.id];
        if (clip.linkedClipId) sel.push(clip.linkedClipId);
        editorState.set('selection.clipIds', sel);
        eventBus.emit(EDITOR_EVENTS.CLIP_SELECTED, { clipId: clip.id });
      }

      const clipTrack = timelineEngine.getTrack(clip.trackId);
      const { prev, next } = this._getAdjacentClips(clip, clipTrack);

      // Check adjacency for transition items
      const prevAdjacent = prev && getClipEndFrame(prev) === clip.startFrame;
      const nextAdjacent = next && getClipEndFrame(clip) === next.startFrame;
      const hasHeadTrans = prevAdjacent && clipTrack.transitions.find(
        t => t.clipAId === prev.id && t.clipBId === clip.id
      );
      const hasTailTrans = nextAdjacent && clipTrack.transitions.find(
        t => t.clipAId === clip.id && t.clipBId === next.id
      );

      const menuItems = [
        { label: 'Cut', action: () => {
          clipOperations.cutClips(selected);
          editorState.set('selection.clipIds', []);
        }},
        { label: 'Copy', action: () => clipOperations.copyClips(selected) },
        { label: 'Paste', action: () => clipOperations.pasteClips() },
        { label: 'Duplicate', action: () => clipOperations.duplicateClips(selected) },
        { separator: true },
        { label: 'Rename...', action: () => this._renameClip(clip, clipEl) },
        { label: 'Speed/Duration...', action: () => this._showSpeedDialog(clip) },
        { separator: true },
        clip.linkedClipId
          ? { label: 'Unlink', action: () => timelineEngine.unlinkClip(clip.id) }
          : { label: 'Link', action: () => this._linkSelected(clip) },
        { separator: true },
        { label: 'Split at Playhead', action: () => {
          const frame = editorState.get('playback.currentFrame');
          clipOperations.split(clip.id, frame);
        }},
        ...(prevAdjacent && !hasHeadTrans ? [
          { label: 'Add Cross Dissolve to Head', action: () => {
            timelineEngine.addTransition(
              clipTrack.id, prev.id, clip.id,
              TRANSITION_TYPES.CROSS_DISSOLVE, 30
            );
          }}
        ] : []),
        ...(nextAdjacent && !hasTailTrans ? [
          { label: 'Add Cross Dissolve to Tail', action: () => {
            timelineEngine.addTransition(
              clipTrack.id, clip.id, next.id,
              TRANSITION_TYPES.CROSS_DISSOLVE, 30
            );
          }}
        ] : []),
        { label: 'Ripple Delete', action: () => clipOperations.rippleDelete([clip.id]) },
        { separator: true },
        { label: 'Add Fade In', action: () => this._addFade(clip, clipTrack, 'in') },
        { label: 'Add Fade Out', action: () => this._addFade(clip, clipTrack, 'out') },
        { separator: true },
        { label: clip.disabled ? 'Enable' : 'Disable', action: () => {
          clip.disabled = !clip.disabled;
          const linked = this._getLinkedClip(clip);
          if (linked) linked.disabled = clip.disabled;
          eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
        }},
        { label: 'Delete', action: () => timelineEngine.removeClip(clip.id) }
      ];

      contextMenu.show(e.clientX, e.clientY, menuItems);
    });

    // Delegated dragover/dragleave/drop for effect drops on clips
    lane.addEventListener('dragover', (e) => {
      // Check if over a clip element for effect drops
      const clipEl = e.target.closest('.nle-clip');
      if (clipEl && e.dataTransfer.types.includes('application/x-nle-effect')) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        clipEl.classList.add('nle-clip-drop-target');
      }
    });

    lane.addEventListener('dragleave', (e) => {
      const clipEl = e.target.closest('.nle-clip');
      if (clipEl && !clipEl.contains(e.relatedTarget)) {
        clipEl.classList.remove('nle-clip-drop-target');
      }
    });

    // We need to handle effect drops on clips via delegation
    // The lane already has a drop handler in timelineTrackUI for media/effect drops on the lane itself.
    // We add a capture-phase listener to intercept effect drops on clips before the lane handler.
    lane.addEventListener('drop', (e) => {
      const clipEl = e.target.closest('.nle-clip');
      if (!clipEl) return; // Let lane-level drop handler handle it

      clipEl.classList.remove('nle-clip-drop-target');
      const effectId = e.dataTransfer.getData('application/x-nle-effect');
      if (!effectId) return;

      e.preventDefault();
      e.stopPropagation();

      const clipId = clipEl.dataset.clipId;
      const clip = this._findClip(clipId);
      if (!clip) return;

      const def = effectRegistry.get(effectId);
      if (!def) return;

      if (def.type === 'transition') {
        this._dropTransition(e, clipEl, clip, effectId);
      } else {
        const instance = effectRegistry.createInstance(effectId);
        if (instance) {
          clip.effects.push(instance);
          eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
        }
      }
    }, true); // capture phase to intercept before lane-level drop
  },

  // Create clip element — DOM only, no event listeners (delegation handles them)
  createClipElement(clip) {
    const el = document.createElement('div');
    el.className = 'nle-clip';
    el.dataset.clipId = clip.id;

    const mediaItem = mediaManager.getItem(clip.mediaId);
    const track = timelineEngine.getTrack(clip.trackId);
    const isAudio = track && track.type === 'audio';
    if (clip.color) el.style.backgroundColor = clip.color;

    if (isAudio) el.classList.add('audio');
    else el.classList.add('video');

    // Clip label — underline if linked (Premiere convention)
    const label = document.createElement('div');
    label.className = 'nle-clip-label';
    if (clip.linkedClipId) label.classList.add('nle-linked');
    label.textContent = clip.name;
    el.appendChild(label);

    // Thumbnail strip (video clips)
    if (mediaItem && mediaItem.thumbnails.length > 0 && !isAudio) {
      const strip = document.createElement('div');
      strip.className = 'nle-clip-thumbstrip';
      for (const thumb of mediaItem.thumbnails) {
        const img = document.createElement('img');
        img.src = thumb.url;
        img.className = 'nle-clip-thumb';
        img.draggable = false;
        strip.appendChild(img);
      }
      el.appendChild(strip);
    }

    // Waveform canvas for audio clips (pooled)
    if (isAudio && mediaItem) {
      const waveCanvas = waveformCanvasPool.acquire(1, 40);
      waveCanvas.className = 'nle-clip-waveform-canvas';
      el.appendChild(waveCanvas);

      if (mediaItem.waveform) {
        this._drawWaveform(waveCanvas, mediaItem, clip);
      } else {
        waveformGenerator.generateWaveform(mediaItem).then(peaks => {
          if (peaks) this._drawWaveform(waveCanvas, mediaItem, clip);
        });
      }
    }

    // FX badge for applied (non-intrinsic) effects
    const appliedEffects = (clip.effects || []).filter(fx => !fx.intrinsic);
    if (appliedEffects.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'nle-clip-fx-badge';
      badge.textContent = 'fx';
      el.appendChild(badge);
    }

    // Rubber band canvas (opacity/volume overlay for pen tool)
    const rbCanvas = document.createElement('canvas');
    rbCanvas.className = 'nle-clip-rubberband';
    el.appendChild(rbCanvas);

    // Trim handles
    const leftHandle = document.createElement('div');
    leftHandle.className = 'nle-clip-handle nle-clip-handle-left';
    el.appendChild(leftHandle);

    const rightHandle = document.createElement('div');
    rightHandle.className = 'nle-clip-handle nle-clip-handle-right';
    el.appendChild(rightHandle);

    return el;
  },

  updateClipPosition(el, clip) {
    const scrollX = editorState.get('timeline.scrollX');
    const x = frameToPixel(clip.startFrame) - scrollX;
    const width = frameToPixel(getClipDuration(clip));
    el.style.transform = `translateX(${x}px)`;
    el.style.width = `${Math.max(4, width)}px`;

    // Redraw rubber band overlay
    const rbCanvas = el.querySelector('.nle-clip-rubberband');
    if (rbCanvas) {
      this._drawRubberBand(rbCanvas, clip, null, width);
    }
  },

  // Helper to extract pixel X from transform for razor tool
  _getClipPixelX(el) {
    const transform = el.style.transform;
    const match = transform && transform.match(/translateX\(([^)]+)px\)/);
    return match ? parseFloat(match[1]) : 0;
  },

  // Find a clip by ID across all tracks
  _findClip(clipId) {
    return timelineEngine.getClip(clipId);
  },

  // Get the linked clip if linked selection is active
  _getLinkedClip(clip) {
    if (!clip.linkedClipId) return null;
    return timelineEngine.getClip(clip.linkedClipId);
  },

  _drawWaveform(canvas, mediaItem, clip) {
    if (!mediaItem.waveform) return;
    const clipWidth = frameToPixel(getClipDuration(clip));
    canvas.width = Math.max(1, Math.round(clipWidth));
    const totalDuration = mediaItem.duration || 1;
    const startRatio = frameToSeconds(clip.sourceInFrame) / totalDuration;
    const endRatio = frameToSeconds(clip.sourceOutFrame) / totalDuration;
    waveformGenerator.renderWaveform(canvas, mediaItem.waveform, startRatio, endRatio, '#a0d8e8');
  },

  _linkSelected(clip) {
    const selected = editorState.get('selection.clipIds') || [];
    if (selected.length !== 2) {
      alert('Select exactly 2 clips (one video, one audio) to link.');
      return;
    }
    const other = selected.find(id => id !== clip.id);
    if (other) {
      timelineEngine.linkClips(clip.id, other);
    }
  },

  _renameClip(clip, el) {
    const name = prompt('Clip name:', clip.name);
    if (name !== null && name.trim()) {
      clip.name = name.trim();
      const label = el.querySelector('.nle-clip-label');
      if (label) label.textContent = clip.name;
    }
  },

  _showSpeedDialog(clip) {
    const input = prompt('Speed (e.g. 1 = normal, 2 = 2x, 0.5 = half):', String(clip.speed));
    if (input !== null) {
      const speed = parseFloat(input);
      if (isFinite(speed) && speed > 0) {
        clip.speed = speed;
        const linked = this._getLinkedClip(clip);
        if (linked) linked.speed = speed;
        eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
      }
    }
  },

  _startDrag(e, el, clip) {
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startFrame = clip.startFrame;
    const startTrackId = clip.trackId;
    const tracks = timelineEngine.getTracks();
    const snapPoints = getSnapPoints(tracks, clip.id);
    const linked = editorState.get('ui.linkedSelection') ? this._getLinkedClip(clip) : null;
    const linkedStartFrame = linked ? linked.startFrame : 0;
    const linkedStartTrackId = linked ? linked.trackId : null;

    // Snapshot all tracks before drag for undo
    const allTrackIds = tracks.map(t => t.id);
    const beforeSnapshot = clipOperations.snapshotTracks(allTrackIds);

    // Phase B: Signal drag start
    if (this._timelineUI) this._timelineUI.setDragging(true);

    const onMove = (e2) => {
      const dx = e2.clientX - startMouseX;
      const deltaFrames = pixelToFrame(dx);
      let newFrame = startFrame + deltaFrames;
      newFrame = Math.max(0, newFrame);
      newFrame = snapFrame(newFrame, snapPoints);
      clip.startFrame = newFrame;

      // Move linked clip in sync
      if (linked) {
        linked.startFrame = linkedStartFrame + (newFrame - startFrame);
      }

      // Vertical: detect track change
      const laneUnder = document.elementFromPoint(e2.clientX, e2.clientY);
      const trackLane = laneUnder?.closest?.('.nle-track-lane');
      if (trackLane) {
        const targetTrackId = trackLane.dataset.trackId;
        if (targetTrackId && targetTrackId !== clip.trackId) {
          const targetTrack = timelineEngine.getTrack(targetTrackId);
          const sourceTrack = timelineEngine.getTrack(clip.trackId);
          if (targetTrack && sourceTrack && targetTrack.type === sourceTrack.type) {
            sourceTrack.clips = sourceTrack.clips.filter(c => c.id !== clip.id);
            clip.trackId = targetTrackId;
            targetTrack.clips.push(clip);
            targetTrack.clips.sort((a, b) => a.startFrame - b.startFrame);
          }
        }
      }

      // Visual feedback: edit mode indicator on clip
      el.dataset.editMode = (e2.ctrlKey || e2.metaKey) ? 'insert' : e2.altKey ? 'replace' : 'overwrite';

      this.updateClipPosition(el, clip);
      eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
    };

    const onUp = (e2) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      // Phase B: Signal drag end
      if (this._timelineUI) this._timelineUI.setDragging(false);

      // Clean up visual feedback
      delete el.dataset.editMode;

      // Auto-create new track if dropped beyond existing tracks
      const sourceTrack = timelineEngine.getTrack(clip.trackId);
      if (sourceTrack) {
        const laneUnder = document.elementFromPoint(e2.clientX, e2.clientY);
        const trackLane = laneUnder?.closest?.('.nle-track-lane');
        const trackRow = laneUnder?.closest?.('.nle-track-row');

        if (!trackLane && !trackRow) {
          const tracksContainer = this._container?.querySelector('.nle-timeline-tracks');
          if (tracksContainer) {
            const containerRect = tracksContainer.getBoundingClientRect();
            const isAbove = e2.clientY < containerRect.top;
            const isBelow = e2.clientY > containerRect.bottom;

            if (isAbove && sourceTrack.type === 'video') {
              const newTrack = timelineEngine.addTrack('video');
              sourceTrack.clips = sourceTrack.clips.filter(c => c.id !== clip.id);
              clip.trackId = newTrack.id;
              newTrack.clips.push(clip);
              newTrack.clips.sort((a, b) => a.startFrame - b.startFrame);
            } else if (isBelow && sourceTrack.type === 'audio') {
              const newTrack = timelineEngine.addTrack('audio');
              sourceTrack.clips = sourceTrack.clips.filter(c => c.id !== clip.id);
              clip.trackId = newTrack.id;
              newTrack.clips.push(clip);
              newTrack.clips.sort((a, b) => a.startFrame - b.startFrame);
            } else if (isAbove && sourceTrack.type === 'audio') {
              const newTrack = timelineEngine.addTrack('audio');
              sourceTrack.clips = sourceTrack.clips.filter(c => c.id !== clip.id);
              clip.trackId = newTrack.id;
              newTrack.clips.push(clip);
              newTrack.clips.sort((a, b) => a.startFrame - b.startFrame);
            } else if (isBelow && sourceTrack.type === 'video') {
              const newTrack = timelineEngine.addTrack('video');
              sourceTrack.clips = sourceTrack.clips.filter(c => c.id !== clip.id);
              clip.trackId = newTrack.id;
              newTrack.clips.push(clip);
              newTrack.clips.sort((a, b) => a.startFrame - b.startFrame);
            }
          }
        }
      }

      // Check if target track is locked — revert if so
      const targetTrack = timelineEngine.getTrack(clip.trackId);
      if (targetTrack && targetTrack.locked) {
        clipOperations.restoreTracksFromSnapshot(beforeSnapshot);
        timelineEngine._recalcDuration();
        eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
        return;
      }

      // Determine edit mode from modifier keys at drop time
      let editMode = EDIT_MODES.OVERWRITE;
      if (e2.ctrlKey || e2.metaKey) editMode = EDIT_MODES.INSERT;
      else if (e2.altKey) editMode = EDIT_MODES.REPLACE;

      // Build exclude list (the clip being dragged + its linked partner)
      const excludeIds = [clip.id];
      if (linked) excludeIds.push(linked.id);

      // Apply edit mode to the clip's track
      clipOperations.applyEditMode(editMode, clip.trackId, clip, excludeIds);

      // Apply edit mode to linked clip's track if different
      if (linked && linked.trackId !== clip.trackId) {
        clipOperations.applyEditMode(editMode, linked.trackId, linked, excludeIds);
      }

      // Snapshot after mutations for redo
      const currentTrackIds = timelineEngine.getTracks().map(t => t.id);
      const afterSnapshot = clipOperations.snapshotTracks(currentTrackIds);

      // Push snapshot-based undo (mutations already applied, skip execute)
      const modeLabel = editMode.charAt(0).toUpperCase() + editMode.slice(1);
      history.pushWithoutExecute({
        description: `${modeLabel}: ${clip.name}`,
        execute() {
          clipOperations.restoreTracksFromSnapshot(afterSnapshot);
          timelineEngine._recalcDuration();
          eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
        },
        undo() {
          clipOperations.restoreTracksFromSnapshot(beforeSnapshot);
          timelineEngine._recalcDuration();
          eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
        }
      });

      timelineEngine._recalcDuration();
      if (clip.trackId !== startTrackId) {
        eventBus.emit(EDITOR_EVENTS.CLIP_MOVED, {
          clip, oldTrackId: startTrackId, newTrackId: clip.trackId
        });
      }
      eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  },

  _startTrimLeft(e, clip) {
    const startMouseX = e.clientX;
    const origStartFrame = clip.startFrame;
    const origSourceIn = clip.sourceInFrame;
    const endFrame = getClipEndFrame(clip);
    const tracks = timelineEngine.getTracks();
    const snapPoints = getSnapPoints(tracks, clip.id);
    const linked = editorState.get('ui.linkedSelection') ? this._getLinkedClip(clip) : null;
    const linkedOrigStart = linked ? linked.startFrame : 0;
    const linkedOrigSourceIn = linked ? linked.sourceInFrame : 0;

    if (this._timelineUI) this._timelineUI.setDragging(true);

    const onMove = (e2) => {
      const dx = e2.clientX - startMouseX;
      const deltaFrames = pixelToFrame(dx);
      let newStart = origStartFrame + deltaFrames;
      newStart = Math.max(0, newStart);
      newStart = snapFrame(newStart, snapPoints);
      if (newStart >= endFrame - 1) return;

      const delta = newStart - origStartFrame;
      clip.startFrame = newStart;
      clip.sourceInFrame = origSourceIn + Math.round(delta * clip.speed);

      // Trim linked clip in sync
      if (linked) {
        linked.startFrame = linkedOrigStart + delta;
        linked.sourceInFrame = linkedOrigSourceIn + Math.round(delta * linked.speed);
      }

      eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (this._timelineUI) this._timelineUI.setDragging(false);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  },

  _startTrimRight(e, clip) {
    const startMouseX = e.clientX;
    const origSourceOut = clip.sourceOutFrame;
    const tracks = timelineEngine.getTracks();
    const snapPoints = getSnapPoints(tracks, clip.id);
    const linked = editorState.get('ui.linkedSelection') ? this._getLinkedClip(clip) : null;
    const linkedOrigSourceOut = linked ? linked.sourceOutFrame : 0;

    if (this._timelineUI) this._timelineUI.setDragging(true);

    const onMove = (e2) => {
      const dx = e2.clientX - startMouseX;
      const deltaFrames = pixelToFrame(dx);
      let newSourceOut = origSourceOut + Math.round(deltaFrames * clip.speed);
      if (newSourceOut <= clip.sourceInFrame + 1) return;

      const newDuration = Math.round((newSourceOut - clip.sourceInFrame) / clip.speed);
      let newEnd = clip.startFrame + newDuration;
      newEnd = snapFrame(newEnd, snapPoints);
      const snappedDuration = newEnd - clip.startFrame;
      clip.sourceOutFrame = clip.sourceInFrame + Math.round(snappedDuration * clip.speed);

      // Trim linked clip in sync
      if (linked) {
        linked.sourceOutFrame = linked.sourceInFrame + Math.round(snappedDuration * linked.speed);
      }

      eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (this._timelineUI) this._timelineUI.setDragging(false);
      timelineEngine._recalcDuration();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  },

  // --- Transition rendering ---

  renderTransitions(track, laneEl) {
    // Remove old transition indicators
    laneEl.querySelectorAll('.nle-transition').forEach(el => el.remove());

    if (!track.transitions || track.transitions.length === 0) return;

    const scrollX = editorState.get('timeline.scrollX');
    const selectedTransId = editorState.get('selection.transitionId');

    for (const trans of track.transitions) {
      const clipB = track.clips.find(c => c.id === trans.clipBId);
      if (!clipB) continue;

      const x = frameToPixel(clipB.startFrame) - scrollX;
      const width = frameToPixel(trans.duration);

      const el = document.createElement('div');
      el.className = 'nle-transition';
      if (trans.id === selectedTransId) el.classList.add('selected');
      el.dataset.transitionId = trans.id;
      el.dataset.trackId = track.id;
      el.style.transform = `translateX(${x}px)`;
      el.style.width = `${Math.max(4, width)}px`;

      // Label
      const label = document.createElement('span');
      label.className = 'nle-transition-label';
      const typeName = trans.type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      label.textContent = typeName;
      el.appendChild(label);

      // Click to select
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        editorState.set('selection.transitionId', trans.id);
        editorState.set('selection.clipIds', []);
        eventBus.emit(EDITOR_EVENTS.SELECTION_CHANGED);
        eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
      });

      // Context menu
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editorState.set('selection.transitionId', trans.id);
        contextMenu.show(e.clientX, e.clientY, [
          { label: 'Delete Transition', action: () => {
            timelineEngine.removeTransition(track.id, trans.id);
            editorState.set('selection.transitionId', null);
          }}
        ]);
      });

      laneEl.appendChild(el);
    }
  },

  // Drop a transition effect onto a clip — pick head or tail based on drop position
  _dropTransition(e, el, clip, effectId) {
    const track = timelineEngine.getTrack(clip.trackId);
    if (!track) return;

    const { prev, next } = this._getAdjacentClips(clip, track);
    const clipEnd = getClipEndFrame(clip);

    const prevAdjacent = prev && getClipEndFrame(prev) === clip.startFrame;
    const nextAdjacent = next && clipEnd === next.startFrame;

    // Determine side from drop position within the clip element
    const rect = el.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const isLeftHalf = dropX < rect.width / 2;

    // Check for existing transitions
    const hasHeadTrans = prevAdjacent && track.transitions.find(
      t => t.clipAId === prev.id && t.clipBId === clip.id
    );
    const hasTailTrans = nextAdjacent && track.transitions.find(
      t => t.clipAId === clip.id && t.clipBId === next.id
    );

    if (isLeftHalf && prevAdjacent && !hasHeadTrans) {
      timelineEngine.addTransition(track.id, prev.id, clip.id, effectId, 30);
    } else if (!isLeftHalf && nextAdjacent && !hasTailTrans) {
      timelineEngine.addTransition(track.id, clip.id, next.id, effectId, 30);
    } else if (prevAdjacent && !hasHeadTrans) {
      timelineEngine.addTransition(track.id, prev.id, clip.id, effectId, 30);
    } else if (nextAdjacent && !hasTailTrans) {
      timelineEngine.addTransition(track.id, clip.id, next.id, effectId, 30);
    }
  },

  _addFade(clip, track, direction) {
    const isAudio = track && track.type === 'audio';
    const fadeDuration = 15; // frames
    const endFrame = getClipEndFrame(clip);

    if (isAudio) {
      const volFx = getIntrinsicEffect(clip, 'audio-volume');
      if (!volFx) return;
      if (!volFx.keyframes) volFx.keyframes = {};
      if (!volFx.keyframes.gain) volFx.keyframes.gain = [];
      const kfs = volFx.keyframes.gain;
      if (direction === 'in') {
        keyframeEngine.addKeyframe(kfs, clip.startFrame, 0);
        keyframeEngine.addKeyframe(kfs, clip.startFrame + fadeDuration, volFx.params.gain);
      } else {
        keyframeEngine.addKeyframe(kfs, endFrame - fadeDuration, volFx.params.gain);
        keyframeEngine.addKeyframe(kfs, endFrame, 0);
      }
    } else {
      const opFx = getIntrinsicEffect(clip, 'opacity');
      if (!opFx) return;
      if (!opFx.keyframes) opFx.keyframes = {};
      if (!opFx.keyframes.opacity) opFx.keyframes.opacity = [];
      const kfs = opFx.keyframes.opacity;
      if (direction === 'in') {
        keyframeEngine.addKeyframe(kfs, clip.startFrame, 0);
        keyframeEngine.addKeyframe(kfs, clip.startFrame + fadeDuration, opFx.params.opacity);
      } else {
        keyframeEngine.addKeyframe(kfs, endFrame - fadeDuration, opFx.params.opacity);
        keyframeEngine.addKeyframe(kfs, endFrame, 0);
      }
    }
    eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
  },

  // --- Rubber band / Pen tool ---

  _getRubberBandContext(clip, track) {
    const isAudio = track && track.type === 'audio';
    if (isAudio) {
      const effect = getIntrinsicEffect(clip, 'audio-volume');
      return { effect, paramId: 'gain', maxValue: 200, hasKfs: !!(effect && effect.keyframes && effect.keyframes.gain && effect.keyframes.gain.length) };
    }
    const effect = getIntrinsicEffect(clip, 'opacity');
    return { effect, paramId: 'opacity', maxValue: 100, hasKfs: !!(effect && effect.keyframes && effect.keyframes.opacity && effect.keyframes.opacity.length) };
  },

  _drawRubberBand(canvas, clip, track, clipWidthOverride) {
    if (!track) track = timelineEngine.getTrack(clip.trackId);
    const clipWidth = clipWidthOverride || frameToPixel(getClipDuration(clip));
    // Track row is 48px, clip is top:2 height:calc(100%-4px) = 44px
    const clipHeight = 44;
    if (clipWidth < 2) return;

    canvas.width = Math.max(1, Math.round(clipWidth));
    canvas.height = Math.max(1, Math.round(clipHeight));

    const { effect, paramId, maxValue, hasKfs } = this._getRubberBandContext(clip, track);
    if (!effect) return;

    // Only draw when pen tool is active or clip has keyframes
    const tool = editorState.get('ui.activeTool');
    if (tool !== TOOL_TYPES.PEN && !hasKfs) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const kfs = (effect.keyframes && effect.keyframes[paramId]) || [];
    const staticValue = effect.params[paramId] ?? (paramId === 'gain' ? 100 : 100);
    const zoom = editorState.get('timeline.zoom') || 1;

    const valueToY = (val) => clipHeight * (1 - val / maxValue);
    const frameToX = (f) => (f - clip.startFrame) * zoom;

    // Draw the rubber band line
    ctx.strokeStyle = '#e8c84a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    if (kfs.length === 0) {
      // Flat line at static value
      const y = valueToY(staticValue);
      ctx.moveTo(0, y);
      ctx.lineTo(clipWidth, y);
    } else {
      // Interpolated segments
      const clipEndFrame = clip.startFrame + getClipDuration(clip);
      // Draw from clip start to first keyframe
      const firstVal = keyframeEngine.getValueAtFrame(kfs, clip.startFrame);
      ctx.moveTo(0, valueToY(firstVal));
      // Sample at each keyframe that falls within clip range
      for (const kf of kfs) {
        if (kf.frame < clip.startFrame || kf.frame > clipEndFrame) continue;
        const x = frameToX(kf.frame);
        const y = valueToY(kf.value);
        ctx.lineTo(x, y);
      }
      // Draw to clip end
      const lastVal = keyframeEngine.getValueAtFrame(kfs, clipEndFrame);
      ctx.lineTo(clipWidth, valueToY(lastVal));
    }
    ctx.stroke();

    // Draw keyframe diamonds
    if (kfs.length > 0) {
      const clipEndFrame = clip.startFrame + getClipDuration(clip);
      ctx.fillStyle = '#e8c84a';
      for (const kf of kfs) {
        if (kf.frame < clip.startFrame || kf.frame > clipEndFrame) continue;
        const x = frameToX(kf.frame);
        const y = valueToY(kf.value);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-3, -3, 6, 6);
        ctx.restore();
      }
    }
  },

  _handlePenTool(e, clip, clipEl) {
    const track = timelineEngine.getTrack(clip.trackId);
    if (!track) return;

    const { effect, paramId, maxValue } = this._getRubberBandContext(clip, track);
    if (!effect) return;

    // Ensure keyframes array exists
    if (!effect.keyframes) effect.keyframes = {};
    if (!effect.keyframes[paramId]) effect.keyframes[paramId] = [];
    const kfs = effect.keyframes[paramId];

    // Get click position relative to clip
    const rect = clipEl.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const clipWidth = rect.width;
    const clipHeight = rect.height;

    // Convert to frame and value
    const zoom = editorState.get('timeline.zoom') || 1;
    const clickFrame = Math.round(clip.startFrame + relX / zoom);
    const clickValue = Math.max(0, Math.min(maxValue, maxValue * (1 - relY / clipHeight)));

    // Hit test existing keyframes (6px threshold)
    const hitKf = this._findNearbyKeyframe(kfs, clickFrame, clickValue, clip, clipWidth, clipHeight, maxValue);

    if (hitKf && (e.ctrlKey || e.metaKey)) {
      // Ctrl+click = delete keyframe
      const beforeKfs = kfs.map(k => ({ ...k }));
      keyframeEngine.removeKeyframe(kfs, hitKf.frame);
      const afterKfs = kfs.map(k => ({ ...k }));
      history.pushWithoutExecute({
        description: `Delete keyframe: ${paramId}`,
        execute() { effect.keyframes[paramId] = afterKfs.map(k => ({ ...k })); eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED); },
        undo() { effect.keyframes[paramId] = beforeKfs.map(k => ({ ...k })); eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED); }
      });
      eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
    } else if (hitKf) {
      // Drag existing keyframe
      this._startKeyframeDrag(hitKf, kfs, clip, clipEl, maxValue, effect, paramId);
    } else {
      // Add new keyframe at click position
      const beforeKfs = kfs.map(k => ({ ...k }));
      keyframeEngine.addKeyframe(kfs, clickFrame, clickValue);
      const afterKfs = kfs.map(k => ({ ...k }));
      history.pushWithoutExecute({
        description: `Add keyframe: ${paramId}`,
        execute() { effect.keyframes[paramId] = afterKfs.map(k => ({ ...k })); eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED); },
        undo() { effect.keyframes[paramId] = beforeKfs.map(k => ({ ...k })); eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED); }
      });
      eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
    }
  },

  _findNearbyKeyframe(kfs, clickFrame, clickValue, clip, clipWidth, clipHeight, maxValue) {
    const zoom = editorState.get('timeline.zoom') || 1;
    const threshold = 6; // pixels
    for (const kf of kfs) {
      if (kf.frame < clip.startFrame || kf.frame > clip.startFrame + getClipDuration(clip)) continue;
      const kfX = (kf.frame - clip.startFrame) * zoom;
      const kfY = clipHeight * (1 - kf.value / maxValue);
      const clickX = (clickFrame - clip.startFrame) * zoom;
      const clickY = clipHeight * (1 - clickValue / maxValue);
      const dist = Math.sqrt((kfX - clickX) ** 2 + (kfY - clickY) ** 2);
      if (dist <= threshold) return kf;
    }
    return null;
  },

  _startKeyframeDrag(hitKf, kfs, clip, clipEl, maxValue, effect, paramId) {
    const beforeKfs = kfs.map(k => ({ ...k }));
    const rect = clipEl.getBoundingClientRect();

    const onMove = (e2) => {
      const relY = e2.clientY - rect.top;
      let newValue = maxValue * (1 - relY / rect.height);
      newValue = Math.max(0, Math.min(maxValue, newValue));
      // Snap to 0% and 100% within 3px
      const snapThreshold = 3;
      const zeroY = rect.height; // y for value 0
      const fullY = 0; // y for maxValue
      const mouseY = e2.clientY - rect.top;
      if (Math.abs(mouseY - zeroY) < snapThreshold) newValue = 0;
      if (Math.abs(mouseY - fullY) < snapThreshold) newValue = maxValue;
      // Snap to default (100 for opacity, 100 for gain)
      const defaultVal = paramId === 'gain' ? 100 : 100;
      const defaultY = rect.height * (1 - defaultVal / maxValue);
      if (Math.abs(mouseY - defaultY) < snapThreshold) newValue = defaultVal;

      hitKf.value = newValue;
      eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const afterKfs = kfs.map(k => ({ ...k }));
      history.pushWithoutExecute({
        description: `Move keyframe: ${paramId}`,
        execute() { effect.keyframes[paramId] = afterKfs.map(k => ({ ...k })); eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED); },
        undo() { effect.keyframes[paramId] = beforeKfs.map(k => ({ ...k })); eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED); }
      });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  },

  // Get adjacent clip info for transition context menu items
  _getAdjacentClips(clip, track) {
    const clips = track.clips.slice().sort((a, b) => a.startFrame - b.startFrame);
    const idx = clips.findIndex(c => c.id === clip.id);
    const prev = idx > 0 ? clips[idx - 1] : null;
    const next = idx < clips.length - 1 ? clips[idx + 1] : null;
    return { prev, next };
  }
};

export default timelineClipUI;
