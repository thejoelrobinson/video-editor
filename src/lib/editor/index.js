// Editor entry point -- wires all subsystems together
import logger from '../utils/logger.js';
import { editorState } from './core/EditorState.js';
import { eventBus } from './core/EventBus.js';
import { history } from './core/History.js';
import { timelineEngine } from './timeline/TimelineEngine.js';
import { mediaManager } from './media/MediaManager.js';
import { thumbnailGenerator } from './media/ThumbnailGenerator.js';
import { playbackEngine } from './playback/PlaybackEngine.js';
import { videoCompositor } from './playback/VideoCompositor.js';
import { audioMixer } from './playback/AudioMixer.js';
import { dockManager } from './ui/DockManager.js';
import { programMonitor } from './ui/ProgramMonitor.js';
import { sourceMonitor } from './ui/SourceMonitor.js';
import { projectPanel } from './ui/ProjectPanel.js';
import { effectsPanel } from './ui/EffectsPanel.js';
import { propertiesPanel } from './ui/PropertiesPanel.js';
import { basicPropertiesPanel } from './ui/BasicPropertiesPanel.js';
import { timelineUI } from './ui/TimelineUI.js';
import { transportControls } from './ui/TransportControls.js';
import { toolbar } from './ui/Toolbar.js';
import { keyboardShortcuts } from './ui/KeyboardShortcuts.js';
import { exportDialog } from './ui/ExportDialog.js';
import { menuBar } from './ui/MenuBar.js';
import { timelineToolbar } from './ui/TimelineToolbar.js';
import { audioMetersPanel } from './ui/AudioMetersPanel.js';
import { projectManager } from './project/ProjectManager.js';
import { EDITOR_EVENTS } from './core/Constants.js';
import { renderAheadManager } from './media/RenderAheadManager.js';
import { conformEncoder } from './media/ConformEncoder.js';
import { sequenceSettingsPanel } from './ui/SequenceSettingsPanel.js';
import { waveformCanvasPool } from './ui/CanvasPool.js';
import { rafScheduler } from './core/RafScheduler.js';
// Register all effects (side-effect imports)
import './effects/VideoEffects.js';
import './effects/AudioEffects.js';
import './effects/Transitions.js';

let initialized = false;

function tryInit(name, fn) {
  try {
    fn();
  } catch (err) {
    logger.error(`[Editor] Failed to init ${name}:`, err);
  }
}

export function initEditor() {
  if (initialized) return;

  const container = document.getElementById('video-editor');
  if (!container) {
    logger.error('[Editor] Container #video-editor not found');
    return;
  }

  logger.info('[Editor] Initializing video editor...');

  // Init timeline model
  tryInit('TimelineEngine', () => {
    timelineEngine.init();
  });

  // Init dock manager (must be first UI module -- extracts panels & builds layout)
  tryInit('DockManager', () => {
    dockManager.init(container.querySelector('.nle-editor'));
  });

  // Init menu bar
  tryInit('MenuBar', () => {
    const el = container.querySelector('.nle-menubar');
    if (!el) { logger.warn('[Editor] .nle-menubar not found, skipping MenuBar'); return; }
    menuBar.init(el);
  });

  // Init program monitor
  tryInit('ProgramMonitor', () => {
    const el = dockManager.getPanelContentEl('program-monitor');
    if (!el) { logger.warn('[Editor] program-monitor panel not found, skipping ProgramMonitor'); return; }
    programMonitor.init(el);
  });

  // Init source monitor
  tryInit('SourceMonitor', () => {
    const el = dockManager.getPanelContentEl('source-monitor');
    if (!el) { logger.warn('[Editor] source-monitor panel not found, skipping SourceMonitor'); return; }
    sourceMonitor.init(el);
  });

  // Init project panel
  tryInit('ProjectPanel', () => {
    const el = dockManager.getPanelContentEl('project');
    if (!el) { logger.warn('[Editor] project panel not found, skipping ProjectPanel'); return; }
    projectPanel.init(el);
  });

  // Init effects panel
  tryInit('EffectsPanel', () => {
    const el = dockManager.getPanelContentEl('effects');
    if (!el) { logger.warn('[Editor] effects panel not found, skipping EffectsPanel'); return; }
    effectsPanel.init(el);
  });

  // Init audio meters panel
  tryInit('AudioMetersPanel', () => {
    const el = dockManager.getPanelContentEl('audio-meters');
    if (!el) { logger.warn('[Editor] audio-meters panel not found, skipping AudioMetersPanel'); return; }
    audioMetersPanel.init(el);
  });

  // Init properties panel (basic clip info)
  tryInit('PropertiesPanel', () => {
    const el = dockManager.getPanelContentEl('properties');
    if (!el) { logger.warn('[Editor] properties panel not found, skipping BasicPropertiesPanel'); return; }
    basicPropertiesPanel.init(el);
  });

  // Init effect controls panel (split-panel with keyframe timeline)
  tryInit('EffectControls', () => {
    const el = dockManager.getPanelContentEl('effect-controls');
    if (!el) { logger.warn('[Editor] effect-controls panel not found, skipping PropertiesPanel'); return; }
    propertiesPanel.init(el);
  });

  // Init timeline (content lives inside the timeline panel content element)
  tryInit('TimelineUI', () => {
    const timelineContent = dockManager.getPanelContentEl('timeline');
    const el = timelineContent?.querySelector('.nle-timeline-panel');
    if (!el) { logger.warn('[Editor] .nle-timeline-panel not found, skipping TimelineUI'); return; }
    timelineUI.init(el);
  });

  // Init transport controls
  tryInit('TransportControls', () => {
    const timelineContent = dockManager.getPanelContentEl('timeline');
    const el = timelineContent?.querySelector('.nle-transport');
    if (!el) { logger.warn('[Editor] .nle-transport not found, skipping TransportControls'); return; }
    transportControls.init(el);
  });

  // Init toolbar
  tryInit('Toolbar', () => {
    const timelineContent = dockManager.getPanelContentEl('timeline');
    const el = timelineContent?.querySelector('.nle-toolbar');
    if (!el) { logger.warn('[Editor] .nle-toolbar not found, skipping Toolbar'); return; }
    toolbar.init(el);
  });

  // Init timeline toolbar (snap, linked selection, markers, display settings)
  tryInit('TimelineToolbar', () => {
    const timelineContent = dockManager.getPanelContentEl('timeline');
    const el = timelineContent?.querySelector('.nle-timeline-toolbar');
    if (!el) { logger.warn('[Editor] .nle-timeline-toolbar not found, skipping TimelineToolbar'); return; }
    timelineToolbar.init(el);
  });

  // Init render-ahead manager (decode worker + buffer)
  tryInit('RenderAheadManager', () => {
    renderAheadManager.init();
  });

  // Init conform encoder (pre-encode at sequence settings during idle)
  tryInit('ConformEncoder', () => {
    conformEncoder.init();
  });

  // Init sequence settings panel
  tryInit('SequenceSettingsPanel', () => {
    const el = dockManager.getPanelContentEl('sequence-settings');
    if (!el) { logger.warn('[Editor] sequence-settings panel not found, skipping SequenceSettingsPanel'); return; }
    sequenceSettingsPanel.init(el);
  });

  // Init playback engine (register with RAF scheduler)
  tryInit('PlaybackEngine', () => {
    playbackEngine.init();
  });

  // Init audio mixer
  tryInit('AudioMixer', () => {
    audioMixer.init();
  });

  // Init keyboard shortcuts
  tryInit('KeyboardShortcuts', () => {
    keyboardShortcuts.init();
  });

  // Export button
  const exportBtn = container.querySelector('.nle-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportDialog.show();
    });
  }

  // Save button
  const saveBtn = container.querySelector('.nle-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        await projectManager.save();
        logger.info('[Editor] Project saved');
      } catch (err) {
        logger.error('[Editor] Save failed:', err);
      }
    });
  }

  // Back button
  const backBtn = container.querySelector('.nle-back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      exitEditor();
    });
  }

  // Undo / Redo buttons
  const undoBtn = container.querySelector('.nle-undo-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => history.undo());
  }
  const redoBtn = container.querySelector('.nle-redo-btn');
  if (redoBtn) {
    redoBtn.addEventListener('click', () => history.redo());
  }

  // Snap button
  const snapBtn = container.querySelector('.nle-snap-btn');
  if (snapBtn) {
    snapBtn.addEventListener('click', () => {
      const snap = !editorState.get('ui.snapEnabled');
      editorState.set('ui.snapEnabled', snap);
      snapBtn.classList.toggle('active', snap);
    });
  }

  // Start autosave
  tryInit('ProjectManager autosave', () => {
    projectManager.startAutosave();
  });

  initialized = true;
  logger.info('[Editor] Video editor initialized');
}

export function exitEditor() {
  playbackEngine.pause();
}

export function destroyEditor() {
  if (!initialized) return;
  logger.info('[Editor] Destroying editor...');

  playbackEngine.pause();
  projectManager.stopAutosave();
  audioMetersPanel.destroy();
  propertiesPanel.destroy();
  basicPropertiesPanel.destroy();
  sequenceSettingsPanel.destroy();
  dockManager.destroy();
  timelineToolbar.cleanup();
  rafScheduler.cleanup();
  waveformCanvasPool.cleanup();
  conformEncoder.cleanup();
  renderAheadManager.cleanup();
  videoCompositor.cleanup();
  audioMixer.cleanup();
  mediaManager.cleanup();
  keyboardShortcuts.cleanup();
  eventBus.removeAll();
  history.clear();

  initialized = false;
  logger.info('[Editor] Editor destroyed');
}

// Keep cleanupEditor as alias for backwards compatibility
export const cleanupEditor = destroyEditor;

export default { initEditor, exitEditor, destroyEditor, cleanupEditor };
