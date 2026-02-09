// WebGL 2.0 GPU-accelerated effect renderer with ping-pong FBO architecture
import { VERTEX_SHADER, FRAGMENT_SHADERS, getEffectConfig, GL_SUPPORTED_EFFECTS } from './effectShaders.js';
import logger from '../../utils/logger.js';

export const glEffectRenderer = {
  _gl: null,
  _canvas: null,
  _programs: new Map(),  // shaderId -> { program, uniforms }
  _quadVAO: null,
  _sourceTexture: null,
  _fbos: [null, null],   // ping-pong framebuffers
  _fboTextures: [null, null],
  _currentFBO: 0,        // which FBO was last written to
  _width: 0,
  _height: 0,
  _initialized: false,
  _supportChecked: false,
  _supported: false,
  _lutTextures: new Map(),  // key -> { texture, unit }
  _nextTexUnit: 1,          // TEXTURE0 is reserved for source

  isSupported() {
    if (this._supportChecked) return this._supported;
    this._supportChecked = true;

    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        const c = new OffscreenCanvas(1, 1);
        const gl = c.getContext('webgl2');
        if (gl) { this._supported = true; return true; }
      } catch (e) { /* fall through */ }
    }
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      this._supported = !!gl;
    } catch (e) {
      this._supported = false;
    }
    return this._supported;
  },

  init(canvas) {
    if (this._initialized) return true;

    this._canvas = canvas || (typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : document.createElement('canvas'));

    this._gl = this._canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      alpha: true,
      preserveDrawingBuffer: true,
      antialias: false
    });

    if (!this._gl) {
      logger.warn('WebGL 2.0 not available, falling back to Canvas2D effects');
      return false;
    }

    this._setupQuad();
    this._initialized = true;
    logger.info('GLEffectRenderer initialized (WebGL 2.0)');
    return true;
  },

  _setupQuad() {
    const gl = this._gl;

    // Fullscreen quad vertices: position (x,y) + texCoord (u,v)
    const vertices = new Float32Array([
      -1, -1,  0, 0,
       1, -1,  1, 0,
      -1,  1,  0, 1,
       1,  1,  1, 1,
    ]);

    this._quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this._quadVAO);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    // a_position
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    // a_texCoord
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

    // Cache all uniform locations and types
    const gl = this._gl;
    const uniforms = {};
    const uniformTypes = {};
    const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < numUniforms; i++) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
      uniformTypes[info.name] = info.type;
    }

    const entry = { program, uniforms, uniformTypes };
    this._programs.set(shaderId, entry);
    return entry;
  },

  _compileProgram(vertSrc, fragSrc) {
    const gl = this._gl;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vertSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      logger.error('Vertex shader compile error:', gl.getShaderInfoLog(vs));
      gl.deleteShader(vs);
      return null;
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fragSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      logger.error('Fragment shader compile error:', gl.getShaderInfoLog(fs));
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    // Bind attribute locations to match VAO layout
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.bindAttribLocation(program, 1, 'a_texCoord');
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      logger.error('Program link error:', gl.getProgramInfoLog(program));
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

    // Use 16-bit float FBOs for color grading precision (prevents banding
    // from Lumetri curves/contrast/lift-gamma-gain in 8-bit). Falls back
    // to RGBA8 if the GPU doesn't support float color buffers.
    if (this._fboFormat === undefined) {
      const ext = gl.getExtension('EXT_color_buffer_float');
      this._fboFormat = ext ? gl.RGBA16F : gl.RGBA8;
      this._fboType = ext ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    }

    // Recreate ping-pong FBOs
    for (let i = 0; i < 2; i++) {
      if (this._fbos[i]) gl.deleteFramebuffer(this._fbos[i]);
      if (this._fboTextures[i]) gl.deleteTexture(this._fboTextures[i]);

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, this._fboFormat, width, height, 0, gl.RGBA, this._fboType, null);
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

    // Create source texture if needed
    if (!this._sourceTexture) {
      this._sourceTexture = gl.createTexture();
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  },

  uploadSource(source, width, height) {
    const gl = this._gl;
    this._resize(width, height);

    gl.bindTexture(gl.TEXTURE_2D, this._sourceTexture);
    // Flip Y so canvas top-row maps to GL texture top (texCoord y=1)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Copy source to FBO_A so first effect reads from it
    this._currentFBO = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbos[0]);
    gl.viewport(0, 0, width, height);

    // Draw source texture to FBO_A
    const passthrough = this._getPassthroughProgram();
    gl.useProgram(passthrough.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._sourceTexture);
    gl.uniform1i(passthrough.uniforms['u_source'], 0);
    gl.bindVertexArray(this._quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

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

  applyEffect(effectId, params) {
    if (!this._initialized || !this._gl) return false;

    const config = getEffectConfig(effectId, params);
    if (!config) return false;

    const gl = this._gl;

    for (const passId of config.passes) {
      const prog = this._getProgram(passId);
      if (!prog) {
        logger.warn(`No GL shader for pass: ${passId}`);
        return false;
      }

      // Read from current FBO, write to the other
      const readFBO = this._currentFBO;
      const writeFBO = 1 - readFBO;

      gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbos[writeFBO]);
      gl.viewport(0, 0, this._width, this._height);

      gl.useProgram(prog.program);

      // Bind source texture (from read FBO)
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._fboTextures[readFBO]);
      if (prog.uniforms['u_source'] !== undefined) {
        gl.uniform1i(prog.uniforms['u_source'], 0);
      }

      // Set texel size for effects that need it
      if (prog.uniforms['u_texelSize'] !== undefined) {
        gl.uniform2f(prog.uniforms['u_texelSize'], 1.0 / this._width, 1.0 / this._height);
      }

      // Set effect-specific uniforms
      for (const [name, value] of Object.entries(config.uniforms)) {
        const loc = prog.uniforms[name];
        if (loc === undefined) continue;

        // Texture uniform (LUT handle from uploadLUT)
        if (value && typeof value === 'object' && value._isTexture) {
          gl.activeTexture(gl.TEXTURE0 + value._textureUnit);
          gl.bindTexture(gl.TEXTURE_2D, value._texture);
          gl.uniform1i(loc, value._textureUnit);
        } else if (Array.isArray(value)) {
          if (value.length === 2) gl.uniform2fv(loc, value);
          else if (value.length === 3) gl.uniform3fv(loc, value);
          else if (value.length === 4) gl.uniform4fv(loc, value);
        } else if (typeof value === 'boolean') {
          gl.uniform1i(loc, value ? 1 : 0);
        } else {
          // Use cached uniform type for correct dispatch
          const uType = prog.uniformTypes[name];
          if (uType === gl.INT || uType === gl.BOOL || uType === gl.SAMPLER_2D) {
            gl.uniform1i(loc, value);
          } else {
            gl.uniform1f(loc, value);
          }
        }
      }

      // Draw
      gl.bindVertexArray(this._quadVAO);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      this._currentFBO = writeFBO;
    }

    return true;
  },

  readResult(targetCtx) {
    if (!this._initialized || !this._gl) return;

    const gl = this._gl;

    // Render final FBO to the GL canvas (screen)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this._width, this._height);

    const passthrough = this._getPassthroughProgram();
    gl.useProgram(passthrough.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._fboTextures[this._currentFBO]);
    gl.uniform1i(passthrough.uniforms['u_source'], 0);
    gl.bindVertexArray(this._quadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Blit GL canvas to 2D context
    targetCtx.drawImage(this._canvas, 0, 0);
  },

  /**
   * Upload a LUT as a GL texture. Returns a handle object for use as a uniform value.
   * @param {string} key - Cache key (e.g. 'curveLUT', 'hslCurveLUT')
   * @param {Uint8Array} data - Pixel data
   * @param {number} width - Texture width
   * @param {number} height - Texture height (default 1)
   * @returns {{ _isTexture: true, _texture: WebGLTexture, _textureUnit: number }}
   */
  uploadLUT(key, data, width, height = 1) {
    if (!this._initialized || !this._gl) return null;
    const gl = this._gl;

    let entry = this._lutTextures.get(key);
    if (!entry) {
      const texture = gl.createTexture();
      const unit = this._nextTexUnit++;
      entry = { texture, unit };
      this._lutTextures.set(key, entry);
    }

    gl.activeTexture(gl.TEXTURE0 + entry.unit);
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    // Choose format based on data size: RGBA for 4-channel, R8 for single-channel
    if (data.length === width * height * 4) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return { _isTexture: true, _texture: entry.texture, _textureUnit: entry.unit };
  },

  hasShader(effectId) {
    return GL_SUPPORTED_EFFECTS.has(effectId);
  },

  cleanup() {
    if (!this._gl) return;
    const gl = this._gl;

    for (const [, entry] of this._programs) {
      gl.deleteProgram(entry.program);
    }
    this._programs.clear();

    for (let i = 0; i < 2; i++) {
      if (this._fbos[i]) gl.deleteFramebuffer(this._fbos[i]);
      if (this._fboTextures[i]) gl.deleteTexture(this._fboTextures[i]);
    }
    this._fbos = [null, null];
    this._fboTextures = [null, null];

    if (this._sourceTexture) gl.deleteTexture(this._sourceTexture);
    this._sourceTexture = null;

    // Clean up LUT textures
    for (const [, entry] of this._lutTextures) {
      gl.deleteTexture(entry.texture);
    }
    this._lutTextures.clear();
    this._nextTexUnit = 1;

    if (this._quadVAO) gl.deleteVertexArray(this._quadVAO);
    this._quadVAO = null;

    this._gl = null;
    this._canvas = null;
    this._initialized = false;
    this._supportChecked = false;
    this._supported = false;
    this._width = 0;
    this._height = 0;
  }
};

export default glEffectRenderer;
