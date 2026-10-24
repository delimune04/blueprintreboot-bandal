// CAPELLA web preview. Everything runs in this browser: a chosen photo is
// decoded locally, never uploaded, and the result is saved with a download.
import { DEFAULTS, PRESETS, RATIOS, cropRect, fitSize, processPixels, stampText } from './filters.mjs';

const form = document.getElementById('lab-form');
const canvas = document.getElementById('lab-canvas');
if (form && canvas) {
  const $ = (id) => document.getElementById(id);
  const caption = $('lab-caption');
  const status = $('lab-status');
  const settings = { ...DEFAULTS };
  let source = null;
  let sourceName = null;
  let frame = 0;

  // A sunset lake drawn in code, so the preview needs no photo licence.
  function drawScene() {
    const scene = document.createElement('canvas');
    scene.width = 1200;
    scene.height = 1500;
    const c = scene.getContext('2d');
    const w = scene.width, h = scene.height, horizon = h * 0.6;
    const sky = c.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#241a52');
    sky.addColorStop(0.42, '#6d3fc4');
    sky.addColorStop(0.75, '#e48fd6');
    sky.addColorStop(1, '#ffc59a');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, horizon);
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 140; i += 1) {
      const y = rand() * horizon * 0.55;
      c.globalAlpha = 0.25 + rand() * 0.75 * (1 - y / (horizon * 0.55));
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(rand() * w, y, 0.6 + rand() * 1.8, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    const sunX = w * 0.62, sunY = horizon - 120;
    const glow = c.createRadialGradient(sunX, sunY, 10, sunX, sunY, 420);
    glow.addColorStop(0, 'rgba(255,240,214,0.95)');
    glow.addColorStop(0.18, 'rgba(255,205,160,0.55)');
    glow.addColorStop(1, 'rgba(255,190,160,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, w, horizon);
    c.fillStyle = '#fff3df';
    c.beginPath();
    c.arc(sunX, sunY, 64, 0, Math.PI * 2);
    c.fill();
    const ridge = (base, amp, color, step, phase) => {
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(0, horizon);
      for (let x = 0; x <= w; x += step) {
        const y = base - amp * (0.55 + 0.45 * Math.sin(x / 170 + phase)) * (0.6 + 0.4 * Math.sin(x / 61 + phase * 2));
        c.lineTo(x, y);
      }
      c.lineTo(w, horizon);
      c.closePath();
      c.fill();
    };
    ridge(horizon - 40, 230, '#8a5fbf', 24, 0.4);
    ridge(horizon - 10, 170, '#5d3d93', 20, 2.1);
    ridge(horizon + 2, 95, '#3a2766', 16, 4.2);
    // Lake: mirrored sky, darker, with shimmer.
    c.save();
    c.translate(0, horizon * 2);
    c.scale(1, -1);
    c.globalAlpha = 0.72;
    c.drawImage(scene, 0, 0, w, horizon, 0, 0, w, horizon);
    c.restore();
    const water = c.createLinearGradient(0, horizon, 0, h);
    water.addColorStop(0, 'rgba(30,18,60,0.25)');
    water.addColorStop(1, 'rgba(14,9,32,0.92)');
    c.fillStyle = water;
    c.fillRect(0, horizon, w, h - horizon);
    c.strokeStyle = 'rgba(255,230,200,0.55)';
    for (let i = 0; i < 46; i += 1) {
      const y = horizon + 14 + i * i * 0.32;
      const half = Math.max(8, 150 - i * 3) * (0.6 + rand() * 0.6);
      c.lineWidth = 1 + i * 0.06;
      c.beginPath();
      c.moveTo(sunX - half, y);
      c.lineTo(sunX + half, y);
      c.stroke();
    }
    c.fillStyle = '#120c24';
    c.beginPath();
    c.moveTo(0, h);
    c.lineTo(0, h * 0.86);
    c.quadraticCurveTo(w * 0.3, h * 0.82, w * 0.55, h * 0.9);
    c.quadraticCurveTo(w * 0.8, h * 0.95, w, h * 0.91);
    c.lineTo(w, h);
    c.fill();
    c.strokeStyle = '#120c24';
    c.lineWidth = 3;
    for (let i = 0; i < 26; i += 1) {
      const x = 40 + i * 13 + rand() * 8, base = h * 0.865 + rand() * 20;
      c.beginPath();
      c.moveTo(x, base);
      c.quadraticCurveTo(x + 10, base - 70, x + 4 + rand() * 18, base - 110 - rand() * 90);
      c.stroke();
    }
    return scene;
  }

  function render(target, maxSide) {
    const ratio = RATIOS.find((r) => r.id === settings.ratio)?.value || null;
    const sw = source.width, sh = source.height;
    const crop = cropRect(sw, sh, ratio);
    const size = fitSize(crop.width, crop.height, maxSide);
    target.width = size.width;
    target.height = size.height;
    const c = target.getContext('2d', { willReadFrequently: true });
    c.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
    const image = c.getImageData(0, 0, size.width, size.height);
    processPixels(image.data, size.width, size.height, settings);
    c.putImageData(image, 0, 0);
    if (settings.stamp) {
      const fontSize = Math.round(Math.min(size.width, size.height) * 0.05);
      c.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      c.textAlign = 'right';
      c.textBaseline = 'alphabetic';
      c.shadowColor = 'rgba(255,120,40,0.85)';
      c.shadowBlur = fontSize * 0.45;
      c.fillStyle = '#ffa24a';
      const margin = Math.round(Math.min(size.width, size.height) * 0.055);
      c.fillText(stampText(), size.width - margin, size.height - margin);
      c.shadowBlur = 0;
    }
  }

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; if (source) render(canvas, 900); });
  };

  // Preset and ratio buttons come from the same lists the math uses.
  const segment = (id, items, key) => {
    const group = $(id);
    group.innerHTML = items.map((item) => `<button type="button" data-value="${item.id}" aria-pressed="${settings[key] === item.id}">${item.label}</button>`).join('');
    group.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-value]');
      if (!button) return;
      settings[key] = button.dataset.value;
      group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      schedule();
    });
  };
  segment('lab-presets', PRESETS, 'preset');
  segment('lab-ratios', RATIOS, 'ratio');

  for (const key of ['intensity', 'exposure', 'grain', 'vignette']) {
    const input = $(`lab-${key}`);
    const output = $(`out-${key}`);
    input.addEventListener('input', () => {
      settings[key] = Number(input.value);
      output.textContent = key === 'exposure' && settings[key] > 0 ? `+${settings[key]}` : String(settings[key]);
      schedule();
    });
  }
  $('lab-stamp').addEventListener('change', (event) => { settings.stamp = event.target.checked; schedule(); });

  async function decode(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  $('lab-file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { status.textContent = '사진 파일을 골라 주세요.'; return; }
    if (file.size > 40 * 1024 * 1024) { status.textContent = '40MB보다 작은 사진을 골라 주세요.'; return; }
    status.textContent = '사진을 불러오는 중이에요…';
    try {
      source = await decode(file);
      sourceName = file.name.replace(/\.[^.]+$/, '');
      caption.textContent = '내 사진 · 이 브라우저 안에서만 처리돼요.';
      status.textContent = '사진을 불러왔어요. 업로드되지 않고 이 화면에서만 보정돼요.';
      schedule();
    } catch {
      status.textContent = '이 사진은 브라우저에서 열 수 없어요. JPG나 PNG로 다시 시도해 주세요.';
    }
  });

  $('lab-reset').addEventListener('click', () => {
    source = drawScene();
    sourceName = null;
    caption.textContent = '기본 장면 · 웹에서 그린 예시 이미지예요.';
    status.textContent = '고른 사진은 이 브라우저 안에서만 처리되고 어디에도 업로드되지 않아요.';
    schedule();
  });

  $('lab-save').addEventListener('click', () => {
    if (!source) return;
    const output = document.createElement('canvas');
    render(output, 2048);
    output.toBlob((blob) => {
      if (!blob) { status.textContent = '저장할 이미지를 만들지 못했어요.'; return; }
      const link = document.createElement('a');
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      link.download = `${sourceName ? `${sourceName}-` : ''}capella-preview-${day}.jpg`;
      link.href = URL.createObjectURL(blob);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      status.textContent = '결과를 저장했어요. 원본 사진은 그대로예요.';
    }, 'image/jpeg', 0.92);
  });

  source = drawScene();
  render(canvas, 900);
}
