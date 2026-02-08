// Premiere Pro tool shortcuts: V A B N C Y U P H Z
import { editorState } from '../core/EditorState.js';
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS, TOOL_TYPES } from '../core/Constants.js';

const TOOLS = [
  { type: TOOL_TYPES.SELECTION,    key: 'V', label: 'Selection' },
  { type: TOOL_TYPES.TRACK_SELECT, key: 'A', label: 'Track Select Forward' },
  { type: TOOL_TYPES.RIPPLE_EDIT,  key: 'B', label: 'Ripple Edit' },
  { type: TOOL_TYPES.ROLLING_EDIT, key: 'N', label: 'Rolling Edit' },
  { type: TOOL_TYPES.RAZOR,        key: 'C', label: 'Razor' },
  { type: TOOL_TYPES.SLIP,         key: 'Y', label: 'Slip' },
  { type: TOOL_TYPES.SLIDE,        key: 'U', label: 'Slide' },
  { type: TOOL_TYPES.PEN,          key: 'P', label: 'Pen' },
  { type: TOOL_TYPES.HAND,         key: 'H', label: 'Hand' },
  { type: TOOL_TYPES.ZOOM,         key: 'Z', label: 'Zoom' }
];

export const toolbar = {
  _container: null,

  init(container) {
    if (!container) {
      this._container = document.querySelector('.nle-toolbar');
    } else {
      this._container = container;
    }
    if (!this._container) return;

    const activeTool = editorState.get('ui.activeTool') || TOOL_TYPES.SELECTION;

    // Wire up existing HTML buttons or create dynamically
    const existingBtns = this._container.querySelectorAll('.nle-tool-btn');
    if (existingBtns.length > 0) {
      existingBtns.forEach(btn => {
        const toolType = btn.dataset.tool;
        btn.classList.toggle('active', toolType === activeTool);
        btn.addEventListener('click', () => this._selectTool(toolType));
      });
    } else {
      for (const tool of TOOLS) {
        const btn = document.createElement('button');
        btn.className = 'nle-tool-btn';
        btn.dataset.tool = tool.type;
        btn.title = `${tool.label} (${tool.key})`;
        btn.innerHTML = `<span class="nle-tool-icon">${tool.key}</span><span class="nle-tool-key">${tool.key}</span>`;
        if (tool.type === activeTool) btn.classList.add('active');
        btn.addEventListener('click', () => this._selectTool(tool.type));
        this._container.appendChild(btn);
      }
    }

    eventBus.on(EDITOR_EVENTS.TOOL_CHANGED, ({ tool }) => {
      this._updateActive(tool);
    });
  },

  _selectTool(toolType) {
    editorState.set('ui.activeTool', toolType);
    eventBus.emit(EDITOR_EVENTS.TOOL_CHANGED, { tool: toolType });
  },

  _updateActive(toolType) {
    if (!this._container) return;
    this._container.querySelectorAll('.nle-tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === toolType);
    });
  },

  selectToolByKey(key) {
    const tool = TOOLS.find(t => t.key === key.toUpperCase());
    if (tool) this._selectTool(tool.type);
  }
};

export default toolbar;
