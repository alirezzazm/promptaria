'use strict';
/**
 * Instagram post studio.
 *
 * Two independent halves:
 *   1. Composer — turns a stored prompt into a Persian caption, a hashtag set
 *      and a carousel storyboard. Works offline, needs no credentials.
 *   2. Publisher — pushes a rendered carousel to a real Instagram account via
 *      the Meta Graph API. Needs an Instagram *Business/Creator* account, a
 *      linked Facebook Page, and a long-lived token with
 *      instagram_basic + instagram_content_publish + pages_show_list.
 *      Until those are saved in settings, only the composer is available.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const GRAPH = 'https://graph.facebook.com/v21.0';
const MEDIA_DIR = path.join(__dirname, '..', 'public', 'ig');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const setting = (k, d = null) => {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
  return r ? r.value : d;
};
const putSetting = (k, v) =>
  db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(k, String(v));

/* ------------------------------------------------------------------ *
 * Hashtags
 * ------------------------------------------------------------------ */
const TAGS_CORE = [
  '#هوش_مصنوعی', '#پرامپت', '#پرامپت_نویسی', '#چت_جی_پی_تی', '#chatgpt', '#ai',
  '#هوش_مصنوعی_فارسی', '#prompt', '#promptengineering', '#aitools',
];
const TAGS_BY_CAT = {
  coding: ['#برنامه_نویسی', '#کدنویسی', '#developer', '#coding', '#programming', '#وب_دولوپر', '#پایتون', '#جاوااسکریپت'],
  writing: ['#نویسندگی', '#تولید_محتوا', '#کپی_رایتینگ', '#copywriting', '#contentcreator', '#نوشتن'],
  marketing: ['#دیجیتال_مارکتینگ', '#مارکتینگ', '#تبلیغات', '#سئو', '#marketing', '#digitalmarketing', '#فروش_اینترنتی'],
  business: ['#کسب_و_کار', '#استارتاپ', '#کارآفرینی', '#مدیریت', '#business', '#startup'],
  design: ['#طراحی', '#گرافیک', '#میدجرنی', '#midjourney', '#design', '#هوش_مصنوعی_تصویر', '#aiart'],
  education: ['#آموزش', '#یادگیری', '#درس_خواندن', '#education', '#مطالعه', '#کنکور'],
  career: ['#رزومه', '#استخدام', '#شغل', '#مصاحبه_شغلی', '#resume', '#job'],
  data: ['#تحلیل_داده', '#دیتا', '#اکسل', '#data', '#analytics', '#دیتاساینس'],
  productivity: ['#بهره_وری', '#مدیریت_زمان', '#برنامه_ریزی', '#productivity', '#نظم'],
  research: ['#پژوهش', '#مقاله_نویسی', '#دانشگاه', '#research', '#پایان_نامه'],
  lifestyle: ['#سبک_زندگی', '#سلامتی', '#تناسب_اندام', '#برنامه_غذایی', '#lifestyle'],
  roleplay: ['#نقش_آفرینی', '#شبیه_سازی', '#roleplay'],
  'ai-systems': ['#مهندسی_پرامپت', '#ایجنت', '#llm', '#claude', '#gemini'],
  general: ['#ترفند', '#آموزش_رایگان', '#تکنولوژی', '#کاربردی'],
};

function hashtags(catSlug, count = 28) {
  const pool = [...TAGS_CORE, ...(TAGS_BY_CAT[catSlug] || TAGS_BY_CAT.general), ...TAGS_BY_CAT.general];
  return [...new Set(pool)].slice(0, count);
}

/* ------------------------------------------------------------------ *
 * Composer
 * ------------------------------------------------------------------ */
const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
};

const HOOKS = [
  'این پرامپت را ذخیره کن، لازمت می‌شود 👇',
  '۹۰٪ آدم‌ها این را از هوش مصنوعی نمی‌خواهند 👇',
  'یک پرامپت، به‌جای یک ساعت کار دستی ⏱',
  'تفاوت جواب معمولی و جواب حرفه‌ای، همین یک متن است 👇',
  'اگر از ChatGPT جواب کلی می‌گیری، مشکل از پرامپتت است 👇',
  'این را کپی کن و ببین چه فرقی می‌کند ✨',
];

const SITE = process.env.SITE_URL || 'https://promptaria.ir';

/**
 * The body slide shows the opening of the prompt, cut on a line boundary.
 * Clipping mid-sentence looked broken, and collapsing the newlines lost the
 * field list that makes a prompt legible at a glance.
 */
function slideBody(body, maxChars = 560, maxLines = 16) {
  const out = [];
  let used = 0;
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trimEnd();
    if (out.length >= maxLines || used + line.length > maxChars) {
      out.push('…');
      break;
    }
    out.push(line);
    used += line.length + 1;
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    // Curly braces mirror under the bidi algorithm and read as garbage in
    // an RTL block; Persian guillemets say the same thing and sit correctly.
    .replace(/\{\{\s*(.+?)\s*\}\}/g, '«$1»')
    .trim();
}

function composePost(p, opts = {}) {
  const parse = (s, f) => {
    try {
      return JSON.parse(s);
    } catch {
      return f;
    }
  };
  const vars = parse(p.variables, []);
  const tips = parse(p.tips, []);
  const catSlug = p.cat_slug || 'general';
  const hook = opts.hook || HOOKS[Math.floor(Math.random() * HOOKS.length)];
  const link = `${SITE}/p/${p.slug}-${p.uid}`;

  const howLines = String(p.how_to || '')
    .split(/\n{2,}/)
    .filter((s) => /^\*\*/.test(s.trim()))
    .slice(0, 3)
    .map((s) => clip(s.replace(/\*\*/g, '').replace(/`/g, ''), 95));

  const caption = [
    hook,
    '',
    `📌 ${p.title}`,
    clip(p.summary.replace(/^این پرامپت\s*/, ''), 220),
    '',
    '🔧 چطور استفاده کنی:',
    ...howLines.map((l, i) => `${i + 1}. ${l}`),
    vars.length ? `\n⚙️ ${vars.length} جای‌خالی دارد که باید با اطلاعات خودت پر کنی.` : '',
    tips.length ? `\n💡 ${clip(tips[0], 150)}` : '',
    '',
    `🔗 متن کامل پرامپت + آموزش فارسی در لینک بایو یا:`,
    link,
    '',
    'اگر به کارت آمد سیو کن و برای کسی بفرست که لازمش دارد 🔁',
    '',
    hashtags(catSlug).join(' '),
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Carousel storyboard. The client renders each slide to a 1080x1350 canvas.
  const slides = [
    { kind: 'cover', eyebrow: p.cat_name || 'پرامپت', title: p.title, sub: clip(p.summary.replace(/^این پرامپت\s*/, ''), 120), badge: 'Promptaria' },
    {
      kind: 'body',
      eyebrow: 'متن پرامپت',
      title: 'این را کپی کن',
      body: slideBody(p.body),
      bodyRtl: p.lang === 'fa',
      mono: true,
    },
  ];
  if (vars.length)
    slides.push({
      kind: 'list',
      eyebrow: 'جای‌خالی‌ها',
      title: 'این‌ها را پر کن',
      items: vars.slice(0, 5).map((v) => `${v.token} ← ${v.name}`),
    });
  if (howLines.length)
    slides.push({ kind: 'list', eyebrow: 'روش استفاده', title: 'در ۳ قدم', items: howLines });
  if (tips.length)
    slides.push({ kind: 'list', eyebrow: 'نکته حرفه‌ای', title: 'اینها را رعایت کن', items: tips.slice(0, 3).map((t) => clip(t, 110)) });
  slides.push({
    kind: 'cta',
    eyebrow: 'Promptaria',
    title: '۳۲۰۰+ پرامپت با آموزش فارسی',
    sub: 'promptaria.ir',
    badge: 'سیو کن 🔖',
  });

  return {
    uid: p.uid,
    title: p.title,
    link,
    caption,
    caption_length: caption.length,
    hashtags: hashtags(catSlug),
    slides,
    first_comment: hashtags(catSlug, 30).join(' '),
    best_time: 'بهترین زمان انتشار برای مخاطب ایرانی: ۲۰:۰۰ تا ۲۳:۰۰ به وقت تهران.',
  };
}

/* ------------------------------------------------------------------ *
 * Rendered media (client sends PNG data URLs; we host them publicly
 * because the Graph API can only fetch images over public HTTPS)
 * ------------------------------------------------------------------ */
function saveSlides(uid, dataUrls) {
  if (!Array.isArray(dataUrls) || !dataUrls.length) throw new Error('no images');
  if (dataUrls.length > 10) throw new Error('اینستاگرام حداکثر ۱۰ اسلاید در کاروسل می‌پذیرد');

  const batch = crypto.randomBytes(6).toString('hex');
  const urls = [];
  dataUrls.forEach((d, i) => {
    const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(d));
    if (!m) throw new Error('فرمت تصویر نامعتبر است');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) throw new Error('تصویر بیش از ۸ مگابایت است');
    const name = `${uid}-${batch}-${i + 1}.${m[1] === 'png' ? 'png' : 'jpg'}`;
    fs.writeFileSync(path.join(MEDIA_DIR, name), buf);
    urls.push(`${SITE}/ig/${name}`);
  });
  return urls;
}

/** Old renders pile up fast; keep only what a recent post might still need. */
function pruneMedia(keepHours = 72) {
  const cutoff = Date.now() - keepHours * 3600e3;
  let removed = 0;
  for (const f of fs.readdirSync(MEDIA_DIR)) {
    const fp = path.join(MEDIA_DIR, f);
    try {
      if (fs.statSync(fp).mtimeMs < cutoff) {
        fs.unlinkSync(fp);
        removed++;
      }
    } catch {}
  }
  return removed;
}

/* ------------------------------------------------------------------ *
 * Publisher (Meta Graph API)
 * ------------------------------------------------------------------ */
function igConfig() {
  return {
    userId: setting('ig_user_id', ''),
    token: setting('ig_token', ''),
    connected: Boolean(setting('ig_user_id') && setting('ig_token')),
  };
}

function saveIgConfig({ userId, token }) {
  if (userId !== undefined) putSetting('ig_user_id', String(userId).trim());
  if (token !== undefined && String(token).trim()) putSetting('ig_token', String(token).trim());
  return igConfig();
}

async function graph(url, options = {}) {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(`Graph API: ${e.message || res.status}${e.code ? ` (code ${e.code})` : ''}`);
  }
  return json;
}

async function verifyAccount() {
  const { userId, token, connected } = igConfig();
  if (!connected) throw new Error('هنوز حساب اینستاگرام وصل نشده است');
  const me = await graph(
    `${GRAPH}/${encodeURIComponent(userId)}?fields=id,username,name,followers_count,media_count&access_token=${encodeURIComponent(token)}`
  );
  return me;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Carousel publish is a three-stage handshake: create one container per image,
 * wrap them in a carousel container, then publish that. Containers are async on
 * Meta's side, so each one is polled until FINISHED.
 */
async function publishCarousel({ imageUrls, caption, log = () => {} }) {
  const { userId, token, connected } = igConfig();
  if (!connected) throw new Error('حساب اینستاگرام وصل نیست — شناسه و توکن را در تنظیمات وارد کن');
  if (!imageUrls.length) throw new Error('تصویری برای انتشار وجود ندارد');

  const enc = encodeURIComponent;
  const children = [];

  for (let i = 0; i < imageUrls.length; i++) {
    log(`ساخت کانتینر تصویر ${i + 1} از ${imageUrls.length}…`);
    const r = await graph(`${GRAPH}/${enc(userId)}/media`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        image_url: imageUrls[i],
        is_carousel_item: 'true',
        access_token: token,
      }),
    });
    await waitReady(r.id, token, log);
    children.push(r.id);
  }

  log('ساخت کاروسل…');
  const carousel = await graph(`${GRAPH}/${enc(userId)}/media`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption,
      access_token: token,
    }),
  });
  await waitReady(carousel.id, token, log);

  log('انتشار…');
  const published = await graph(`${GRAPH}/${enc(userId)}/media_publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: carousel.id, access_token: token }),
  });

  const perma = await graph(
    `${GRAPH}/${enc(published.id)}?fields=permalink&access_token=${enc(token)}`
  ).catch(() => ({}));

  log('منتشر شد ✓');
  return { id: published.id, permalink: perma.permalink || null };
}

async function waitReady(containerId, token, log) {
  for (let i = 0; i < 25; i++) {
    const s = await graph(
      `${GRAPH}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(token)}`
    );
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED')
      throw new Error(`کانتینر ${containerId} ناموفق: ${s.status || s.status_code}`);
    await wait(2000);
    if (i === 5) log('در انتظار پردازش تصویر توسط اینستاگرام…');
  }
  throw new Error('اینستاگرام تصویر را در زمان معقول پردازش نکرد');
}

module.exports = {
  composePost,
  saveSlides,
  pruneMedia,
  igConfig,
  saveIgConfig,
  verifyAccount,
  publishCarousel,
  hashtags,
};
