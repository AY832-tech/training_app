'use strict';
// 依存ゼロの軽量チャート（Canvas）。線グラフと棒グラフ。
(function () {
  const COL = {
    text: '#8b93a3', grid: '#2a2f3a', accent: '#4ade80', blue: '#60a5fa', bg: '#181b22',
  };

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 320;
    const cssH = parseInt(canvas.dataset.height || '180', 10);
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.height = cssH + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { ctx, w: cssW, h: cssH };
  }

  function niceBounds(min, max) {
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1;
    return { lo: min - pad, hi: max + pad };
  }

  // labels: string[], series: [{data:number[], color}]
  function line(canvas, labels, series) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const padL = 38, padR = 10, padT = 12, padB = 22;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const all = series.flatMap((s) => s.data).filter((v) => v != null && !isNaN(v));
    if (!all.length) { drawEmpty(ctx, w, h); return; }
    const { lo, hi } = niceBounds(Math.min(...all), Math.max(...all));
    const x = (i) => padL + (labels.length <= 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
    const y = (v) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;

    // grid + y labels
    ctx.font = '10px sans-serif'; ctx.fillStyle = COL.text; ctx.textAlign = 'right';
    for (let g = 0; g <= 4; g++) {
      const val = lo + ((hi - lo) * g) / 4;
      const yy = y(val);
      ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillText(fmt(val), padL - 5, yy + 3);
    }
    // x labels (最大5個)
    ctx.textAlign = 'center';
    const step = Math.max(1, Math.ceil(labels.length / 5));
    labels.forEach((lb, i) => {
      if (i % step === 0 || i === labels.length - 1)
        ctx.fillText(lb, x(i), h - 6);
    });

    for (const s of series) {
      const col = s.color || COL.accent;
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      s.data.forEach((v, i) => {
        if (v == null || isNaN(v)) return;
        const px = x(i), py = y(v);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      });
      ctx.stroke();
      // points
      ctx.fillStyle = col;
      s.data.forEach((v, i) => {
        if (v == null || isNaN(v)) return;
        ctx.beginPath(); ctx.arc(x(i), y(v), 2.8, 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  function bar(canvas, labels, data, color) {
    const { ctx, w, h } = setup(canvas);
    ctx.clearRect(0, 0, w, h);
    const padL = 38, padR = 10, padT = 12, padB = 22;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const vals = data.filter((v) => v != null && !isNaN(v));
    if (!vals.length) { drawEmpty(ctx, w, h); return; }
    const hi = Math.max(...vals, 0) * 1.15 || 1;
    const y = (v) => padT + plotH - (v / hi) * plotH;
    ctx.font = '10px sans-serif'; ctx.fillStyle = COL.text; ctx.textAlign = 'right';
    for (let g = 0; g <= 4; g++) {
      const val = (hi * g) / 4, yy = y(val);
      ctx.strokeStyle = COL.grid; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillText(fmt(val), padL - 5, yy + 3);
    }
    const bw = (plotW / data.length) * 0.6;
    const gap = (plotW / data.length);
    ctx.fillStyle = color || COL.accent;
    data.forEach((v, i) => {
      if (v == null || isNaN(v)) return;
      const bx = padL + gap * i + (gap - bw) / 2;
      const by = y(v);
      ctx.beginPath();
      roundRect(ctx, bx, by, bw, padT + plotH - by, 3);
      ctx.fill();
    });
    ctx.fillStyle = COL.text; ctx.textAlign = 'center';
    const step = Math.max(1, Math.ceil(labels.length / 7));
    labels.forEach((lb, i) => { if (i % step === 0) ctx.fillText(lb, padL + gap * i + gap / 2, h - 6); });
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    if (h <= 0) return;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, 0);
    ctx.arcTo(x, y + h, x, y, 0);
    ctx.arcTo(x, y, x + w, y, r);
  }

  function drawEmpty(ctx, w, h) {
    ctx.fillStyle = COL.text; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('データがありません', w / 2, h / 2);
  }

  function fmt(v) {
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'k';
    return Math.round(v * 10) / 10 + '';
  }

  window.Charts = { line, bar };
})();
