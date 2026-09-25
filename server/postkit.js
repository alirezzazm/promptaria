'use strict';
/**
 * Post kits — the no-API route to Instagram.
 *
 * Meta's publishing API needs a developer app that not everyone can create, so
 * the studio can also hand off a post to a phone instead: the rendered slides
 * and the caption are parked behind an unguessable, expiring URL that opens as
 * a mobile page. Save the images, copy the caption, post from the app.
 *
 * The URL is the only credential, so it is 32 random hex chars, carries
 * noindex, and expires on its own.
 */
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('./db');

const SITE = process.env.SITE_URL || 'https://promptaria.ir';
const KIT_HOURS = 72;

db.exec(`
CREATE TABLE IF NOT EXISTS post_kits (
  token      TEXT PRIMARY KEY,
  uid        TEXT,
  title      TEXT,
  caption    TEXT,
  hashtags   TEXT DEFAULT '',
  images     TEXT NOT NULL,
  opened     INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);`);

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function createKit({ uid, title, caption, hashtags, images }) {
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare(
    `INSERT INTO post_kits (token, uid, title, caption, hashtags, images, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+${KIT_HOURS} hours'))`
  ).run(token, String(uid || ''), String(title || ''), String(caption || ''), String(hashtags || ''), JSON.stringify(images));

  db.prepare("DELETE FROM post_kits WHERE expires_at <= datetime('now')").run();
  return { token, url: `${SITE}/kit/${token}`, expiresInHours: KIT_HOURS };
}

const getKit = (token) =>
  db.prepare("SELECT * FROM post_kits WHERE token = ? AND expires_at > datetime('now')").get(String(token || ''));

/**
 * Defaults to pale-on-transparent for the dark kit page. Pass `{ onWhite: true }`
 * where the code sits on a white card — phone scanners are far more reliable
 * with the conventional dark-on-light contrast.
 */
const qrSvg = (text, { onWhite = false } = {}) =>
  QRCode.toString(text, {
    type: 'svg',
    margin: 1,
    width: 220,
    color: onWhite ? { dark: '#0a0a12', light: '#ffffff' } : { dark: '#eceefb', light: '#00000000' },
  });

/* ------------------------------------------------------------------ *
 * The mobile page
 * ------------------------------------------------------------------ */
function renderKit(kit) {
  const images = JSON.parse(kit.images);
  db.prepare('UPDATE post_kits SET opened = opened + 1 WHERE token = ?').run(kit.token);

  return `<!doctype html>
<html lang="fa" dir="rtl" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>کیت پست — ${esc(kit.title)}</title>
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#0a0a12">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
<style>
  body { padding-bottom: 40px; }
  .kit { max-width: 620px; margin: 0 auto; padding: 20px 16px; }
  .kit h1 { font-size: 20px; margin: 0 0 6px; }
  .kit .sub { color: var(--dim); font-size: 12.5px; margin: 0 0 22px; }
  .step { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; margin: 26px 0 12px; }
  .step i { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center;
            background: #7c5cff22; border: 1px solid #7c5cff44; color: var(--accent-2);
            font-style: normal; font-size: 13px; flex: 0 0 auto; }
  .shots { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .shot { position: relative; border-radius: 14px; overflow: hidden; border: 1px solid var(--border); background: #0c0d16; }
  .shot img { display: block; width: 100%; height: auto; }
  .shot span { position: absolute; top: 8px; inset-inline-start: 8px; font-size: 11px; padding: 2px 9px;
               border-radius: 7px; background: #0a0a12cc; color: var(--muted); }
  .shot a { position: absolute; bottom: 8px; inset-inline-end: 8px; font-size: 11.5px; padding: 5px 12px;
            border-radius: 9px; background: var(--accent); color: #fff; font-weight: 600; }
  .cap { white-space: pre-wrap; font-size: 13px; line-height: 2.1; background: #0c0d16;
         border: 1px solid var(--border); border-radius: 14px; padding: 16px; max-height: 340px; overflow-y: auto; }
  .big-btn { width: 100%; margin-top: 12px; padding: 15px; border-radius: 14px; border: none; font-size: 15px;
             font-weight: 700; color: #fff; background: linear-gradient(135deg, var(--accent), #6247e0); }
  .big-btn.done { background: var(--green); }
  .hint { color: var(--dim); font-size: 12.5px; line-height: 2; margin: 10px 0 0; }
  .expire { margin-top: 30px; text-align: center; color: var(--dim); font-size: 12px; }
</style>
</head>
<body>
<div class="kit">
  <h1>${esc(kit.title)}</h1>
  <p class="sub">کیت پست اینستاگرام · ${images.length} اسلاید</p>

  <button class="big-btn" id="shareAll" type="button" hidden style="margin:0 0 6px">
    ارسال همه به اینستاگرام
  </button>
  <p class="hint" id="shareHint" hidden>
    این دکمه هر ${images.length} تصویر را به برگه‌ی اشتراک‌گذاری گوشی می‌دهد. اینکه اینستاگرام
    آن‌ها را به‌صورت کاروسل بپذیرد به نسخه‌ی اپ بستگی دارد؛ اگر نپذیرفت از راه پایین برو.
  </p>

  <div class="step"><i>۱</i> تصاویر را ذخیره کن</div>
  <p class="hint">روی هر تصویر نگه دار و «ذخیره در تصاویر» را بزن — یا دکمه ذخیره گوشه هر کدام. ترتیب مهم است.</p>
  <div class="shots">
    ${images
      .map(
        (u, i) => `<div class="shot">
          <span>${i + 1}</span>
          <img src="${esc(u)}" alt="اسلاید ${i + 1}" loading="lazy">
          <a href="${esc(u)}" download="slide-${i + 1}.jpg" target="_blank" rel="noopener">ذخیره</a>
        </div>`
      )
      .join('')}
  </div>

  <div class="step"><i>۲</i> کپشن را کپی کن</div>
  <div class="cap" id="cap">${esc(kit.caption)}</div>
  <button class="big-btn" id="copyCap" type="button">کپی کپشن</button>
  ${
    kit.hashtags
      ? `<div class="step"><i>۳</i> هشتگ‌ها برای کامنت اول</div>
         <div class="cap" id="tags" style="max-height:150px">${esc(kit.hashtags)}</div>
         <button class="big-btn" id="copyTags" type="button">کپی هشتگ‌ها</button>`
      : ''
  }

  <div class="step"><i>${kit.hashtags ? '۴' : '۳'}</i> در اینستاگرام پست کن</div>
  <p class="hint">
    اینستاگرام را باز کن → پست جدید → همان تصاویر را به ترتیب انتخاب کن → کپشن را بچسبان.
    ${kit.hashtags ? 'هشتگ‌ها را بعد از انتشار در کامنت اول بگذار تا کپشن تمیز بماند.' : ''}
  </p>

  <p class="expire">این لینک ${KIT_HOURS} ساعت بعد از ساخت منقضی می‌شود.</p>
</div>

<script>
  function wire(btnId, srcId, label) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var text = document.getElementById(srcId).textContent;
      var done = function () {
        btn.textContent = 'کپی شد ✓';
        btn.classList.add('done');
        setTimeout(function () { btn.textContent = label; btn.classList.remove('done'); }, 2000);
      };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
      } else fallback(text, done);
    });
  }
  function fallback(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    ta.remove();
  }
  wire('copyCap', 'cap', 'کپی کپشن');
  wire('copyTags', 'tags', 'کپی هشتگ‌ها');

  /* Share sheet path. Only offered where the browser can actually share files —
   * on a desktop it would appear and then fail, so it stays hidden unless
   * canShare() says yes for a real File. The slides are same-origin, so
   * fetching them back as blobs is allowed. */
  (function () {
    var urls = ${JSON.stringify(images)};
    var btn = document.getElementById('shareAll');
    var hint = document.getElementById('shareHint');
    if (!btn || !navigator.canShare || !navigator.share) return;
    try {
      var probe = new File([new Blob([1])], 'p.jpg', { type: 'image/jpeg' });
      if (!navigator.canShare({ files: [probe] })) return;
    } catch (e) { return; }

    btn.hidden = false; hint.hidden = false;
    btn.addEventListener('click', function () {
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'آماده‌سازی تصاویر…';
      Promise.all(
        urls.map(function (u, i) {
          return fetch(u)
            .then(function (r) { return r.blob(); })
            .then(function (b) { return new File([b], 'slide-' + (i + 1) + '.jpg', { type: 'image/jpeg' }); });
        })
      )
        .then(function (files) {
          return navigator.share({ files: files, text: document.getElementById('cap').textContent });
        })
        .then(function () { btn.textContent = 'فرستاده شد ✓'; btn.classList.add('done'); })
        .catch(function (e) {
          // AbortError just means the user closed the sheet — not a failure.
          btn.textContent = e && e.name === 'AbortError' ? label : 'نشد — از راه پایین برو';
          btn.disabled = false;
        });
    });
  })();
</script>
</body>
</html>`;
}

function renderExpired() {
  return `<!doctype html>
<html lang="fa" dir="rtl" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>لینک منقضی شده</title><meta name="robots" content="noindex,nofollow">
<link rel="stylesheet" href="/styles.css"></head>
<body><main class="wrap"><div class="empty"><div class="big">⏳</div>
<h1>این لینک دیگر معتبر نیست</h1>
<p>کیت‌های پست ${KIT_HOURS} ساعت بعد از ساخت منقضی می‌شوند. از پنل یک کیت تازه بساز.</p>
</div></main></body></html>`;
}

module.exports = { createKit, getKit, renderKit, renderExpired, qrSvg, KIT_HOURS };
