// Dockable Sequence Settings panel — resolution, fps, codec, bitrate + conform progress
import { editorState } from '../core/EditorState.js';
import { eventBus } from '../core/EventBus.js';
import {
  EDITOR_EVENTS, CANVAS_PRESETS, FRAME_RATES,
  SEQUENCE_CODECS, SEQUENCE_BITRATE_OPTIONS
} from '../core/Constants.js';
import { conformEncoder } from '../media/ConformEncoder.js';

export const sequenceSettingsPanel = {
  _el: null,
  _progressBar: null,
  _progressLabel: null,
  _unsubs: [],

  init(el) {
    this._el = el;
    this._buildUI();
    this._bindEvents();
    this._updateProgress();
  },

  _buildUI() {
    const el = this._el;
    el.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'nle-seq-settings';

    // Resolution
    wrap.appendChild(this._buildRow('Resolution', this._buildResolutionControl()));

    // Frame Rate
    wrap.appendChild(this._buildRow('Frame Rate', this._buildFpsControl()));

    // Codec
    wrap.appendChild(this._buildRow('Codec', this._buildCodecControl()));

    // Bitrate
    wrap.appendChild(this._buildRow('Bitrate', this._buildBitrateControl()));

    // Divider
    const divider = document.createElement('div');
    divider.className = 'nle-seq-divider';
    wrap.appendChild(divider);

    // Conform tuning
    const tuningSection = document.createElement('div');
    tuningSection.className = 'nle-seq-tuning-section';

    const tuningHeader = document.createElement('div');
    tuningHeader.className = 'nle-seq-progress-header';
    tuningHeader.textContent = 'Conform Tuning';
    tuningSection.appendChild(tuningHeader);

    tuningSection.appendChild(this._buildRow('Batch Size',
      this._buildTuningSlider('_maxPerTick', 1, 32, conformEncoder._maxPerTick,
        'Frames composited per idle tick. Higher = faster conforming but more main-thread work. Lower if UI feels sluggish during conform.')));
    tuningSection.appendChild(this._buildRow('Pipeline Depth',
      this._buildTuningSlider('_maxPending', 1, 32, conformEncoder._maxPending,
        'Max encodes in-flight to the GPU. Higher = better GPU utilization. Lower if system runs hot or memory-constrained.')));

    wrap.appendChild(tuningSection);

    // Conform progress
    const progressSection = document.createElement('div');
    progressSection.className = 'nle-seq-progress-section';

    const progressHeader = document.createElement('div');
    progressHeader.className = 'nle-seq-progress-header';
    progressHeader.textContent = 'Conform Status';
    progressSection.appendChild(progressHeader);

    const progressBarWrap = document.createElement('div');
    progressBarWrap.className = 'nle-seq-progress-bar-wrap';
    this._progressBar = document.createElement('div');
    this._progressBar.className = 'nle-seq-progress-bar';
    this._progressBar.style.width = '0%';
    progressBarWrap.appendChild(this._progressBar);
    progressSection.appendChild(progressBarWrap);

    this._progressLabel = document.createElement('div');
    this._progressLabel.className = 'nle-seq-progress-label';
    this._progressLabel.textContent = '0/0 frames pre-encoded';
    progressSection.appendChild(this._progressLabel);

    // Buttons row
    const btnRow = document.createElement('div');
    btnRow.className = 'nle-seq-btn-row';

    const reconformBtn = document.createElement('button');
    reconformBtn.className = 'nle-seq-btn';
    reconformBtn.textContent = 'Re-conform';
    reconformBtn.title = 'Invalidate all conformed packets and restart';
    reconformBtn.addEventListener('click', () => {
      conformEncoder._invalidateAll();
      conformEncoder._restartIdleFill();
    });
    btnRow.appendChild(reconformBtn);

    progressSection.appendChild(btnRow);
    wrap.appendChild(progressSection);

    el.appendChild(wrap);
  },

  _buildRow(label, control) {
    const row = document.createElement('div');
    row.className = 'nle-seq-row';
    const lbl = document.createElement('span');
    lbl.className = 'nle-seq-label';
    lbl.textContent = label;
    row.appendChild(lbl);
    row.appendChild(control);
    return row;
  },

  _buildResolutionControl() {
    const wrap = document.createElement('div');
    wrap.className = 'nle-seq-control';

    const select = document.createElement('select');
    select.className = 'nle-seq-select';

    for (const [key, preset] of Object.entries(CANVAS_PRESETS)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = preset.label;
      select.appendChild(opt);
    }

    // Custom option
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom';
    select.appendChild(customOpt);

    // Set current value
    const canvas = editorState.get('project.canvas');
    const currentKey = `${canvas.width}x${canvas.height}`;
    if (CANVAS_PRESETS[currentKey]) {
      select.value = currentKey;
    } else {
      select.value = 'custom';
    }

    // Custom W x H inputs
    const customWrap = document.createElement('div');
    customWrap.className = 'nle-seq-custom-res';
    customWrap.style.display = select.value === 'custom' ? 'flex' : 'none';

    const widthInput = document.createElement('input');
    widthInput.type = 'number';
    widthInput.className = 'nle-seq-num-input';
    widthInput.value = canvas.width;
    widthInput.min = 128;
    widthInput.max = 7680;

    const xLabel = document.createElement('span');
    xLabel.className = 'nle-seq-x-label';
    xLabel.textContent = '\u00D7';

    const heightInput = document.createElement('input');
    heightInput.type = 'number';
    heightInput.className = 'nle-seq-num-input';
    heightInput.value = canvas.height;
    heightInput.min = 128;
    heightInput.max = 4320;

    customWrap.appendChild(widthInput);
    customWrap.appendChild(xLabel);
    customWrap.appendChild(heightInput);

    select.addEventListener('change', () => {
      if (select.value === 'custom') {
        customWrap.style.display = 'flex';
      } else {
        customWrap.style.display = 'none';
        const preset = CANVAS_PRESETS[select.value];
        if (preset) {
          editorState.set('project.canvas', { width: preset.width, height: preset.height });
        }
      }
    });

    const applyCustom = () => {
      const w = Math.max(128, Math.min(7680, parseInt(widthInput.value) || 1920));
      const h = Math.max(128, Math.min(4320, parseInt(heightInput.value) || 1080));
      widthInput.value = w;
      heightInput.value = h;
      editorState.set('project.canvas', { width: w, height: h });
    };

    widthInput.addEventListener('change', applyCustom);
    heightInput.addEventListener('change', applyCustom);

    wrap.appendChild(select);
    wrap.appendChild(customWrap);
    return wrap;
  },

  _buildFpsControl() {
    const select = document.createElement('select');
    select.className = 'nle-seq-select';

    const fpsValues = Object.values(FRAME_RATES);
    const current = editorState.get('project.frameRate');

    for (const fps of fpsValues) {
      const opt = document.createElement('option');
      opt.value = fps;
      opt.textContent = `${fps} fps`;
      if (fps === current) opt.selected = true;
      select.appendChild(opt);
    }

    select.addEventListener('change', () => {
      editorState.set('project.frameRate', parseInt(select.value));
    });

    return select;
  },

  _buildCodecControl() {
    const select = document.createElement('select');
    select.className = 'nle-seq-select';

    const codecEntries = [
      { value: SEQUENCE_CODECS.H264, label: 'H.264 High' },
      { value: SEQUENCE_CODECS.VP9, label: 'VP9' }
    ];

    const current = editorState.get('project.codec');

    for (const { value, label } of codecEntries) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === current) opt.selected = true;
      select.appendChild(opt);
    }

    select.addEventListener('change', () => {
      editorState.set('project.codec', select.value);
    });

    return select;
  },

  _buildBitrateControl() {
    const select = document.createElement('select');
    select.className = 'nle-seq-select';

    const current = editorState.get('project.bitrate');

    for (const br of SEQUENCE_BITRATE_OPTIONS) {
      const opt = document.createElement('option');
      opt.value = br;
      const numStr = br.replace(/[mMkK]$/, '');
      const unit = br.endsWith('M') || br.endsWith('m') ? 'Mbps' : 'Kbps';
      opt.textContent = `${numStr} ${unit}`;
      if (br === current) opt.selected = true;
      select.appendChild(opt);
    }

    select.addEventListener('change', () => {
      editorState.set('project.bitrate', select.value);
    });

    return select;
  },

  _buildTuningSlider(prop, min, max, initial, tooltip) {
    const wrap = document.createElement('div');
    wrap.className = 'nle-seq-tuning-control';
    wrap.title = tooltip;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'nle-seq-slider';
    slider.min = min;
    slider.max = max;
    slider.value = initial;

    const valueLabel = document.createElement('span');
    valueLabel.className = 'nle-seq-tuning-value';
    valueLabel.textContent = initial;

    slider.addEventListener('input', () => {
      const val = parseInt(slider.value);
      valueLabel.textContent = val;
      conformEncoder[prop] = val;
    });

    wrap.appendChild(slider);
    wrap.appendChild(valueLabel);
    return wrap;
  },

  _bindEvents() {
    // Update progress periodically when conforming is active
    const updateFn = () => this._updateProgress();
    eventBus.on(EDITOR_EVENTS.CONFORM_BUFFER_CHANGED, updateFn);
    this._unsubs.push(() => eventBus.off(EDITOR_EVENTS.CONFORM_BUFFER_CHANGED, updateFn));

    // Update controls when settings change externally
    const settingsFn = () => this._rebuildControls();
    for (const path of ['project.canvas', 'project.frameRate', 'project.codec', 'project.bitrate']) {
      const unsub = editorState.subscribe(path, settingsFn);
      this._unsubs.push(unsub);
    }

    // Rebuild panel when active sequence changes
    const seqFn = () => this._rebuildControls();
    eventBus.on(EDITOR_EVENTS.SEQUENCE_ACTIVATED, seqFn);
    this._unsubs.push(() => eventBus.off(EDITOR_EVENTS.SEQUENCE_ACTIVATED, seqFn));
  },

  _rebuildControls() {
    // Simple approach: rebuild the entire panel UI when settings change externally
    if (this._el) this._buildUI();
  },

  _updateProgress() {
    if (!this._progressBar || !this._progressLabel) return;
    const { conformed, total } = conformEncoder.getProgress();
    const pct = total > 0 ? Math.round((conformed / total) * 100) : 0;
    this._progressBar.style.width = `${pct}%`;
    this._progressLabel.textContent = `${conformed}/${total} frames pre-encoded (${pct}%)`;
  },

  destroy() {
    for (const unsub of this._unsubs) {
      if (typeof unsub === 'function') unsub();
    }
    this._unsubs = [];
    if (this._el) this._el.innerHTML = '';
    this._progressBar = null;
    this._progressLabel = null;
  }
};

export default sequenceSettingsPanel;
