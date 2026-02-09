// Transform controls overlay for Program Monitor
// Draws bounding box, scale handles, rotation handle, and anchor point
// over the display canvas. Captures mouse events for direct manipulation.
import { eventBus } from '../core/EventBus.js';
import { EDITOR_EVENTS, TRACK_TYPES } from '../core/Constants.js';
import { editorState } from '../core/EditorState.js';
import { timelineEngine } from '../timeline/TimelineEngine.js';
import { getIntrinsicEffect, clipContainsFrame } from '../timeline/Clip.js';
import { keyframeEngine } from '../effects/KeyframeEngine.js';
import { history } from '../core/History.js';
import { programMonitor } from './ProgramMonitor.js';
import logger from '../../utils/logger.js';

const HANDLE = {
  NONE: 'none',
  MOVE: 'move',
  SCALE_TL: 'scale-tl',
  SCALE_TR: 'scale-tr',
  SCALE_BL: 'scale-bl',
  SCALE_BR: 'scale-br',
  SCALE_T: 'scale-t',
  SCALE_R: 'scale-r',
  SCALE_B: 'scale-b',
  SCALE_L: 'scale-l',
  ROTATE: 'rotate',
  ANCHOR: 'anchor'
};

const CORNER_SIZE = 8;
const EDGE_SIZE = 6;
const ANCHOR_RADIUS = 6;
const ROTATE_DISTANCE = 30;
const HIT_RADIUS = 10;

const COLORS = {
  BOX: '#00a8ff',
  HANDLE_FILL: '#ffffff',
  HANDLE_STROKE: '#00a8ff',
  ANCHOR: '#ff6600',
  ROTATE_LINE: '#00a8ff'
};

const CURSORS = {
  [HANDLE.MOVE]: 'move',
  [HANDLE.SCALE_TL]: 'nwse-resize',
  [HANDLE.SCALE_BR]: 'nwse-resize',
  [HANDLE.SCALE_TR]: 'nesw-resize',
  [HANDLE.SCALE_BL]: 'nesw-resize',
  [HANDLE.SCALE_T]: 'ns-resize',
  [HANDLE.SCALE_B]: 'ns-resize',
  [HANDLE.SCALE_L]: 'ew-resize',
  [HANDLE.SCALE_R]: 'ew-resize',
  [HANDLE.ROTATE]: 'crosshair',
  [HANDLE.ANCHOR]: 'crosshair'
};

export const transformOverlay = {
  _canvas: null,
  _ctx: null,
  _resizeObserver: null,
  _listeners: [],
  _previewArea: null,
  _displayCanvas: null,

  // Coordinate mapping
  _offsetX: 0,
  _offsetY: 0,
  _scaleX: 1,
  _scaleY: 1,
  _previewRect: null,

  // Selected clip state
  _clip: null,
  _motionFx: null,
  _params: null,

  // Drag state
  _dragging: false,
  _activeHandle: HANDLE.NONE,
  _dragStartMouse: null,
  _dragStartParams: null,
  _dragStartKeyframes: null,
  _dragStartAngle: 0,
  _dragStartDist: 0,
  _rafPending: false,

  // Bound handlers
  _onMouseDown: null,
  _onMouseMove: null,
  _onMouseUp: null,
  _onKeyDown: null,

  init(container) {
    this._previewArea = programMonitor._previewArea;
    this._displayCanvas = programMonitor._displayCanvas;
    if (!this._previewArea || !this._displayCanvas) {
      logger.warn('[TransformOverlay] Preview area or display canvas not found');
      return;
    }

    // Create overlay canvas
    this._canvas = document.createElement('canvas');
    this._canvas.className = 'nle-transform-overlay';
    this._previewArea.appendChild(this._canvas);
    this._ctx = this._canvas.getContext('2d');

    // Resize observer
    this._resizeObserver = new ResizeObserver(() => {
      this._sizeCanvas();
      this._updateMapping();
      this._draw();
    });
    this._resizeObserver.observe(this._previewArea);
    this._sizeCanvas();
    this._updateMapping();

    // Bind mouse handlers
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);

    this._canvas.addEventListener('mousedown', this._onMouseDown);
    this._canvas.addEventListener('mousemove', this._onMouseMove);

    // Event subscriptions
    const redraw = () => this._onSelectionOrFrame();
    const redrawIfNotDragging = () => { if (!this._dragging) this._onSelectionOrFrame(); };

    const events = [
      [EDITOR_EVENTS.CLIP_SELECTED, redraw],
      [EDITOR_EVENTS.CLIP_DESELECTED, redraw],
      [EDITOR_EVENTS.SELECTION_CHANGED, redraw],
      [EDITOR_EVENTS.PLAYBACK_FRAME, redraw],
      [EDITOR_EVENTS.PLAYBACK_SEEK, redraw],
      [EDITOR_EVENTS.TIMELINE_UPDATED, redrawIfNotDragging],
      [EDITOR_EVENTS.SEQUENCE_ACTIVATED, () => {
        this._sizeCanvas();
        this._updateMapping();
        this._onSelectionOrFrame();
      }]
    ];

    for (const [evt, fn] of events) {
      eventBus.on(evt, fn);
    }
    this._listeners = events;

    this._onSelectionOrFrame();
  },

  cleanup() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._canvas) {
      this._canvas.removeEventListener('mousedown', this._onMouseDown);
      this._canvas.removeEventListener('mousemove', this._onMouseMove);
      this._canvas.remove();
      this._canvas = null;
    }
    this._stopDrag(true);
    for (const [evt, fn] of this._listeners) {
      eventBus.off(evt, fn);
    }
    this._listeners = [];
    this._clip = null;
    this._motionFx = null;
    this._params = null;
  },

  // ── Canvas Sizing ──

  _sizeCanvas() {
    if (!this._canvas || !this._previewArea) return;
    const rect = this._previewArea.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = Math.round(rect.width * dpr);
    this._canvas.height = Math.round(rect.height * dpr);
    this._canvas.style.width = rect.width + 'px';
    this._canvas.style.height = rect.height + 'px';
    if (this._ctx) this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  // ── Coordinate Mapping ──

  _updateMapping() {
    if (!this._displayCanvas || !this._previewArea) return;
    const proj = editorState.get('project.canvas');
    if (!proj) return;

    const canvasRect = this._displayCanvas.getBoundingClientRect();
    const previewRect = this._previewArea.getBoundingClientRect();

    this._previewRect = previewRect;
    this._offsetX = canvasRect.left - previewRect.left;
    this._offsetY = canvasRect.top - previewRect.top;
    this._scaleX = proj.width / canvasRect.width;
    this._scaleY = proj.height / canvasRect.height;
  },

  _screenToProject(screenX, screenY) {
    const relX = screenX - this._previewRect.left - this._offsetX;
    const relY = screenY - this._previewRect.top - this._offsetY;
    return { x: relX * this._scaleX, y: relY * this._scaleY };
  },

  _projectToScreen(projX, projY) {
    return {
      x: projX / this._scaleX + this._offsetX,
      y: projY / this._scaleY + this._offsetY
    };
  },

  // ── Selected Clip Resolution ──

  _resolveSelectedClip() {
    const selectedIds = editorState.get('selection.clipIds') || [];
    if (selectedIds.length === 0) {
      this._clip = null;
      this._motionFx = null;
      this._params = null;
      return;
    }

    const frame = editorState.get('playback.currentFrame') || 0;
    const videoTracks = timelineEngine.getVideoTracks();
    let bestClip = null;
    let fallbackClip = null;

    // Iterate tracks top-down (last track = topmost visually)
    for (let i = videoTracks.length - 1; i >= 0; i--) {
      const track = videoTracks[i];
      for (const clip of track.clips) {
        if (!selectedIds.includes(clip.id)) continue;
        if (!fallbackClip) fallbackClip = clip;
        if (clipContainsFrame(clip, frame)) {
          bestClip = clip;
          break;
        }
      }
      if (bestClip) break;
    }

    this._clip = bestClip || fallbackClip;
    if (this._clip) {
      this._motionFx = getIntrinsicEffect(this._clip, 'motion');
      this._resolveParams();
    } else {
      this._motionFx = null;
      this._params = null;
    }
  },

  _resolveParams() {
    if (!this._motionFx) { this._params = null; return; }
    const frame = editorState.get('playback.currentFrame') || 0;
    this._params = keyframeEngine.resolveParams(this._motionFx, frame);
  },

  _onSelectionOrFrame() {
    this._updateMapping();
    this._resolveSelectedClip();
    this._updatePointerEvents();
    this._draw();
  },

  _updatePointerEvents() {
    if (!this._canvas) return;
    this._canvas.style.pointerEvents = this._clip ? 'auto' : 'none';
  },

  // ── Bounding Box Geometry ──

  _getTransformedCorners() {
    if (!this._params) return null;
    const proj = editorState.get('project.canvas');
    if (!proj) return null;

    const { posX, posY, scale, scaleWidth, uniformScale, rotation, anchorX, anchorY } = this._params;
    const sy = scale / 100;
    const sx = uniformScale ? sy : scaleWidth / 100;
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const corners = [
      { x: 0, y: 0 },
      { x: proj.width, y: 0 },
      { x: proj.width, y: proj.height },
      { x: 0, y: proj.height }
    ];

    return corners.map(c => {
      const lx = (c.x - anchorX) * sx;
      const ly = (c.y - anchorY) * sy;
      return {
        x: lx * cos - ly * sin + posX,
        y: lx * sin + ly * cos + posY
      };
    });
  },

  _getMidpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  },

  // ── Hit Testing ──

  _hitTest(screenX, screenY) {
    if (!this._params || !this._clip) return HANDLE.NONE;

    const corners = this._getTransformedCorners();
    if (!corners) return HANDLE.NONE;

    // Convert corners to screen coords
    const sc = corners.map(c => this._projectToScreen(c.x, c.y));
    const midT = this._getMidpoint(sc[0], sc[1]);
    const midR = this._getMidpoint(sc[1], sc[2]);
    const midB = this._getMidpoint(sc[2], sc[3]);
    const midL = this._getMidpoint(sc[3], sc[0]);

    const topCenter = this._getMidpoint(sc[0], sc[1]);
    const anchorScreen = this._projectToScreen(this._params.anchorX, this._params.anchorY);

    // Rotation handle position: 30px above top center along the up direction
    const rad = (this._params.rotation * Math.PI) / 180;
    const rotPt = {
      x: topCenter.x - Math.sin(rad) * ROTATE_DISTANCE,
      y: topCenter.y - Math.cos(rad) * ROTATE_DISTANCE
    };

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const mx = screenX - this._previewRect.left;
    const my = screenY - this._previewRect.top;
    const mouse = { x: mx, y: my };

    // Priority: anchor > rotation > corners > edges > inside
    if (dist(mouse, { x: anchorScreen.x, y: anchorScreen.y }) < HIT_RADIUS) return HANDLE.ANCHOR;
    if (dist(mouse, rotPt) < HIT_RADIUS) return HANDLE.ROTATE;

    if (dist(mouse, sc[0]) < HIT_RADIUS) return HANDLE.SCALE_TL;
    if (dist(mouse, sc[1]) < HIT_RADIUS) return HANDLE.SCALE_TR;
    if (dist(mouse, sc[2]) < HIT_RADIUS) return HANDLE.SCALE_BR;
    if (dist(mouse, sc[3]) < HIT_RADIUS) return HANDLE.SCALE_BL;

    if (dist(mouse, midT) < HIT_RADIUS) return HANDLE.SCALE_T;
    if (dist(mouse, midR) < HIT_RADIUS) return HANDLE.SCALE_R;
    if (dist(mouse, midB) < HIT_RADIUS) return HANDLE.SCALE_B;
    if (dist(mouse, midL) < HIT_RADIUS) return HANDLE.SCALE_L;

    // Point-in-quad test (cross product winding)
    if (this._pointInQuad(mouse, sc)) return HANDLE.MOVE;

    return HANDLE.NONE;
  },

  _pointInQuad(p, quad) {
    // Uses cross product sign to check if point is on the same side of all edges
    for (let i = 0; i < 4; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % 4];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (cross < 0) return false;
    }
    return true;
  },

  // ── Mouse Handlers ──

  _handleMouseDown(e) {
    if (e.button !== 0) return;
    this._updateMapping();
    const handle = this._hitTest(e.clientX, e.clientY);
    if (handle === HANDLE.NONE) return;

    e.preventDefault();
    e.stopPropagation();

    this._activeHandle = handle;
    this._dragging = true;
    this._dragStartMouse = { x: e.clientX, y: e.clientY };

    // Snapshot params for undo
    this._dragStartParams = { ...this._motionFx.params };
    this._dragStartKeyframes = this._snapshotKeyframes(this._motionFx.keyframes);

    // Handle-specific start data
    if (handle === HANDLE.ROTATE) {
      const anchorScreen = this._projectToScreen(this._params.anchorX, this._params.anchorY);
      const mx = e.clientX - this._previewRect.left;
      const my = e.clientY - this._previewRect.top;
      this._dragStartAngle = Math.atan2(my - anchorScreen.y, mx - anchorScreen.x);
    } else if (handle.startsWith('scale')) {
      const anchorScreen = this._projectToScreen(this._params.anchorX, this._params.anchorY);
      const mx = e.clientX - this._previewRect.left;
      const my = e.clientY - this._previewRect.top;
      this._dragStartDist = Math.hypot(mx - anchorScreen.x, my - anchorScreen.y);
    }

    // Global listeners for drag
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('keydown', this._onKeyDown);
  },

  _handleMouseMove(e) {
    if (!this._dragging) {
      // Hover cursor
      this._updateMapping();
      const handle = this._hitTest(e.clientX, e.clientY);
      this._canvas.style.cursor = CURSORS[handle] || 'default';
      return;
    }

    e.preventDefault();
    const proj = this._screenToProject(e.clientX, e.clientY);
    const startProj = this._screenToProject(this._dragStartMouse.x, this._dragStartMouse.y);
    const dp = this._dragStartParams;

    switch (this._activeHandle) {
      case HANDLE.MOVE: {
        const dx = proj.x - startProj.x;
        const dy = proj.y - startProj.y;
        this._updateParam('posX', dp.posX + dx);
        this._updateParam('posY', dp.posY + dy);
        break;
      }

      case HANDLE.SCALE_TL:
      case HANDLE.SCALE_TR:
      case HANDLE.SCALE_BL:
      case HANDLE.SCALE_BR: {
        const anchorScreen = this._projectToScreen(this._params.anchorX, this._params.anchorY);
        const mx = e.clientX - this._previewRect.left;
        const my = e.clientY - this._previewRect.top;
        const currentDist = Math.hypot(mx - anchorScreen.x, my - anchorScreen.y);
        if (this._dragStartDist > 1) {
          const ratio = currentDist / this._dragStartDist;
          this._updateParam('scale', dp.scale * ratio);
          if (!dp.uniformScale) {
            this._updateParam('scaleWidth', dp.scaleWidth * ratio);
          }
        }
        break;
      }

      case HANDLE.SCALE_T:
      case HANDLE.SCALE_B: {
        // Project mouse delta onto the clip's local Y axis (rotated)
        const dx = proj.x - startProj.x;
        const dy = proj.y - startProj.y;
        const rad = (dp.rotation * Math.PI) / 180;
        // Local Y component of the delta
        const localDy = -dx * Math.sin(rad) + dy * Math.cos(rad);
        const projH = editorState.get('project.canvas').height;
        const baseExtent = projH * (dp.scale / 100) / 2;
        if (baseExtent > 1) {
          const sign = this._activeHandle === HANDLE.SCALE_T ? -1 : 1;
          const newScale = dp.scale * (1 + sign * localDy / baseExtent) / 1;
          this._updateParam('scale', Math.max(1, newScale));
        }
        break;
      }

      case HANDLE.SCALE_L:
      case HANDLE.SCALE_R: {
        const dx = proj.x - startProj.x;
        const dy = proj.y - startProj.y;
        const rad = (dp.rotation * Math.PI) / 180;
        const localDx = dx * Math.cos(rad) + dy * Math.sin(rad);
        const projW = editorState.get('project.canvas').width;
        const sw = dp.uniformScale ? dp.scale : dp.scaleWidth;
        const baseExtent = projW * (sw / 100) / 2;
        if (baseExtent > 1) {
          const sign = this._activeHandle === HANDLE.SCALE_L ? -1 : 1;
          const newSW = sw * (1 + sign * localDx / baseExtent) / 1;
          if (dp.uniformScale) {
            this._updateParam('scale', Math.max(1, newSW));
          } else {
            this._updateParam('scaleWidth', Math.max(1, newSW));
          }
        }
        break;
      }

      case HANDLE.ROTATE: {
        const anchorScreen = this._projectToScreen(this._params.anchorX, this._params.anchorY);
        const mx = e.clientX - this._previewRect.left;
        const my = e.clientY - this._previewRect.top;
        const currentAngle = Math.atan2(my - anchorScreen.y, mx - anchorScreen.x);
        let delta = ((currentAngle - this._dragStartAngle) * 180) / Math.PI;
        // Shift constrains to 45 degrees
        if (e.shiftKey) {
          const total = dp.rotation + delta;
          delta = Math.round(total / 45) * 45 - dp.rotation;
        }
        this._updateParam('rotation', dp.rotation + delta);
        break;
      }

      case HANDLE.ANCHOR: {
        // Move anchor to mouse position in project coords, compensate position
        const newAnchorX = proj.x;
        const newAnchorY = proj.y;

        // Compute the world offset from old anchor to new anchor
        const oldAX = dp.anchorX;
        const oldAY = dp.anchorY;
        const sy = dp.scale / 100;
        const sx = dp.uniformScale ? sy : dp.scaleWidth / 100;
        const rad = (dp.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // Old anchor in world: posX, posY (by definition, since transform is translate(pos) then translate(-anchor))
        // New anchor in world: apply transform to newAnchor
        const dx = (newAnchorX - oldAX) * sx;
        const dy = (newAnchorY - oldAY) * sy;
        const worldDx = dx * cos - dy * sin;
        const worldDy = dx * sin + dy * cos;

        this._updateParam('anchorX', newAnchorX);
        this._updateParam('anchorY', newAnchorY);
        this._updateParam('posX', dp.posX + worldDx);
        this._updateParam('posY', dp.posY + worldDy);
        break;
      }
    }

    this._scheduleUpdate();
  },

  _handleMouseUp(e) {
    if (!this._dragging) return;
    e.preventDefault();
    this._stopDrag(false);
  },

  _handleKeyDown(e) {
    if (e.key === 'Escape' && this._dragging) {
      e.preventDefault();
      // Revert to pre-drag state
      if (this._motionFx && this._dragStartParams) {
        Object.assign(this._motionFx.params, this._dragStartParams);
        if (this._dragStartKeyframes) {
          this._motionFx.keyframes = this._dragStartKeyframes;
        }
        this._resolveParams();
        eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
      }
      this._stopDrag(true);
    }
  },

  _stopDrag(cancelled) {
    if (!this._dragging && !cancelled) return;

    if (!cancelled && this._motionFx && this._dragStartParams) {
      // Push undo command
      const fx = this._motionFx;
      const beforeParams = { ...this._dragStartParams };
      const afterParams = { ...fx.params };
      const beforeKf = this._dragStartKeyframes;
      const afterKf = this._snapshotKeyframes(fx.keyframes);

      history.pushWithoutExecute({
        description: 'Transform clip',
        execute() {
          Object.assign(fx.params, afterParams);
          fx.keyframes = afterKf;
          eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
        },
        undo() {
          Object.assign(fx.params, beforeParams);
          fx.keyframes = beforeKf;
          eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
        }
      });
    }

    this._dragging = false;
    this._activeHandle = HANDLE.NONE;
    this._dragStartMouse = null;
    this._dragStartParams = null;
    this._dragStartKeyframes = null;

    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('keydown', this._onKeyDown);

    this._draw();
  },

  // ── Param Update ──

  _updateParam(paramId, value) {
    if (!this._motionFx) return;
    this._motionFx.params[paramId] = value;

    // If param is keyframed, also add/update keyframe at current frame
    const kfs = this._motionFx.keyframes[paramId];
    if (kfs && kfs.length > 0) {
      const frame = editorState.get('playback.currentFrame') || 0;
      keyframeEngine.addKeyframe(kfs, frame, value);
    }

    this._resolveParams();
  },

  _scheduleUpdate() {
    if (this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      eventBus.emit(EDITOR_EVENTS.TIMELINE_UPDATED);
      this._draw();
    });
  },

  // ── Keyframe Snapshot ──

  _snapshotKeyframes(kfObj) {
    if (!kfObj) return {};
    const snap = {};
    for (const [key, arr] of Object.entries(kfObj)) {
      snap[key] = arr.map(kf => ({ ...kf }));
    }
    return snap;
  },

  // ── Drawing ──

  _draw() {
    if (!this._ctx || !this._canvas) return;
    const w = this._canvas.width / (window.devicePixelRatio || 1);
    const h = this._canvas.height / (window.devicePixelRatio || 1);
    this._ctx.clearRect(0, 0, w, h);

    if (!this._clip || !this._params) return;

    const corners = this._getTransformedCorners();
    if (!corners) return;

    const sc = corners.map(c => this._projectToScreen(c.x, c.y));
    const midT = this._getMidpoint(sc[0], sc[1]);
    const midR = this._getMidpoint(sc[1], sc[2]);
    const midB = this._getMidpoint(sc[2], sc[3]);
    const midL = this._getMidpoint(sc[3], sc[0]);
    const topCenter = this._getMidpoint(sc[0], sc[1]);
    const anchorScreen = this._projectToScreen(this._params.anchorX, this._params.anchorY);

    const rad = (this._params.rotation * Math.PI) / 180;
    const rotPt = {
      x: topCenter.x - Math.sin(rad) * ROTATE_DISTANCE,
      y: topCenter.y - Math.cos(rad) * ROTATE_DISTANCE
    };

    const ctx = this._ctx;

    // 1. Bounding box outline
    ctx.beginPath();
    ctx.moveTo(sc[0].x, sc[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(sc[i].x, sc[i].y);
    ctx.closePath();
    ctx.strokeStyle = COLORS.BOX;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 2. Rotation handle line + circle
    ctx.beginPath();
    ctx.moveTo(topCenter.x, topCenter.y);
    ctx.lineTo(rotPt.x, rotPt.y);
    ctx.strokeStyle = COLORS.ROTATE_LINE;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(rotPt.x, rotPt.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.HANDLE_FILL;
    ctx.fill();
    ctx.strokeStyle = COLORS.HANDLE_STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 3. Corner handles
    for (const pt of sc) {
      this._drawSquareHandle(ctx, pt.x, pt.y, CORNER_SIZE);
    }

    // 4. Edge midpoint handles
    for (const pt of [midT, midR, midB, midL]) {
      this._drawSquareHandle(ctx, pt.x, pt.y, EDGE_SIZE);
    }

    // 5. Anchor crosshair + circle
    const ax = anchorScreen.x;
    const ay = anchorScreen.y;
    const cr = ANCHOR_RADIUS;

    ctx.beginPath();
    ctx.arc(ax, ay, cr, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.ANCHOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Crosshair lines
    ctx.beginPath();
    ctx.moveTo(ax - cr - 3, ay);
    ctx.lineTo(ax + cr + 3, ay);
    ctx.moveTo(ax, ay - cr - 3);
    ctx.lineTo(ax, ay + cr + 3);
    ctx.strokeStyle = COLORS.ANCHOR;
    ctx.lineWidth = 1;
    ctx.stroke();
  },

  _drawSquareHandle(ctx, cx, cy, size) {
    const half = size / 2;
    ctx.fillStyle = COLORS.HANDLE_FILL;
    ctx.fillRect(cx - half, cy - half, size, size);
    ctx.strokeStyle = COLORS.HANDLE_STROKE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - half, cy - half, size, size);
  }
};

export default transformOverlay;
