// Shared pure functions for video compositing (main thread + Worker)

// Draw source at native pixel size, centered on canvas (no scaling)
export function drawFit(ctx, source, canvasWidth, canvasHeight) {
  const srcW = source.videoWidth || source.naturalWidth || source.width;
  const srcH = source.videoHeight || source.naturalHeight || source.height;
  if (!srcW || !srcH) return;

  const x = (canvasWidth - srcW) / 2;
  const y = (canvasHeight - srcH) / 2;

  ctx.drawImage(source, x, y, srcW, srcH);
}

// Separate effects into compositing (transform/motion/opacity/crop) and pixel effects
export function separateEffects(effects, effectRegistryGet, keyframeResolve, frame) {
  let transformParams = null;
  let motionParams = null;
  let opacity = 1;
  const pixelEffects = [];
  const cropEffects = [];

  for (const fx of effects) {
    const def = effectRegistryGet(fx.effectId);
    if (!def || def.type !== 'video') continue;

    const params = keyframeResolve(fx, frame);

    if (fx.effectId === 'motion' && fx.intrinsic) {
      motionParams = params;
    } else if (fx.effectId === 'transform') {
      transformParams = params;
    } else if (fx.effectId === 'opacity') {
      opacity = params.opacity / 100;
    } else if (fx.effectId === 'crop') {
      cropEffects.push({ fx, def, params });
    } else if (fx.effectId === 'time-remap' || fx.effectId === 'audio-volume' ||
               fx.effectId === 'panner' || fx.effectId === 'channel-volume') {
      // Audio/time effects — skip in video compositor
    } else {
      pixelEffects.push({ fx, def, params });
    }
  }

  return { transformParams, motionParams, opacity, pixelEffects, cropEffects };
}

// Apply motion crop to offscreen canvas (black bars over cropped regions)
export function applyMotionCrop(ctx, motionParams, canvasWidth, canvasHeight) {
  const { cropLeft, cropTop, cropRight, cropBottom } = motionParams;
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

// Apply compositing transform + motion + opacity and blit offscreen canvas to main context
export function applyCompositing(ctx, transformParams, opacity, offscreenCanvas, canvasWidth, canvasHeight, motionParams) {
  ctx.save();

  if (motionParams) {
    const sy = motionParams.scale / 100;
    const sx = motionParams.uniformScale ? sy : motionParams.scaleWidth / 100;
    ctx.translate(motionParams.posX, motionParams.posY);
    ctx.rotate((motionParams.rotation * Math.PI) / 180);
    ctx.scale(sx, sy);
    ctx.translate(-motionParams.anchorX, -motionParams.anchorY);
  }

  if (transformParams) {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    ctx.translate(cx + transformParams.posX, cy + transformParams.posY);
    ctx.rotate((transformParams.rotation * Math.PI) / 180);
    ctx.scale(transformParams.scaleX / 100, transformParams.scaleY / 100);
    ctx.translate(-cx, -cy);
  }

  ctx.globalAlpha = opacity;
  ctx.drawImage(offscreenCanvas, 0, 0);
  ctx.restore();
}

// Canvas2D filter fallback for pixel effects (used in Workers where def.apply() is unavailable)
export function applyCanvas2DEffect(ctx, effectId, params) {
  switch (effectId) {
    case 'gaussian-blur':
      if (params.radius > 0) { ctx.filter = `blur(${params.radius}px)`; ctx.drawImage(ctx.canvas, 0, 0); ctx.filter = 'none'; }
      break;
    case 'hue-rotate':
      ctx.filter = `hue-rotate(${params.angle}deg)`; ctx.drawImage(ctx.canvas, 0, 0); ctx.filter = 'none';
      break;
    case 'invert':
      if (params.amount > 0) { ctx.filter = `invert(${params.amount}%)`; ctx.drawImage(ctx.canvas, 0, 0); ctx.filter = 'none'; }
      break;
    case 'grayscale':
      if (params.amount > 0) { ctx.filter = `grayscale(${params.amount}%)`; ctx.drawImage(ctx.canvas, 0, 0); ctx.filter = 'none'; }
      break;
    case 'sepia':
      if (params.amount > 0) { ctx.filter = `sepia(${params.amount}%)`; ctx.drawImage(ctx.canvas, 0, 0); ctx.filter = 'none'; }
      break;
    case 'brightness-contrast': {
      const b = params.brightness / 100;
      const c = (params.contrast + 100) / 100;
      ctx.filter = `brightness(${1 + b}) contrast(${c})`; ctx.drawImage(ctx.canvas, 0, 0); ctx.filter = 'none';
      break;
    }
    case 'saturation':
      ctx.filter = `saturate(${(params.amount + 100) / 100})`; ctx.drawImage(ctx.canvas, 0, 0); ctx.filter = 'none';
      break;
    case 'drop-shadow':
      ctx.filter = `drop-shadow(${params.offsetX}px ${params.offsetY}px ${params.blur}px ${params.color || '#000'})`;
      ctx.drawImage(ctx.canvas, 0, 0); ctx.filter = 'none';
      break;
    default:
      break;
  }
}
