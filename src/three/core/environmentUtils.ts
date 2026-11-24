import * as THREE from 'three';

/**
 * Checks renderer GPU string directly (never UA/headless/platform) to detect
 * software WebGL rasterizers so expensive multi-pass bloom & high-res shadows
 * can step down gracefully.
 */
export function detectSoftwareWebGL(gl: THREE.WebGLRenderer): boolean {
  try {
    const context = gl.getContext();
    if (!context) return false;
    const debugExt = context.getExtension('WEBGL_debug_renderer_info');
    if (debugExt) {
      const rendererStr = String(
        context.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) || '',
      ).toLowerCase();
      return /swiftshader|software|llvmpipe|mesa/i.test(rendererStr);
    }
    const basicRenderer = String(context.getParameter(context.RENDERER) || '').toLowerCase();
    return /swiftshader|software|llvmpipe|mesa/i.test(basicRenderer);
  } catch {
    return false;
  }
}

/**
 * Generates a tileable procedural stone plaza texture with subtle mortar seams & grain.
 */
export function createPlazaTileTexture(isDay: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = isDay ? '#d8e0ec' : '#1b2438';
    ctx.fillRect(0, 0, 256, 256);

    // Subtle stone grain
    for (let i = 0; i < 900; i += 1) {
      const x = (i * 73) % 256;
      const y = (i * 139) % 256;
      const alpha = (i % 5) * 0.015 + 0.02;
      ctx.fillStyle = isDay
        ? `rgba(120, 138, 165, ${alpha})`
        : `rgba(148, 175, 220, ${alpha * 0.65})`;
      ctx.fillRect(x, y, 2, 2);
    }

    // Concentric & radial flagstones
    ctx.strokeStyle = isDay ? 'rgba(130, 148, 175, 0.38)' : 'rgba(56, 189, 248, 0.14)';
    ctx.lineWidth = 2;
    for (let y = 0; y <= 256; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
    }
    for (let x = 0; x <= 256; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 256);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates an organic meadow/stone variation texture for landscape terrain.
 */
export function createTerrainDetailTexture(isDay: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = isDay ? '#ffffff' : '#dbeafe';
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 650; i += 1) {
      const x = ((i * 97) % 256);
      const y = ((i * 53) % 256);
      const r = 3 + (i % 7);
      ctx.fillStyle = isDay
        ? i % 2 === 0
          ? 'rgba(180, 220, 160, 0.16)'
          : 'rgba(90, 140, 80, 0.10)'
        : i % 2 === 0
          ? 'rgba(110, 145, 200, 0.10)'
          : 'rgba(18, 28, 52, 0.14)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates an emissive architectural window facade texture for Model Land towers.
 */
export function createArchitecturalWindowTexture(
  accentHex: string,
  litRatio = 0.82,
  patternVariant = 0,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#050811';
    ctx.fillRect(0, 0, 128, 256);

    const cols = patternVariant % 2 === 0 ? 6 : 4;
    const rows = 14;
    const padX = 10;
    const padY = 12;
    const cellW = (128 - padX * 2) / cols;
    const cellH = (256 - padY * 2) / rows;

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const hash = ((r * 31 + c * 17 + patternVariant * 13) % 100) / 100;
        if (hash > litRatio) continue;

        ctx.fillStyle = accentHex;
        ctx.globalAlpha = 0.55 + (hash * 0.45);

        const x = padX + c * cellW + 3;
        const y = padY + r * cellH + 3;
        const w = Math.max(4, cellW - 6);
        const h = Math.max(4, cellH - 6);

        if (patternVariant === 2) {
          // Horizontal light ribbon bars
          ctx.fillRect(padX + 2, y + 2, 128 - padX * 2 - 4, Math.max(3, h * 0.55));
          break;
        } else {
          ctx.fillRect(x, y, w, h);
        }
      }
    }
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates brushed titanium metal bump/roughness variation texture for Nova & architecture.
 */
export function createBrushedMetalTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 1) {
      const shade = 116 + ((y * 17) % 28);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(0, y, 128, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}
