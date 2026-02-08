const I=`#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`,D={"brightness-contrast":`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_brightness;
uniform float u_contrast;
void main() {
  vec4 color = texture(u_source, v_texCoord);
  // Brightness (additive)
  color.rgb += u_brightness;
  // Contrast (scale around 0.5)
  color.rgb = (color.rgb - 0.5) * u_contrast + 0.5;
  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}`,saturation:`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_amount;
void main() {
  vec4 color = texture(u_source, v_texCoord);
  float lum = dot(color.rgb, vec3(0.2989, 0.587, 0.114));
  color.rgb = mix(vec3(lum), color.rgb, u_amount);
  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}`,"hue-rotate":`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_angle;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 color = texture(u_source, v_texCoord);
  vec3 hsv = rgb2hsv(color.rgb);
  hsv.x = fract(hsv.x + u_angle / 360.0);
  color.rgb = hsv2rgb(hsv);
  fragColor = vec4(color.rgb, color.a);
}`,"gaussian-blur-h":`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_radius;
uniform vec2 u_texelSize;

void main() {
  vec4 sum = vec4(0.0);
  float weightSum = 0.0;
  int r = int(ceil(u_radius));
  for (int i = -r; i <= r; i++) {
    float x = float(i);
    float weight = exp(-0.5 * (x * x) / max(u_radius * u_radius * 0.25, 0.001));
    sum += texture(u_source, v_texCoord + vec2(x * u_texelSize.x, 0.0)) * weight;
    weightSum += weight;
  }
  fragColor = sum / weightSum;
}`,"gaussian-blur-v":`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_radius;
uniform vec2 u_texelSize;

void main() {
  vec4 sum = vec4(0.0);
  float weightSum = 0.0;
  int r = int(ceil(u_radius));
  for (int i = -r; i <= r; i++) {
    float y = float(i);
    float weight = exp(-0.5 * (y * y) / max(u_radius * u_radius * 0.25, 0.001));
    sum += texture(u_source, v_texCoord + vec2(0.0, y * u_texelSize.y)) * weight;
    weightSum += weight;
  }
  fragColor = sum / weightSum;
}`,invert:`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_amount;
void main() {
  vec4 color = texture(u_source, v_texCoord);
  vec3 inverted = 1.0 - color.rgb;
  color.rgb = mix(color.rgb, inverted, u_amount);
  fragColor = vec4(color.rgb, color.a);
}`,grayscale:`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_amount;
void main() {
  vec4 color = texture(u_source, v_texCoord);
  float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  color.rgb = mix(color.rgb, vec3(lum), u_amount);
  fragColor = vec4(color.rgb, color.a);
}`,sepia:`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_amount;
void main() {
  vec4 color = texture(u_source, v_texCoord);
  vec3 sepia = vec3(
    dot(color.rgb, vec3(0.393, 0.769, 0.189)),
    dot(color.rgb, vec3(0.349, 0.686, 0.168)),
    dot(color.rgb, vec3(0.272, 0.534, 0.131))
  );
  color.rgb = mix(color.rgb, sepia, u_amount);
  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}`,sharpen:`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_amount;
uniform vec2 u_texelSize;
void main() {
  vec4 center = texture(u_source, v_texCoord);
  vec4 top    = texture(u_source, v_texCoord + vec2(0.0, -u_texelSize.y));
  vec4 bottom = texture(u_source, v_texCoord + vec2(0.0, u_texelSize.y));
  vec4 left   = texture(u_source, v_texCoord + vec2(-u_texelSize.x, 0.0));
  vec4 right  = texture(u_source, v_texCoord + vec2(u_texelSize.x, 0.0));
  vec4 sharpened = center * 5.0 - top - bottom - left - right;
  fragColor = vec4(mix(center.rgb, clamp(sharpened.rgb, 0.0, 1.0), u_amount), center.a);
}`,levels:`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_inputBlack;
uniform float u_inputWhite;
uniform float u_gamma;
uniform float u_outputBlack;
uniform float u_outputWhite;
void main() {
  vec4 color = texture(u_source, v_texCoord);
  float inRange = max(u_inputWhite - u_inputBlack, 1.0 / 255.0);
  float outRange = u_outputWhite - u_outputBlack;
  // Input levels
  color.rgb = clamp((color.rgb - u_inputBlack) / inRange, 0.0, 1.0);
  // Gamma
  color.rgb = pow(color.rgb, vec3(1.0 / u_gamma));
  // Output levels
  color.rgb = color.rgb * outRange + u_outputBlack;
  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}`,"hsl-adjust":`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_hue;
uniform float u_saturation;
uniform float u_lightness;

vec3 rgb2hsl(vec3 c) {
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  float l = (maxC + minC) * 0.5;
  float s = 0.0;
  float h = 0.0;
  if (maxC != minC) {
    float d = maxC - minC;
    s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
    if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if (s == 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    hue2rgb(p, q, h + 1.0/3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0/3.0)
  );
}

void main() {
  vec4 color = texture(u_source, v_texCoord);
  vec3 hsl = rgb2hsl(color.rgb);
  hsl.x = fract(hsl.x + u_hue / 360.0);
  hsl.y = clamp(hsl.y + u_saturation, 0.0, 1.0);
  hsl.z = clamp(hsl.z + u_lightness, 0.0, 1.0);
  color.rgb = hsl2rgb(hsl);
  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}`,vignette:`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_amount;
uniform float u_size;
void main() {
  vec4 color = texture(u_source, v_texCoord);
  vec2 center = v_texCoord - 0.5;
  float dist = length(center) / 0.7071;
  float vig = smoothstep(u_size, u_size - 0.3, dist);
  color.rgb *= mix(1.0, vig, u_amount);
  fragColor = vec4(color.rgb, color.a);
}`,"drop-shadow":`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_offsetX;
uniform float u_offsetY;
uniform float u_blur;
uniform vec3 u_color;
uniform vec2 u_texelSize;
void main() {
  vec4 original = texture(u_source, v_texCoord);
  // Sample shadow from offset position with blur
  vec2 shadowCoord = v_texCoord - vec2(u_offsetX, u_offsetY) * u_texelSize;
  vec4 shadowSample = vec4(0.0);
  float weightSum = 0.0;
  int r = int(ceil(u_blur));
  if (r < 1) r = 1;
  for (int y = -r; y <= r; y++) {
    for (int x = -r; x <= r; x++) {
      float d = float(x * x + y * y);
      float w = exp(-0.5 * d / max(u_blur * u_blur * 0.25, 0.001));
      vec2 coord = shadowCoord + vec2(float(x), float(y)) * u_texelSize;
      shadowSample += texture(u_source, coord) * w;
      weightSum += w;
    }
  }
  shadowSample /= weightSum;
  float shadowAlpha = shadowSample.a * (1.0 - original.a);
  vec3 result = original.rgb * original.a + u_color * shadowAlpha;
  fragColor = vec4(result, max(original.a, shadowAlpha));
}`};function M(e,t){switch(e){case"brightness-contrast":return{passes:["brightness-contrast"],uniforms:{u_brightness:t.brightness/100,u_contrast:(t.contrast+100)/100}};case"saturation":return{passes:["saturation"],uniforms:{u_amount:(t.amount+100)/100}};case"hue-rotate":return{passes:["hue-rotate"],uniforms:{u_angle:t.angle}};case"gaussian-blur":return t.radius<=0?null:{passes:["gaussian-blur-h","gaussian-blur-v"],uniforms:{u_radius:t.radius}};case"invert":return t.amount<=0?null:{passes:["invert"],uniforms:{u_amount:t.amount/100}};case"grayscale":return t.amount<=0?null:{passes:["grayscale"],uniforms:{u_amount:t.amount/100}};case"sepia":return t.amount<=0?null:{passes:["sepia"],uniforms:{u_amount:t.amount/100}};case"sharpen":return t.amount<=0?null:{passes:["sharpen"],uniforms:{u_amount:t.amount/100}};case"levels":return{passes:["levels"],uniforms:{u_inputBlack:t.inputBlack/255,u_inputWhite:t.inputWhite/255,u_gamma:t.gamma,u_outputBlack:t.outputBlack/255,u_outputWhite:t.outputWhite/255}};case"hsl-adjust":return t.hue===0&&t.saturation===0&&t.lightness===0?null:{passes:["hsl-adjust"],uniforms:{u_hue:t.hue,u_saturation:t.saturation/100,u_lightness:t.lightness/100}};case"vignette":return t.amount<=0?null:{passes:["vignette"],uniforms:{u_amount:t.amount/100,u_size:t.size/100}};case"drop-shadow":return{passes:["drop-shadow"],uniforms:{u_offsetX:t.offsetX,u_offsetY:t.offsetY,u_blur:t.blur,u_color:O(t.color||"#000000")}};default:return null}}function O(e){const t=parseInt(e.slice(1,3),16)/255,r=parseInt(e.slice(3,5),16)/255,o=parseInt(e.slice(5,7),16)/255;return[t,r,o]}const z=new Set(Object.keys(D)),L=`#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
uniform mat3 u_mvp;
void main() {
  vec3 pos = u_mvp * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`,k=`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform float u_opacity;
uniform vec4 u_crop; // left, top, right, bottom (0..1 ratios)
void main() {
  // Discard pixels in crop regions
  if (v_texCoord.x < u_crop.x || v_texCoord.x > (1.0 - u_crop.z) ||
      v_texCoord.y < u_crop.y || v_texCoord.y > (1.0 - u_crop.w)) {
    fragColor = vec4(0.0);
    return;
  }
  vec4 color = texture(u_source, v_texCoord);
  fragColor = vec4(color.rgb, color.a * u_opacity);
}`,p={_gl:null,_canvas:null,_programs:new Map,_quadVAO:null,_sourceTexture:null,_fbos:[null,null],_fboTextures:[null,null],_currentFBO:0,_width:0,_height:0,_initialized:!1,init(){if(this._initialized)return!0;try{return this._canvas=new OffscreenCanvas(1,1),this._gl=this._canvas.getContext("webgl2",{premultipliedAlpha:!1,alpha:!0,preserveDrawingBuffer:!0,antialias:!1}),this._gl?(this._setupQuad(),this._initialized=!0,!0):!1}catch{return!1}},_setupQuad(){const e=this._gl,t=new Float32Array([-1,-1,0,0,1,-1,1,0,-1,1,0,1,1,1,1,1]);this._quadVAO=e.createVertexArray(),e.bindVertexArray(this._quadVAO);const r=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,r),e.bufferData(e.ARRAY_BUFFER,t,e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,16,0),e.enableVertexAttribArray(1),e.vertexAttribPointer(1,2,e.FLOAT,!1,16,8),e.bindVertexArray(null)},_getProgram(e){if(this._programs.has(e))return this._programs.get(e);const t=D[e];if(!t)return null;const r=this._compileProgram(I,t);if(!r)return null;const o=this._gl,s={},i=o.getProgramParameter(r,o.ACTIVE_UNIFORMS);for(let l=0;l<i;l++){const n=o.getActiveUniform(r,l);s[n.name]=o.getUniformLocation(r,n.name)}const u={program:r,uniforms:s};return this._programs.set(e,u),u},_compileProgram(e,t){const r=this._gl,o=r.createShader(r.VERTEX_SHADER);if(r.shaderSource(o,e),r.compileShader(o),!r.getShaderParameter(o,r.COMPILE_STATUS))return r.deleteShader(o),null;const s=r.createShader(r.FRAGMENT_SHADER);if(r.shaderSource(s,t),r.compileShader(s),!r.getShaderParameter(s,r.COMPILE_STATUS))return r.deleteShader(o),r.deleteShader(s),null;const i=r.createProgram();return r.attachShader(i,o),r.attachShader(i,s),r.bindAttribLocation(i,0,"a_position"),r.bindAttribLocation(i,1,"a_texCoord"),r.linkProgram(i),r.getProgramParameter(i,r.LINK_STATUS)?(r.deleteShader(o),r.deleteShader(s),i):(r.deleteProgram(i),r.deleteShader(o),r.deleteShader(s),null)},_resize(e,t){if(this._width===e&&this._height===t)return;const r=this._gl;this._width=e,this._height=t,this._canvas.width=e,this._canvas.height=t,r.viewport(0,0,e,t);for(let o=0;o<2;o++){this._fbos[o]&&r.deleteFramebuffer(this._fbos[o]),this._fboTextures[o]&&r.deleteTexture(this._fboTextures[o]);const s=r.createTexture();r.bindTexture(r.TEXTURE_2D,s),r.texImage2D(r.TEXTURE_2D,0,r.RGBA8,e,t,0,r.RGBA,r.UNSIGNED_BYTE,null),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE);const i=r.createFramebuffer();r.bindFramebuffer(r.FRAMEBUFFER,i),r.framebufferTexture2D(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,s,0),this._fboTextures[o]=s,this._fbos[o]=i}this._sourceTexture||(this._sourceTexture=r.createTexture()),r.bindFramebuffer(r.FRAMEBUFFER,null)},_getPassthroughProgram(){if(this._programs.has("_passthrough"))return this._programs.get("_passthrough");const t=this._compileProgram(I,`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
void main() {
  fragColor = texture(u_source, v_texCoord);
}`),r=this._gl,o={},s=r.getProgramParameter(t,r.ACTIVE_UNIFORMS);for(let u=0;u<s;u++){const l=r.getActiveUniform(t,u);o[l.name]=r.getUniformLocation(t,l.name)}const i={program:t,uniforms:o};return this._programs.set("_passthrough",i),i},uploadSource(e,t,r){const o=this._gl;this._resize(t,r),o.bindTexture(o.TEXTURE_2D,this._sourceTexture),o.texImage2D(o.TEXTURE_2D,0,o.RGBA8,o.RGBA,o.UNSIGNED_BYTE,e),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MIN_FILTER,o.LINEAR),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MAG_FILTER,o.LINEAR),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_S,o.CLAMP_TO_EDGE),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_T,o.CLAMP_TO_EDGE),this._currentFBO=0,o.bindFramebuffer(o.FRAMEBUFFER,this._fbos[0]),o.viewport(0,0,t,r);const s=this._getPassthroughProgram();o.useProgram(s.program),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this._sourceTexture),o.uniform1i(s.uniforms.u_source,0),o.bindVertexArray(this._quadVAO),o.drawArrays(o.TRIANGLE_STRIP,0,4),o.bindFramebuffer(o.FRAMEBUFFER,null)},applyEffect(e,t){if(!this._initialized||!this._gl)return!1;const r=M(e,t);if(!r)return!1;const o=this._gl;for(const s of r.passes){const i=this._getProgram(s);if(!i)return!1;const u=this._currentFBO,l=1-u;o.bindFramebuffer(o.FRAMEBUFFER,this._fbos[l]),o.viewport(0,0,this._width,this._height),o.useProgram(i.program),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this._fboTextures[u]),i.uniforms.u_source!==void 0&&o.uniform1i(i.uniforms.u_source,0),i.uniforms.u_texelSize!==void 0&&o.uniform2f(i.uniforms.u_texelSize,1/this._width,1/this._height);for(const[n,f]of Object.entries(r.uniforms)){const _=i.uniforms[n];_!==void 0&&(Array.isArray(f)?f.length===2?o.uniform2fv(_,f):f.length===3?o.uniform3fv(_,f):f.length===4&&o.uniform4fv(_,f):o.uniform1f(_,f))}o.bindVertexArray(this._quadVAO),o.drawArrays(o.TRIANGLE_STRIP,0,4),this._currentFBO=l}return!0},readResult(e){if(!this._initialized||!this._gl)return;const t=this._gl;t.bindFramebuffer(t.FRAMEBUFFER,null),t.viewport(0,0,this._width,this._height);const r=this._getPassthroughProgram();t.useProgram(r.program),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,this._fboTextures[this._currentFBO]),t.uniform1i(r.uniforms.u_source,0),t.bindVertexArray(this._quadVAO),t.drawArrays(t.TRIANGLE_STRIP,0,4),e.drawImage(this._canvas,0,0)},hasShader(e){return z.has(e)},compositeToOutput(e,t,r,o,s,i){if(!this._initialized||!this._gl)return!1;const u=this._gl;if(!this._compositeProgram){const f=this._compileProgram(L,k);if(!f)return!1;const _={},m=u.getProgramParameter(f,u.ACTIVE_UNIFORMS);for(let a=0;a<m;a++){const c=u.getActiveUniform(f,a);_[c.name]=u.getUniformLocation(f,c.name)}this._compositeProgram={program:f,uniforms:_}}const l=this._compositeProgram,n=this._buildMVPMatrix(o,i,t,r);if(u.bindFramebuffer(u.FRAMEBUFFER,null),u.viewport(0,0,this._width,this._height),u.enable(u.BLEND),u.blendFunc(u.SRC_ALPHA,u.ONE_MINUS_SRC_ALPHA),u.useProgram(l.program),u.activeTexture(u.TEXTURE0),u.bindTexture(u.TEXTURE_2D,this._fboTextures[this._currentFBO]),l.uniforms.u_source!==void 0&&u.uniform1i(l.uniforms.u_source,0),l.uniforms.u_opacity!==void 0&&u.uniform1f(l.uniforms.u_opacity,s),l.uniforms.u_crop!==void 0){const f=o?(o.cropLeft||0)/100:0,_=o?(o.cropTop||0)/100:0,m=o?(o.cropRight||0)/100:0,a=o?(o.cropBottom||0)/100:0;u.uniform4f(l.uniforms.u_crop,f,_,m,a)}return l.uniforms.u_mvp!==void 0&&u.uniformMatrix3fv(l.uniforms.u_mvp,!1,n),u.bindVertexArray(this._quadVAO),u.drawArrays(u.TRIANGLE_STRIP,0,4),u.disable(u.BLEND),e.drawImage(this._canvas,0,0),!0},_buildMVPMatrix(e,t,r,o){let s=[1,0,0,0,1,0,0,0,1];if(e){const i=e.uniformScale?e.scale/100:e.scaleWidth/100,u=e.scale/100,l=e.rotation*Math.PI/180,n=e.posX,f=e.posY,_=e.anchorX,m=e.anchorY,a=Math.cos(l),c=Math.sin(l),A=r/2,w=o/2;if(!(n===A&&f===w&&_===A&&m===w&&i===1&&u===1&&l===0)){const B=n*2/r-1,X=1-f*2/o,S=_*2/r,y=m*2/o,b=i,x=u;s[0]=a*b,s[1]=-c*b,s[3]=c*x,s[4]=a*x,s[6]=B-a*b*(S-1)-c*x*(y-1),s[7]=X+c*b*(S-1)-a*x*(y-1)}}return new Float32Array(s)}};let h=null,d=null,g=null,T=null,v=[null,null],C=[null,null],E=!1,F=!1;function q(e,t){return g||(g=new OffscreenCanvas(e,t),T=g.getContext("2d")),g.width!==e&&(g.width=e),g.height!==t&&(g.height=t),T}function P(e,t,r){v[e]||(v[e]=new OffscreenCanvas(t,r),C[e]=v[e].getContext("2d"));const o=v[e];return o.width!==t&&(o.width=t),o.height!==r&&(o.height=r),{canvas:o,ctx:C[e]}}function U(e,t,r,o){const s=t.width,i=t.height;if(!s||!i)return;const u=(r-s)/2,l=(o-i)/2;e.drawImage(t,u,l,s,i)}function N(e,t,r,o){const{cropLeft:s,cropTop:i,cropRight:u,cropBottom:l}=t;if(s<=0&&i<=0&&u<=0&&l<=0)return;const n=r,f=o,_=s/100*n,m=i/100*f,a=u/100*n,c=l/100*f;e.fillStyle="#000",m>0&&e.fillRect(0,0,n,m),c>0&&e.fillRect(0,f-c,n,c),_>0&&e.fillRect(0,0,_,f),a>0&&e.fillRect(n-a,0,a,f)}function V(e,t,r,o){const s=r,i=o,u=t.top/100*i,l=t.bottom/100*i,n=t.left/100*s,f=t.right/100*s;(u>0||l>0||n>0||f>0)&&(e.fillStyle="#000",u>0&&e.fillRect(0,0,s,u),l>0&&e.fillRect(0,i-l,s,l),n>0&&e.fillRect(0,0,n,i),f>0&&e.fillRect(s-f,0,f,i))}function R(e,t,r,o){const{frame:s,effects:i,needsProcessing:u}=t;if(!s)return;if(!u){U(e,s,r,o);return}const l=q(r,o);l.clearRect(0,0,r,o),U(l,s,r,o);let n=null,f=null,_=1;const m=[];for(const a of i)a.effectId==="motion"&&a.intrinsic?n=a.resolvedParams:a.effectId==="transform"?f=a.resolvedParams:a.effectId==="opacity"?_=a.resolvedParams.opacity/100:a.effectId==="crop"?V(l,a.resolvedParams,r,o):a.effectId==="time-remap"||a.effectId==="audio-volume"||a.effectId==="panner"||a.effectId==="channel-volume"||a.type==="video"&&m.push(a);if(m.length>0)if(E&&m.every(c=>p.hasShader(c.effectId))){p.uploadSource(g,r,o);for(const c of m)p.applyEffect(c.effectId,c.resolvedParams);l.clearRect(0,0,r,o),p.readResult(l)}else for(const c of m)c.canvas2dFn&&G(l,c.effectId,c.resolvedParams);if(n&&N(l,n,r,o),e.save(),n){const a=n.scale/100,c=n.uniformScale?a:n.scaleWidth/100;e.translate(n.posX,n.posY),e.rotate(n.rotation*Math.PI/180),e.scale(c,a),e.translate(-n.anchorX,-n.anchorY)}if(f){const a=r/2,c=o/2;e.translate(a+f.posX,c+f.posY),e.rotate(f.rotation*Math.PI/180),e.scale(f.scaleX/100,f.scaleY/100),e.translate(-a,-c)}e.globalAlpha=_,e.drawImage(g,0,0),e.restore()}function G(e,t,r,o,s){switch(t){case"gaussian-blur":r.radius>0&&(e.filter=`blur(${r.radius}px)`,e.drawImage(e.canvas,0,0),e.filter="none");break;case"hue-rotate":e.filter=`hue-rotate(${r.angle}deg)`,e.drawImage(e.canvas,0,0),e.filter="none";break;case"invert":r.amount>0&&(e.filter=`invert(${r.amount}%)`,e.drawImage(e.canvas,0,0),e.filter="none");break;case"grayscale":r.amount>0&&(e.filter=`grayscale(${r.amount}%)`,e.drawImage(e.canvas,0,0),e.filter="none");break;case"sepia":r.amount>0&&(e.filter=`sepia(${r.amount}%)`,e.drawImage(e.canvas,0,0),e.filter="none");break;case"drop-shadow":e.filter=`drop-shadow(${r.offsetX}px ${r.offsetY}px ${r.blur}px ${r.color||"#000"})`,e.drawImage(e.canvas,0,0),e.filter="none";break;case"brightness-contrast":{const i=r.brightness/100,u=(r.contrast+100)/100;e.filter=`brightness(${1+i}) contrast(${u})`,e.drawImage(e.canvas,0,0),e.filter="none";break}case"saturation":e.filter=`saturate(${(r.amount+100)/100})`,e.drawImage(e.canvas,0,0),e.filter="none";break}}function Y(e,t,r,o){const{type:s,progress:i,clipA:u,clipB:l}=t,{canvas:n,ctx:f}=P(0,r,o);f.clearRect(0,0,r,o),u&&R(f,u,r,o);const{canvas:_,ctx:m}=P(1,r,o);switch(m.clearRect(0,0,r,o),l&&R(m,l,r,o),s){case"cross-dissolve":e.globalAlpha=1-i,e.drawImage(n,0,0,r,o),e.globalAlpha=i,e.drawImage(_,0,0,r,o),e.globalAlpha=1;break;case"dip-to-black":case"dip-to-white":{const a=s==="dip-to-white"?"#fff":"#000";if(i<.5){const c=i*2;e.drawImage(n,0,0,r,o),e.globalAlpha=c,e.fillStyle=a,e.fillRect(0,0,r,o),e.globalAlpha=1}else{const c=(i-.5)*2;e.fillStyle=a,e.fillRect(0,0,r,o),e.globalAlpha=c,e.drawImage(_,0,0,r,o),e.globalAlpha=1}break}case"wipe-left":case"wipe-right":case"wipe-up":case"wipe-down":{const a=s.split("-")[1];e.drawImage(n,0,0,r,o),e.save(),e.beginPath(),a==="left"?e.rect(0,0,r*i,o):a==="right"?e.rect(r*(1-i),0,r*i,o):a==="up"?e.rect(0,0,r,o*i):e.rect(0,o*(1-i),r,o*i),e.clip(),e.drawImage(_,0,0,r,o),e.restore();break}case"slide-left":e.drawImage(n,0,0,r,o),e.drawImage(_,r*(1-i),0,r,o);break;case"push-left":{const a=r*i;e.drawImage(n,-a,0,r,o),e.drawImage(_,r-a,0,r,o);break}default:e.globalAlpha=1-i,e.drawImage(n,0,0,r,o),e.globalAlpha=i,e.drawImage(_,0,0,r,o),e.globalAlpha=1}}self.onmessage=e=>{const{type:t}=e.data;if(t==="init"){h=e.data.canvas,d=h.getContext("2d",{alpha:!1}),h.width=e.data.width,h.height=e.data.height,E=p.init(),self.postMessage({type:"init_done",glAvailable:E});return}if(t==="resize"){h&&(h.width=e.data.width,h.height=e.data.height);return}if(t==="render"){const{frame:r,command:o}=e.data;if(!h||!d){self.postMessage({type:"rendered",frame:r});return}try{F=!0;const{canvasWidth:s,canvasHeight:i,tracks:u}=o;d.fillStyle="#000000",d.fillRect(0,0,s,i);for(let l=u.length-1;l>=0;l--){const n=u[l];for(const f of n.clips)R(d,f,s,i);for(const f of n.transitions)Y(d,f,s,i)}for(const l of u){for(const n of l.clips)n.frame&&n.frame.close();for(const n of l.transitions)n.clipA&&n.clipA.frame&&n.clipA.frame.close(),n.clipB&&n.clipB.frame&&n.clipB.frame.close()}}catch(s){console.error("[CompositorWorker] Render error:",s)}finally{F=!1,self.postMessage({type:"rendered",frame:r})}return}if(t==="destroy"){h=null,d=null,g=null,T=null,v=[null,null],C=[null,null];return}};
//# sourceMappingURL=CompositorWorker-DAgFH7v5.js.map
