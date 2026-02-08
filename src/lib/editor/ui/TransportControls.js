// Play/pause/stop/loop/speed controls
import { editorState } from '../core/EditorState.js';
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS, PLAYBACK_SPEEDS, ZOOM_LEVELS } from '../core/Constants.js';
import { playbackEngine } from '../playback/PlaybackEngine.js';
import { frameToTimecode, timecodeToFrame } from '../timeline/TimelineMath.js';

export const transportControls = {
  _container: null,

  init(container) {
    if (!container) {
      this._container = document.querySelector('.nle-transport');
    } else {
      this._container = container;
    }
    if (!this._container) return;

    const playBtn = this._container.querySelector('.nle-play-btn');
    const stopBtn = this._container.querySelector('.nle-stop-btn');
    const loopBtn = this._container.querySelector('.nle-loop-btn');
    const skipBackBtn = this._container.querySelector('.nle-skip-back-btn');
    const skipFwdBtn = this._container.querySelector('.nle-skip-fwd-btn');
    const speedSelect = this._container.querySelector('.nle-speed-select');
    this._timecodeEl = this._container.querySelector('.nle-timecode');
    this._timecodeEditing = false;

    // Click timecode to edit
    this._timecodeEl?.addEventListener('click', () => this._startTimecodeEdit());

    // Ctrl+G event from keyboard shortcuts
    eventBus.on(EDITOR_EVENTS.GOTO_TIMECODE, () => this._startTimecodeEdit());

    playBtn?.addEventListener('click', () => {
      playbackEngine.togglePlay();
    });

    stopBtn?.addEventListener('click', () => {
      playbackEngine.stop();
    });

    loopBtn?.addEventListener('click', () => {
      const loop = !editorState.get('playback.loop');
      editorState.set('playback.loop', loop);
      loopBtn.classList.toggle('active', loop);
    });

    skipBackBtn?.addEventListener('click', () => {
      playbackEngine.seek(0);
    });

    skipFwdBtn?.addEventListener('click', () => {
      const duration = editorState.get('timeline.duration');
      playbackEngine.seek(duration);
    });

    // Populate speed select options
    if (speedSelect && speedSelect.options.length === 0) {
      for (const speed of PLAYBACK_SPEEDS) {
        const opt = document.createElement('option');
        opt.value = speed;
        opt.textContent = `${speed}x`;
        if (speed === 1) opt.selected = true;
        speedSelect.appendChild(opt);
      }
      speedSelect.addEventListener('change', () => {
        playbackEngine.setSpeed(parseFloat(speedSelect.value));
      });
    }

    // Zoom slider
    const zoomSlider = this._container.querySelector('.nle-zoom-slider');
    if (zoomSlider) {
      zoomSlider.max = ZOOM_LEVELS.length - 1;
      zoomSlider.value = editorState.get('timeline.zoomIndex');
      zoomSlider.addEventListener('input', () => {
        const newIndex = parseInt(zoomSlider.value, 10);
        editorState.set('timeline.zoomIndex', newIndex);
        eventBus.emit(EDITOR_EVENTS.ZOOM_CHANGED);
      });
      // Sync slider when zoom changes externally (Ctrl+Wheel)
      eventBus.on(EDITOR_EVENTS.ZOOM_CHANGED, () => {
        zoomSlider.value = editorState.get('timeline.zoomIndex');
      });
    }

    // Update play button state
    eventBus.on(EDITOR_EVENTS.PLAYBACK_START, () => {
      if (playBtn) {
        playBtn.classList.add('playing');
        playBtn.innerHTML = this._pauseIcon();
      }
    });

    eventBus.on(EDITOR_EVENTS.PLAYBACK_STOP, () => {
      if (playBtn) {
        playBtn.classList.remove('playing');
        playBtn.innerHTML = this._playIcon();
      }
    });

    // Update timecode
    eventBus.on(EDITOR_EVENTS.PLAYBACK_FRAME, ({ frame }) => {
      this._updateTimecode(frame);
    });

    eventBus.on(EDITOR_EVENTS.PLAYBACK_SEEK, ({ frame }) => {
      this._updateTimecode(frame);
    });

    this._updateTimecode(0);
  },

  _updateTimecode(frame) {
    if (this._timecodeEl && !this._timecodeEditing) {
      this._timecodeEl.textContent = frameToTimecode(frame);
    }
  },

  _startTimecodeEdit() {
    if (!this._timecodeEl || this._timecodeEditing) return;
    this._timecodeEditing = true;

    const currentTC = this._timecodeEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'nle-timecode-input';
    input.value = currentTC;

    this._timecodeEl.textContent = '';
    this._timecodeEl.appendChild(input);
    input.focus();
    input.select();

    const commit = () => {
      if (!this._timecodeEditing) return;
      const frame = timecodeToFrame(input.value);
      if (frame !== null && frame >= 0) {
        playbackEngine.seek(frame);
      }
      this._cancelTimecodeEdit();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._cancelTimecodeEdit();
      }
      e.stopPropagation(); // Don't trigger editor shortcuts while typing
    });

    input.addEventListener('blur', () => commit());
  },

  _cancelTimecodeEdit() {
    if (!this._timecodeEditing) return;
    this._timecodeEditing = false;
    const frame = editorState.get('playback.currentFrame');
    this._updateTimecode(frame);
  },

  _playIcon() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  },

  _pauseIcon() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  }
};

export default transportControls;
