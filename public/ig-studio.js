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

  /**
   * Like wrap(), but a prompt body is structured text: its line breaks carry
   * meaning (field lists, numbered rules) and collapsing them turns a readable
   * prompt into a wall. Wrap each source line on its own.
   */
  function wrapBlock(ctx, text, maxWidth) {
    const out = [];
    for (const raw of String(text).split('\n')) {
      if (!raw.trim()) {
        if (out.length && out[out.length - 1] !== '') out.push('');
        continue;
      }
      for (const l of wrap(ctx, raw.trim(), maxWidth)) out.push(l);
    }
    return out;
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

  /**
   * The Promptaria mark: a gradient rounded square holding a four-point spark
   * drawn as a real path (not an emoji), so it stays crisp at any size and
   * reads as one recognizable logo across every slide — the repetition is what
   * builds recall, which is half of why a feed converts to follows.
   */
  function drawLogoMark(ctx, x, y, size) {
    const r = size * 0.28;
    const mg = ctx.createLinearGradient(x, y, x + size, y + size);
    mg.addColorStop(0, PALETTE.accent);
    mg.addColorStop(0.6, '#6247e0');
    mg.addColorStop(1, PALETTE.accent2);
    ctx.fillStyle = mg;
    roundRect(ctx, x, y, size, size, r);
    ctx.fill();

    // four-point spark
    const cx = x + size / 2;
    const cy = y + size / 2;
    const R = size * 0.34; // long axis
    const w = size * 0.1; // waist
    ctx.beginPath();
    ctx.moveTo(cx, cy - R);
    ctx.quadraticCurveTo(cx + w, cy - w, cx + R, cy);
    ctx.quadraticCurveTo(cx + w, cy + w, cx, cy + R);
    ctx.quadraticCurveTo(cx - w, cy + w, cx - R, cy);
    ctx.quadraticCurveTo(cx - w, cy - w, cx, cy - R);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
    // small accent dot, top-right, like a cursor blink
    ctx.beginPath();
    ctx.arc(x + size * 0.8, y + size * 0.2, size * 0.06, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE.gold;
    ctx.fill();
  }

  function drawBrand(ctx, index, total) {
    ctx.save();
    const baseY = H - 96;

    // mark + wordmark + handle, left side
    drawLogoMark(ctx, 70, baseY, 56);
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.fillStyle = PALETTE.text;
    ctx.font = '800 34px Vazirmatn, Tahoma, sans-serif';
    ctx.fillText('Promptaria', 142, baseY + 26);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = '500 24px Vazirmatn, Tahoma, sans-serif';
    ctx.fillText('@prompt_aria', 142, baseY + 52);

    // page pill, right side
    if (total > 1) {
      ctx.direction = 'ltr';
      ctx.textAlign = 'right';
      ctx.font = '600 26px Vazirmatn, Tahoma, sans-serif';
      const label = `${index + 1}/${total}`;
      const pw = ctx.measureText(label).width + 40;
      ctx.fillStyle = hexA(PALETTE.accent2, 0.14);
      roundRect(ctx, W - 70 - pw, baseY + 8, pw, 44, 22);
      ctx.fill();
      ctx.fillStyle = PALETTE.accent2;
      ctx.fillText(label, W - 90, baseY + 37);
    }
    ctx.restore();
  }

  /** A right-pointing swipe cue for RTL carousels: readers move cover → left. */
  function drawSwipeCue(ctx) {
    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.font = '700 30px Vazirmatn, Tahoma, sans-serif';
    const label = 'بکش ببین';
    const w = ctx.measureText(label).width + 96;
    const x = W - 70 - w;
    const y = H - 210;
    ctx.fillStyle = hexA(PALETTE.gold, 0.16);
    roundRect(ctx, x, y, w, 64, 32);
    ctx.fill();
    ctx.strokeStyle = hexA(PALETTE.gold, 0.5);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = PALETTE.gold;
    ctx.fillText(label, W - 96, y + 42);
    // arrow pointing left (swipe direction)
    const ax = x + 40;
    const ay = y + 32;
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax + 16, ay);
    ctx.lineTo(ax - 8, ay);
    ctx.moveTo(ax, ay - 10);
    ctx.lineTo(ax - 10, ay);
    ctx.lineTo(ax, ay + 10);
    ctx.stroke();
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
      ctx.font = slide.bodyRtl
        ? '400 29px Vazirmatn, Tahoma, sans-serif'
        : '400 27px "JetBrains Mono", Consolas, monospace';
      const bodyLines = wrapBlock(ctx, slide.body, MAXW - 76);
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
      // A Persian body must stay RTL: drawn left-to-right the brackets and
      // digits mirror and the block becomes unreadable.
      const rtl = Boolean(slide.bodyRtl);
      ctx.direction = rtl ? 'rtl' : 'ltr';
      ctx.textAlign = rtl ? 'right' : 'left';
      ctx.fillStyle = '#dfe3ff';
      ctx.font = rtl
        ? '400 29px Vazirmatn, Tahoma, sans-serif'
        : '400 27px "JetBrains Mono", Consolas, monospace';
      const tx = rtl ? W - 106 : 106;
      let ty = boxTop + 58;
      for (const line of bodyLines) {
        if (ty > boxTop + boxH - 30) break;
        if (line) ctx.fillText(line, tx, ty);
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

    // A swipe cue on the cover lifts carousel completion — and a fully-swiped
    // carousel is one of the strongest ranking signals Instagram acts on.
    if (slide.kind === 'cover' && total > 1) drawSwipeCue(ctx);

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
    // Instagram's content-publishing API accepts JPEG only, so anything headed
    // for the Graph API must be encoded as JPEG; PNG is for local downloads.
    toDataUrls: (canvases, type = 'image/png') =>
      canvases.map((c) => c.toDataURL(type, type === 'image/jpeg' ? 0.92 : undefined)),
  };
})();
