// CAPELLA web preview: pure image math shared by the page and its tests.
// These looks are a web approximation for trying the app's controls; they are
// not the app's filter definitions.

export const PRESETS = [
  { id: 'none', label: '원본', matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], offset: [0, 0, 0], contrast: 1, saturation: 1, fade: 0 },
  { id: 'starlight', label: '별빛', matrix: [0.94, 0.02, 0.04, 0.01, 0.93, 0.06, 0.04, 0.02, 1.04], offset: [0.02, 0.0, 0.05], contrast: 1.06, saturation: 0.88, fade: 0.06 },
  { id: 'film', label: '필름', matrix: [1.05, 0.03, 0, 0.02, 1.0, 0, 0, 0.04, 0.86], offset: [0.025, 0.012, 0], contrast: 0.94, saturation: 0.9, fade: 0.1 },
  { id: 'sunset', label: '노을', matrix: [1.1, 0.02, 0, 0.02, 0.97, 0, 0.02, 0, 0.88], offset: [0.03, 0.005, 0.02], contrast: 1.08, saturation: 1.16, fade: 0.02 },
  { id: 'clear', label: '맑음', matrix: [1.02, 0, 0, 0, 1.02, 0, 0, 0, 1.03], offset: [0, 0, 0], contrast: 1.12, saturation: 1.2, fade: 0 },
  { id: 'mono', label: '모노', matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], offset: [0, 0, 0], contrast: 1.2, saturation: 0, fade: 0.04 },
];

export const RATIOS = [
  { id: 'source', label: '원본', value: null },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:5', label: '4:5', value: 4 / 5 },
  { id: '3:4', label: '3:4', value: 3 / 4 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
];

export const DEFAULTS = Object.freeze({ preset: 'starlight', ratio: 'source', intensity: 80, exposure: 0, grain: 20, vignette: 35, stamp: true });

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Centre crop of a width×height source to the ratio (width / height). */
export function cropRect(width, height, ratio) {
  if (!ratio || !(width > 0) || !(height > 0)) return { x: 0, y: 0, width, height };
  if (width / height > ratio) {
    const w = Math.round(height * ratio);
    return { x: Math.round((width - w) / 2), y: 0, width: w, height };
  }
  const h = Math.round(width / ratio);
  return { x: 0, y: Math.round((height - h) / 2), width, height: h };
}

/** Output size whose longer side is at most maxSide, keeping the aspect ratio. */
export function fitSize(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Film-camera style stamp: 'YY MM DD in local time. */
export function stampText(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `'${pad(date.getFullYear() % 100)} ${pad(date.getMonth() + 1)} ${pad(date.getDate())}`;
}

// Integer hash so grain stays put while sliders move.
function noise(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/**
 * Applies a preset, exposure, vignette and grain to RGBA pixels in place.
 * settings: { preset, intensity 0–100, exposure −100–100, grain 0–100, vignette 0–100 }
 */
export function processPixels(data, width, height, settings) {
  const preset = PRESETS.find((p) => p.id === settings.preset) || PRESETS[0];
  const mix = clamp01((settings.intensity ?? 100) / 100);
  const gain = Math.pow(2, (settings.exposure || 0) / 100);
  const grain = clamp01((settings.grain || 0) / 100) * 0.11;
  const vignette = clamp01((settings.vignette || 0) / 100) * 0.75;
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = preset.matrix;
  const [o0, o1, o2] = preset.offset;
  const { contrast, saturation, fade } = preset;
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  const radius = Math.hypot(cx, cy) || 1;
  const identity = preset.id === 'none';
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let r = (data[i] / 255) * gain, g = (data[i + 1] / 255) * gain, b = (data[i + 2] / 255) * gain;
      if (!identity && mix > 0) {
        let tr = m0 * r + m1 * g + m2 * b + o0;
        let tg = m3 * r + m4 * g + m5 * b + o1;
        let tb = m6 * r + m7 * g + m8 * b + o2;
        const luma = 0.2126 * tr + 0.7152 * tg + 0.0722 * tb;
        tr = luma + (tr - luma) * saturation;
        tg = luma + (tg - luma) * saturation;
        tb = luma + (tb - luma) * saturation;
        tr = (tr - 0.5) * contrast + 0.5;
        tg = (tg - 0.5) * contrast + 0.5;
        tb = (tb - 0.5) * contrast + 0.5;
        tr = tr * (1 - fade) + fade;
        tg = tg * (1 - fade) + fade;
        tb = tb * (1 - fade) + fade;
        r += (tr - r) * mix;
        g += (tg - g) * mix;
        b += (tb - b) * mix;
      }
      if (vignette > 0) {
        const d = Math.hypot(x - cx, y - cy) / radius;
        const t = clamp01((d - 0.35) / 0.65);
        const v = 1 - vignette * t * t * (3 - 2 * t);
        r *= v; g *= v; b *= v;
      }
      if (grain > 0) {
        const n = noise(x, y) * grain;
        r += n; g += n; b += n;
      }
      data[i] = Math.round(clamp01(r) * 255);
      data[i + 1] = Math.round(clamp01(g) * 255);
      data[i + 2] = Math.round(clamp01(b) * 255);
    }
  }
  return data;
}
