const D={DEBUG:0,INFO:1,WARN:2,ERROR:3};let q=D.INFO;const W=(e,t,r,o,i)=>{if(e<q)return;const a=`[NLE] [${t}]`;i!==void 0?r(`${a} ${o}`,i):r(`${a} ${o}`)},x={setLevel(e){e in D&&(q=D[e])},debug(e,t){W(D.DEBUG,"DEBUG",console.debug,e,t)},info(e,t){W(D.INFO,"INFO",console.info,e,t)},warn(e,t){W(D.WARN,"WARN",console.warn,e,t)},error(e,t){W(D.ERROR,"ERROR",console.error,e,t)}};function j(){let e=null,t=null,r=null;return{async init(o,i={}){var d;const a=await import("./mp4box.all-Cb4wIdk6.js");this._mp4box=a;const l=a.createFile||((d=a.default)==null?void 0:d.createFile);if(!l)throw new Error("mp4box module missing createFile");return e=l(),new Promise((n,u)=>{e.onReady=c=>{var w;for(const s of c.tracks)s.type==="video"&&!t?t=s:s.type==="audio"&&!r&&(r=s);if(t){const s=e.getTrackById(t.id),b=this._getCodecDescription(s);(w=i.onVideoConfig)==null||w.call(i,{codec:t.codec,codedWidth:t.video.width,codedHeight:t.video.height,description:b}),e.setExtractionOptions(t.id,"video",{nbSamples:1e3})}this._started=!0,e.start(),n(c)},e.onError=c=>{x.error("MP4Box error:",c),u(c)},e.onSamples=(c,w,s)=>{var b;for(const p of s)if(w==="video"){const g=new EncodedVideoChunk({type:p.is_sync?"key":"delta",timestamp:p.cts*1e6/p.timescale,duration:p.duration*1e6/p.timescale,data:p.data});(b=i.onVideoChunk)==null||b.call(i,g,p)}},o.fileStart=0,e.appendBuffer(o)})},_mp4box:null,_serializeAvcC(o){const i=g=>{if(!g||typeof g.byteLength!="number")return null;if(g.buffer){const E=g.byteOffset||0;return new Uint8Array(g.buffer.slice(E,E+g.byteLength))}return new Uint8Array(g)},a=[];for(const g of o.SPS||[]){const E=i(g.data)||i(g.nalu)||i(g);E&&E.byteLength>0&&a.push(E)}const l=[];for(const g of o.PPS||[]){const E=i(g.data)||i(g.nalu)||i(g);E&&E.byteLength>0&&l.push(E)}const d=o.AVCProfileIndication||0,n=[100,110,122,144].includes(d),u=n?(o.SPS_Ext||[]).map(g=>i(g.data)||i(g.nalu)||i(g)||new Uint8Array(0)).filter(g=>g.byteLength>0):[];let c=6;for(const g of a)c+=2+g.byteLength;c+=1;for(const g of l)c+=2+g.byteLength;if(n){c+=4;for(const g of u)c+=2+g.byteLength}const w=new ArrayBuffer(c),s=new DataView(w),b=new Uint8Array(w);let p=0;s.setUint8(p++,o.configurationVersion||1),s.setUint8(p++,d),s.setUint8(p++,o.profile_compatibility||0),s.setUint8(p++,o.AVCLevelIndication||0),s.setUint8(p++,252|(o.lengthSizeMinusOne??3)&3),s.setUint8(p++,224|a.length&31);for(const g of a)s.setUint16(p,g.byteLength),p+=2,b.set(g,p),p+=g.byteLength;s.setUint8(p++,l.length&255);for(const g of l)s.setUint16(p,g.byteLength),p+=2,b.set(g,p),p+=g.byteLength;if(n){s.setUint8(p++,252|(o.chroma_format??1)&3),s.setUint8(p++,248|(o.bit_depth_luma_minus8??0)&7),s.setUint8(p++,248|(o.bit_depth_chroma_minus8??0)&7),s.setUint8(p++,u.length&255);for(const g of u)s.setUint16(p,g.byteLength),p+=2,b.set(g,p),p+=g.byteLength}return new Uint8Array(w)},_getCodecDescription(o){var i,a;try{const l=o.mdia.minf.stbl.stsd.entries[0],d=l.avcC||l.hvcC||l.vpcC||l.av1C;if(!d)return;const n=this._mp4box,u=(n==null?void 0:n.DataStream)||((i=n==null?void 0:n.default)==null?void 0:i.DataStream);if(u)try{const c=((a=n==null?void 0:n.Endianness)==null?void 0:a.BIG_ENDIAN)??1,w=new u(void 0,0,c);d.write(w);const s=new Uint8Array(w.buffer.slice(8,w.position));if(s.byteLength>0)return x.info(`Codec description via DataStream: ${s.byteLength} bytes`),s}catch(c){x.warn("DataStream serialization failed, falling back to manual:",c.message)}return l.avcC?this._serializeAvcC(l.avcC):void 0}catch(l){x.warn("Could not extract codec description:",l);return}},_started:!1,start(){e&&!this._started&&(this._started=!0,e.start())},getVideoTrackInfo(){return t?{codec:t.codec,width:t.video.width,height:t.video.height,duration:t.duration/t.timescale,frameCount:t.nb_samples,frameRate:t.nb_samples/(t.duration/t.timescale),timescale:t.timescale}:null},getAudioTrackInfo(){return r?{codec:r.codec,sampleRate:r.audio.sample_rate,channels:r.audio.channel_count,duration:r.duration/r.timescale}:null},seek(o){if(!e||!t)return;const i=o*t.timescale;e.seek(i,!0)},cleanup(){e&&(e.flush(),e=null),t=null,r=null,this._started=!1}}}function H(){let e=null,t=null,r=null,o=[],i=null,a=[],l=null,d=null,n=null,u=!1,c=null,w=-1,s=null;function b(y){return new EncodedVideoChunk({type:y.type,timestamp:y.timestamp,duration:y.duration,data:new Uint8Array(i,y.offset,y.size)})}function p(){for(const y of a)y.close();a=[]}function g(){if(t)try{t.close()}catch{}s=null,t=new VideoDecoder({output:y=>{a.push(y)},error:y=>{s=y,x.error("VideoDecoder error:",y)}}),t.configure({...r,hardwareAcceleration:"prefer-hardware",optimizeForLatency:!u})}function E(){t&&t.state==="configured"&&!s?(t.reset(),t.configure({...r,hardwareAcceleration:"prefer-hardware",optimizeForLatency:!u})):g()}return{async init(y,m){return d||(d=(async()=>{e=j(),i=m;const h=[];let F=null;if(await e.init(m,{onVideoConfig(_){F=_},onVideoChunk(_,R){h.push({type:R.is_sync?"key":"delta",timestamp:_.timestamp,duration:_.duration,offset:R.offset,size:R.size})}}),r=F,o=h,l=e.getVideoTrackInfo(),e.cleanup(),e=null,!r)throw new Error("No video config from demuxer");if(!(await VideoDecoder.isConfigSupported(r)).supported)throw new Error(`VideoDecoder config not supported: ${r.codec}`);x.info(`WebCodecsDecoder: ${o.length} chunks, ${l.width}x${l.height}, ${l.frameRate.toFixed(1)}fps`)})(),d)},async getFrameAt(y){if(!r||o.length===0)return null;for(;n;)await n;let m;n=new Promise(h=>{m=h});try{return await this._decodeFrameAt(y)}finally{n=null,m()}},async _decodeFrameAt(y){const m=y*1e6;let h=0;for(let f=o.length-1;f>=0;f--)if(o[f].type==="key"&&o[f].timestamp<=m){h=f;break}let F=h,C=Math.abs(o[h].timestamp-m);for(let f=h+1;f<o.length&&o[f].type!=="key";f++){const v=Math.abs(o[f].timestamp-m);v<C&&(C=v,F=f)}p(),s=null,E();for(let f=h;f<=F&&t.state==="configured";f++)t.decode(b(o[f]));if(t.state==="configured")try{await t.flush()}catch(f){x.warn("VideoDecoder flush failed, using partial output:",f.message)}if(s){if(a.length===0)throw s;s=null}let _=null,R=1/0;for(const f of a){const v=Math.abs(f.timestamp-m);v<R?(R=v,_&&_.close(),_=f):f.close()}return a=[],_},async getImageBitmapAt(y){const m=await this.getFrameAt(y);if(!m)return null;try{const h=await createImageBitmap(m);return m.close(),h}catch{return m.close(),null}},startSequentialMode(){u=!0,c=new Map,w=-1},endSequentialMode(){var y;if(u=!1,c){for(const m of c.values())(y=m.close)==null||y.call(m);c=null}w=-1},async getSequentialImageBitmap(y){if(!r||o.length===0)return null;const m=y*1e6;let h=0,F=1/0;for(let f=0;f<o.length;f++){const v=Math.abs(o[f].timestamp-m);if(v<F&&(F=v,h=f),o[f].timestamp>m+5e4)break}let C=0;for(let f=h;f>=0;f--)if(o[f].type==="key"){C=f;break}if(w!==C){let f=o.length-1;for(let v=C+1;v<o.length;v++)if(o[v].type==="key"){f=v-1;break}if(c){for(const v of c.values())v.close();c=new Map}p(),s=null,E();for(let v=C;v<=f&&t.state==="configured";v++)t.decode(b(o[v]));if(t.state==="configured")try{await t.flush()}catch(v){x.warn("Sequential flush failed, using partial output:",v.message)}if(s)throw p(),s;for(const v of a){try{const T=await createImageBitmap(v);c.set(v.timestamp,T)}catch{}v.close()}a=[],w=C}let _=null,R=1/0;for(const[f,v]of c){const T=Math.abs(f-m);T<R&&(R=T,_=v)}if(!_)return null;try{return await createImageBitmap(_)}catch{return null}},getChunkMetasInRange(y,m){if(o.length===0)return[];let h=0;for(let _=o.length-1;_>=0;_--)if(o[_].type==="key"&&o[_].timestamp<=y){h=_;break}let F=o.length-1;for(let _=h;_<o.length;_++)if(_>h&&o[_].type==="key"){let R=!1;for(let f=_;f<o.length&&!(f>_&&o[f].type==="key");f++)if(o[f].timestamp<=m){R=!0;break}if(!R){F=_-1;break}}const C=[];for(let _=h;_<=F;_++)C.push(o[_]);return C},getSourceBuffer(){return i},getCodecConfig(){return r},isHealthy(){return s?!1:!t&&r?!0:t&&t.state==="configured"},getTrackInfo(){return l},close(){var y;if(n=null,p(),c){for(const m of c.values())(y=m.close)==null||y.call(m);c=null}if(w=-1,u=!1,t){try{t.close()}catch{}t=null}e&&(e.cleanup(),e=null),o=[],i=null,r=null,l=null,d=null,s=null}}}function Y(){const e=new Map,t=new Map;return{registerImage(r,o){t.set(r,{type:"image",blob:o})},registerVideo(r,o){t.set(r,{type:"video",buffer:o})},async getImageBitmap(r){if(e.has(r))return e.get(r);const o=t.get(r);if(!o||o.type!=="image")return null;const i=await createImageBitmap(o.blob);return e.set(r,i),i},async getVideoFrame(r,o){const i=t.get(r);if(!i)return null;if(i.type==="frames"){const a=Math.round(o*1e3);return i.frames.get(a)||null}if(i.type==="video"&&typeof VideoDecoder<"u")try{i.decoder||(console.log(`[WorkerMediaDecoder] Creating WebCodecsDecoder for ${r}, buffer=${i.buffer.byteLength} bytes`),i.decoder=H(),await i.decoder.init(r,i.buffer),console.log(`[WorkerMediaDecoder] Decoder initialized for ${r}`));const a=await i.decoder.getImageBitmapAt(o);return a||console.warn(`[WorkerMediaDecoder] getImageBitmapAt(${o}) returned null for ${r}`),a}catch(a){return console.error(`[WorkerMediaDecoder] WebCodecs decode FAILED for ${r}: ${a.message}`,a),i.decoder=null,null}return console.warn(`[WorkerMediaDecoder] No decode path for ${r}: type=${i.type}, VideoDecoder=${typeof VideoDecoder}`),null},registerFrames(r,o){t.set(r,{type:"frames",frames:o})},cleanup(){for(const[,r]of e)r.close();e.clear();for(const[,r]of t)r.decoder&&r.decoder.close();t.clear()}}}function N(e,t,r,o){const i=t.videoWidth||t.naturalWidth||t.width,a=t.videoHeight||t.naturalHeight||t.height;if(!i||!a)return;const l=(r-i)/2,d=(o-a)/2;e.drawImage(t,l,d,i,a)}function K(e,t,r,o){let i=null,a=null,l=1;const d=[],n=[];for(const u of e){const c=t(u.effectId);if(!c||c.type!=="video")continue;const w=r(u,o);u.effectId==="motion"&&u.intrinsic?a=w:u.effectId==="transform"?i=w:u.effectId==="opacity"?l=w.opacity/100:u.effectId==="crop"?n.push({fx:u,def:c,params:w}):u.effectId==="time-remap"||u.effectId==="audio-volume"||u.effectId==="panner"||u.effectId==="channel-volume"||d.push({fx:u,def:c,params:w})}return{transformParams:i,motionParams:a,opacity:l,pixelEffects:d,cropEffects:n}}function J(e,t,r,o){const{cropLeft:i,cropTop:a,cropRight:l,cropBottom:d}=t;if(i<=0&&a<=0&&l<=0&&d<=0)return;const n=r,u=o,c=i/100*n,w=a/100*u,s=l/100*n,b=d/100*u;e.fillStyle="#000",w>0&&e.fillRect(0,0,n,w),b>0&&e.fillRect(0,u-b,n,b),c>0&&e.fillRect(0,0,c,u),s>0&&e.fillRect(n-s,0,s,u)}function Q(e,t,r,o,i,a,l){if(e.save(),l){const d=l.scale/100,n=l.uniformScale?d:l.scaleWidth/100;e.translate(l.posX,l.posY),e.rotate(l.rotation*Math.PI/180),e.scale(n,d),e.translate(-l.anchorX,-l.anchorY)}if(t){const d=i/2,n=a/2;e.translate(d+t.posX,n+t.posY),e.rotate(t.rotation*Math.PI/180),e.scale(t.scaleX/100,t.scaleY/100),e.translate(-d,-n)}e.globalAlpha=r,e.drawImage(o,0,0),e.restore()}function Z(e,t,r){switch(t){case"gaussian-blur":r.radius>0&&(e.filter=`blur(${r.radius}px)`,e.drawImage(e.canvas,0,0),e.filter="none");break;case"hue-rotate":e.filter=`hue-rotate(${r.angle}deg)`,e.drawImage(e.canvas,0,0),e.filter="none";break;case"invert":r.amount>0&&(e.filter=`invert(${r.amount}%)`,e.drawImage(e.canvas,0,0),e.filter="none");break;case"grayscale":r.amount>0&&(e.filter=`grayscale(${r.amount}%)`,e.drawImage(e.canvas,0,0),e.filter="none");break;case"sepia":r.amount>0&&(e.filter=`sepia(${r.amount}%)`,e.drawImage(e.canvas,0,0),e.filter="none");break;case"brightness-contrast":{const o=r.brightness/100,i=(r.contrast+100)/100;e.filter=`brightness(${1+o}) contrast(${i})`,e.drawImage(e.canvas,0,0),e.filter="none";break}case"saturation":e.filter=`saturate(${(r.amount+100)/100})`,e.drawImage(e.canvas,0,0),e.filter="none";break;case"drop-shadow":e.filter=`drop-shadow(${r.offsetX}px ${r.offsetY}px ${r.blur}px ${r.color||"#000"})`,e.drawImage(e.canvas,0,0),e.filter="none";break}}const X=`#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`,P={"brightness-contrast":`#version 300 es
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
}`};function ee(e,t){switch(e){case"brightness-contrast":return{passes:["brightness-contrast"],uniforms:{u_brightness:t.brightness/100,u_contrast:(t.contrast+100)/100}};case"saturation":return{passes:["saturation"],uniforms:{u_amount:(t.amount+100)/100}};case"hue-rotate":return{passes:["hue-rotate"],uniforms:{u_angle:t.angle}};case"gaussian-blur":return t.radius<=0?null:{passes:["gaussian-blur-h","gaussian-blur-v"],uniforms:{u_radius:t.radius}};case"invert":return t.amount<=0?null:{passes:["invert"],uniforms:{u_amount:t.amount/100}};case"grayscale":return t.amount<=0?null:{passes:["grayscale"],uniforms:{u_amount:t.amount/100}};case"sepia":return t.amount<=0?null:{passes:["sepia"],uniforms:{u_amount:t.amount/100}};case"sharpen":return t.amount<=0?null:{passes:["sharpen"],uniforms:{u_amount:t.amount/100}};case"levels":return{passes:["levels"],uniforms:{u_inputBlack:t.inputBlack/255,u_inputWhite:t.inputWhite/255,u_gamma:t.gamma,u_outputBlack:t.outputBlack/255,u_outputWhite:t.outputWhite/255}};case"hsl-adjust":return t.hue===0&&t.saturation===0&&t.lightness===0?null:{passes:["hsl-adjust"],uniforms:{u_hue:t.hue,u_saturation:t.saturation/100,u_lightness:t.lightness/100}};case"vignette":return t.amount<=0?null:{passes:["vignette"],uniforms:{u_amount:t.amount/100,u_size:t.size/100}};case"drop-shadow":return{passes:["drop-shadow"],uniforms:{u_offsetX:t.offsetX,u_offsetY:t.offsetY,u_blur:t.blur,u_color:te(t.color||"#000000")}};default:return null}}function te(e){const t=parseInt(e.slice(1,3),16)/255,r=parseInt(e.slice(3,5),16)/255,o=parseInt(e.slice(5,7),16)/255;return[t,r,o]}const G=new Set(Object.keys(P)),L={_gl:null,_canvas:null,_programs:new Map,_quadVAO:null,_sourceTexture:null,_fbos:[null,null],_fboTextures:[null,null],_currentFBO:0,_width:0,_height:0,_initialized:!1,_supportChecked:!1,_supported:!1,isSupported(){if(this._supportChecked)return this._supported;if(this._supportChecked=!0,typeof OffscreenCanvas<"u")try{if(new OffscreenCanvas(1,1).getContext("webgl2"))return this._supported=!0,!0}catch{}try{const t=document.createElement("canvas").getContext("webgl2");this._supported=!!t}catch{this._supported=!1}return this._supported},init(e){return this._initialized?!0:(this._canvas=e||(typeof OffscreenCanvas<"u"?new OffscreenCanvas(1,1):document.createElement("canvas")),this._gl=this._canvas.getContext("webgl2",{premultipliedAlpha:!1,alpha:!0,preserveDrawingBuffer:!0,antialias:!1}),this._gl?(this._setupQuad(),this._initialized=!0,x.info("GLEffectRenderer initialized (WebGL 2.0)"),!0):(x.warn("WebGL 2.0 not available, falling back to Canvas2D effects"),!1))},_setupQuad(){const e=this._gl,t=new Float32Array([-1,-1,0,0,1,-1,1,0,-1,1,0,1,1,1,1,1]);this._quadVAO=e.createVertexArray(),e.bindVertexArray(this._quadVAO);const r=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,r),e.bufferData(e.ARRAY_BUFFER,t,e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,16,0),e.enableVertexAttribArray(1),e.vertexAttribPointer(1,2,e.FLOAT,!1,16,8),e.bindVertexArray(null)},_getProgram(e){if(this._programs.has(e))return this._programs.get(e);const t=P[e];if(!t)return null;const r=this._compileProgram(X,t);if(!r)return null;const o=this._gl,i={},a=o.getProgramParameter(r,o.ACTIVE_UNIFORMS);for(let d=0;d<a;d++){const n=o.getActiveUniform(r,d);i[n.name]=o.getUniformLocation(r,n.name)}const l={program:r,uniforms:i};return this._programs.set(e,l),l},_compileProgram(e,t){const r=this._gl,o=r.createShader(r.VERTEX_SHADER);if(r.shaderSource(o,e),r.compileShader(o),!r.getShaderParameter(o,r.COMPILE_STATUS))return x.error("Vertex shader compile error:",r.getShaderInfoLog(o)),r.deleteShader(o),null;const i=r.createShader(r.FRAGMENT_SHADER);if(r.shaderSource(i,t),r.compileShader(i),!r.getShaderParameter(i,r.COMPILE_STATUS))return x.error("Fragment shader compile error:",r.getShaderInfoLog(i)),r.deleteShader(o),r.deleteShader(i),null;const a=r.createProgram();return r.attachShader(a,o),r.attachShader(a,i),r.bindAttribLocation(a,0,"a_position"),r.bindAttribLocation(a,1,"a_texCoord"),r.linkProgram(a),r.getProgramParameter(a,r.LINK_STATUS)?(r.deleteShader(o),r.deleteShader(i),a):(x.error("Program link error:",r.getProgramInfoLog(a)),r.deleteProgram(a),r.deleteShader(o),r.deleteShader(i),null)},_resize(e,t){if(this._width===e&&this._height===t)return;const r=this._gl;this._width=e,this._height=t,this._canvas.width=e,this._canvas.height=t,r.viewport(0,0,e,t);for(let o=0;o<2;o++){this._fbos[o]&&r.deleteFramebuffer(this._fbos[o]),this._fboTextures[o]&&r.deleteTexture(this._fboTextures[o]);const i=r.createTexture();r.bindTexture(r.TEXTURE_2D,i),r.texImage2D(r.TEXTURE_2D,0,r.RGBA8,e,t,0,r.RGBA,r.UNSIGNED_BYTE,null),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MIN_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_MAG_FILTER,r.LINEAR),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_S,r.CLAMP_TO_EDGE),r.texParameteri(r.TEXTURE_2D,r.TEXTURE_WRAP_T,r.CLAMP_TO_EDGE);const a=r.createFramebuffer();r.bindFramebuffer(r.FRAMEBUFFER,a),r.framebufferTexture2D(r.FRAMEBUFFER,r.COLOR_ATTACHMENT0,r.TEXTURE_2D,i,0),this._fboTextures[o]=i,this._fbos[o]=a}this._sourceTexture||(this._sourceTexture=r.createTexture()),r.bindFramebuffer(r.FRAMEBUFFER,null)},uploadSource(e,t,r){const o=this._gl;this._resize(t,r),o.bindTexture(o.TEXTURE_2D,this._sourceTexture),o.texImage2D(o.TEXTURE_2D,0,o.RGBA8,o.RGBA,o.UNSIGNED_BYTE,e),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MIN_FILTER,o.LINEAR),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_MAG_FILTER,o.LINEAR),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_S,o.CLAMP_TO_EDGE),o.texParameteri(o.TEXTURE_2D,o.TEXTURE_WRAP_T,o.CLAMP_TO_EDGE),this._currentFBO=0,o.bindFramebuffer(o.FRAMEBUFFER,this._fbos[0]),o.viewport(0,0,t,r);const i=this._getPassthroughProgram();o.useProgram(i.program),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this._sourceTexture),o.uniform1i(i.uniforms.u_source,0),o.bindVertexArray(this._quadVAO),o.drawArrays(o.TRIANGLE_STRIP,0,4),o.bindFramebuffer(o.FRAMEBUFFER,null)},_getPassthroughProgram(){if(this._programs.has("_passthrough"))return this._programs.get("_passthrough");const t=this._compileProgram(X,`#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
uniform sampler2D u_source;
void main() {
  fragColor = texture(u_source, v_texCoord);
}`),r=this._gl,o={},i=r.getProgramParameter(t,r.ACTIVE_UNIFORMS);for(let l=0;l<i;l++){const d=r.getActiveUniform(t,l);o[d.name]=r.getUniformLocation(t,d.name)}const a={program:t,uniforms:o};return this._programs.set("_passthrough",a),a},applyEffect(e,t){if(!this._initialized||!this._gl)return!1;const r=ee(e,t);if(!r)return!1;const o=this._gl;for(const i of r.passes){const a=this._getProgram(i);if(!a)return x.warn(`No GL shader for pass: ${i}`),!1;const l=this._currentFBO,d=1-l;o.bindFramebuffer(o.FRAMEBUFFER,this._fbos[d]),o.viewport(0,0,this._width,this._height),o.useProgram(a.program),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this._fboTextures[l]),a.uniforms.u_source!==void 0&&o.uniform1i(a.uniforms.u_source,0),a.uniforms.u_texelSize!==void 0&&o.uniform2f(a.uniforms.u_texelSize,1/this._width,1/this._height);for(const[n,u]of Object.entries(r.uniforms)){const c=a.uniforms[n];c!==void 0&&(Array.isArray(u)?u.length===2?o.uniform2fv(c,u):u.length===3?o.uniform3fv(c,u):u.length===4&&o.uniform4fv(c,u):o.uniform1f(c,u))}o.bindVertexArray(this._quadVAO),o.drawArrays(o.TRIANGLE_STRIP,0,4),this._currentFBO=d}return!0},readResult(e){if(!this._initialized||!this._gl)return;const t=this._gl;t.bindFramebuffer(t.FRAMEBUFFER,null),t.viewport(0,0,this._width,this._height);const r=this._getPassthroughProgram();t.useProgram(r.program),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,this._fboTextures[this._currentFBO]),t.uniform1i(r.uniforms.u_source,0),t.bindVertexArray(this._quadVAO),t.drawArrays(t.TRIANGLE_STRIP,0,4),e.drawImage(this._canvas,0,0)},hasShader(e){return G.has(e)},cleanup(){if(!this._gl)return;const e=this._gl;for(const[,t]of this._programs)e.deleteProgram(t.program);this._programs.clear();for(let t=0;t<2;t++)this._fbos[t]&&e.deleteFramebuffer(this._fbos[t]),this._fboTextures[t]&&e.deleteTexture(this._fboTextures[t]);this._fbos=[null,null],this._fboTextures=[null,null],this._sourceTexture&&e.deleteTexture(this._sourceTexture),this._sourceTexture=null,this._quadVAO&&e.deleteVertexArray(this._quadVAO),this._quadVAO=null,this._gl=null,this._canvas=null,this._initialized=!1,this._supportChecked=!1,this._supported=!1,this._width=0,this._height=0}};function re(e,t,r,o,i,a=30){let l=a;const d=new OffscreenCanvas(e,t),n=d.getContext("2d",{willReadFrequently:!0}),u=new OffscreenCanvas(e,t),c=u.getContext("2d",{willReadFrequently:!0});let w=null;return{canvas:d,setFps(s){l=s},async compositeFrame(s,b,p){n.fillStyle="#000000",n.fillRect(0,0,e,t);let g=0;for(let E=b.length-1;E>=0;E--){const y=b[E];if(!(y.muted||y.type!=="video"))for(const m of y.clips){if(m.disabled)continue;const h=Math.round((m.sourceOutFrame-m.sourceInFrame)/(m.speed||1));if(s<m.startFrame||s>=m.startFrame+h)continue;const F=p(m.mediaId);if(!F)continue;const C=s-m.startFrame,R=(m.sourceInFrame+Math.round(C*(m.speed||1)))/l;await this._renderClip(n,F,R,m,s),g++}}return s===0&&x.info(`[WorkerCompositor] frame 0: ${g} clips rendered, canvas=${e}x${t}`),d},async _renderClip(s,b,p,g,E){const y=(g.effects||[]).filter(f=>f.enabled);if(y.length===0){const f=await this._getSource(b,p);f&&N(s,f,e,t);return}c.clearRect(0,0,e,t);const m=await this._getSource(b,p);m&&N(c,m,e,t);const{transformParams:h,motionParams:F,opacity:C,pixelEffects:_,cropEffects:R}=K(y,o,i,E);for(const{params:f}of R){const v=e,T=t,I=f.top/100*T,B=f.bottom/100*T,$=f.left/100*v,O=f.right/100*v;c.fillStyle="#000",I>0&&c.fillRect(0,0,v,I),B>0&&c.fillRect(0,T-B,v,B),$>0&&c.fillRect(0,0,$,T),O>0&&c.fillRect(v-O,0,O,T)}if(_.length>0)if(w===null&&(w=L.isSupported()&&L.init()),w&&_.every(v=>G.has(v.fx.effectId))){L.uploadSource(u,e,t);for(const{fx:v,params:T}of _)L.applyEffect(v.effectId,T);c.clearRect(0,0,e,t),L.readResult(c)}else for(const{fx:v,params:T}of _)Z(c,v.effectId,T);F&&J(c,F,e,t),Q(s,h,C,u,e,t,F)},async _getSource(s,b){let p=null;return s.type==="image"?p=await r.getImageBitmap(s.id):s.type==="video"&&(p=await r.getVideoFrame(s.id,b)),p||x.warn(`[WorkerCompositor] _getSource returned null: id=${s.id}, type=${s.type}, time=${b}`),p},cleanup(){L.cleanup()}}}let A=null,V=!1,z=null;const S={async load(e){if(!(V&&A))try{e==null||e(.05);const{FFmpeg:t}=await import("./index-B9zgSVgf.js");A=new t,A.on("log",({message:n})=>{x.debug(`[FFmpeg] ${n}`)}),A.on("progress",({progress:n,time:u})=>{z?z(n,u):e&&e(n,u)});const r="https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm",o=`${r}/ffmpeg-core.js`,i=`${r}/ffmpeg-core.wasm`;let a,l;const d=await this._loadFromCache(o,i);if(d)e==null||e(.7),x.info("Loading FFmpeg from cache..."),a=d.coreURL,l=d.wasmURL;else{e==null||e(.1),x.info("Downloading FFmpeg core JS...");const n=await fetch(o);e==null||e(.4),x.info("Downloading FFmpeg WASM (~30MB)...");const u=await fetch(i);this._cacheResponses(o,n.clone(),i,u.clone());const c=await n.blob(),w=await u.blob();a=URL.createObjectURL(new Blob([c],{type:"text/javascript"})),l=URL.createObjectURL(new Blob([w],{type:"application/wasm"}))}e==null||e(.8),x.info("Initializing FFmpeg..."),await A.load({coreURL:a,wasmURL:l}),V=!0,e==null||e(1),x.info("FFmpeg.wasm loaded successfully")}catch(t){throw x.error("Failed to load FFmpeg.wasm:",t),A=null,t}},_CACHE_NAME:"ffmpeg-wasm-v0.12.6",async _loadFromCache(e,t){try{if(typeof caches>"u")return null;const r=await caches.open(this._CACHE_NAME),o=await r.match(e),i=await r.match(t);if(!o||!i)return null;const a=await o.blob(),l=await i.blob(),d=URL.createObjectURL(new Blob([a],{type:"text/javascript"})),n=URL.createObjectURL(new Blob([l],{type:"application/wasm"}));return{coreURL:d,wasmURL:n}}catch(r){return x.debug("Cache API read failed:",r),null}},async _cacheResponses(e,t,r,o){try{if(typeof caches>"u")return;const i=await caches.open(this._CACHE_NAME);await Promise.all([i.put(e,t),i.put(r,o)]),x.info("FFmpeg WASM cached for next session")}catch(i){x.debug("FFmpeg cache write failed (non-fatal):",i)}},isLoaded(){return V},setProgressCallback(e){z=e},async writeFile(e,t){if(!A)throw new Error("FFmpeg not loaded");await A.writeFile(e,t)},async readFile(e){if(!A)throw new Error("FFmpeg not loaded");return await A.readFile(e)},async exec(e){if(!A)throw new Error("FFmpeg not loaded");x.info(`[FFmpeg] exec: ffmpeg ${e.join(" ")}`),await A.exec(e)},async deleteFile(e){if(!A)throw new Error("FFmpeg not loaded");try{await A.deleteFile(e)}catch{}},async ensureCacheWarm(){if(typeof caches>"u")return!1;const e="https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm",t=`${e}/ffmpeg-core.js`,r=`${e}/ffmpeg-core.wasm`,o=await this._loadFromCache(t,r);if(o)return URL.revokeObjectURL(o.coreURL),URL.revokeObjectURL(o.wasmURL),x.info("FFmpeg cache is warm (ready for Worker)"),!0;x.info("Pre-warming FFmpeg cache for Worker export...");try{const[i,a]=await Promise.all([fetch(t),fetch(r)]);return await this._cacheResponses(t,i,r,a),x.info("FFmpeg cache warmed successfully"),!0}catch(i){return x.warn("Failed to pre-warm FFmpeg cache:",i),!1}},async cleanup(){A&&(A.terminate(),A=null,V=!1)}};x.setLevel("DEBUG");let U=null,k=null,M=!1;self.onmessage=async e=>{const{type:t,data:r}=e.data;try{switch(t){case"init":await oe(r);break;case"start":await ie(r);break;case"cancel":M=!0;break}}catch(o){self.postMessage({type:"error",error:o.message||"Export worker error"})}};async function oe(e){const{width:t,height:r,media:o,effectRegistry:i}=e;U=Y();for(const n of o)n.type==="image"?U.registerImage(n.id,n.blob):n.type==="video"&&(n.buffer?U.registerVideo(n.id,n.buffer):n.frames?U.registerFrames(n.id,n.frames):console.warn(`[ExportWorker] video item ${n.id} has no buffer or frames!`));const a=new Map;if(i)for(const n of i)a.set(n.id,n);k=re(t,r,U,n=>a.get(n),(n,u)=>{const c={...n.params};if(n.keyframes){for(const[w,s]of Object.entries(n.keyframes))if(!(!s||s.length===0)){if(u<=s[0].frame){c[w]=s[0].value;continue}if(u>=s[s.length-1].frame){c[w]=s[s.length-1].value;continue}for(let b=0;b<s.length-1;b++)if(u>=s[b].frame&&u<=s[b+1].frame){const p=(u-s[b].frame)/(s[b+1].frame-s[b].frame);c[w]=s[b].value+(s[b+1].value-s[b].value)*p;break}}}return c}),self.postMessage({type:"init_complete"})}async function ie(e){const{preset:t,tracks:r,inPoint:o,outPoint:i,fps:a,mediaItems:l,audioWavData:d}=e;M=!1;const n=i-o;if(self.postMessage({type:"progress",stage:"loading",progress:0}),await S.load(),self.postMessage({type:"progress",stage:"loading",progress:1}),M){self.postMessage({type:"cancelled"});return}k.setFps(a);const u=new Map;for(const h of l)u.set(h.id,h);let c=!!(d&&d.byteLength>0);c?self.postMessage({type:"log",message:`[Worker] Audio available: ${(d.byteLength/1024).toFixed(0)}KB`}):self.postMessage({type:"log",message:"[Worker] No audio data received"});{let h=!1;for(const F of r)if(!(F.type!=="video"||F.muted)){for(const C of F.clips)if(!C.disabled&&C.sourceOutFrame>C.sourceInFrame){h=!0;break}if(h)break}if(!h)throw new Error("Worker export: no valid video clips found in timeline")}if(typeof VideoEncoder<"u"&&t.webCodecsCodec)try{const{createWebCodecsEncoder:h}=await import("./WebCodecsEncoder-DVUh4g99.js"),{muxToContainer:F}=await import("./Muxer-QYXUgLuH.js"),C=h({codec:t.webCodecsCodec,width:k.canvas.width,height:k.canvas.height,bitrate:t.videoBitrate,fps:a});await C.init(),self.postMessage({type:"log",message:`[Worker] WebCodecs path: ${n} frames, ${a}fps, hasAudio: ${c}`}),self.postMessage({type:"progress",stage:"encoding",progress:0});let _=0;for(let I=o;I<i;I++){if(M){C.close(),self.postMessage({type:"cancelled"});return}const B=await k.compositeFrame(I,r,O=>u.get(O)),$=Math.round(_/a*1e6);C.encodeFrame(B,$),_++,self.postMessage({type:"progress",stage:"encoding",progress:_/n,current:_,total:n})}await C.flush();const R=C.getEncodedData();C.close(),self.postMessage({type:"progress",stage:"muxing",progress:0});const f=await F(S,R,d,{codec:t.webCodecsCodec,format:t.format,fps:a,duration:n/a,audioBitrate:t.audioBitrate,audioSampleRate:t.audioSampleRate}),v=t.format==="webm"?"video/webm":"video/mp4",T=f.buffer;self.postMessage({type:"complete",buffer:T,mimeType:v},[T]),k&&k.cleanup(),U&&U.cleanup();return}catch(h){self.postMessage({type:"log",message:`[Worker] WebCodecs FAILED: ${h.message}, falling to JPEG`})}self.postMessage({type:"log",message:`[Worker] JPEG+FFmpeg fallback path (${n} frames, hasAudio: ${c})`});let s=0;self.postMessage({type:"progress",stage:"rendering",progress:0});for(let h=o;h<i;h++){if(M){self.postMessage({type:"cancelled"});return}const _=await(await(await k.compositeFrame(h,r,v=>u.get(v))).convertToBlob({type:"image/jpeg",quality:.92})).arrayBuffer(),R=new Uint8Array(_),f=String(s).padStart(6,"0");await S.writeFile(`frame_${f}.jpg`,R),s++,self.postMessage({type:"progress",stage:"rendering",progress:s/n,current:s,total:n})}if(M){self.postMessage({type:"cancelled"});return}self.postMessage({type:"progress",stage:"encoding",progress:0}),c&&d&&d.byteLength>0?await S.writeFile("audio.wav",new Uint8Array(d)):c&&(c=!1),S.setProgressCallback(h=>{self.postMessage({type:"progress",stage:"encoding",progress:h})});const b=`output.${t.format}`,p=ae(t,a,s,c,b);try{await S.exec(p)}catch(h){throw new Error(`FFmpeg encoding failed: ${h.message}`)}finally{S.setProgressCallback(null)}const g=await S.readFile(b),E=t.format==="webm"?"video/webm":t.format==="gif"?"image/gif":"video/mp4",y=new Blob([g.buffer],{type:E});for(let h=0;h<s;h++){const F=String(h).padStart(6,"0");await S.deleteFile(`frame_${F}.jpg`)}await S.deleteFile(b),c&&await S.deleteFile("audio.wav");const m=await y.arrayBuffer();self.postMessage({type:"complete",buffer:m,mimeType:E},[m]),k&&k.cleanup(),U&&U.cleanup()}function ae(e,t,r,o,i){const a=["-framerate",String(t),"-i","frame_%06d.jpg"];return o&&a.push("-i","audio.wav"),e.videoCodec&&a.push("-c:v",e.videoCodec),e.pixelFormat&&a.push("-pix_fmt",e.pixelFormat),e.videoBitrate&&a.push("-b:v",e.videoBitrate),e.preset&&a.push("-preset",e.preset),o&&e.audioCodec&&(a.push("-c:a",e.audioCodec),e.audioBitrate&&a.push("-b:a",e.audioBitrate),e.audioSampleRate&&a.push("-ar",String(e.audioSampleRate))),o&&a.push("-shortest"),a.push("-y",i),a}export{x as l};
//# sourceMappingURL=ExportWorker-Cu0vtgJu.js.map
