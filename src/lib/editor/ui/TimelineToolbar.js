// Premiere Pro-style timeline toolbar (snap, linked selection, markers, display settings)
import { editorState } from '../core/EditorState.js';
import { markerManager } from '../timeline/Markers.js';

const ICONS = {
  nest: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="8" height="8" rx="1"/><rect x="5" y="1" width="8" height="8" rx="1"/></svg>',
  snap: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 1v12"/><path d="M3 4l4-3 4 3"/><path d="M3 10l4 3 4-3"/></svg>',
  linked: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a3 3 0 004-1l1.5-1.5a3 3 0 00-4.24-4.24L6 2.5"/><path d="M8 6a3 3 0 00-4 1L2.5 8.5a3 3 0 004.24 4.24L8 11.5"/></svg>',
  marker: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 1l2.5 4.5H11L7 13 3 5.5h1.5z"/></svg>',
  wrench: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 1.5a4 4 0 00-5 5l-2 5.5 5.5-2a4 4 0 005-5"/><circle cx="8" cy="6" r="1"/></svg>',
  cc: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="12" height="8" rx="1.5"/><path d="M5.5 6a1 1 0 10 0 2"/><path d="M9.5 6a1 1 0 10 0 2"/></svg>'
};

let _container = null;
let _dropdown = null;
let _unsubs = [];
let _outsideClickHandler = null;
let _escHandler = null;

function _createToggleButton(parent, { icon, title, statePath }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nle-tl-toolbar-btn';
  btn.title = title;
  btn.innerHTML = icon;

  // Sync initial state
  if (editorState.get(statePath)) btn.classList.add('active');

  btn.addEventListener('click', () => {
    const next = !editorState.get(statePath);
    editorState.set(statePath, next);
  });

  const unsub = editorState.subscribe(statePath, (val) => {
    btn.classList.toggle('active', !!val);
  });
  _unsubs.push(unsub);

  parent.appendChild(btn);
  return btn;
}

function _createActionButton(parent, { icon, title, action }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nle-tl-toolbar-btn';
  btn.title = title;
  btn.innerHTML = icon;
  btn.addEventListener('click', action);
  parent.appendChild(btn);
  return btn;
}

function _dismissDropdown() {
  if (_dropdown) {
    _dropdown.remove();
    _dropdown = null;
  }
  if (_outsideClickHandler) {
    document.removeEventListener('mousedown', _outsideClickHandler, true);
    _outsideClickHandler = null;
  }
  if (_escHandler) {
    document.removeEventListener('keydown', _escHandler);
    _escHandler = null;
  }
}

function _toggleSettingsDropdown(e) {
  if (_dropdown) {
    _dismissDropdown();
    return;
  }

  const triggerBtn = e.currentTarget;
  const rect = triggerBtn.getBoundingClientRect();
  _dropdown = document.createElement('div');
  _dropdown.className = 'nle-tl-settings-dropdown';
  _dropdown.style.left = `${rect.left}px`;
  _dropdown.style.top = `${rect.bottom + 2}px`;

  const items = [
    { label: 'Show Thumbnails', statePath: 'ui.showThumbnails' },
    { label: 'Show Waveforms', statePath: 'ui.showWaveforms' },
    { label: 'Show Duplicate Frame Markers', statePath: 'ui.showDuplicateFrames' }
  ];

  for (const item of items) {
    const row = document.createElement('label');
    row.className = 'nle-tl-settings-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!editorState.get(item.statePath);
    cb.addEventListener('change', () => {
      editorState.set(item.statePath, cb.checked);
    });

    const span = document.createElement('span');
    span.textContent = item.label;

    row.appendChild(cb);
    row.appendChild(span);
    _dropdown.appendChild(row);
  }

  document.body.appendChild(_dropdown);

  // Dismiss on outside click (capture triggerBtn ref — e.currentTarget is null after dispatch)
  _outsideClickHandler = (ev) => {
    if (_dropdown && !_dropdown.contains(ev.target) && !triggerBtn.contains(ev.target)) {
      _dismissDropdown();
    }
  };
  // Use setTimeout to avoid the current click triggering immediate dismiss
  setTimeout(() => {
    document.addEventListener('mousedown', _outsideClickHandler, true);
  }, 0);

  // Dismiss on Escape
  _escHandler = (ev) => {
    if (ev.key === 'Escape') _dismissDropdown();
  };
  document.addEventListener('keydown', _escHandler);
}

function _syncDisplayClasses() {
  const panel = _container?.closest('.nle-timeline-panel');
  if (!panel) return;
  panel.classList.toggle('hide-thumbnails', !editorState.get('ui.showThumbnails'));
  panel.classList.toggle('hide-waveforms', !editorState.get('ui.showWaveforms'));
}

export const timelineToolbar = {
  init(container) {
    _container = container;
    _container.innerHTML = '';

    const left = document.createElement('div');
    left.className = 'nle-tl-toolbar-left';

    // 1. Nest Sequences (placeholder toggle)
    _createToggleButton(left, {
      icon: ICONS.nest,
      title: 'Nest Sequences',
      statePath: 'ui.nestSequences'
    });

    // 2. Snap
    _createToggleButton(left, {
      icon: ICONS.snap,
      title: 'Snap (S)',
      statePath: 'ui.snapEnabled'
    });

    // 3. Linked Selection
    _createToggleButton(left, {
      icon: ICONS.linked,
      title: 'Linked Selection',
      statePath: 'ui.linkedSelection'
    });

    // 4. Add Marker
    _createActionButton(left, {
      icon: ICONS.marker,
      title: 'Add Marker (M)',
      action: () => markerManager.addMarkerAtPlayhead()
    });

    // 5. Display Settings (wrench dropdown)
    _createActionButton(left, {
      icon: ICONS.wrench,
      title: 'Timeline Display Settings',
      action: _toggleSettingsDropdown
    });

    // 6. CC (placeholder toggle)
    _createToggleButton(left, {
      icon: ICONS.cc,
      title: 'Closed Captions',
      statePath: 'ui.showCaptions'
    });

    _container.appendChild(left);

    // Apply initial display classes + subscribe to changes from outside
    _syncDisplayClasses();
    _unsubs.push(editorState.subscribe('ui.showThumbnails', _syncDisplayClasses));
    _unsubs.push(editorState.subscribe('ui.showWaveforms', _syncDisplayClasses));
  },

  cleanup() {
    _dismissDropdown();
    for (const unsub of _unsubs) unsub();
    _unsubs = [];
    _container = null;
  }
};

export default timelineToolbar;
