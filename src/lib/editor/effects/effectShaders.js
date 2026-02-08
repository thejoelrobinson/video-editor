// GLSL shader sources for WebGL 2.0 effect rendering

// Shared fullscreen quad vertex shader
export const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

// Fragment shaders keyed by effect ID
export const FRAGMENT_SHADERS = {
  'brightness-contrast': `#version 300 es
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
}`,

  'saturation': `#version 300 es
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
}`,

  'hue-rotate': `#version 300 es
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
}`,

  'gaussian-blur-h': `#version 300 es
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
}`,

  'gaussian-blur-v': `#version 300 es
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
}`,

  'invert': `#version 300 es
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
}`,

  'grayscale': `#version 300 es
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
}`,

  'sepia': `#version 300 es
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
}`,

  'sharpen': `#version 300 es
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
}`,

  'levels': `#version 300 es
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
}`,

  'hsl-adjust': `#version 300 es
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
}`,

  'vignette': `#version 300 es
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
}`,

  'drop-shadow': `#version 300 es
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
}`,
};

// Map effect IDs to their uniform setter functions
// Each returns an object: { uniforms: {name: value}, passes: ['shader-id', ...] }
export function getEffectConfig(effectId, params) {
  switch (effectId) {
    case 'brightness-contrast':
      return {
        passes: ['brightness-contrast'],
        uniforms: {
          u_brightness: params.brightness / 100,
          u_contrast: (params.contrast + 100) / 100
        }
      };
    case 'saturation':
      return {
        passes: ['saturation'],
        uniforms: { u_amount: (params.amount + 100) / 100 }
      };
    case 'hue-rotate':
      return {
        passes: ['hue-rotate'],
        uniforms: { u_angle: params.angle }
      };
    case 'gaussian-blur':
      if (params.radius <= 0) return null;
      return {
        passes: ['gaussian-blur-h', 'gaussian-blur-v'],
        uniforms: { u_radius: params.radius }
      };
    case 'invert':
      if (params.amount <= 0) return null;
      return {
        passes: ['invert'],
        uniforms: { u_amount: params.amount / 100 }
      };
    case 'grayscale':
      if (params.amount <= 0) return null;
      return {
        passes: ['grayscale'],
        uniforms: { u_amount: params.amount / 100 }
      };
    case 'sepia':
      if (params.amount <= 0) return null;
      return {
        passes: ['sepia'],
        uniforms: { u_amount: params.amount / 100 }
      };
    case 'sharpen':
      if (params.amount <= 0) return null;
      return {
        passes: ['sharpen'],
        uniforms: { u_amount: params.amount / 100 }
      };
    case 'levels':
      return {
        passes: ['levels'],
        uniforms: {
          u_inputBlack: params.inputBlack / 255,
          u_inputWhite: params.inputWhite / 255,
          u_gamma: params.gamma,
          u_outputBlack: params.outputBlack / 255,
          u_outputWhite: params.outputWhite / 255
        }
      };
    case 'hsl-adjust':
      if (params.hue === 0 && params.saturation === 0 && params.lightness === 0) return null;
      return {
        passes: ['hsl-adjust'],
        uniforms: {
          u_hue: params.hue,
          u_saturation: params.saturation / 100,
          u_lightness: params.lightness / 100
        }
      };
    case 'vignette':
      if (params.amount <= 0) return null;
      return {
        passes: ['vignette'],
        uniforms: {
          u_amount: params.amount / 100,
          u_size: params.size / 100
        }
      };
    case 'drop-shadow':
      return {
        passes: ['drop-shadow'],
        uniforms: {
          u_offsetX: params.offsetX,
          u_offsetY: params.offsetY,
          u_blur: params.blur,
          u_color: hexToVec3(params.color || '#000000')
        }
      };
    default:
      return null;
  }
}

// Helper for drop-shadow color
function hexToVec3(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

// Set of effect IDs that have GL shader implementations
export const GL_SUPPORTED_EFFECTS = new Set(Object.keys(FRAGMENT_SHADERS));

// Effects that should NOT use GL (handled as canvas compositing)
export const COMPOSITING_EFFECTS = new Set(['transform', 'opacity', 'crop']);

// Composite vertex shader — transforms clip position via u_mvp mat3
export const COMPOSITE_VERT = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
uniform mat3 u_mvp;
void main() {
  vec3 pos = u_mvp * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

// Composite fragment shader — crop + opacity on the composited output
export const COMPOSITE_FRAG = `#version 300 es
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
}`;

