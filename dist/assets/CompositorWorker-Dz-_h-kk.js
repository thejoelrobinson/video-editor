const L=`#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`,M={"brightness-contrast":`#version 300 es
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
}`,"lumetri-color-main":`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;

// Basic Correction
uniform int u_basic_enabled;
uniform float u_temperature;
uniform float u_tint;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;
uniform float u_saturation;
uniform float u_vibrance;

// Creative
uniform int u_creative_enabled;
uniform float u_faded_film;
uniform float u_creative_vibrance;
uniform float u_creative_saturation;
uniform vec3 u_shadow_tint;
uniform vec3 u_highlight_tint;
uniform float u_tint_balance;

// Color Wheels
uniform int u_wheels_enabled;
uniform float u_shadow_wheel_r;
uniform float u_shadow_wheel_g;
uniform float u_shadow_wheel_b;
uniform float u_shadow_luma;
uniform float u_midtone_wheel_r;
uniform float u_midtone_wheel_g;
uniform float u_midtone_wheel_b;
uniform float u_midtone_luma;
uniform float u_highlight_wheel_r;
uniform float u_highlight_wheel_g;
uniform float u_highlight_wheel_b;
uniform float u_highlight_luma;

// Vignette
uniform int u_vignette_enabled;
uniform float u_vignette_amount;
uniform float u_vignette_midpoint;
uniform float u_vignette_roundness;
uniform float u_vignette_feather;

vec3 whiteBalance(vec3 color, float temp, float tintVal) {
  // Attempt color temperature shift (blue-orange axis via temp, green-magenta via tint)
  float t = temp / 100.0;
  float ti = tintVal / 100.0;
  color.r += t * 0.1;
  color.b -= t * 0.1;
  color.g += ti * 0.1;
  color.b -= ti * 0.05;
  return color;
}

void main() {
  vec4 color = texture(u_source, v_texCoord);

  // --- Basic Correction ---
  if (u_basic_enabled != 0) {
    // White balance
    color.rgb = whiteBalance(color.rgb, u_temperature, u_tint);

    // Exposure: multiply by 2^exposure
    color.rgb *= pow(2.0, u_exposure);

    // Contrast: scale around midgray
    color.rgb = (color.rgb - 0.5) * (u_contrast / 100.0 + 1.0) + 0.5;

    // Luminance for zone-based adjustments
    float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));

    // Highlights / Shadows / Whites / Blacks
    float shadowMask = 1.0 - smoothstep(0.0, 0.5, luma);
    float highlightMask = smoothstep(0.5, 1.0, luma);
    float blacksMask = 1.0 - smoothstep(0.0, 0.25, luma);
    float whitesMask = smoothstep(0.75, 1.0, luma);

    color.rgb += shadowMask * (u_shadows / 100.0) * 0.5;
    color.rgb += highlightMask * (u_highlights / 100.0) * 0.5;
    color.rgb += blacksMask * (u_blacks / 100.0) * 0.25;
    color.rgb += whitesMask * (u_whites / 100.0) * 0.25;

    // Saturation
    float lumaPost = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(vec3(lumaPost), color.rgb, u_saturation / 100.0);

    // Vibrance (boost low-saturation pixels more)
    float curSat = length(color.rgb - vec3(lumaPost));
    float vibWeight = 1.0 - clamp(curSat * 3.0, 0.0, 1.0);
    float vibAmount = u_vibrance / 100.0;
    color.rgb = mix(vec3(lumaPost), color.rgb, 1.0 + vibAmount * vibWeight);
  }

  // --- Creative ---
  if (u_creative_enabled != 0) {
    // Faded film: lift blacks linearly
    float fade = u_faded_film / 100.0;
    color.rgb += fade * 0.15;
    color.rgb = max(color.rgb, vec3(fade * 0.1));

    // Creative vibrance + saturation
    float lumaC = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float curSatC = length(color.rgb - vec3(lumaC));
    float vibWeightC = 1.0 - clamp(curSatC * 3.0, 0.0, 1.0);
    color.rgb = mix(vec3(lumaC), color.rgb, 1.0 + (u_creative_vibrance / 100.0) * vibWeightC);
    color.rgb = mix(vec3(lumaC), color.rgb, u_creative_saturation / 100.0);

    // Shadow/highlight tinting — additive blend to avoid darkening at defaults
    float lumaT = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float balance = (u_tint_balance + 100.0) / 200.0; // 0..1
    float shadowTintMask = 1.0 - smoothstep(0.0, balance, lumaT);
    float highlightTintMask = smoothstep(balance, 1.0, lumaT);
    // Tint offset: subtract white (neutral) so default tint colors produce zero offset
    vec3 shadowTintOffset = u_shadow_tint - vec3(0.5);
    vec3 highlightTintOffset = u_highlight_tint - vec3(0.5);
    color.rgb += shadowTintMask * shadowTintOffset * 0.6;
    color.rgb += highlightTintMask * highlightTintOffset * 0.6;
  }

  // --- Color Wheels (3-way) ---
  if (u_wheels_enabled != 0) {
    float lumaW = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    float sMask = 1.0 - smoothstep(0.0, 0.5, lumaW);
    float mMask = 1.0 - abs(lumaW - 0.5) * 2.0;
    mMask = max(0.0, mMask);
    float hMask = smoothstep(0.5, 1.0, lumaW);

    vec3 shadowOffset = vec3(u_shadow_wheel_r, u_shadow_wheel_g, u_shadow_wheel_b);
    vec3 midtoneOffset = vec3(u_midtone_wheel_r, u_midtone_wheel_g, u_midtone_wheel_b);
    vec3 highlightOffset = vec3(u_highlight_wheel_r, u_highlight_wheel_g, u_highlight_wheel_b);

    color.rgb += sMask * shadowOffset * 0.5;
    color.rgb += mMask * midtoneOffset * 0.5;
    color.rgb += hMask * highlightOffset * 0.5;

    // Luminance offsets
    color.rgb += sMask * (u_shadow_luma / 100.0) * 0.5;
    color.rgb += mMask * (u_midtone_luma / 100.0) * 0.5;
    color.rgb += hMask * (u_highlight_luma / 100.0) * 0.5;
  }

  // --- Vignette ---
  if (u_vignette_enabled != 0) {
    vec2 center = v_texCoord - 0.5;
    float roundness = u_vignette_roundness / 100.0;
    // Roundness controls ellipse vs circle: 0=wide ellipse, 1=circle
    float aspect = mix(1.7777, 1.0, roundness); // 16:9 aspect at 0, circle at 1
    float dist = length(center / vec2(aspect, 1.0));
    float midpt = u_vignette_midpoint / 100.0;
    float feath = max(0.01, u_vignette_feather / 100.0);
    float vig = smoothstep(midpt - feath * 0.5, midpt + feath * 0.5, dist);
    float amount = u_vignette_amount / 100.0;
    color.rgb *= 1.0 - vig * amount;
  }

  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}`,"lumetri-color-curves":`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
uniform sampler2D u_curveLUT;     // 256x1 RGBA: R=red curve, G=green curve, B=blue curve
uniform sampler2D u_hslCurveLUT;  // 256x5: packed HSL curves (row-wise)

uniform int u_hsl_curves_active;

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

  // RGB curve lookup — each channel remapped through its LUT
  vec4 lutSample = texture(u_curveLUT, vec2(color.r, 0.5));
  color.r = lutSample.r;
  lutSample = texture(u_curveLUT, vec2(color.g, 0.5));
  color.g = lutSample.g;
  lutSample = texture(u_curveLUT, vec2(color.b, 0.5));
  color.b = lutSample.b;

  // HSL-domain curves
  if (u_hsl_curves_active != 0) {
    vec3 hsl = rgb2hsl(color.rgb);

    // Row 0: Hue vs Saturation — adjust sat based on hue
    float hueVsSat = texture(u_hslCurveLUT, vec2(hsl.x, 0.1)).r;
    float satOffset0 = (hueVsSat - 128.0/255.0) * 2.0;
    hsl.y = clamp(hsl.y + satOffset0, 0.0, 1.0);

    // Row 1: Hue vs Hue — adjust hue based on hue
    float hueVsHue = texture(u_hslCurveLUT, vec2(hsl.x, 0.3)).r;
    float hueOffset = (hueVsHue - 128.0/255.0) * 2.0;
    hsl.x = fract(hsl.x + hueOffset);

    // Row 2: Hue vs Luma — adjust luma based on hue
    float hueVsLuma = texture(u_hslCurveLUT, vec2(hsl.x, 0.5)).r;
    float lumaOffset = (hueVsLuma - 128.0/255.0) * 2.0;
    hsl.z = clamp(hsl.z + lumaOffset * 0.5, 0.0, 1.0);

    // Row 3: Luma vs Saturation — adjust sat based on luma
    float lumaVsSat = texture(u_hslCurveLUT, vec2(hsl.z, 0.7)).r;
    float satOffset3 = (lumaVsSat - 128.0/255.0) * 2.0;
    hsl.y = clamp(hsl.y + satOffset3, 0.0, 1.0);

    // Row 4: Sat vs Saturation — adjust sat based on sat
    float satVsSat = texture(u_hslCurveLUT, vec2(hsl.y, 0.9)).r;
    float satOffset4 = (satVsSat - 128.0/255.0) * 2.0;
    hsl.y = clamp(hsl.y + satOffset4, 0.0, 1.0);

    color.rgb = hsl2rgb(hsl);
  }

  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
}`,"lumetri-color-secondary":`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;

// Key controls
uniform float u_hsl_hue_center;
uniform float u_hsl_hue_range;
uniform float u_hsl_sat_center;
uniform float u_hsl_sat_range;
uniform float u_hsl_luma_center;
uniform float u_hsl_luma_range;
uniform float u_hsl_denoise;

// Correction
uniform float u_hsl_temperature;
uniform float u_hsl_tint;
uniform float u_hsl_contrast;
uniform float u_hsl_saturation;
uniform float u_hsl_sharpen;
uniform vec2 u_texelSize;

// Mask preview
uniform int u_hsl_show_mask;

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

void main() {
  vec4 color = texture(u_source, v_texCoord);
  vec3 hsl = rgb2hsl(color.rgb);

  // Hue mask (wrapping at 360 degrees)
  float hDeg = hsl.x * 360.0;
  float hueDist = abs(mod(hDeg - u_hsl_hue_center + 180.0, 360.0) - 180.0);
  float hueRange = max(1.0, u_hsl_hue_range);
  float hueMask = 1.0 - smoothstep(hueRange * 0.8, hueRange, hueDist);

  // Saturation mask
  float sPct = hsl.y * 100.0;
  float satDist = abs(sPct - u_hsl_sat_center);
  float satRange = max(1.0, u_hsl_sat_range);
  float satMask = 1.0 - smoothstep(satRange * 0.8, satRange, satDist);

  // Luminance mask
  float lPct = hsl.z * 100.0;
  float lumDist = abs(lPct - u_hsl_luma_center);
  float lumRange = max(1.0, u_hsl_luma_range);
  float lumMask = 1.0 - smoothstep(lumRange * 0.8, lumRange, lumDist);

  // Combined mask
  float mask = hueMask * satMask * lumMask;

  // Denoise: threshold low-confidence pixels
  float denoise = u_hsl_denoise / 100.0;
  mask = smoothstep(denoise, denoise + 0.1, mask);

  // Show mask mode
  if (u_hsl_show_mask != 0) {
    fragColor = vec4(vec3(mask), color.a);
    return;
  }

  // Apply corrections weighted by mask
  vec3 corrected = color.rgb;

  // Temperature/tint shift
  float t = u_hsl_temperature / 100.0;
  float ti = u_hsl_tint / 100.0;
  corrected.r += t * 0.1;
  corrected.b -= t * 0.1;
  corrected.g += ti * 0.1;

  // Contrast
  float contrastF = u_hsl_contrast / 100.0 + 1.0;
  corrected = (corrected - 0.5) * contrastF + 0.5;

  // Saturation
  float lum = dot(corrected, vec3(0.2126, 0.7152, 0.0722));
  corrected = mix(vec3(lum), corrected, u_hsl_saturation / 100.0);

  // Sharpen (3x3 unsharp mask on source, applied to corrected)
  if (u_hsl_sharpen > 0.0) {
    vec4 cen = texture(u_source, v_texCoord);
    vec4 t2 = texture(u_source, v_texCoord + vec2(0.0, -u_texelSize.y));
    vec4 b2 = texture(u_source, v_texCoord + vec2(0.0, u_texelSize.y));
    vec4 l2 = texture(u_source, v_texCoord + vec2(-u_texelSize.x, 0.0));
    vec4 r2 = texture(u_source, v_texCoord + vec2(u_texelSize.x, 0.0));
    vec3 sharp = cen.rgb * 5.0 - t2.rgb - b2.rgb - l2.rgb - r2.rgb;
    corrected = mix(corrected, clamp(sharp, 0.0, 1.0), u_hsl_sharpen / 100.0);
  }

  // Blend corrected with original using mask
  color.rgb = mix(color.rgb, clamp(corrected, 0.0, 1.0), mask);

  fragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
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
}`};function B(r,o){switch(r){case"brightness-contrast":return{passes:["brightness-contrast"],uniforms:{u_brightness:o.brightness/100,u_contrast:(o.contrast+100)/100}};case"saturation":return{passes:["saturation"],uniforms:{u_amount:(o.amount+100)/100}};case"hue-rotate":return{passes:["hue-rotate"],uniforms:{u_angle:o.angle}};case"gaussian-blur":return o.radius<=0?null:{passes:["gaussian-blur-h","gaussian-blur-v"],uniforms:{u_radius:o.radius}};case"invert":return o.amount<=0?null:{passes:["invert"],uniforms:{u_amount:o.amount/100}};case"grayscale":return o.amount<=0?null:{passes:["grayscale"],uniforms:{u_amount:o.amount/100}};case"sepia":return o.amount<=0?null:{passes:["sepia"],uniforms:{u_amount:o.amount/100}};case"sharpen":return o.amount<=0?null:{passes:["sharpen"],uniforms:{u_amount:o.amount/100}};case"levels":return{passes:["levels"],uniforms:{u_inputBlack:o.inputBlack/255,u_inputWhite:o.inputWhite/255,u_gamma:o.gamma,u_outputBlack:o.outputBlack/255,u_outputWhite:o.outputWhite/255}};case"hsl-adjust":return o.hue===0&&o.saturation===0&&o.lightness===0?null:{passes:["hsl-adjust"],uniforms:{u_hue:o.hue,u_saturation:o.saturation/100,u_lightness:o.lightness/100}};case"vignette":return o.amount<=0?null:{passes:["vignette"],uniforms:{u_amount:o.amount/100,u_size:o.size/100}};case"drop-shadow":return{passes:["drop-shadow"],uniforms:{u_offsetX:o.offsetX,u_offsetY:o.offsetY,u_blur:o.blur,u_color:T(o.color||"#000000")}};case"lumetri-color":{const t=[],e={},l=o.basic_enabled!==!1,i=!!o.creative_enabled,u=!!o.wheels_enabled,a=!!o.vignette_enabled;if(l||i||u||a){t.push("lumetri-color-main"),e.u_basic_enabled=l?1:0,e.u_temperature=o.temperature||0,e.u_tint=o.tint||0,e.u_exposure=o.exposure||0,e.u_contrast=o.contrast||0,e.u_highlights=o.highlights||0,e.u_shadows=o.shadows||0,e.u_whites=o.whites||0,e.u_blacks=o.blacks||0,e.u_saturation=o.saturation!=null?o.saturation:100,e.u_vibrance=o.vibrance||0,e.u_creative_enabled=i?1:0,e.u_faded_film=o.faded_film||0,e.u_creative_vibrance=o.creative_vibrance||0,e.u_creative_saturation=o.creative_saturation!=null?o.creative_saturation:100,e.u_shadow_tint=T(o.shadow_tint||"#808080"),e.u_highlight_tint=T(o.highlight_tint||"#808080"),e.u_tint_balance=o.tint_balance||0,e.u_wheels_enabled=u?1:0;const n=C(o.shadow_hue||0,o.shadow_sat||0);e.u_shadow_wheel_r=n[0],e.u_shadow_wheel_g=n[1],e.u_shadow_wheel_b=n[2],e.u_shadow_luma=o.shadow_luma||0;const s=C(o.midtone_hue||0,o.midtone_sat||0);e.u_midtone_wheel_r=s[0],e.u_midtone_wheel_g=s[1],e.u_midtone_wheel_b=s[2],e.u_midtone_luma=o.midtone_luma||0;const f=C(o.highlight_hue||0,o.highlight_sat||0);e.u_highlight_wheel_r=f[0],e.u_highlight_wheel_g=f[1],e.u_highlight_wheel_b=f[2],e.u_highlight_luma=o.highlight_luma||0,e.u_vignette_enabled=a?1:0,e.u_vignette_amount=o.vignette_amount||0,e.u_vignette_midpoint=o.vignette_midpoint!=null?o.vignette_midpoint:50,e.u_vignette_roundness=o.vignette_roundness!=null?o.vignette_roundness:50,e.u_vignette_feather=o.vignette_feather!=null?o.vignette_feather:50}return i&&o.creative_sharpen>0&&(t.push("sharpen"),e.u_amount=o.creative_sharpen/100),o.curves_enabled&&o._curveLUT&&(t.push("lumetri-color-curves"),e.u_curveLUT=o._curveLUT,e.u_hsl_curves_active=o._hslCurveLUT?1:0,o._hslCurveLUT&&(e.u_hslCurveLUT=o._hslCurveLUT)),o.hsl_enabled&&(t.push("lumetri-color-secondary"),e.u_hsl_hue_center=o.hsl_hue_center||0,e.u_hsl_hue_range=o.hsl_hue_range!=null?o.hsl_hue_range:30,e.u_hsl_sat_center=o.hsl_sat_center!=null?o.hsl_sat_center:50,e.u_hsl_sat_range=o.hsl_sat_range!=null?o.hsl_sat_range:50,e.u_hsl_luma_center=o.hsl_luma_center!=null?o.hsl_luma_center:50,e.u_hsl_luma_range=o.hsl_luma_range!=null?o.hsl_luma_range:50,e.u_hsl_denoise=o.hsl_denoise!=null?o.hsl_denoise:10,e.u_hsl_temperature=o.hsl_temperature||0,e.u_hsl_tint=o.hsl_tint||0,e.u_hsl_contrast=o.hsl_contrast||0,e.u_hsl_saturation=o.hsl_saturation!=null?o.hsl_saturation:100,e.u_hsl_show_mask=o.hsl_show_mask?1:0,e.u_hsl_sharpen=o.hsl_sharpen||0),t.length===0?null:{passes:t,uniforms:e}}default:return null}}function T(r){const o=parseInt(r.slice(1,3),16)/255,t=parseInt(r.slice(3,5),16)/255,e=parseInt(r.slice(5,7),16)/255;return[o,t,e]}function C(r,o){const t=o/100,e=r/360,l=.5+.5,i=0,u=(f,h,c)=>(c<0&&(c+=1),c>1&&(c-=1),c<1/6?f+(h-f)*6*c:c<1/2?h:c<2/3?f+(h-f)*(2/3-c)*6:f),a=u(i,l,e+1/3)*t,n=u(i,l,e)*t,s=u(i,l,e-1/3)*t;return[a-.5*t,n-.5*t,s-.5*t]}const X=new Set([...Object.keys(M),"lumetri-color"]),z=`#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
uniform mat3 u_mvp;
void main() {
  vec3 pos = u_mvp * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`,V=`#version 300 es
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
}`,v={_gl:null,_canvas:null,_programs:new Map,_quadVAO:null,_sourceTexture:null,_fbos:[null,null],_fboTextures:[null,null],_currentFBO:0,_width:0,_height:0,_initialized:!1,_lutTextures:new Map,_nextTexUnit:1,init(){if(this._initialized)return!0;try{return this._canvas=new OffscreenCanvas(1,1),this._gl=this._canvas.getContext("webgl2",{premultipliedAlpha:!1,alpha:!0,preserveDrawingBuffer:!0,antialias:!1}),this._gl?(this._setupQuad(),this._initialized=!0,!0):!1}catch{return!1}},_setupQuad(){const r=this._gl,o=new Float32Array([-1,-1,0,0,1,-1,1,0,-1,1,0,1,1,1,1,1]);this._quadVAO=r.createVertexArray(),r.bindVertexArray(this._quadVAO);const t=r.createBuffer();r.bindBuffer(r.ARRAY_BUFFER,t),r.bufferData(r.ARRAY_BUFFER,o,r.STATIC_DRAW),r.enableVertexAttribArray(0),r.vertexAttribPointer(0,2,r.FLOAT,!1,16,0),r.enableVertexAttribArray(1),r.vertexAttribPointer(1,2,r.FLOAT,!1,16,8),r.bindVertexArray(null)},_getProgram(r){if(this._programs.has(r))return this._programs.get(r);const o=M[r];if(!o)return null;const t=this._compileProgram(L,o);if(!t)return null;const e=this._gl,l={},i={},u=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let n=0;n<u;n++){const s=e.getActiveUniform(t,n);l[s.name]=e.getUniformLocation(t,s.name),i[s.name]=s.type}const a={program:t,uniforms:l,uniformTypes:i};return this._programs.set(r,a),a},_compileProgram(r,o){const t=this._gl,e=t.createShader(t.VERTEX_SHADER);if(t.shaderSource(e,r),t.compileShader(e),!t.getShaderParameter(e,t.COMPILE_STATUS))return console.error("[CompositorWorker] Vertex shader error:",t.getShaderInfoLog(e)),t.deleteShader(e),null;const l=t.createShader(t.FRAGMENT_SHADER);if(t.shaderSource(l,o),t.compileShader(l),!t.getShaderParameter(l,t.COMPILE_STATUS))return console.error("[CompositorWorker] Fragment shader error:",t.getShaderInfoLog(l)),t.deleteShader(e),t.deleteShader(l),null;const i=t.createProgram();return t.attachShader(i,e),t.attachShader(i,l),t.bindAttribLocation(i,0,"a_position"),t.bindAttribLocation(i,1,"a_texCoord"),t.linkProgram(i),t.getProgramParameter(i,t.LINK_STATUS)?(t.deleteShader(e),t.deleteShader(l),i):(console.error("[CompositorWorker] Program link error:",t.getProgramInfoLog(i)),t.deleteProgram(i),t.deleteShader(e),t.deleteShader(l),null)},_resize(r,o){if(this._width===r&&this._height===o)return;const t=this._gl;this._width=r,this._height=o,this._canvas.width=r,this._canvas.height=o,t.viewport(0,0,r,o);for(let e=0;e<2;e++){this._fbos[e]&&t.deleteFramebuffer(this._fbos[e]),this._fboTextures[e]&&t.deleteTexture(this._fboTextures[e]);const l=t.createTexture();t.bindTexture(t.TEXTURE_2D,l),t.texImage2D(t.TEXTURE_2D,0,t.RGBA8,r,o,0,t.RGBA,t.UNSIGNED_BYTE,null),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE);const i=t.createFramebuffer();t.bindFramebuffer(t.FRAMEBUFFER,i),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,l,0),this._fboTextures[e]=l,this._fbos[e]=i}this._sourceTexture||(this._sourceTexture=t.createTexture()),t.bindFramebuffer(t.FRAMEBUFFER,null)},_getPassthroughProgram(){if(this._programs.has("_passthrough"))return this._programs.get("_passthrough");const o=this._compileProgram(L,`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
void main() {
  fragColor = texture(u_source, v_texCoord);
}`),t=this._gl,e={},l=t.getProgramParameter(o,t.ACTIVE_UNIFORMS);for(let u=0;u<l;u++){const a=t.getActiveUniform(o,u);e[a.name]=t.getUniformLocation(o,a.name)}const i={program:o,uniforms:e};return this._programs.set("_passthrough",i),i},uploadSource(r,o,t){const e=this._gl;this._resize(o,t),e.bindTexture(e.TEXTURE_2D,this._sourceTexture),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!0),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,e.RGBA,e.UNSIGNED_BYTE,r),e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL,!1),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),this._currentFBO=0,e.bindFramebuffer(e.FRAMEBUFFER,this._fbos[0]),e.viewport(0,0,o,t);const l=this._getPassthroughProgram();e.useProgram(l.program),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this._sourceTexture),e.uniform1i(l.uniforms.u_source,0),e.bindVertexArray(this._quadVAO),e.drawArrays(e.TRIANGLE_STRIP,0,4),e.bindFramebuffer(e.FRAMEBUFFER,null)},applyEffect(r,o){if(!this._initialized||!this._gl)return!1;r==="lumetri-color"&&o.curves_enabled&&(o._curveLUTData&&!o._curveLUT&&(o._curveLUT=this.uploadLUT("lumetri-curve",o._curveLUTData,256,1)),o._hslCurveLUTData&&!o._hslCurveLUT&&(o._hslCurveLUT=this.uploadLUT("lumetri-hsl-curve",o._hslCurveLUTData,256,5)));const t=B(r,o);if(!t)return!1;const e=this._gl;for(const l of t.passes){const i=this._getProgram(l);if(!i)return console.error("[CompositorWorker] Failed to get program for pass:",l),!1;const u=this._currentFBO,a=1-u;e.bindFramebuffer(e.FRAMEBUFFER,this._fbos[a]),e.viewport(0,0,this._width,this._height),e.useProgram(i.program),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this._fboTextures[u]),i.uniforms.u_source!==void 0&&e.uniform1i(i.uniforms.u_source,0),i.uniforms.u_texelSize!==void 0&&e.uniform2f(i.uniforms.u_texelSize,1/this._width,1/this._height);for(const[n,s]of Object.entries(t.uniforms)){const f=i.uniforms[n];if(f!==void 0){if(s&&typeof s=="object"&&s._isTexture){e.activeTexture(e.TEXTURE0+s._textureUnit),e.bindTexture(e.TEXTURE_2D,s._texture),e.uniform1i(f,s._textureUnit);continue}if(Array.isArray(s))s.length===2?e.uniform2fv(f,s):s.length===3?e.uniform3fv(f,s):s.length===4&&e.uniform4fv(f,s);else if(typeof s=="boolean")e.uniform1i(f,s?1:0);else{const h=i.uniformTypes[n];h===e.INT||h===e.BOOL||h===e.SAMPLER_2D?e.uniform1i(f,s):e.uniform1f(f,s)}}}e.bindVertexArray(this._quadVAO),e.drawArrays(e.TRIANGLE_STRIP,0,4),this._currentFBO=a}return!0},readResult(r){if(!this._initialized||!this._gl)return;const o=this._gl;o.bindFramebuffer(o.FRAMEBUFFER,null),o.viewport(0,0,this._width,this._height);const t=this._getPassthroughProgram();o.useProgram(t.program),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this._fboTextures[this._currentFBO]),o.uniform1i(t.uniforms.u_source,0),o.bindVertexArray(this._quadVAO),o.drawArrays(o.TRIANGLE_STRIP,0,4),r.drawImage(this._canvas,0,0)},hasShader(r){return X.has(r)},uploadLUT(r,o,t,e=1){if(!this._initialized||!this._gl)return null;const l=this._gl;let i=this._lutTextures.get(r);if(!i){const u=l.createTexture(),a=this._nextTexUnit++;i={texture:u,unit:a},this._lutTextures.set(r,i)}return l.activeTexture(l.TEXTURE0+i.unit),l.bindTexture(l.TEXTURE_2D,i.texture),o.length===t*e*4?l.texImage2D(l.TEXTURE_2D,0,l.RGBA,t,e,0,l.RGBA,l.UNSIGNED_BYTE,o):l.texImage2D(l.TEXTURE_2D,0,l.R8,t,e,0,l.RED,l.UNSIGNED_BYTE,o),l.texParameteri(l.TEXTURE_2D,l.TEXTURE_MIN_FILTER,l.LINEAR),l.texParameteri(l.TEXTURE_2D,l.TEXTURE_MAG_FILTER,l.LINEAR),l.texParameteri(l.TEXTURE_2D,l.TEXTURE_WRAP_S,l.CLAMP_TO_EDGE),l.texParameteri(l.TEXTURE_2D,l.TEXTURE_WRAP_T,l.CLAMP_TO_EDGE),{_isTexture:!0,_texture:i.texture,_textureUnit:i.unit}},compositeToOutput(r,o,t,e,l,i){if(!this._initialized||!this._gl)return!1;const u=this._gl;if(!this._compositeProgram){const s=this._compileProgram(z,V);if(!s)return!1;const f={},h=u.getProgramParameter(s,u.ACTIVE_UNIFORMS);for(let c=0;c<h;c++){const _=u.getActiveUniform(s,c);f[_.name]=u.getUniformLocation(s,_.name)}this._compositeProgram={program:s,uniforms:f}}const a=this._compositeProgram,n=this._buildMVPMatrix(e,i,o,t);if(u.bindFramebuffer(u.FRAMEBUFFER,null),u.viewport(0,0,this._width,this._height),u.enable(u.BLEND),u.blendFunc(u.SRC_ALPHA,u.ONE_MINUS_SRC_ALPHA),u.useProgram(a.program),u.activeTexture(u.TEXTURE0),u.bindTexture(u.TEXTURE_2D,this._fboTextures[this._currentFBO]),a.uniforms.u_source!==void 0&&u.uniform1i(a.uniforms.u_source,0),a.uniforms.u_opacity!==void 0&&u.uniform1f(a.uniforms.u_opacity,l),a.uniforms.u_crop!==void 0){const s=e?(e.cropLeft||0)/100:0,f=e?(e.cropTop||0)/100:0,h=e?(e.cropRight||0)/100:0,c=e?(e.cropBottom||0)/100:0;u.uniform4f(a.uniforms.u_crop,s,f,h,c)}return a.uniforms.u_mvp!==void 0&&u.uniformMatrix3fv(a.uniforms.u_mvp,!1,n),u.bindVertexArray(this._quadVAO),u.drawArrays(u.TRIANGLE_STRIP,0,4),u.disable(u.BLEND),r.drawImage(this._canvas,0,0),!0},_buildMVPMatrix(r,o,t,e){let l=[1,0,0,0,1,0,0,0,1];if(r){const i=r.uniformScale?r.scale/100:r.scaleWidth/100,u=r.scale/100,a=r.rotation*Math.PI/180,n=r.posX,s=r.posY,f=r.anchorX,h=r.anchorY,c=Math.cos(a),_=Math.sin(a),A=t/2,y=e/2;if(!(n===A&&s===y&&f===A&&h===y&&i===1&&u===1&&a===0)){const F=n*2/t-1,O=1-s*2/e,U=f*2/t,k=h*2/e,p=i,x=u;l[0]=c*p,l[1]=-_*p,l[3]=_*x,l[4]=c*x,l[6]=F-c*p*(U-1)-_*x*(k-1),l[7]=O+_*p*(U-1)-c*x*(k-1)}}return new Float32Array(l)}};let g=null,d=null,m=null,w=null,b=[null,null],E=[null,null],R=!1,D=!1;function G(r,o){return m||(m=new OffscreenCanvas(r,o),w=m.getContext("2d")),m.width!==r&&(m.width=r),m.height!==o&&(m.height=o),w}function I(r,o,t){b[r]||(b[r]=new OffscreenCanvas(o,t),E[r]=b[r].getContext("2d"));const e=b[r];return e.width!==o&&(e.width=o),e.height!==t&&(e.height=t),{canvas:e,ctx:E[r]}}function P(r,o,t,e){const l=o.width,i=o.height;if(!l||!i)return;const u=(t-l)/2,a=(e-i)/2;r.drawImage(o,u,a,l,i)}function N(r,o,t,e){const{cropLeft:l,cropTop:i,cropRight:u,cropBottom:a}=o;if(l<=0&&i<=0&&u<=0&&a<=0)return;const n=t,s=e,f=l/100*n,h=i/100*s,c=u/100*n,_=a/100*s;r.fillStyle="#000",h>0&&r.fillRect(0,0,n,h),_>0&&r.fillRect(0,s-_,n,_),f>0&&r.fillRect(0,0,f,s),c>0&&r.fillRect(n-c,0,c,s)}function q(r,o,t,e){const l=t,i=e,u=o.top/100*i,a=o.bottom/100*i,n=o.left/100*l,s=o.right/100*l;(u>0||a>0||n>0||s>0)&&(r.fillStyle="#000",u>0&&r.fillRect(0,0,l,u),a>0&&r.fillRect(0,i-a,l,a),n>0&&r.fillRect(0,0,n,i),s>0&&r.fillRect(l-s,0,s,i))}function S(r,o,t,e){const{frame:l,effects:i,needsProcessing:u}=o;if(!l)return;if(!u){P(r,l,t,e);return}const a=G(t,e);a.clearRect(0,0,t,e),P(a,l,t,e);let n=null,s=null,f=1;const h=[];for(const c of i)c.effectId==="motion"&&c.intrinsic?n=c.resolvedParams:c.effectId==="transform"?s=c.resolvedParams:c.effectId==="opacity"?f=c.resolvedParams.opacity/100:c.effectId==="crop"?q(a,c.resolvedParams,t,e):c.effectId==="time-remap"||c.effectId==="audio-volume"||c.effectId==="panner"||c.effectId==="channel-volume"||c.type==="video"&&h.push(c);if(h.length>0)if(R&&h.every(_=>v.hasShader(_.effectId))){v.uploadSource(m,t,e);for(const _ of h)v.applyEffect(_.effectId,_.resolvedParams);a.clearRect(0,0,t,e),v.readResult(a)}else for(const _ of h)_.canvas2dFn&&Y(a,_.effectId,_.resolvedParams);if(n&&N(a,n,t,e),r.save(),n){const c=n.scale/100,_=n.uniformScale?c:n.scaleWidth/100;r.translate(n.posX,n.posY),r.rotate(n.rotation*Math.PI/180),r.scale(_,c),r.translate(-n.anchorX,-n.anchorY)}if(s){const c=t/2,_=e/2;r.translate(c+s.posX,_+s.posY),r.rotate(s.rotation*Math.PI/180),r.scale(s.scaleX/100,s.scaleY/100),r.translate(-c,-_)}r.globalAlpha=f,r.drawImage(m,0,0),r.restore()}function Y(r,o,t,e,l){switch(o){case"gaussian-blur":t.radius>0&&(r.filter=`blur(${t.radius}px)`,r.drawImage(r.canvas,0,0),r.filter="none");break;case"hue-rotate":r.filter=`hue-rotate(${t.angle}deg)`,r.drawImage(r.canvas,0,0),r.filter="none";break;case"invert":t.amount>0&&(r.filter=`invert(${t.amount}%)`,r.drawImage(r.canvas,0,0),r.filter="none");break;case"grayscale":t.amount>0&&(r.filter=`grayscale(${t.amount}%)`,r.drawImage(r.canvas,0,0),r.filter="none");break;case"sepia":t.amount>0&&(r.filter=`sepia(${t.amount}%)`,r.drawImage(r.canvas,0,0),r.filter="none");break;case"drop-shadow":r.filter=`drop-shadow(${t.offsetX}px ${t.offsetY}px ${t.blur}px ${t.color||"#000"})`,r.drawImage(r.canvas,0,0),r.filter="none";break;case"brightness-contrast":{const i=t.brightness/100,u=(t.contrast+100)/100;r.filter=`brightness(${1+i}) contrast(${u})`,r.drawImage(r.canvas,0,0),r.filter="none";break}case"saturation":r.filter=`saturate(${(t.amount+100)/100})`,r.drawImage(r.canvas,0,0),r.filter="none";break}}function j(r,o,t,e){const{type:l,progress:i,clipA:u,clipB:a}=o,{canvas:n,ctx:s}=I(0,t,e);s.clearRect(0,0,t,e),u&&S(s,u,t,e);const{canvas:f,ctx:h}=I(1,t,e);switch(h.clearRect(0,0,t,e),a&&S(h,a,t,e),l){case"cross-dissolve":r.globalAlpha=1-i,r.drawImage(n,0,0,t,e),r.globalAlpha=i,r.drawImage(f,0,0,t,e),r.globalAlpha=1;break;case"dip-to-black":case"dip-to-white":{const c=l==="dip-to-white"?"#fff":"#000";if(i<.5){const _=i*2;r.drawImage(n,0,0,t,e),r.globalAlpha=_,r.fillStyle=c,r.fillRect(0,0,t,e),r.globalAlpha=1}else{const _=(i-.5)*2;r.fillStyle=c,r.fillRect(0,0,t,e),r.globalAlpha=_,r.drawImage(f,0,0,t,e),r.globalAlpha=1}break}case"wipe-left":case"wipe-right":case"wipe-up":case"wipe-down":{const c=l.split("-")[1];r.drawImage(n,0,0,t,e),r.save(),r.beginPath(),c==="left"?r.rect(0,0,t*i,e):c==="right"?r.rect(t*(1-i),0,t*i,e):c==="up"?r.rect(0,0,t,e*i):r.rect(0,e*(1-i),t,e*i),r.clip(),r.drawImage(f,0,0,t,e),r.restore();break}case"slide-left":r.drawImage(n,0,0,t,e),r.drawImage(f,t*(1-i),0,t,e);break;case"push-left":{const c=t*i;r.drawImage(n,-c,0,t,e),r.drawImage(f,t-c,0,t,e);break}default:r.globalAlpha=1-i,r.drawImage(n,0,0,t,e),r.globalAlpha=i,r.drawImage(f,0,0,t,e),r.globalAlpha=1}}self.onmessage=r=>{const{type:o}=r.data;if(o==="init"){g=r.data.canvas,d=g.getContext("2d",{alpha:!1}),g.width=r.data.width,g.height=r.data.height,R=v.init(),self.postMessage({type:"init_done",glAvailable:R});return}if(o==="resize"){g&&(g.width=r.data.width,g.height=r.data.height);return}if(o==="render"){const{frame:t,command:e}=r.data;if(!g||!d){self.postMessage({type:"rendered",frame:t});return}try{D=!0;const{canvasWidth:l,canvasHeight:i,tracks:u}=e;d.fillStyle="#000000",d.fillRect(0,0,l,i);for(let a=u.length-1;a>=0;a--){const n=u[a];for(const s of n.clips)S(d,s,l,i);for(const s of n.transitions)j(d,s,l,i)}for(const a of u){for(const n of a.clips)n.frame&&n.frame.close();for(const n of a.transitions)n.clipA&&n.clipA.frame&&n.clipA.frame.close(),n.clipB&&n.clipB.frame&&n.clipB.frame.close()}}catch(l){console.error("[CompositorWorker] Render error:",l)}finally{D=!1,self.postMessage({type:"rendered",frame:t})}return}if(o==="destroy"){g=null,d=null,m=null,w=null,b=[null,null],E=[null,null];return}};
//# sourceMappingURL=CompositorWorker-Dz-_h-kk.js.map
