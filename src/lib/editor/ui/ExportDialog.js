// Export dialog: preset picker, custom settings, progress bar, download
import { getPresetList, getPreset } from '../export/ExportPresets.js';
import { exportPipeline } from '../export/ExportPipeline.js';
import { editorState } from '../core/EditorState.js';
import { timelineEngine } from '../timeline/TimelineEngine.js';
import { frameToTimecode } from '../timeline/TimelineMath.js';
import logger from '../../utils/logger.js';

export const exportDialog = {
  _overlay: null,
  _dialog: null,

  show() {
    if (this._overlay) return;

    this._overlay = document.createElement('div');
    this._overlay.className = 'nle-export-overlay';

    this._dialog = document.createElement('div');
    this._dialog.className = 'nle-export-dialog';
    this._dialog.innerHTML = this._buildHTML();
    this._overlay.appendChild(this._dialog);

    document.getElementById('video-editor')?.appendChild(this._overlay);

    this._bindEvents();
  },

  hide() {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
      this._dialog = null;
    }
  },

  _buildHTML() {
    const presets = getPresetList();
    return `
      <div class="nle-export-header">
        <h3>Export Video</h3>
        <button class="nle-export-close-btn" title="Close">×</button>
      </div>
      <div class="nle-export-body">
        <div class="nle-export-section">
          <label class="nle-export-label">Preset</label>
          <select class="nle-export-preset-select">
            ${presets.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
          </select>
        </div>
        <div class="nle-export-details">
          <div class="nle-export-detail-row">
            <span>Resolution:</span>
            <span class="nle-export-resolution">1920×1080</span>
          </div>
          <div class="nle-export-detail-row">
            <span>Format:</span>
            <span class="nle-export-format">MP4 (H.264)</span>
          </div>
          <div class="nle-export-detail-row">
            <span>Frame Rate:</span>
            <span class="nle-export-fps">30 fps</span>
          </div>
          <div class="nle-export-detail-row">
            <span>Source Range:</span>
            <span class="nle-export-range">${this._getSourceRangeText()}</span>
          </div>
          <div class="nle-export-detail-row">
            <span>Duration:</span>
            <span class="nle-export-duration">${this._getExportDurationText()}</span>
          </div>
        </div>
        <div class="nle-export-progress nle-hidden">
          <div class="nle-export-progress-bar">
            <div class="nle-export-progress-fill"></div>
          </div>
          <span class="nle-export-progress-text">Preparing...</span>
        </div>
      </div>
      <div class="nle-export-footer">
        <button class="nle-export-cancel-btn">Cancel</button>
        <button class="nle-export-start-btn">Export</button>
      </div>
    `;
  },

  _bindEvents() {
    const closeBtn = this._dialog.querySelector('.nle-export-close-btn');
    const cancelBtn = this._dialog.querySelector('.nle-export-cancel-btn');
    const startBtn = this._dialog.querySelector('.nle-export-start-btn');
    const presetSelect = this._dialog.querySelector('.nle-export-preset-select');

    closeBtn?.addEventListener('click', () => this.hide());
    cancelBtn?.addEventListener('click', () => {
      if (exportPipeline.isExporting()) {
        exportPipeline.cancel();
      } else {
        this.hide();
      }
    });

    presetSelect?.addEventListener('change', () => this._updatePresetDetails());
    this._updatePresetDetails();

    startBtn?.addEventListener('click', () => this._startExport());

    // Close on overlay click
    this._overlay?.addEventListener('click', (e) => {
      if (e.target === this._overlay) this.hide();
    });
  },

  _getSourceRangeText() {
    const inPoint = editorState.get('playback.inPoint');
    const outPoint = editorState.get('playback.outPoint');
    if (inPoint !== null || outPoint !== null) {
      const inTc = frameToTimecode(inPoint ?? 0);
      const duration = timelineEngine.getDuration();
      const outTc = frameToTimecode(outPoint ?? duration);
      return `In/Out (${inTc} - ${outTc})`;
    }
    return 'Entire Sequence';
  },

  _getExportDurationText() {
    const fps = editorState.get('project.frameRate');
    const duration = timelineEngine.getDuration();
    const inPoint = editorState.get('playback.inPoint') ?? 0;
    const outPoint = editorState.get('playback.outPoint') ?? duration;
    const totalFrames = outPoint - inPoint;
    const seconds = totalFrames / fps;
    return `${frameToTimecode(totalFrames)} (${totalFrames} frames, ${seconds.toFixed(1)}s)`;
  },

  _updatePresetDetails() {
    const select = this._dialog.querySelector('.nle-export-preset-select');
    const preset = getPreset(select.value);

    this._dialog.querySelector('.nle-export-resolution').textContent =
      `${preset.width}×${preset.height}`;
    this._dialog.querySelector('.nle-export-format').textContent =
      `${preset.format.toUpperCase()} (${preset.videoCodec || 'auto'})`;
    this._dialog.querySelector('.nle-export-fps').textContent =
      `${preset.fps} fps`;
  },

  async _startExport() {
    const select = this._dialog.querySelector('.nle-export-preset-select');
    const presetId = select.value;
    const preset = getPreset(presetId);

    const progressEl = this._dialog.querySelector('.nle-export-progress');
    const progressFill = this._dialog.querySelector('.nle-export-progress-fill');
    const progressText = this._dialog.querySelector('.nle-export-progress-text');
    const startBtn = this._dialog.querySelector('.nle-export-start-btn');

    progressEl?.classList.remove('nle-hidden');
    startBtn.disabled = true;
    startBtn.textContent = 'Exporting...';

    try {
      const blob = await exportPipeline.export(presetId, ({ stage, progress, message }) => {
        if (progressFill) progressFill.style.width = `${Math.round(progress * 100)}%`;
        if (progressText) progressText.textContent = message;
      });

      if (blob) {
        const projectName = editorState.get('project.name') || 'export';
        const filename = `${projectName}.${preset.format}`;
        exportPipeline.download(blob, filename);
        if (progressText) progressText.textContent = 'Download started!';
      }
    } catch (err) {
      logger.error('Export error:', err);
      if (progressText) progressText.textContent = `Error: ${err.message}`;
    } finally {
      startBtn.disabled = false;
      startBtn.textContent = 'Export';
    }
  }
};

export default exportDialog;
