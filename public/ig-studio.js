'use strict';
/**
 * Instagram studio UI.
 *
 * Slides are drawn on a 1080x1350 canvas in the browser (Instagram's portrait
 * carousel ratio) and exported as PNG. Rendering client-side keeps the server
 * free of native image dependencies, and the PNGs only leave the browser when
 * the admin explicitly asks to save or publish.
 */
(function () {
  const W = 1080;
  const H = 1350;

  const PALETTE = {
    bg0: '#0a0a12',
    bg1: '#191a35',
    text: '#eceefb',
    muted: '#9aa0c8',
    accent: '#7c5cff',
    accent2: '#22d3ee',
    accent3: '#f472b6',
    gold: '#fbbf24',
  };

  const fontsReady = () =>
    document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Greedy RTL-safe wrap; canvas handles the bidi run itself per line. */
  function wrap(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawBackdrop(ctx, variant) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, PALETTE.bg0);
    g.addColorStop(1, PALETTE.bg1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // soft colour blooms, rotated per slide so a carousel does not look flat
    const blooms = [
      [W * 0.82, H * 0.12, 420, PALETTE.accent, 0.32],
      [W * 0.1, H * 0.82, 380, PALETTE.accent2, 0.2],
      [W * 0.5, H * 0.5, 300, PALETTE.accent3, 0.1],
    ];
    blooms.forEach(([x, y, r, color, alpha], i) => {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r * (1 + (variant % 3) * 0.08));
      rg.addColorStop(0, hexA(color, alpha));
      rg.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    });

    // top accent bar
    const bar = ctx.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, PALETTE.accent);
    bar.addColorStop(0.5, PALETTE.accent2);
    bar.addColorStop(1, PALETTE.accent3);
    ctx.fillStyle = bar;
    ctx.fillRect(0, 0, W, 10);
  }

  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  function drawBrand(ctx, index, total) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.font = '600 30px Vazirmatn, Tahoma, sans-serif';
    ctx.fillStyle = PALETTE.muted;
    ctx.fillText('promptaria.aliizz.ir', W - 70, H - 62);

    // logo mark
    ctx.textAlign = 'left';
    const mg = ctx.createLinearGradient(70, H - 100, 130, H - 50);
    mg.addColorStop(0, PALETTE.accent);
    mg.addColorStop(1, PALETTE.accent2);
    ctx.fillStyle = mg;
    roundRect(ctx, 70, H - 102, 52, 52, 15);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 30px Vazirmatn, Tahoma, sans-serif';
    ctx.fillText('✦', 84, H - 64);

    if (total > 1) {
      ctx.direction = 'ltr'; // an RTL run would flip this into "6 / 2"
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.muted;
      ctx.font = '500 26px Vazirmatn, Tahoma, sans-serif';
      ctx.fillText(`${index + 1} / ${total}`, W / 2, H - 62);
    }
    ctx.restore();
  }

  function drawEyebrow(ctx, text) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.font = '600 30px Vazirmatn, Tahoma, sans-serif';
    const w = ctx.measureText(text).width + 46;
    ctx.fillStyle = hexA(PALETTE.accent2, 0.14);
    roundRect(ctx, W - 70 - w, 118, w, 62, 18);
    ctx.fill();
    ctx.strokeStyle = hexA(PALETTE.accent2, 0.4);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = PALETTE.accent2;
    ctx.fillText(text, W - 93, 160);
    ctx.restore();
  }

  function drawSlide(canvas, slide, index, total) {
    const ctx = canvas.getContext('2d');
    canvas.width = W;
    canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    drawBackdrop(ctx, index);
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    const RIGHT = W - 70;
    const MAXW = W - 140;
    let y = 250;

    if (slide.eyebrow) drawEyebrow(ctx, slide.eyebrow);

    // title
    ctx.fillStyle = PALETTE.text;
    if (slide.kind === 'cover' || slide.kind === 'cta') y = 430;
    const titleSize = slide.kind === 'cover' ? 68 : 58;
    ctx.font = `800 ${titleSize}px Vazirmatn, Tahoma, sans-serif`;
    const titleLines = wrap(ctx, slide.title || '', MAXW).slice(0, 4);
    for (const line of titleLines) {
      ctx.fillText(line, RIGHT, y);
      y += titleSize * 1.42;
    }

    y += 22;

    if (slide.sub) {
      ctx.fillStyle = PALETTE.muted;
      ctx.font = '400 38px Vazirmatn, Tahoma, sans-serif';
      for (const line of wrap(ctx, slide.sub, MAXW).slice(0, 5)) {
        ctx.fillText(line, RIGHT, y);
        y += 56;
      }
      y += 16;
    }

    if (slide.body) {
      // prompt text: LTR mono block on a dark card
      const boxTop = y;
      // measure first so the card hugs the text rather than leaving dead space
      ctx.save();
      ctx.font = '400 27px "JetBrains Mono", Consolas, monospace';
      const bodyLines = wrap(ctx, slide.body, MAXW - 76);
      ctx.restore();
      const maxH = H - y - 190;
      const boxH = Math.max(220, Math.min(maxH, bodyLines.length * 40 + 96));
      ctx.fillStyle = 'rgba(6,7,14,0.72)';
      roundRect(ctx, 70, boxTop, MAXW, boxH, 26);
      ctx.fill();
      ctx.strokeStyle = hexA(PALETTE.accent, 0.34);
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      roundRect(ctx, 70, boxTop, MAXW, boxH, 26);
      ctx.clip();
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#dfe3ff';
      ctx.font = '400 27px "JetBrains Mono", Consolas, monospace';
      let ty = boxTop + 58;
      for (const line of bodyLines) {
        if (ty > boxTop + boxH - 30) break;
        ctx.fillText(line, 106, ty);
        ty += 40;
      }
      ctx.restore();
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      y = boxTop + boxH + 30;
    }

    if (slide.items && slide.items.length) {
      ctx.font = '500 34px Vazirmatn, Tahoma, sans-serif';
      for (let i = 0; i < slide.items.length; i++) {
        const lines = wrap(ctx, slide.items[i], MAXW - 110);
        const cardH = lines.length * 50 + 46;
        if (y + cardH > H - 180) break;

        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        roundRect(ctx, 70, y - 10, MAXW, cardH, 20);
        ctx.fill();
        // numbered accent edge
        ctx.fillStyle = [PALETTE.accent, PALETTE.accent2, PALETTE.accent3, PALETTE.gold][i % 4];
        roundRect(ctx, W - 78, y - 10, 8, cardH, 4);
        ctx.fill();

        ctx.fillStyle = PALETTE.text;
        let ly = y + 34;
        for (const line of lines) {
          ctx.fillText(line, RIGHT - 34, ly);
          ly += 50;
        }
        y += cardH + 20;
      }
    }

    if (slide.badge) {
      ctx.font = '700 34px Vazirmatn, Tahoma, sans-serif';
      const bw = ctx.measureText(slide.badge).width + 60;
      const by = H - 260;
      const bg = ctx.createLinearGradient(RIGHT - bw, by, RIGHT, by + 76);
      bg.addColorStop(0, PALETTE.accent);
      bg.addColorStop(1, '#6247e0');
      ctx.fillStyle = bg;
      roundRect(ctx, RIGHT - bw, by, bw, 76, 22);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(slide.badge, RIGHT - 30, by + 50);
    }

    drawBrand(ctx, index, total);
    return canvas;
  }

  async function renderAll(slides) {
    await fontsReady();
    return slides.map((s, i) => {
      const c = document.createElement('canvas');
      drawSlide(c, s, i, slides.length);
      return c;
    });
  }

  window.IGStudio = {
    W,
    H,
    drawSlide,
    renderAll,
    toDataUrls: (canvases) => canvases.map((c) => c.toDataURL('image/png')),
  };
})();
