// OffscreenCanvas compositor worker — renders video frames off the main thread.
// Receives an OffscreenCanvas, render commands with ImageBitmaps, draws composited result.
// Supports Canvas2D rendering with motion transforms, transitions, crop, opacity.
// WebGL pixel effects via an embedded GLEffectRenderer instance.

import { VERTEX_SHADER, FRAGMENT_SHADERS, getEffectConfig, GL_SUPPORTED_EFFECTS, COMPOSITE_VERT, COMPOSITE_FRAG } from '../effects/effectShaders.js';

// ---- Minimal GLEffectRenderer for the worker context ----
const glRenderer = {
  _gl: null,
  _canvas: null,
  _programs: new Map(),
  _quadVAO: null,
  _sourceTexture: null,
  _fbos: [null, null],
  _fboTextures: [null, null],
  _currentFBO: 0,
  _width: 0,
  _height: 0,
  _initialized: false,

  init() {
    if (this._initialized) return true;
    try {
      this._canvas = new OffscreenCanvas(1, 1);
      this._gl = this._canvas.getContext('webgl2', {
        premultipliedAlpha: false,
        alpha: true,
        preserveDrawingBuffer: true,
        antialias: false
      });
      if (!this._gl) return false;
      this._setupQuad();
      this._initialized = true;
      return true;
    } catch (e) {
      return false;
    }
  },

  _setupQuad() {
    const gl = this._gl;
    const vertices = new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ]);
    this._quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this._quadVAO);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
  },

  _getProgram(shaderId) {
    if (this._programs.has(shaderId)) return this._programs.get(shaderId);
    const fragSrc = FRAGMENT_SHADERS[shaderId];
    if (!fragSrc) return null;
    const program = this._compileProgram(VERTEX_SHADER, fragSrc);
    if (!program) return null;
    const gl = this._gl;
    const uniforms = {};
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    const entry = { program, uniforms };
    this._programs.set(shaderId, entry);
    return entry;
  },

  _compileProgram(vertSrc, fragSrc) {
    const gl = this._gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vertSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      gl.deleteShader(vs);
      return null;
    }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fragSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.bindAttribLocation(program, 1, 'a_texCoord');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return program;
  },

  _resize(width, height) {
    if (this._width === width && this._height === height) return;
    const gl = this._gl;
    this._width = width;
    this._height = height;
    this._canvas.width = width;
    this._canvas.height = height;
    gl.viewport(0, 0, width, height);
    for (let i = 0; i < 2; i++) {
      if (this._fbos[i]) gl.deleteFramebuffer(this._fbos[i]);
      if (this._fboTextures[i]) gl.deleteTexture(this._fboTextures[i]);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this._fboTextures[i] = tex;
      this._fbos[i] = fbo;
    }
    if (!this._sourceTexture) {
      this._sourceTexture = gl.createTexture();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  _getPassthroughProgram() {
    if (this._programs.has('_passthrough')) return this._programs.get('_passthrough');
    const fragSrc = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
void main() {
  fragColor = texture(u_source, v_texCoord);
}`;
    const program = this._compileProgram(VERTEX_SHADER, fragSrc);
    const gl = this._gl;
    const uniforms = {};
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    const entry = { program, uniforms };
    this._programs.set('_passthrough', entry);
    return entry;
  },

  uploadSource(source, width, height) {
    const gl = this._gl;
    this._resize(width, height);
    gl.bindTexture(gl.TEXTURE_2D, this._sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._currentFBO = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbos[0]);
    gl.viewport(0, 0, width, height);
    const passthrough = this._getPassthroughProgram();
    gl.useProgram(passthrough.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._sourceTexture);
    gl.uniform1i(passthrough.uniforms['u_source'], 0);
    gl.bindVertexArray(this._quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  applyEffect(effectId, params) {
    if (!this._initialized || !this._gl) return false;
    const config = getEffectConfig(effectId, params);
    if (!config) return false;
    const gl = this._gl;
    for (const passId of config.passes) {
      const prog = this._getProgram(passId);
      if (!prog) return false;
      const readFBO = this._currentFBO;
      const writeFBO = 1 - readFBO;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbos[writeFBO]);
      gl.viewport(0, 0, this._width, this._height);
      gl.useProgram(prog.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._fboTextures[readFBO]);
      if (prog.uniforms['u_source'] !== undefined) {
        gl.uniform1i(prog.uniforms['u_source'], 0);
      }
      if (prog.uniforms['u_texelSize'] !== undefined) {
        gl.uniform2f(prog.uniforms['u_texelSize'], 1.0 / this._width, 1.0 / this._height);
      }
      for (const [name, value] of Object.entries(config.uniforms)) {
        const loc = prog.uniforms[name];
        if (loc === undefined) continue;
        if (Array.isArray(value)) {
          if (value.length === 2) gl.uniform2fv(loc, value);
          else if (value.length === 3) gl.uniform3fv(loc, value);
          else if (value.length === 4) gl.uniform4fv(loc, value);
        } else {
          gl.uniform1f(loc, value);
        }
      }
      gl.bindVertexArray(this._quadVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this._currentFBO = writeFBO;
    }
    return true;
  },

  readResult(targetCtx) {
    if (!this._initialized || !this._gl) return;
    const gl = this._gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this._width, this._height);
    const passthrough = this._getPassthroughProgram();
    gl.useProgram(passthrough.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._fboTextures[this._currentFBO]);
    gl.uniform1i(passthrough.uniforms['u_source'], 0);
    gl.bindVertexArray(this._quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    targetCtx.drawImage(this._canvas, 0, 0);
  },

  hasShader(effectId) {
    return GL_SUPPORTED_EFFECTS.has(effectId);
  },

  // Composite the current FBO result onto the display canvas with motion transform
  // NOTE: Not currently wired into render path — Canvas2D compositing used instead.
  // GL composite deferred to Phase B due to backbuffer clearing and MVP matrix issues.
  compositeToOutput(targetCtx, canvasWidth, canvasHeight, motionParams, opacity, transformParams) {
    if (!this._initialized || !this._gl) return false;

    const gl = this._gl;

    // Get or compile the composite program
    if (!this._compositeProgram) {
      const program = this._compileProgram(COMPOSITE_VERT, COMPOSITE_FRAG);
      if (!program) return false;
      const uniforms = {};
      const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < numUniforms; i++) {
        const info = gl.getActiveUniform(program, i);
        uniforms[info.name] = gl.getUniformLocation(program, info.name);
      }
      this._compositeProgram = { program, uniforms };
    }

    const prog = this._compositeProgram;
    const mvp = this._buildMVPMatrix(motionParams, transformParams, canvasWidth, canvasHeight);

    // Render the current FBO to the GL canvas (not an FBO — render to screen/backbuffer)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this._width, this._height);

    // Enable blending for alpha compositing (SRC_ALPHA, ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(prog.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._fboTextures[this._currentFBO]);
    if (prog.uniforms['u_source'] !== undefined) {
      gl.uniform1i(prog.uniforms['u_source'], 0);
    }
    if (prog.uniforms['u_opacity'] !== undefined) {
      gl.uniform1f(prog.uniforms['u_opacity'], opacity);
    }
    if (prog.uniforms['u_crop'] !== undefined) {
      const cropL = motionParams ? (motionParams.cropLeft || 0) / 100 : 0;
      const cropT = motionParams ? (motionParams.cropTop || 0) / 100 : 0;
      const cropR = motionParams ? (motionParams.cropRight || 0) / 100 : 0;
      const cropB = motionParams ? (motionParams.cropBottom || 0) / 100 : 0;
      gl.uniform4f(prog.uniforms['u_crop'], cropL, cropT, cropR, cropB);
    }
    if (prog.uniforms['u_mvp'] !== undefined) {
      gl.uniformMatrix3fv(prog.uniforms['u_mvp'], false, mvp);
    }

    gl.bindVertexArray(this._quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.disable(gl.BLEND);

    // Blit GL canvas to the 2D context
    targetCtx.drawImage(this._canvas, 0, 0);
    return true;
  },

  // Build a 3x3 MVP matrix from motion params (pixel coords -> GL clip space -1..1)
  _buildMVPMatrix(motionParams, transformParams, canvasW, canvasH) {
    // Start with identity
    // mat3 column-major: [m00, m10, m20, m01, m11, m21, m02, m12, m22]
    let m = [1, 0, 0, 0, 1, 0, 0, 0, 1];

    if (motionParams) {
      const sx = motionParams.uniformScale
        ? motionParams.scale / 100
        : motionParams.scaleWidth / 100;
      const sy = motionParams.scale / 100;
      const rot = (motionParams.rotation * Math.PI) / 180;
      const posX = motionParams.posX;
      const posY = motionParams.posY;
      const ancX = motionParams.anchorX;
      const ancY = motionParams.anchorY;

      // Build transform: translate(posX, posY) * rotate * scale * translate(-anchorX, -anchorY)
      // Then map pixel coords to clip space: x' = (x / canvasW) * 2 - 1, y' = 1 - (y / canvasH) * 2
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);

      // Combined: pixel-space transform
      // P = translate(posX, posY) * rotate(rot) * scale(sx, sy) * translate(-ancX, -ancY) * vertex
      // Then to clip space: cx = P.x * 2/W - 1, cy = 1 - P.y * 2/H

      // For simplicity (and since the quad covers -1..1 in GL space which maps to the
      // full canvas via texCoords), we only need the MVP if motion params differ from default.
      // Default = identity (posX=cx, posY=cy, anchor=center, scale=100%, rot=0)
      const cx = canvasW / 2;
      const cy = canvasH / 2;
      const isDefault = posX === cx && posY === cy && ancX === cx && ancY === cy &&
        sx === 1 && sy === 1 && rot === 0;

      if (!isDefault) {
        // Translate anchor to origin, scale, rotate, translate to position
        // Then convert to clip space
        const tx = (posX * 2 / canvasW) - 1;
        const ty = 1 - (posY * 2 / canvasH);
        const atx = (ancX * 2 / canvasW);
        const aty = (ancY * 2 / canvasH);
        const scaleToClipX = sx;
        const scaleToClipY = sy;

        // Build column-major mat3:
        // translate(tx, ty) * rotate(rot) * scale(sx, sy) * translate(-atx, aty)
        // This is a simplified version — the full composition
        m[0] = cosR * scaleToClipX;
        m[1] = -sinR * scaleToClipX;
        m[3] = sinR * scaleToClipY;
        m[4] = cosR * scaleToClipY;
        m[6] = tx - (cosR * scaleToClipX * (atx - 1)) - (sinR * scaleToClipY * (aty - 1));
        m[7] = ty + (sinR * scaleToClipX * (atx - 1)) - (cosR * scaleToClipY * (aty - 1));
        // Note: This is a first-order approximation. The exact matrix needs validation.
        // For Phase A we keep this as-is; visual testing will refine the math.
      }
    }

    return new Float32Array(m);
  }
};

// ---- Worker state ----
let canvas = null;
let ctx = null;
let offscreenCanvas = null;
let offscreenCtx = null;
let transCanvases = [null, null];
let transCtxs = [null, null];
let glAvailable = false;
let rendering = false;

function ensureOffscreen(width, height) {
  if (!offscreenCanvas) {
    offscreenCanvas = new OffscreenCanvas(width, height);
    offscreenCtx = offscreenCanvas.getContext('2d');
  }
  if (offscreenCanvas.width !== width) offscreenCanvas.width = width;
  if (offscreenCanvas.height !== height) offscreenCanvas.height = height;
  return offscreenCtx;
}

function ensureTransCtx(index, width, height) {
  if (!transCanvases[index]) {
    transCanvases[index] = new OffscreenCanvas(width, height);
    transCtxs[index] = transCanvases[index].getContext('2d');
  }
  const c = transCanvases[index];
  if (c.width !== width) c.width = width;
  if (c.height !== height) c.height = height;
  return { canvas: c, ctx: transCtxs[index] };
}

// ---- Drawing helpers (mirror VideoCompositor logic) ----

function drawFit(ctx, source, canvasWidth, canvasHeight) {
  const srcW = source.width;
  const srcH = source.height;
  if (!srcW || !srcH) return;
  const x = (canvasWidth - srcW) / 2;
  const y = (canvasHeight - srcH) / 2;
  ctx.drawImage(source, x, y, srcW, srcH);
}

function applyMotionCrop(ctx, mp, canvasWidth, canvasHeight) {
  const { cropLeft, cropTop, cropRight, cropBottom } = mp;
  if (cropLeft <= 0 && cropTop <= 0 && cropRight <= 0 && cropBottom <= 0) return;
  const w = canvasWidth;
  const h = canvasHeight;
  const left = (cropLeft / 100) * w;
  const top = (cropTop / 100) * h;
  const right = (cropRight / 100) * w;
  const bottom = (cropBottom / 100) * h;
  ctx.fillStyle = '#000';
  if (top > 0) ctx.fillRect(0, 0, w, top);
  if (bottom > 0) ctx.fillRect(0, h - bottom, w, bottom);
  if (left > 0) ctx.fillRect(0, 0, left, h);
  if (right > 0) ctx.fillRect(w - right, 0, right, h);
}

function applyCrop(ctx, params, canvasWidth, canvasHeight) {
  const w = canvasWidth;
  const h = canvasHeight;
  const top = (params.top / 100) * h;
  const bottom = (params.bottom / 100) * h;
  const left = (params.left / 100) * w;
  const right = (params.right / 100) * w;
  if (top > 0 || bottom > 0 || left > 0 || right > 0) {
    ctx.fillStyle = '#000';
    if (top > 0) ctx.fillRect(0, 0, w, top);
    if (bottom > 0) ctx.fillRect(0, h - bottom, w, bottom);
    if (left > 0) ctx.fillRect(0, 0, left, h);
    if (right > 0) ctx.fillRect(w - right, 0, right, h);
  }
}

function renderClipToCtx(targetCtx, clipCmd, canvasWidth, canvasHeight) {
  const { frame: bitmap, effects, needsProcessing } = clipCmd;
  if (!bitmap) return;

  if (!needsProcessing) {
    drawFit(targetCtx, bitmap, canvasWidth, canvasHeight);
    return;
  }

  const offCtx = ensureOffscreen(canvasWidth, canvasHeight);
  offCtx.clearRect(0, 0, canvasWidth, canvasHeight);
  drawFit(offCtx, bitmap, canvasWidth, canvasHeight);

  let motionParams = null;
  let transformParams = null;
  let opacity = 1;
  const pixelEffects = [];

  for (const fx of effects) {
    if (fx.effectId === 'motion' && fx.intrinsic) {
      motionParams = fx.resolvedParams;
    } else if (fx.effectId === 'transform') {
      transformParams = fx.resolvedParams;
    } else if (fx.effectId === 'opacity') {
      opacity = fx.resolvedParams.opacity / 100;
    } else if (fx.effectId === 'crop') {
      applyCrop(offCtx, fx.resolvedParams, canvasWidth, canvasHeight);
    } else if (fx.effectId === 'time-remap' || fx.effectId === 'audio-volume' ||
               fx.effectId === 'panner' || fx.effectId === 'channel-volume') {
      // Audio/time effects: skip in video compositor
    } else if (fx.type === 'video') {
      pixelEffects.push(fx);
    }
  }

  // Apply pixel effects via GL or Canvas2D fallback
  if (pixelEffects.length > 0) {
    const useGL = glAvailable &&
      pixelEffects.every(e => glRenderer.hasShader(e.effectId));

    if (useGL) {
      glRenderer.uploadSource(offscreenCanvas, canvasWidth, canvasHeight);
      for (const fx of pixelEffects) {
        glRenderer.applyEffect(fx.effectId, fx.resolvedParams);
      }
      offCtx.clearRect(0, 0, canvasWidth, canvasHeight);
      glRenderer.readResult(offCtx);
    } else {
      // Canvas2D fallback for pixel effects
      for (const fx of pixelEffects) {
        if (fx.canvas2dFn) {
          applyCanvas2DEffect(offCtx, fx.effectId, fx.resolvedParams, canvasWidth, canvasHeight);
        }
      }
    }
  }

  // Motion + opacity compositing via Canvas2D (proven path)
  if (motionParams) {
    applyMotionCrop(offCtx, motionParams, canvasWidth, canvasHeight);
  }

  targetCtx.save();

  if (motionParams) {
    const sy = motionParams.scale / 100;
    const sx = motionParams.uniformScale ? sy : motionParams.scaleWidth / 100;
    targetCtx.translate(motionParams.posX, motionParams.posY);
    targetCtx.rotate((motionParams.rotation * Math.PI) / 180);
    targetCtx.scale(sx, sy);
    targetCtx.translate(-motionParams.anchorX, -motionParams.anchorY);
  }

  if (transformParams) {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    targetCtx.translate(cx + transformParams.posX, cy + transformParams.posY);
    targetCtx.rotate((transformParams.rotation * Math.PI) / 180);
    targetCtx.scale(transformParams.scaleX / 100, transformParams.scaleY / 100);
    targetCtx.translate(-cx, -cy);
  }

  targetCtx.globalAlpha = opacity;
  targetCtx.drawImage(offscreenCanvas, 0, 0);
  targetCtx.restore();
}

// Canvas2D fallback for pixel effects that don't have GL shaders
function applyCanvas2DEffect(ctx, effectId, params, w, h) {
  switch (effectId) {
    case 'gaussian-blur':
      if (params.radius > 0) {
        ctx.filter = `blur(${params.radius}px)`;
        ctx.drawImage(ctx.canvas, 0, 0);
        ctx.filter = 'none';
      }
      break;
    case 'hue-rotate':
      ctx.filter = `hue-rotate(${params.angle}deg)`;
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.filter = 'none';
      break;
    case 'invert':
      if (params.amount > 0) {
        ctx.filter = `invert(${params.amount}%)`;
        ctx.drawImage(ctx.canvas, 0, 0);
        ctx.filter = 'none';
      }
      break;
    case 'grayscale':
      if (params.amount > 0) {
        ctx.filter = `grayscale(${params.amount}%)`;
        ctx.drawImage(ctx.canvas, 0, 0);
        ctx.filter = 'none';
      }
      break;
    case 'sepia':
      if (params.amount > 0) {
        ctx.filter = `sepia(${params.amount}%)`;
        ctx.drawImage(ctx.canvas, 0, 0);
        ctx.filter = 'none';
      }
      break;
    case 'drop-shadow':
      ctx.filter = `drop-shadow(${params.offsetX}px ${params.offsetY}px ${params.blur}px ${params.color || '#000'})`;
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.filter = 'none';
      break;
    case 'brightness-contrast': {
      const b = params.brightness / 100;
      const c = (params.contrast + 100) / 100;
      ctx.filter = `brightness(${1 + b}) contrast(${c})`;
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.filter = 'none';
      break;
    }
    case 'saturation':
      ctx.filter = `saturate(${(params.amount + 100) / 100})`;
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.filter = 'none';
      break;
    default:
      break;
  }
}

// ---- Transition rendering (mirrors Transitions.js) ----

function renderTransition(ctx, cmd, canvasWidth, canvasHeight) {
  const { type, progress, clipA, clipB } = cmd;

  const { canvas: canvasA, ctx: ctxA } = ensureTransCtx(0, canvasWidth, canvasHeight);
  ctxA.clearRect(0, 0, canvasWidth, canvasHeight);
  if (clipA) renderClipToCtx(ctxA, clipA, canvasWidth, canvasHeight);

  const { canvas: canvasB, ctx: ctxB } = ensureTransCtx(1, canvasWidth, canvasHeight);
  ctxB.clearRect(0, 0, canvasWidth, canvasHeight);
  if (clipB) renderClipToCtx(ctxB, clipB, canvasWidth, canvasHeight);

  switch (type) {
    case 'cross-dissolve':
      ctx.globalAlpha = 1 - progress;
      ctx.drawImage(canvasA, 0, 0, canvasWidth, canvasHeight);
      ctx.globalAlpha = progress;
      ctx.drawImage(canvasB, 0, 0, canvasWidth, canvasHeight);
      ctx.globalAlpha = 1;
      break;
    case 'dip-to-black':
    case 'dip-to-white': {
      const color = type === 'dip-to-white' ? '#fff' : '#000';
      if (progress < 0.5) {
        const p = progress * 2;
        ctx.drawImage(canvasA, 0, 0, canvasWidth, canvasHeight);
        ctx.globalAlpha = p;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.globalAlpha = 1;
      } else {
        const p = (progress - 0.5) * 2;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.globalAlpha = p;
        ctx.drawImage(canvasB, 0, 0, canvasWidth, canvasHeight);
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'wipe-left':
    case 'wipe-right':
    case 'wipe-up':
    case 'wipe-down': {
      const dir = type.split('-')[1]; // left, right, up, down
      ctx.drawImage(canvasA, 0, 0, canvasWidth, canvasHeight);
      ctx.save();
      ctx.beginPath();
      if (dir === 'left') ctx.rect(0, 0, canvasWidth * progress, canvasHeight);
      else if (dir === 'right') ctx.rect(canvasWidth * (1 - progress), 0, canvasWidth * progress, canvasHeight);
      else if (dir === 'up') ctx.rect(0, 0, canvasWidth, canvasHeight * progress);
      else ctx.rect(0, canvasHeight * (1 - progress), canvasWidth, canvasHeight * progress);
      ctx.clip();
      ctx.drawImage(canvasB, 0, 0, canvasWidth, canvasHeight);
      ctx.restore();
      break;
    }
    case 'slide-left':
      ctx.drawImage(canvasA, 0, 0, canvasWidth, canvasHeight);
      ctx.drawImage(canvasB, canvasWidth * (1 - progress), 0, canvasWidth, canvasHeight);
      break;
    case 'push-left': {
      const offset = canvasWidth * progress;
      ctx.drawImage(canvasA, -offset, 0, canvasWidth, canvasHeight);
      ctx.drawImage(canvasB, canvasWidth - offset, 0, canvasWidth, canvasHeight);
      break;
    }
    default:
      // Fallback to cross-dissolve
      ctx.globalAlpha = 1 - progress;
      ctx.drawImage(canvasA, 0, 0, canvasWidth, canvasHeight);
      ctx.globalAlpha = progress;
      ctx.drawImage(canvasB, 0, 0, canvasWidth, canvasHeight);
      ctx.globalAlpha = 1;
  }
}

// ---- Main message handler ----

self.onmessage = (e) => {
  const { type } = e.data;

  if (type === 'init') {
    canvas = e.data.canvas;
    ctx = canvas.getContext('2d', { alpha: false });
    canvas.width = e.data.width;
    canvas.height = e.data.height;
    glAvailable = glRenderer.init();
    self.postMessage({ type: 'init_done', glAvailable });
    return;
  }

  if (type === 'resize') {
    if (canvas) {
      canvas.width = e.data.width;
      canvas.height = e.data.height;
    }
    return;
  }

  if (type === 'render') {
    const { frame, command } = e.data;
    if (!canvas || !ctx) {
      self.postMessage({ type: 'rendered', frame });
      return;
    }

    try {
      rendering = true;
      const { canvasWidth, canvasHeight, tracks } = command;

      // Clear to black
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Render tracks bottom-to-top: last in array = top of UI = highest priority = render last
      for (let i = tracks.length - 1; i >= 0; i--) {
        const trackCmd = tracks[i];

        // Render non-transition clips
        for (const clipCmd of trackCmd.clips) {
          renderClipToCtx(ctx, clipCmd, canvasWidth, canvasHeight);
        }

        // Render transitions
        for (const transCmd of trackCmd.transitions) {
          renderTransition(ctx, transCmd, canvasWidth, canvasHeight);
        }
      }

      // Close all transferred ImageBitmaps to free memory
      for (const trackCmd of tracks) {
        for (const clipCmd of trackCmd.clips) {
          if (clipCmd.frame) clipCmd.frame.close();
        }
        for (const transCmd of trackCmd.transitions) {
          if (transCmd.clipA && transCmd.clipA.frame) transCmd.clipA.frame.close();
          if (transCmd.clipB && transCmd.clipB.frame) transCmd.clipB.frame.close();
        }
      }
    } catch (err) {
      // Log but don't let errors prevent 'rendered' response — otherwise
      // _workerBusy stays true forever and playback permanently freezes
      console.error('[CompositorWorker] Render error:', err);
    } finally {
      rendering = false;
      self.postMessage({ type: 'rendered', frame });
    }
    return;
  }

  if (type === 'destroy') {
    canvas = null;
    ctx = null;
    offscreenCanvas = null;
    offscreenCtx = null;
    transCanvases = [null, null];
    transCtxs = [null, null];
    return;
  }
};
