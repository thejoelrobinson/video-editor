// Core timeline model — tracks, clips, duration
import { editorState } from '../core/EditorState.js';
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS, TRACK_TYPES } from '../core/Constants.js';
import { createTrack } from './Track.js';
import { createClip, getClipEndFrame, getClipDuration } from './Clip.js';
import { createTransition, TRANSITION_TYPES } from '../effects/Transitions.js';
import { secondsToFrame } from './TimelineMath.js';

export const timelineEngine = {
  _batchDepth: 0,
  _batchRanges: [],
  _batchEventQueue: [],

  beginBatch() {
    this._batchDepth++;
    if (this._batchDepth === 1) {
      this._batchRanges = [];
      this._batchEventQueue = [];
    }
  },

  commitBatch() {
    if (this._batchDepth <= 0) return;
    this._batchDepth--;
    if (this._batchDepth > 0) return; // still nested
    try {
      this._recalcDuration();
      eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED, {
        ranges: this._batchRanges.length > 0 ? this._batchRanges : null
      });
      // Replay queued events
      for (const { event, data } of this._batchEventQueue) {
        eventBus.emit(event, data);
      }
    } finally {
      this._batchRanges = [];
      this._batchEventQueue = [];
    }
  },

  _emitOrQueue(event, data) {
    if (this._batchDepth > 0) {
      if (event === EDITOR_EVENTS.TIMELINE_UPDATED) return; // suppressed
      this._batchEventQueue.push({ event, data });
    } else {
      eventBus.emit(event, data);
    }
  },

  _recordAffectedRange(start, end) {
    if (this._batchDepth > 0) {
      this._batchRanges.push({ start, end });
    }
  },

  init() {
    // Start with one video track and one audio track in the default sequence
    const v1 = createTrack({ name: 'V1', type: TRACK_TYPES.VIDEO });
    const a1 = createTrack({ name: 'A1', type: TRACK_TYPES.AUDIO });
    editorState.set('timeline.tracks', [v1, a1]);
    this._recalcDuration();
  },

  switchSequence(seqId) {
    if (!editorState.getSequence(seqId)) return false;

    // Stop playback before switching (set state directly to avoid circular import)
    editorState.set('playback.playing', false);
    editorState.set('playback.currentFrame', 0);
    eventBus.emit(EDITOR_EVENTS.PLAYBACK_STOP);

    // Clear selection
    editorState.set('selection.clipIds', []);
    editorState.set('selection.trackId', null);

    // Switch the active sequence pointer (no-ops if already active, but events
    // must still fire — ConformEncoder's cross-sequence idle fill temporarily
    // swaps the pointer, so the "already active" check would short-circuit
    // a real user switch and leave the UI stale)
    editorState.setActiveSequenceId(seqId);

    // Emit sequence activated event (triggers UI rebuilds)
    eventBus.emit(EDITOR_EVENTS.SEQUENCE_ACTIVATED, { id: seqId });
    eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);

    return true;
  },

  getTracks() {
    return editorState.get('timeline.tracks') || [];
  },

  getTrack(trackId) {
    return this.getTracks().find(t => t.id === trackId);
  },

  getVideoTracks() {
    return this.getTracks().filter(t =>
      t.type === TRACK_TYPES.VIDEO || t.type === TRACK_TYPES.TITLE
    );
  },

  getAudioTracks() {
    return this.getTracks().filter(t => t.type === TRACK_TYPES.AUDIO);
  },

  addTrack(type = TRACK_TYPES.VIDEO, name = null) {
    const tracks = this.getTracks();
    const count = tracks.filter(t => t.type === type).length;
    const prefix = type === TRACK_TYPES.AUDIO ? 'A' : 'V';
    const track = createTrack({
      name: name || `${prefix}${count + 1}`,
      type
    });

    // Insert video tracks at top, audio tracks at bottom
    if (type === TRACK_TYPES.AUDIO) {
      tracks.push(track);
    } else {
      // Find first audio track index, insert before it
      const firstAudioIdx = tracks.findIndex(t => t.type === TRACK_TYPES.AUDIO);
      if (firstAudioIdx === -1) {
        tracks.push(track);
      } else {
        tracks.splice(firstAudioIdx, 0, track);
      }
    }

    editorState.set('timeline.tracks', [...tracks]);
    this._emitOrQueue(EDITOR_EVENTS.TRACK_ADDED, { track });
    return track;
  },

  removeTrack(trackId) {
    const tracks = this.getTracks().filter(t => t.id !== trackId);
    if (tracks.length === 0) return false;
    editorState.set('timeline.tracks', tracks);
    if (!this._batchDepth) this._recalcDuration();
    this._emitOrQueue(EDITOR_EVENTS.TRACK_REMOVED, { trackId });
    return true;
  },

  addClip(trackId, mediaItem, startFrame = 0) {
    const track = this.getTrack(trackId);
    if (!track) return null;

    const canvas = editorState.get('project.canvas') || { width: 1920, height: 1080 };
    const durationFrames = secondsToFrame(mediaItem.duration || 5);
    const clip = createClip({
      mediaId: mediaItem.id,
      trackId,
      name: mediaItem.name || 'Clip',
      startFrame,
      sourceInFrame: 0,
      sourceOutFrame: durationFrames,
      color: this._getTrackColor(track),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height
    });

    track.clips.push(clip);
    track.clips.sort((a, b) => a.startFrame - b.startFrame);
    if (!this._batchDepth) this._recalcDuration();
    const endFrame = clip.startFrame + Math.round((clip.sourceOutFrame - clip.sourceInFrame) / (clip.speed || 1));
    this._recordAffectedRange(clip.startFrame, endFrame);
    this._emitOrQueue(EDITOR_EVENTS.CLIP_ADDED, { clip, trackId });
    this._emitOrQueue(EDITOR_EVENTS.TIMELINE_UPDATED);
    return clip;
  },

  // Add a video clip with a linked audio clip (Premiere-style A/V link)
  addClipWithLinkedAudio(mediaItem, startFrame = 0) {
    const videoTrack = this.getVideoTracks()[0] || this.addTrack(TRACK_TYPES.VIDEO);
    const audioTrack = this.getAudioTracks()[0] || this.addTrack(TRACK_TYPES.AUDIO);
    const canvas = editorState.get('project.canvas') || { width: 1920, height: 1080 };
    const durationFrames = secondsToFrame(mediaItem.duration || 5);

    const videoClip = createClip({
      mediaId: mediaItem.id,
      trackId: videoTrack.id,
      name: `${mediaItem.name || 'Clip'} [V]`,
      startFrame,
      sourceInFrame: 0,
      sourceOutFrame: durationFrames,
      color: this._getTrackColor(videoTrack),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height
    });

    const audioClip = createClip({
      mediaId: mediaItem.id,
      trackId: audioTrack.id,
      name: `${mediaItem.name || 'Clip'} [A]`,
      startFrame,
      sourceInFrame: 0,
      sourceOutFrame: durationFrames,
      color: this._getTrackColor(audioTrack),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height
    });

    // Link them together
    videoClip.linkedClipId = audioClip.id;
    audioClip.linkedClipId = videoClip.id;

    videoTrack.clips.push(videoClip);
    videoTrack.clips.sort((a, b) => a.startFrame - b.startFrame);
    audioTrack.clips.push(audioClip);
    audioTrack.clips.sort((a, b) => a.startFrame - b.startFrame);

    if (!this._batchDepth) this._recalcDuration();
    const endFrame = videoClip.startFrame + Math.round((videoClip.sourceOutFrame - videoClip.sourceInFrame) / (videoClip.speed || 1));
    this._recordAffectedRange(videoClip.startFrame, endFrame);
    this._emitOrQueue(EDITOR_EVENTS.CLIP_ADDED, { clip: videoClip, trackId: videoTrack.id });
    this._emitOrQueue(EDITOR_EVENTS.CLIP_ADDED, { clip: audioClip, trackId: audioTrack.id });
    this._emitOrQueue(EDITOR_EVENTS.TIMELINE_UPDATED);
    return { videoClip, audioClip };
  },

  linkClips(clipIdA, clipIdB) {
    const a = this.getClip(clipIdA);
    const b = this.getClip(clipIdB);
    if (!a || !b) return;
    // Unlink existing partners first
    if (a.linkedClipId) {
      const old = this.getClip(a.linkedClipId);
      if (old) old.linkedClipId = null;
    }
    if (b.linkedClipId) {
      const old = this.getClip(b.linkedClipId);
      if (old) old.linkedClipId = null;
    }
    a.linkedClipId = clipIdB;
    b.linkedClipId = clipIdA;
    this._emitOrQueue(EDITOR_EVENTS.TIMELINE_UPDATED);
  },

  unlinkClip(clipId) {
    const clip = this.getClip(clipId);
    if (!clip || !clip.linkedClipId) return;
    const partner = this.getClip(clip.linkedClipId);
    clip.linkedClipId = null;
    if (partner) partner.linkedClipId = null;
    this._emitOrQueue(EDITOR_EVENTS.TIMELINE_UPDATED);
  },

  removeClip(clipId) {
    const tracks = this.getTracks();
    for (const track of tracks) {
      const idx = track.clips.findIndex(c => c.id === clipId);
      if (idx !== -1) {
        const clip = track.clips.splice(idx, 1)[0];
        // Also remove linked clip
        if (clip.linkedClipId) {
          const linkedId = clip.linkedClipId;
          clip.linkedClipId = null;
          const partner = this.getClip(linkedId);
          if (partner) {
            partner.linkedClipId = null; // prevent recursion
            this.removeClip(linkedId);
          }
        }
        if (!this._batchDepth) this._recalcDuration();
        const clipEnd = clip.startFrame + Math.round((clip.sourceOutFrame - clip.sourceInFrame) / (clip.speed || 1));
        this._recordAffectedRange(clip.startFrame, clipEnd);
        this._emitOrQueue(EDITOR_EVENTS.CLIP_REMOVED, { clip, trackId: track.id });
        this._emitOrQueue(EDITOR_EVENTS.TIMELINE_UPDATED);
        return clip;
      }
    }
    return null;
  },

  getClip(clipId) {
    for (const track of this.getTracks()) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  },

  getAllClips() {
    const clips = [];
    for (const track of this.getTracks()) {
      clips.push(...track.clips);
    }
    return clips;
  },

  moveClip(clipId, newTrackId, newStartFrame) {
    const clip = this.getClip(clipId);
    if (!clip) return false;

    // Remove from old track
    const oldTrack = this.getTrack(clip.trackId);
    if (oldTrack) {
      oldTrack.clips = oldTrack.clips.filter(c => c.id !== clipId);
    }

    // Add to new track
    const newTrack = this.getTrack(newTrackId);
    if (!newTrack) return false;

    clip.trackId = newTrackId;
    clip.startFrame = Math.max(0, newStartFrame);
    newTrack.clips.push(clip);
    newTrack.clips.sort((a, b) => a.startFrame - b.startFrame);

    if (!this._batchDepth) this._recalcDuration();
    const clipEnd = getClipEndFrame(clip);
    this._recordAffectedRange(clip.startFrame, clipEnd);
    this._emitOrQueue(EDITOR_EVENTS.CLIP_MOVED, { clip, oldTrackId: oldTrack?.id, newTrackId });
    this._emitOrQueue(EDITOR_EVENTS.TIMELINE_UPDATED);
    return true;
  },

  // --- Transition management ---

  addTransition(trackId, clipAId, clipBId, type = TRANSITION_TYPES.CROSS_DISSOLVE, duration = 30) {
    const track = this.getTrack(trackId);
    if (!track) return null;

    const clipA = track.clips.find(c => c.id === clipAId);
    const clipB = track.clips.find(c => c.id === clipBId);
    if (!clipA || !clipB) return null;

    // Clips must be adjacent (A ends where B starts)
    const clipAEnd = getClipEndFrame(clipA);
    if (clipAEnd !== clipB.startFrame) return null;

    // No duplicate transition between these clips
    const existing = track.transitions.find(
      t => t.clipAId === clipAId && t.clipBId === clipBId
    );
    if (existing) return null;

    // Check available handle on clip B (how far back source can extend)
    const availableHandle = clipB.sourceInFrame;
    duration = Math.min(duration, Math.floor(availableHandle / clipB.speed));
    if (duration <= 0) return null;

    // Create overlap: move clipB earlier and extend its source range backward
    clipB.startFrame -= duration;
    clipB.sourceInFrame -= Math.round(duration * clipB.speed);

    const transition = createTransition({ type, duration, clipAId, clipBId });
    track.transitions.push(transition);

    this._recordAffectedRange(clipB.startFrame, clipB.startFrame + duration);
    this._emitOrQueue(EDITOR_EVENTS.TRANSITION_ADDED, { transition, trackId });
    this._emitOrQueue(EDITOR_EVENTS.TIMELINE_UPDATED);
    return transition;
  },

  removeTransition(trackId, transitionId) {
    const track = this.getTrack(trackId);
    if (!track) return false;

    const idx = track.transitions.findIndex(t => t.id === transitionId);
    if (idx === -1) return false;

    const trans = track.transitions[idx];
    const clipB = track.clips.find(c => c.id === trans.clipBId);

    // Reverse the overlap
    if (clipB) {
      clipB.startFrame += trans.duration;
      clipB.sourceInFrame += Math.round(trans.duration * clipB.speed);
    }

    track.transitions.splice(idx, 1);
    if (clipB) {
      this._recordAffectedRange(clipB.startFrame - trans.duration, clipB.startFrame);
    }
    this._emitOrQueue(EDITOR_EVENTS.TRANSITION_REMOVED, { transitionId, trackId });
    this._emitOrQueue(EDITOR_EVENTS.TIMELINE_UPDATED);
    return true;
  },

  addDefaultTransitionAtPlayhead() {
    const currentFrame = editorState.get('playback.currentFrame');
    const videoTracks = this.getVideoTracks();

    for (const track of videoTracks) {
      if (track.locked) continue;

      // Find clip A ending at (or near ±1) the playhead, and clip B starting there
      let clipA = null;
      let clipB = null;

      for (const clip of track.clips) {
        const endFrame = getClipEndFrame(clip);
        if (Math.abs(endFrame - currentFrame) <= 1) clipA = clip;
        if (Math.abs(clip.startFrame - currentFrame) <= 1) clipB = clip;
      }

      if (clipA && clipB && clipA.id !== clipB.id) {
        const result = this.addTransition(
          track.id, clipA.id, clipB.id,
          TRANSITION_TYPES.CROSS_DISSOLVE, 30
        );
        if (result) return result;
      }
    }
    return null;
  },

  // Find the track containing a given transition
  getTransitionTrack(transitionId) {
    for (const track of this.getTracks()) {
      if (track.transitions.find(t => t.id === transitionId)) {
        return track;
      }
    }
    return null;
  },

  _recalcDuration() {
    let maxFrame = 0;
    for (const track of this.getTracks()) {
      for (const clip of track.clips) {
        const end = getClipEndFrame(clip);
        if (end > maxFrame) maxFrame = end;
      }
    }
    // Add 5 seconds of padding
    const fps = editorState.get('project.frameRate');
    editorState.set('timeline.duration', maxFrame + fps * 5);
  },

  _getTrackColor(track) {
    const videoColors = ['#4a90d9', '#7b68ee', '#e06c75', '#e5c07b', '#98c379', '#c678dd'];
    const audioColors = ['#56b6c2', '#61afef', '#d19a66'];
    const tracks = this.getTracks().filter(t => t.type === track.type);
    const idx = tracks.indexOf(track);
    const palette = track.type === TRACK_TYPES.AUDIO ? audioColors : videoColors;
    return palette[idx % palette.length];
  },

  getDuration() {
    return editorState.get('timeline.duration') || 0;
  },

  clear() {
    editorState.set('timeline.tracks', []);
    editorState.set('timeline.duration', 0);
    eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
  }
};

export default timelineEngine;
