const F={DEBUG:0,INFO:1,WARN:2,ERROR:3};let j=F.INFO;const W=(o,e,r,t,i)=>{if(o<j)return;const s=`[NLE] [${e}]`;i!==void 0?r(`${s} ${t}`,i):r(`${s} ${t}`)},T={setLevel(o){o in F&&(j=F[o])},debug(o,e){W(F.DEBUG,"DEBUG",console.debug,o,e)},info(o,e){W(F.INFO,"INFO",console.info,o,e)},warn(o,e){W(F.WARN,"WARN",console.warn,o,e)},error(o,e){W(F.ERROR,"ERROR",console.error,o,e)}};function K(){let o=null,e=null,r=null;return{async init(t,i={}){const s=await import("./mp4box.all-DICvI8SL.js");this._mp4box=s;const f=s.createFile||s.default?.createFile;if(!f)throw new Error("mp4box module missing createFile");return o=f(),new Promise((c,u)=>{o.onReady=l=>{for(const n of l.tracks)n.type==="video"&&!e?e=n:n.type==="audio"&&!r&&(r=n);if(e){const n=o.getTrackById(e.id),m=this._getCodecDescription(n);i.onVideoConfig?.({codec:e.codec,codedWidth:e.video.width,codedHeight:e.video.height,description:m}),o.setExtractionOptions(e.id,"video",{nbSamples:1e3})}this._started=!0,o.start(),c(l)},o.onError=l=>{T.error("MP4Box error:",l),u(l)},o.onSamples=(l,n,m)=>{for(const a of m)if(n==="video"){const x=new EncodedVideoChunk({type:a.is_sync?"key":"delta",timestamp:a.cts*1e6/a.timescale,duration:a.duration*1e6/a.timescale,data:a.data});i.onVideoChunk?.(x,a)}},t.fileStart=0,o.appendBuffer(t)})},_mp4box:null,_serializeAvcC(t){const i=_=>{if(!_||typeof _.byteLength!="number")return null;if(_.buffer){const R=_.byteOffset||0;return new Uint8Array(_.buffer.slice(R,R+_.byteLength))}return new Uint8Array(_)},s=[];for(const _ of t.SPS||[]){const R=i(_.data)||i(_.nalu)||i(_);R&&R.byteLength>0&&s.push(R)}const f=[];for(const _ of t.PPS||[]){const R=i(_.data)||i(_.nalu)||i(_);R&&R.byteLength>0&&f.push(R)}const c=t.AVCProfileIndication||0,u=[100,110,122,144].includes(c),l=u?(t.SPS_Ext||[]).map(_=>i(_.data)||i(_.nalu)||i(_)||new Uint8Array(0)).filter(_=>_.byteLength>0):[];let n=6;for(const _ of s)n+=2+_.byteLength;n+=1;for(const _ of f)n+=2+_.byteLength;if(u){n+=4;for(const _ of l)n+=2+_.byteLength}const m=new ArrayBuffer(n),a=new DataView(m),x=new Uint8Array(m);let v=0;a.setUint8(v++,t.configurationVersion||1),a.setUint8(v++,c),a.setUint8(v++,t.profile_compatibility||0),a.setUint8(v++,t.AVCLevelIndication||0),a.setUint8(v++,252|(t.lengthSizeMinusOne??3)&3),a.setUint8(v++,224|s.length&31);for(const _ of s)a.setUint16(v,_.byteLength),v+=2,x.set(_,v),v+=_.byteLength;a.setUint8(v++,f.length&255);for(const _ of f)a.setUint16(v,_.byteLength),v+=2,x.set(_,v),v+=_.byteLength;if(u){a.setUint8(v++,252|(t.chroma_format??1)&3),a.setUint8(v++,248|(t.bit_depth_luma_minus8??0)&7),a.setUint8(v++,248|(t.bit_depth_chroma_minus8??0)&7),a.setUint8(v++,l.length&255);for(const _ of l)a.setUint16(v,_.byteLength),v+=2,x.set(_,v),v+=_.byteLength}return new Uint8Array(m)},_getCodecDescription(t){try{const i=t.mdia.minf.stbl.stsd.entries[0],s=i.avcC||i.hvcC||i.vpcC||i.av1C;if(!s)return;const f=this._mp4box,c=f?.DataStream||f?.default?.DataStream;if(c)try{const u=f?.Endianness?.BIG_ENDIAN??1,l=new c(void 0,0,u);s.write(l);const n=new Uint8Array(l.buffer.slice(8,l.position));if(n.byteLength>0)return T.info(`Codec description via DataStream: ${n.byteLength} bytes`),n}catch(u){T.warn("DataStream serialization failed, falling back to manual:",u.message)}return i.avcC?this._serializeAvcC(i.avcC):void 0}catch(i){T.warn("Could not extract codec description:",i);return}},_started:!1,start(){o&&!this._started&&(this._started=!0,o.start())},getVideoTrackInfo(){return e?{codec:e.codec,width:e.video.width,height:e.video.height,duration:e.duration/e.timescale,frameCount:e.nb_samples,frameRate:e.nb_samples/(e.duration/e.timescale),timescale:e.timescale}:null},getAudioTrackInfo(){return r?{codec:r.codec,sampleRate:r.audio.sample_rate,channels:r.audio.channel_count,duration:r.duration/r.timescale}:null},seek(t){if(!o||!e)return;const i=t*e.timescale;o.seek(i,!0)},cleanup(){o&&(o.flush(),o=null),e=null,r=null,this._started=!1}}}function J(){let o=null,e=null,r=null,t=[],i=null,s=[],f=null,c=null,u=null,l=!1,n=null,m=-1,a=null;function x(w){return new EncodedVideoChunk({type:w.type,timestamp:w.timestamp,duration:w.duration,data:new Uint8Array(i,w.offset,w.size)})}function v(){for(const w of s)w.close();s=[]}function _(){if(e)try{e.close()}catch{}a=null,e=new VideoDecoder({output:w=>{s.push(w)},error:w=>{a=w,T.error("VideoDecoder error:",w)}}),e.configure({...r,hardwareAcceleration:"prefer-hardware",optimizeForLatency:!l})}function R(){e&&e.state==="configured"&&!a?(e.reset(),e.configure({...r,hardwareAcceleration:"prefer-hardware",optimizeForLatency:!l})):_()}return{async init(w,b){return c||(c=(async()=>{o=K(),i=b;const d=[];let C=null;if(await o.init(b,{onVideoConfig(g){C=g},onVideoChunk(g,S){d.push({type:S.is_sync?"key":"delta",timestamp:g.timestamp,duration:g.duration,offset:S.offset,size:S.size})}}),r=C,t=d,f=o.getVideoTrackInfo(),o.cleanup(),o=null,!r)throw new Error("No video config from demuxer");if(!(await VideoDecoder.isConfigSupported(r)).supported)throw new Error(`VideoDecoder config not supported: ${r.codec}`);T.info(`WebCodecsDecoder: ${t.length} chunks, ${f.width}x${f.height}, ${f.frameRate.toFixed(1)}fps`)})(),c)},async getFrameAt(w){if(!r||t.length===0)return null;for(;u;)await u;let b;u=new Promise(d=>{b=d});try{return await this._decodeFrameAt(w)}finally{u=null,b()}},async _decodeFrameAt(w){const b=w*1e6;let d=0;for(let h=t.length-1;h>=0;h--)if(t[h].type==="key"&&t[h].timestamp<=b){d=h;break}let C=d,y=Math.abs(t[d].timestamp-b);for(let h=d+1;h<t.length&&t[h].type!=="key";h++){const p=Math.abs(t[h].timestamp-b);p<y&&(y=p,C=h)}v(),a=null,R();for(let h=d;h<=C&&e.state==="configured";h++)e.decode(x(t[h]));if(e.state==="configured")try{await e.flush()}catch(h){T.warn("VideoDecoder flush failed, using partial output:",h.message)}if(a){if(s.length===0)throw a;a=null}let g=null,S=1/0;for(const h of s){const p=Math.abs(h.timestamp-b);p<S?(S=p,g&&g.close(),g=h):h.close()}return s=[],g},async getImageBitmapAt(w){const b=await this.getFrameAt(w);if(!b)return null;try{const d=await createImageBitmap(b);return b.close(),d}catch{return b.close(),null}},startSequentialMode(){l=!0,n=new Map,m=-1},endSequentialMode(){if(l=!1,n){for(const w of n.values())w.close?.();n=null}m=-1},async getSequentialImageBitmap(w){if(!r||t.length===0)return null;const b=w*1e6;let d=0,C=1/0;for(let h=0;h<t.length;h++){const p=Math.abs(t[h].timestamp-b);if(p<C&&(C=p,d=h),t[h].timestamp>b+5e4)break}let y=0;for(let h=d;h>=0;h--)if(t[h].type==="key"){y=h;break}if(m!==y){let h=t.length-1;for(let p=y+1;p<t.length;p++)if(t[p].type==="key"){h=p-1;break}if(n){for(const p of n.values())p.close();n=new Map}v(),a=null,R();for(let p=y;p<=h&&e.state==="configured";p++)e.decode(x(t[p]));if(e.state==="configured")try{await e.flush()}catch(p){T.warn("Sequential flush failed, using partial output:",p.message)}if(a)throw v(),a;for(const p of s){try{const D=await createImageBitmap(p);n.set(p.timestamp,D)}catch{}p.close()}s=[],m=y}let g=null,S=1/0;for(const[h,p]of n){const D=Math.abs(h-b);D<S&&(S=D,g=p)}if(!g)return null;try{return await createImageBitmap(g)}catch{return null}},getChunkMetasInRange(w,b){if(t.length===0)return[];let d=0;for(let g=t.length-1;g>=0;g--)if(t[g].type==="key"&&t[g].timestamp<=w){d=g;break}let C=t.length-1;for(let g=d;g<t.length;g++)if(g>d&&t[g].type==="key"){let S=!1;for(let h=g;h<t.length&&!(h>g&&t[h].type==="key");h++)if(t[h].timestamp<=b){S=!0;break}if(!S){C=g-1;break}}const y=[];for(let g=d;g<=C;g++)y.push(t[g]);return y},getSourceBuffer(){return i},getCodecConfig(){return r},isHealthy(){return a?!1:!e&&r?!0:e&&e.state==="configured"},getTrackInfo(){return f},close(){if(u=null,v(),n){for(const w of n.values())w.close?.();n=null}if(m=-1,l=!1,e){try{e.close()}catch{}e=null}o&&(o.cleanup(),o=null),t=[],i=null,r=null,f=null,c=null,a=null}}}function Q(){const o=new Map,e=new Map;return{registerImage(r,t){e.set(r,{type:"image",blob:t})},registerVideo(r,t){e.set(r,{type:"video",buffer:t})},async getImageBitmap(r){if(o.has(r))return o.get(r);const t=e.get(r);if(!t||t.type!=="image")return null;const i=await createImageBitmap(t.blob);return o.set(r,i),i},async getVideoFrame(r,t){const i=e.get(r);if(!i)return null;if(i.type==="frames"){const s=Math.round(t*1e3);return i.frames.get(s)||null}if(i.type==="video"&&typeof VideoDecoder<"u")try{i.decoder||(console.log(`[WorkerMediaDecoder] Creating WebCodecsDecoder for ${r}, buffer=${i.buffer.byteLength} bytes`),i.decoder=J(),await i.decoder.init(r,i.buffer),console.log(`[WorkerMediaDecoder] Decoder initialized for ${r}`));const s=await i.decoder.getImageBitmapAt(t);return s||console.warn(`[WorkerMediaDecoder] getImageBitmapAt(${t}) returned null for ${r}`),s}catch(s){return console.error(`[WorkerMediaDecoder] WebCodecs decode FAILED for ${r}: ${s.message}`,s),i.decoder=null,null}return console.warn(`[WorkerMediaDecoder] No decode path for ${r}: type=${i.type}, VideoDecoder=${typeof VideoDecoder}`),null},registerFrames(r,t){e.set(r,{type:"frames",frames:t})},cleanup(){for(const[,r]of o)r.close();o.clear();for(const[,r]of e)r.decoder&&r.decoder.close();e.clear()}}}function z(o,e,r,t){const i=e.videoWidth||e.naturalWidth||e.width,s=e.videoHeight||e.naturalHeight||e.height;if(!i||!s)return;const f=(r-i)/2,c=(t-s)/2;o.drawImage(e,f,c,i,s)}function Z(o,e,r,t){let i=null,s=null,f=1;const c=[],u=[];for(const l of o){const n=e(l.effectId);if(!n||n.type!=="video")continue;const m=r(l,t);l.effectId==="motion"&&l.intrinsic?s=m:l.effectId==="transform"?i=m:l.effectId==="opacity"?f=m.opacity/100:l.effectId==="crop"?u.push({fx:l,def:n,params:m}):l.effectId==="time-remap"||l.effectId==="audio-volume"||l.effectId==="panner"||l.effectId==="channel-volume"||c.push({fx:l,def:n,params:m})}return{transformParams:i,motionParams:s,opacity:f,pixelEffects:c,cropEffects:u}}function ee(o,e,r,t){const{cropLeft:i,cropTop:s,cropRight:f,cropBottom:c}=e;if(i<=0&&s<=0&&f<=0&&c<=0)return;const u=r,l=t,n=i/100*u,m=s/100*l,a=f/100*u,x=c/100*l;o.fillStyle="#000",m>0&&o.fillRect(0,0,u,m),x>0&&o.fillRect(0,l-x,u,x),n>0&&o.fillRect(0,0,n,l),a>0&&o.fillRect(u-a,0,a,l)}function te(o,e,r,t,i,s,f){if(o.save(),f){const c=f.scale/100,u=f.uniformScale?c:f.scaleWidth/100;o.translate(f.posX,f.posY),o.rotate(f.rotation*Math.PI/180),o.scale(u,c),o.translate(-f.anchorX,-f.anchorY)}if(e){const c=i/2,u=s/2;o.translate(c+e.posX,u+e.posY),o.rotate(e.rotation*Math.PI/180),o.scale(e.scaleX/100,e.scaleY/100),o.translate(-c,-u)}o.globalAlpha=r,o.drawImage(t,0,0),o.restore()}function re(o,e,r){switch(e){case"gaussian-blur":r.radius>0&&(o.filter=`blur(${r.radius}px)`,o.drawImage(o.canvas,0,0),o.filter="none");break;case"hue-rotate":o.filter=`hue-rotate(${r.angle}deg)`,o.drawImage(o.canvas,0,0),o.filter="none";break;case"invert":r.amount>0&&(o.filter=`invert(${r.amount}%)`,o.drawImage(o.canvas,0,0),o.filter="none");break;case"grayscale":r.amount>0&&(o.filter=`grayscale(${r.amount}%)`,o.drawImage(o.canvas,0,0),o.filter="none");break;case"sepia":r.amount>0&&(o.filter=`sepia(${r.amount}%)`,o.drawImage(o.canvas,0,0),o.filter="none");break;case"brightness-contrast":{const t=r.brightness/100,i=(r.contrast+100)/100;o.filter=`brightness(${1+t}) contrast(${i})`,o.drawImage(o.canvas,0,0),o.filter="none";break}case"saturation":o.filter=`saturate(${(r.amount+100)/100})`,o.drawImage(o.canvas,0,0),o.filter="none";break;case"drop-shadow":o.filter=`drop-shadow(${r.offsetX}px ${r.offsetY}px ${r.blur}px ${r.color||"#000"})`,o.drawImage(o.canvas,0,0),o.filter="none";break}}const X=`#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`,H={"brightness-contrast":`#version 300 es
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
}`};function oe(o,e){switch(o){case"brightness-contrast":return{passes:["brightness-contrast"],uniforms:{u_brightness:e.brightness/100,u_contrast:(e.contrast+100)/100}};case"saturation":return{passes:["saturation"],uniforms:{u_amount:(e.amount+100)/100}};case"hue-rotate":return{passes:["hue-rotate"],uniforms:{u_angle:e.angle}};case"gaussian-blur":return e.radius<=0?null:{passes:["gaussian-blur-h","gaussian-blur-v"],uniforms:{u_radius:e.radius}};case"invert":return e.amount<=0?null:{passes:["invert"],uniforms:{u_amount:e.amount/100}};case"grayscale":return e.amount<=0?null:{passes:["grayscale"],uniforms:{u_amount:e.amount/100}};case"sepia":return e.amount<=0?null:{passes:["sepia"],uniforms:{u_amount:e.amount/100}};case"sharpen":return e.amount<=0?null:{passes:["sharpen"],uniforms:{u_amount:e.amount/100}};case"levels":return{passes:["levels"],uniforms:{u_inputBlack:e.inputBlack/255,u_inputWhite:e.inputWhite/255,u_gamma:e.gamma,u_outputBlack:e.outputBlack/255,u_outputWhite:e.outputWhite/255}};case"hsl-adjust":return e.hue===0&&e.saturation===0&&e.lightness===0?null:{passes:["hsl-adjust"],uniforms:{u_hue:e.hue,u_saturation:e.saturation/100,u_lightness:e.lightness/100}};case"vignette":return e.amount<=0?null:{passes:["vignette"],uniforms:{u_amount:e.amount/100,u_size:e.size/100}};case"drop-shadow":return{passes:["drop-shadow"],uniforms:{u_offsetX:e.offsetX,u_offsetY:e.offsetY,u_blur:e.blur,u_color:V(e.color||"#000000")}};case"lumetri-color":{const r=[],t={},i=e.basic_enabled!==!1,s=!!e.creative_enabled,f=!!e.wheels_enabled,c=!!e.vignette_enabled;if(i||s||f||c){r.push("lumetri-color-main"),t.u_basic_enabled=i?1:0,t.u_temperature=e.temperature||0,t.u_tint=e.tint||0,t.u_exposure=e.exposure||0,t.u_contrast=e.contrast||0,t.u_highlights=e.highlights||0,t.u_shadows=e.shadows||0,t.u_whites=e.whites||0,t.u_blacks=e.blacks||0,t.u_saturation=e.saturation!=null?e.saturation:100,t.u_vibrance=e.vibrance||0,t.u_creative_enabled=s?1:0,t.u_faded_film=e.faded_film||0,t.u_creative_vibrance=e.creative_vibrance||0,t.u_creative_saturation=e.creative_saturation!=null?e.creative_saturation:100,t.u_shadow_tint=V(e.shadow_tint||"#808080"),t.u_highlight_tint=V(e.highlight_tint||"#808080"),t.u_tint_balance=e.tint_balance||0,t.u_wheels_enabled=f?1:0;const u=$(e.shadow_hue||0,e.shadow_sat||0);t.u_shadow_wheel_r=u[0],t.u_shadow_wheel_g=u[1],t.u_shadow_wheel_b=u[2],t.u_shadow_luma=e.shadow_luma||0;const l=$(e.midtone_hue||0,e.midtone_sat||0);t.u_midtone_wheel_r=l[0],t.u_midtone_wheel_g=l[1],t.u_midtone_wheel_b=l[2],t.u_midtone_luma=e.midtone_luma||0;const n=$(e.highlight_hue||0,e.highlight_sat||0);t.u_highlight_wheel_r=n[0],t.u_highlight_wheel_g=n[1],t.u_highlight_wheel_b=n[2],t.u_highlight_luma=e.highlight_luma||0,t.u_vignette_enabled=c?1:0,t.u_vignette_amount=e.vignette_amount||0,t.u_vignette_midpoint=e.vignette_midpoint!=null?e.vignette_midpoint:50,t.u_vignette_roundness=e.vignette_roundness!=null?e.vignette_roundness:50,t.u_vignette_feather=e.vignette_feather!=null?e.vignette_feather:50}return s&&e.creative_sharpen>0&&(r.push("sharpen"),t.u_amount=e.creative_sharpen/100),e.curves_enabled&&e._curveLUT&&(r.push("lumetri-color-curves"),t.u_curveLUT=e._curveLUT,t.u_hsl_curves_active=e._hslCurveLUT?1:0,e._hslCurveLUT&&(t.u_hslCurveLUT=e._hslCurveLUT)),e.hsl_enabled&&(r.push("lumetri-color-secondary"),t.u_hsl_hue_center=e.hsl_hue_center||0,t.u_hsl_hue_range=e.hsl_hue_range!=null?e.hsl_hue_range:30,t.u_hsl_sat_center=e.hsl_sat_center!=null?e.hsl_sat_center:50,t.u_hsl_sat_range=e.hsl_sat_range!=null?e.hsl_sat_range:50,t.u_hsl_luma_center=e.hsl_luma_center!=null?e.hsl_luma_center:50,t.u_hsl_luma_range=e.hsl_luma_range!=null?e.hsl_luma_range:50,t.u_hsl_denoise=e.hsl_denoise!=null?e.hsl_denoise:10,t.u_hsl_temperature=e.hsl_temperature||0,t.u_hsl_tint=e.hsl_tint||0,t.u_hsl_contrast=e.hsl_contrast||0,t.u_hsl_saturation=e.hsl_saturation!=null?e.hsl_saturation:100,t.u_hsl_show_mask=e.hsl_show_mask?1:0,t.u_hsl_sharpen=e.hsl_sharpen||0),r.length===0?null:{passes:r,uniforms:t}}default:return null}}function V(o){const e=parseInt(o.slice(1,3),16)/255,r=parseInt(o.slice(3,5),16)/255,t=parseInt(o.slice(5,7),16)/255;return[e,r,t]}function $(o,e){const r=e/100,t=o/360,i=.5+.5,s=0,f=(n,m,a)=>(a<0&&(a+=1),a>1&&(a-=1),a<1/6?n+(m-n)*6*a:a<1/2?m:a<2/3?n+(m-n)*(2/3-a)*6:n),c=f(s,i,t+1/3)*r,u=f(s,i,t)*r,l=f(s,i,t-1/3)*r;return[c-.5*r,u-.5*r,l-.5*r]}const Y=new Set([...Object.keys(H),"lumetri-color"]),U={_gl:null,_canvas:null,_programs:new Map,_quadVAO:null,_sourceTexture:null,_fbos:[null,null],_fboTextures:[null,null],_currentFBO:0,_width:0,_height:0,_initialized:!1,_supportChecked:!1,_supported:!1,_lutTextures:new Map,_nextTexUnit:1,isSupported(){if(this._supportChecked)return this._supported;if(this._supportChecked=!0,typeof OffscreenCanvas<"u")try{if(new OffscreenCanvas(1,1).getContext("webgl2"))return this._supported=!0,!0}catch{}try{const e=document.createElement("canvas").getContext("webgl2");this._supported=!!e}catch{this._supported=!1}return this._supported},init(o){return this._initialized?!0:(this._canvas=o||(typeof OffscreenCanvas<"u"?new OffscreenCanvas(1,1):document.createElement("canvas")),this._gl=this._canvas.getContext("webgl2",{premultipliedAlpha:!1,alpha:!0,preserveDrawingBuffer:!0,antialias:!1}),this._gl?(this._setupQuad(),this._initialized=!0,T.info("GLEffectRenderer initialized (WebGL 2.0)"),!0):(T.warn("WebGL 2.0 not available, falling back to Canvas2D effects"),!1))},_setupQuad(){const o=this._gl,e=new Float32Array([-1,-1,0,0,1,-1,1,0,-1,1,0,1,1,1,1,1]);this._quadVAO=o.createVertexArray(),o.bindVertexArray(this._quadVAO);const r=o.createBuffer();o.bindBuffer(o.ARRAY_BUFFER,r),o.bufferData(o.ARRAY_BUFFER,e,o.STATIC_DRAW),o.enableVertexAttribArray(0),o.vertexAttribPointer(0,2,o.FLOAT,!1,16,0),o.enableVertexAttribArray(1),o.vertexAttribPointer(1,2,o.FLOAT,!1,16,8),o.bindVertexArray(null)},_getProgram(o){if(this._programs.has(o))return this._programs.get(o);const e=H[o];if(!e)return null;const r=this._compileProgram(X,e);if(!r)return null;const t=this._gl,i={},s={},f=t.getProgramParameter(r,t.ACTIVE_UNIFORMS);for(let u=0;u<f;u++){const l=t.getActiveUniform(r,u);i[l.name]=t.getUniformLocation(r,l.name),s[l.name]=l.type}const c={program:r,uniforms:i,uniformTypes:s};return this._programs.set(o,c),c},_compileProgram(o,e){const r=this._gl,t=r.createShader(r.VERTEX_SHADER);if(r.shaderSource(t,o),r.compileShader(t),!r.getShaderParameter(t,r.COMPILE_STATUS))return T.error("Vertex shader compile error:",r.getShaderInfoLog(t)),r.deleteShader(t),null;const i=r.createShader(r.FRAGMENT_SHADER);if(r.shaderSource(i,e),r.compileShader(i),!r.getShaderParameter(i,r.COMPILE_STATUS))return T.error("Fragment shader compile error:",r.getShaderInfoLog(i)),r.deleteShader(t),r.deleteShader(i),null;const s=r.createProgram();return r.attachShader(s,t),r.attachShader(s,i),r.bindAttribLocation(s,0,"a_position"),r.bindAttribLocation(s,1,"a_texCoord"),r.linkProgram(s),r.getProgramParameter(s,r.LINK_STATUS)?(r.deleteShader(t),r.deleteShader(i),s):(T.error("Program link error:",r.getProgramInfoLog(s)),r.deleteProgram(s),r.deleteShader(t),r.deleteShader(i),null)},_resize(o,e){if(this._width===o&&this._height===e)return;const r=this._gl;this._width=o,this._height=e,this._canvas.width=o,this._canvas.height=e,r.viewport(0,0,o,e);for(let t=0;t<2;t++){this._fbos[t]&&r.deleteFramebuffer(this._fbos[t]),this._fboTextures[t]&&r.deleteTexture(this._fboTextures[t]);const i=r.createTexture();r.bindTexture(r.TEXTURE_2D,i),r.texImage2D(r.TEXTURE_2D,0,r.RGBA8,o,e,0,r.RGBA,r.UNSIGNED_BYTE,null),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE);const s=r.createFramebuffer();r.bindFramebuffer(r.FRAMEBUFFER,s),r.framebufferTexture2D(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,i,0),this._fboTextures[t]=i,this._fbos[t]=s}this._sourceTexture||(this._sourceTexture=r.createTexture()),r.bindFramebuffer(r.FRAMEBUFFER,null)},uploadSource(o,e,r){const t=this._gl;this._resize(e,r),t.bindTexture(t.TEXTURE_2D,this._sourceTexture),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!0),t.texImage2D(t.TEXTURE_2D,0,t.RGBA8,t.RGBA,t.UNSIGNED_BYTE,o),t.pixelStorei(t.UNPACK_FLIP_Y_WEBGL,!1),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),this._currentFBO=0,t.bindFramebuffer(t.FRAMEBUFFER,this._fbos[0]),t.viewport(0,0,e,r);const i=this._getPassthroughProgram();t.useProgram(i.program),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,this._sourceTexture),t.uniform1i(i.uniforms.u_source,0),t.bindVertexArray(this._quadVAO),t.drawArrays(t.TRIANGLE_STRIP,0,4),t.bindFramebuffer(t.FRAMEBUFFER,null)},_getPassthroughProgram(){if(this._programs.has("_passthrough"))return this._programs.get("_passthrough");const e=this._compileProgram(X,`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
void main() {
  fragColor = texture(u_source, v_texCoord);
}`),r=this._gl,t={},i=r.getProgramParameter(e,r.ACTIVE_UNIFORMS);for(let f=0;f<i;f++){const c=r.getActiveUniform(e,f);t[c.name]=r.getUniformLocation(e,c.name)}const s={program:e,uniforms:t};return this._programs.set("_passthrough",s),s},applyEffect(o,e){if(!this._initialized||!this._gl)return!1;const r=oe(o,e);if(!r)return!1;const t=this._gl;for(const i of r.passes){const s=this._getProgram(i);if(!s)return T.warn(`No GL shader for pass: ${i}`),!1;const f=this._currentFBO,c=1-f;t.bindFramebuffer(t.FRAMEBUFFER,this._fbos[c]),t.viewport(0,0,this._width,this._height),t.useProgram(s.program),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,this._fboTextures[f]),s.uniforms.u_source!==void 0&&t.uniform1i(s.uniforms.u_source,0),s.uniforms.u_texelSize!==void 0&&t.uniform2f(s.uniforms.u_texelSize,1/this._width,1/this._height);for(const[u,l]of Object.entries(r.uniforms)){const n=s.uniforms[u];if(n!==void 0)if(l&&typeof l=="object"&&l._isTexture)t.activeTexture(t.TEXTURE0+l._textureUnit),t.bindTexture(t.TEXTURE_2D,l._texture),t.uniform1i(n,l._textureUnit);else if(Array.isArray(l))l.length===2?t.uniform2fv(n,l):l.length===3?t.uniform3fv(n,l):l.length===4&&t.uniform4fv(n,l);else if(typeof l=="boolean")t.uniform1i(n,l?1:0);else{const m=s.uniformTypes[u];m===t.INT||m===t.BOOL||m===t.SAMPLER_2D?t.uniform1i(n,l):t.uniform1f(n,l)}}t.bindVertexArray(this._quadVAO),t.drawArrays(t.TRIANGLE_STRIP,0,4),this._currentFBO=c}return!0},readResult(o){if(!this._initialized||!this._gl)return;const e=this._gl;e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,this._width,this._height);const r=this._getPassthroughProgram();e.useProgram(r.program),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this._fboTextures[this._currentFBO]),e.uniform1i(r.uniforms.u_source,0),e.bindVertexArray(this._quadVAO),e.drawArrays(e.TRIANGLE_STRIP,0,4),o.drawImage(this._canvas,0,0)},uploadLUT(o,e,r,t=1){if(!this._initialized||!this._gl)return null;const i=this._gl;let s=this._lutTextures.get(o);if(!s){const f=i.createTexture(),c=this._nextTexUnit++;s={texture:f,unit:c},this._lutTextures.set(o,s)}return i.activeTexture(i.TEXTURE0+s.unit),i.bindTexture(i.TEXTURE_2D,s.texture),e.length===r*t*4?i.texImage2D(i.TEXTURE_2D,0,i.RGBA,r,t,0,i.RGBA,i.UNSIGNED_BYTE,e):i.texImage2D(i.TEXTURE_2D,0,i.R8,r,t,0,i.RED,i.UNSIGNED_BYTE,e),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAG_FILTER,i.LINEAR),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE),{_isTexture:!0,_texture:s.texture,_textureUnit:s.unit}},hasShader(o){return Y.has(o)},cleanup(){if(!this._gl)return;const o=this._gl;for(const[,e]of this._programs)o.deleteProgram(e.program);this._programs.clear();for(let e=0;e<2;e++)this._fbos[e]&&o.deleteFramebuffer(this._fbos[e]),this._fboTextures[e]&&o.deleteTexture(this._fboTextures[e]);this._fbos=[null,null],this._fboTextures=[null,null],this._sourceTexture&&o.deleteTexture(this._sourceTexture),this._sourceTexture=null;for(const[,e]of this._lutTextures)o.deleteTexture(e.texture);this._lutTextures.clear(),this._nextTexUnit=1,this._quadVAO&&o.deleteVertexArray(this._quadVAO),this._quadVAO=null,this._gl=null,this._canvas=null,this._initialized=!1,this._supportChecked=!1,this._supported=!1,this._width=0,this._height=0}};function ie(o,e,r,t,i,s=30){let f=s;const c=new OffscreenCanvas(o,e),u=c.getContext("2d",{willReadFrequently:!0}),l=new OffscreenCanvas(o,e),n=l.getContext("2d",{willReadFrequently:!0});let m=null;return{canvas:c,setFps(a){f=a},async compositeFrame(a,x,v){u.fillStyle="#000000",u.fillRect(0,0,o,e);let _=0;for(let R=x.length-1;R>=0;R--){const w=x[R];if(!(w.muted||w.type!=="video"))for(const b of w.clips){if(b.disabled)continue;const d=Math.round((b.sourceOutFrame-b.sourceInFrame)/(b.speed||1));if(a<b.startFrame||a>=b.startFrame+d)continue;const C=v(b.mediaId);if(!C)continue;const y=a-b.startFrame,S=(b.sourceInFrame+Math.round(y*(b.speed||1)))/f;await this._renderClip(u,C,S,b,a),_++}}return a===0&&T.info(`[WorkerCompositor] frame 0: ${_} clips rendered, canvas=${o}x${e}`),c},async _renderClip(a,x,v,_,R){const w=(_.effects||[]).filter(h=>h.enabled);if(w.length===0){const h=await this._getSource(x,v);h&&z(a,h,o,e);return}n.clearRect(0,0,o,e);const b=await this._getSource(x,v);b&&z(n,b,o,e);const{transformParams:d,motionParams:C,opacity:y,pixelEffects:g,cropEffects:S}=Z(w,t,i,R);for(const{params:h}of S){const p=o,D=e,I=h.top/100*D,M=h.bottom/100*D,P=h.left/100*p,B=h.right/100*p;n.fillStyle="#000",I>0&&n.fillRect(0,0,p,I),M>0&&n.fillRect(0,D-M,p,M),P>0&&n.fillRect(0,0,P,D),B>0&&n.fillRect(p-B,0,B,D)}if(g.length>0)if(m===null&&(m=U.isSupported()&&U.init()),m&&g.every(p=>Y.has(p.fx.effectId))){U.uploadSource(l,o,e);for(const{fx:p,params:D}of g)U.applyEffect(p.effectId,D);n.clearRect(0,0,o,e),U.readResult(n)}else for(const{fx:p,params:D}of g)re(n,p.effectId,D);C&&ee(n,C,o,e),te(a,d,y,l,o,e,C)},async _getSource(a,x){let v=null;return a.type==="image"?v=await r.getImageBitmap(a.id):a.type==="video"&&(v=await r.getVideoFrame(a.id,x)),v||T.warn(`[WorkerCompositor] _getSource returned null: id=${a.id}, type=${a.type}, time=${x}`),v},cleanup(){U.cleanup()}}}var E;(function(o){o.LOAD="LOAD",o.EXEC="EXEC",o.FFPROBE="FFPROBE",o.WRITE_FILE="WRITE_FILE",o.READ_FILE="READ_FILE",o.DELETE_FILE="DELETE_FILE",o.RENAME="RENAME",o.CREATE_DIR="CREATE_DIR",o.LIST_DIR="LIST_DIR",o.DELETE_DIR="DELETE_DIR",o.ERROR="ERROR",o.DOWNLOAD="DOWNLOAD",o.PROGRESS="PROGRESS",o.LOG="LOG",o.MOUNT="MOUNT",o.UNMOUNT="UNMOUNT"})(E||(E={}));const se=(()=>{let o=0;return()=>o++})(),ae=new Error("ffmpeg is not loaded, call `await ffmpeg.load()` first"),ne=new Error("called FFmpeg.terminate()");class le{#t=null;#o={};#r={};#i=[];#s=[];loaded=!1;#a=()=>{this.#t&&(this.#t.onmessage=({data:{id:e,type:r,data:t}})=>{switch(r){case E.LOAD:this.loaded=!0,this.#o[e](t);break;case E.MOUNT:case E.UNMOUNT:case E.EXEC:case E.FFPROBE:case E.WRITE_FILE:case E.READ_FILE:case E.DELETE_FILE:case E.RENAME:case E.CREATE_DIR:case E.LIST_DIR:case E.DELETE_DIR:this.#o[e](t);break;case E.LOG:this.#i.forEach(i=>i(t));break;case E.PROGRESS:this.#s.forEach(i=>i(t));break;case E.ERROR:this.#r[e](t);break}delete this.#o[e],delete this.#r[e]})};#e=({type:e,data:r},t=[],i)=>this.#t?new Promise((s,f)=>{const c=se();this.#t&&this.#t.postMessage({id:c,type:e,data:r},t),this.#o[c]=s,this.#r[c]=f,i?.addEventListener("abort",()=>{f(new DOMException(`Message # ${c} was aborted`,"AbortError"))},{once:!0})}):Promise.reject(ae);on(e,r){e==="log"?this.#i.push(r):e==="progress"&&this.#s.push(r)}off(e,r){e==="log"?this.#i=this.#i.filter(t=>t!==r):e==="progress"&&(this.#s=this.#s.filter(t=>t!==r))}load=({classWorkerURL:e,...r}={},{signal:t}={})=>(this.#t||(this.#t=e?new Worker(new URL(e,import.meta.url),{type:"module"}):new Worker(new URL(""+new URL("worker-DYSz7Krg.js",import.meta.url).href,import.meta.url),{type:"module"}),this.#a()),this.#e({type:E.LOAD,data:r},void 0,t));exec=(e,r=-1,{signal:t}={})=>this.#e({type:E.EXEC,data:{args:e,timeout:r}},void 0,t);ffprobe=(e,r=-1,{signal:t}={})=>this.#e({type:E.FFPROBE,data:{args:e,timeout:r}},void 0,t);terminate=()=>{const e=Object.keys(this.#r);for(const r of e)this.#r[r](ne),delete this.#r[r],delete this.#o[r];this.#t&&(this.#t.terminate(),this.#t=null,this.loaded=!1)};writeFile=(e,r,{signal:t}={})=>{const i=[];return r instanceof Uint8Array&&i.push(r.buffer),this.#e({type:E.WRITE_FILE,data:{path:e,data:r}},i,t)};mount=(e,r,t)=>{const i=[];return this.#e({type:E.MOUNT,data:{fsType:e,options:r,mountPoint:t}},i)};unmount=e=>{const r=[];return this.#e({type:E.UNMOUNT,data:{mountPoint:e}},r)};readFile=(e,r="binary",{signal:t}={})=>this.#e({type:E.READ_FILE,data:{path:e,encoding:r}},void 0,t);deleteFile=(e,{signal:r}={})=>this.#e({type:E.DELETE_FILE,data:{path:e}},void 0,r);rename=(e,r,{signal:t}={})=>this.#e({type:E.RENAME,data:{oldPath:e,newPath:r}},void 0,t);createDir=(e,{signal:r}={})=>this.#e({type:E.CREATE_DIR,data:{path:e}},void 0,r);listDir=(e,{signal:r}={})=>this.#e({type:E.LIST_DIR,data:{path:e}},void 0,r);deleteDir=(e,{signal:r}={})=>this.#e({type:E.DELETE_DIR,data:{path:e}},void 0,r)}var G;(function(o){o.MEMFS="MEMFS",o.NODEFS="NODEFS",o.NODERAWFS="NODERAWFS",o.IDBFS="IDBFS",o.WORKERFS="WORKERFS",o.PROXYFS="PROXYFS"})(G||(G={}));const ue=new Error("failed to get response body reader"),ce=new Error("failed to complete download"),fe="Content-Length",he=async(o,e)=>{const r=await fetch(o);let t;try{const i=parseInt(r.headers.get(fe)||"-1"),s=r.body?.getReader();if(!s)throw ue;const f=[];let c=0;for(;;){const{done:n,value:m}=await s.read(),a=m?m.length:0;if(n){if(i!=-1&&i!==c)throw ce;e&&e({url:o,total:i,received:c,delta:a,done:n});break}f.push(m),c+=a,e&&e({url:o,total:i,received:c,delta:a,done:n})}const u=new Uint8Array(c);let l=0;for(const n of f)u.set(n,l),l+=n.length;t=u.buffer}catch(i){console.log("failed to send download progress event: ",i),t=await r.arrayBuffer()}return t},q=async(o,e,r=!1,t)=>{const i=r?await he(o,t):await(await fetch(o)).arrayBuffer(),s=new Blob([i],{type:e});return URL.createObjectURL(s)},_e="0.12.6",N=`https://unpkg.com/@ffmpeg/core@${_e}/dist/esm`,k={_ffmpeg:null,_loaded:!1,_loading:null,_progressCb:null,isLoaded(){return this._loaded},async load(o){if(!this._loaded)return this._loading?this._loading:(this._loading=(async()=>{const e=new le;e.on("log",({message:i})=>{if(T.debug(`[FFmpeg] ${i}`),typeof self<"u"&&self.postMessage)try{self.postMessage({type:"log",message:`[FFmpeg] ${i}`})}catch{}}),e.on("progress",({progress:i})=>{this._progressCb&&this._progressCb(i)}),o?.(.1);const r=await q(`${N}/ffmpeg-core.js`,"text/javascript");o?.(.4);const t=await q(`${N}/ffmpeg-core.wasm`,"application/wasm");o?.(.8),await e.load({coreURL:r,wasmURL:t}),this._ffmpeg=e,this._loaded=!0,o?.(1),T.info("FFmpeg loaded")})(),this._loading)},async writeFile(o,e){if(!this._ffmpeg)throw new Error("FFmpeg not loaded");await this._ffmpeg.writeFile(o,e)},async readFile(o){if(!this._ffmpeg)throw new Error("FFmpeg not loaded");return await this._ffmpeg.readFile(o)},async deleteFile(o){if(!this._ffmpeg)throw new Error("FFmpeg not loaded");try{await this._ffmpeg.deleteFile(o)}catch{}},async exec(o){if(!this._ffmpeg)throw new Error("FFmpeg not loaded");const e=await this._ffmpeg.exec(o);if(e!==0)throw new Error(`FFmpeg exited with code ${e}`)},setProgressCallback(o){this._progressCb=o},async ensureCacheWarm(){if(!(typeof caches>"u"))try{const o=[`${N}/ffmpeg-core.js`,`${N}/ffmpeg-core.wasm`];for(const e of o){const r=await fetch(e,{cache:"force-cache"});r.ok||T.warn(`Cache warm failed for ${e}: ${r.status}`)}}catch(o){T.warn("FFmpeg cache warm failed:",o.message)}}};T.setLevel("DEBUG");let L=null,A=null,O=!1;self.onmessage=async o=>{const{type:e,data:r}=o.data;try{switch(e){case"init":await de(r);break;case"start":await ge(r);break;case"cancel":O=!0;break}}catch(t){self.postMessage({type:"error",error:t.message||"Export worker error"})}};async function de(o){const{width:e,height:r,media:t,effectRegistry:i}=o;L=Q();for(const u of t)u.type==="image"?L.registerImage(u.id,u.blob):u.type==="video"&&(u.buffer?L.registerVideo(u.id,u.buffer):u.frames?L.registerFrames(u.id,u.frames):console.warn(`[ExportWorker] video item ${u.id} has no buffer or frames!`));const s=new Map;if(i)for(const u of i)s.set(u.id,u);A=ie(e,r,L,u=>s.get(u),(u,l)=>{const n={...u.params};if(u.keyframes){for(const[m,a]of Object.entries(u.keyframes))if(!(!a||a.length===0)){if(l<=a[0].frame){n[m]=a[0].value;continue}if(l>=a[a.length-1].frame){n[m]=a[a.length-1].value;continue}for(let x=0;x<a.length-1;x++)if(l>=a[x].frame&&l<=a[x+1].frame){const v=(l-a[x].frame)/(a[x+1].frame-a[x].frame);n[m]=a[x].value+(a[x+1].value-a[x].value)*v;break}}}return n}),self.postMessage({type:"init_complete"})}async function ge(o){const{preset:e,tracks:r,inPoint:t,outPoint:i,fps:s,mediaItems:f,audioWavData:c}=o;O=!1;const u=i-t;if(self.postMessage({type:"progress",stage:"loading",progress:0}),await k.load(),self.postMessage({type:"progress",stage:"loading",progress:1}),O){self.postMessage({type:"cancelled"});return}A.setFps(s);const l=new Map;for(const d of f)l.set(d.id,d);let n=!!(c&&c.byteLength>0);n?self.postMessage({type:"log",message:`[Worker] Audio available: ${(c.byteLength/1024).toFixed(0)}KB`}):self.postMessage({type:"log",message:"[Worker] No audio data received"});{let d=!1;for(const C of r)if(!(C.type!=="video"||C.muted)){for(const y of C.clips)if(!y.disabled&&y.sourceOutFrame>y.sourceInFrame){d=!0;break}if(d)break}if(!d)throw new Error("Worker export: no valid video clips found in timeline")}if(typeof VideoEncoder<"u"&&e.webCodecsCodec)try{const{createWebCodecsEncoder:d}=await import("./WebCodecsEncoder-CG0HoFjn.js"),{muxToContainer:C}=await import("./Muxer-BVKAs0Ou.js"),y=d({codec:e.webCodecsCodec,width:A.canvas.width,height:A.canvas.height,bitrate:e.videoBitrate,fps:s});await y.init(),self.postMessage({type:"log",message:`[Worker] WebCodecs path: ${u} frames, ${s}fps, hasAudio: ${n}`}),self.postMessage({type:"progress",stage:"encoding",progress:0});let g=0;for(let I=t;I<i;I++){if(O){y.close(),self.postMessage({type:"cancelled"});return}const M=await A.compositeFrame(I,r,B=>l.get(B)),P=Math.round(g/s*1e6);y.encodeFrame(M,P),g++,self.postMessage({type:"progress",stage:"encoding",progress:g/u,current:g,total:u})}await y.flush();const S=y.getEncodedData();y.close(),self.postMessage({type:"progress",stage:"muxing",progress:0});const h=await C(k,S,c,{codec:e.webCodecsCodec,format:e.format,fps:s,duration:u/s,audioBitrate:e.audioBitrate,audioSampleRate:e.audioSampleRate}),p=e.format==="webm"?"video/webm":"video/mp4",D=h.buffer;self.postMessage({type:"complete",buffer:D,mimeType:p},[D]),A&&A.cleanup(),L&&L.cleanup();return}catch(d){self.postMessage({type:"log",message:`[Worker] WebCodecs FAILED: ${d.message}, falling to JPEG`})}self.postMessage({type:"log",message:`[Worker] JPEG+FFmpeg fallback path (${u} frames, hasAudio: ${n})`});let a=0;self.postMessage({type:"progress",stage:"rendering",progress:0});for(let d=t;d<i;d++){if(O){self.postMessage({type:"cancelled"});return}const g=await(await(await A.compositeFrame(d,r,p=>l.get(p))).convertToBlob({type:"image/jpeg",quality:.92})).arrayBuffer(),S=new Uint8Array(g),h=String(a).padStart(6,"0");await k.writeFile(`frame_${h}.jpg`,S),a++,self.postMessage({type:"progress",stage:"rendering",progress:a/u,current:a,total:u})}if(O){self.postMessage({type:"cancelled"});return}self.postMessage({type:"progress",stage:"encoding",progress:0}),n&&c&&c.byteLength>0?await k.writeFile("audio.wav",new Uint8Array(c)):n&&(n=!1),k.setProgressCallback(d=>{self.postMessage({type:"progress",stage:"encoding",progress:d})});const x=`output.${e.format}`,v=me(e,s,a,n,x);try{await k.exec(v)}catch(d){throw new Error(`FFmpeg encoding failed: ${d.message}`)}finally{k.setProgressCallback(null)}const _=await k.readFile(x),R=e.format==="webm"?"video/webm":e.format==="gif"?"image/gif":"video/mp4",w=new Blob([_.buffer],{type:R});for(let d=0;d<a;d++){const C=String(d).padStart(6,"0");await k.deleteFile(`frame_${C}.jpg`)}await k.deleteFile(x),n&&await k.deleteFile("audio.wav");const b=await w.arrayBuffer();self.postMessage({type:"complete",buffer:b,mimeType:R},[b]),A&&A.cleanup(),L&&L.cleanup()}function me(o,e,r,t,i){const s=["-framerate",String(e),"-i","frame_%06d.jpg"];return t&&s.push("-i","audio.wav"),o.videoCodec&&s.push("-c:v",o.videoCodec),o.pixelFormat&&s.push("-pix_fmt",o.pixelFormat),o.videoBitrate&&s.push("-b:v",o.videoBitrate),o.preset&&s.push("-preset",o.preset),t&&o.audioCodec&&(s.push("-c:a",o.audioCodec),o.audioBitrate&&s.push("-b:a",o.audioBitrate),o.audioSampleRate&&s.push("-ar",String(o.audioSampleRate))),t&&s.push("-shortest"),s.push("-y",i),s}export{T as l};
//# sourceMappingURL=ExportWorker-Dy2-LkJK.js.map
