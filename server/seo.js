'use strict';
/**
 * Server-side rendering + structured data.
 *
 * The catalogue is the whole point of the site, so it must exist in the HTML
 * that crawlers receive — a client-rendered SPA would leave Google with an
 * empty shell. Every public route below ships complete, indexable markup and
 * the browser bundle then takes over for interactions.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');

// Static assets are served with a long max-age, so their URLs carry a build
// stamp taken from file mtimes — a deploy changes the URL and browsers refetch.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const assetV = (() => {
  try {
    const stamps = ['app.js', 'styles.css'].map((f) => fs.statSync(path.join(PUBLIC_DIR, f)).mtimeMs);
    return String(Math.round(Math.max(...stamps))).slice(-9);
  } catch {
    return '1';
  }
})();

const SITE = process.env.SITE_URL || 'https://promptaria.aliizz.ir';
const NAME = 'Promptaria';
const NAME_FA = 'پرامپت‌آریا';

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** JSON-LD must not be able to break out of its <script> block. */
const jsonld = (obj) =>
  `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
};

const promptUrl = (p) => `${SITE}/p/${p.slug || 'prompt'}-${p.uid}`;
const catUrl = (slug) => `${SITE}/c/${slug}`;

/* ------------------------------------------------------------------ *
 * <head>
 * ------------------------------------------------------------------ */
function head({ title, description, canonical, keywords = [], type = 'website', extraLd = [], noindex = false, published, modified }) {
  const ogImage = `${SITE}/og.svg`;
  return `
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${keywords.length ? `<meta name="keywords" content="${esc(keywords.join('، '))}">` : ''}
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">'}
<meta name="theme-color" content="#0a0a12">
<meta name="author" content="${NAME}">
<link rel="alternate" hreflang="fa-IR" href="${esc(canonical)}">
<link rel="alternate" hreflang="x-default" href="${esc(canonical)}">

<meta property="og:type" content="${esc(type)}">
<meta property="og:site_name" content="${NAME} — ${NAME_FA}">
<meta property="og:locale" content="fa_IR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
${published ? `<meta property="article:published_time" content="${esc(published)}">` : ''}
${modified ? `<meta property="article:modified_time" content="${esc(modified)}">` : ''}

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogImage}">

<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/styles.css?v=${assetV}">
${extraLd.map(jsonld).join('\n')}`.trim();
}

const orgLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE}/#organization`,
  name: NAME,
  alternateName: NAME_FA,
  url: SITE,
  logo: { '@type': 'ImageObject', url: `${SITE}/favicon.svg` },
};

const siteLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE}/#website`,
  url: SITE,
  name: NAME,
  alternateName: NAME_FA,
  inLanguage: 'fa-IR',
  publisher: { '@id': `${SITE}/#organization` },
  potentialAction: {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/search?q={search_term_string}` },
    'query-input': 'required name=search_term_string',
  },
};

const breadcrumbLd = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: it.name,
    item: it.url,
  })),
});

/* ------------------------------------------------------------------ *
 * Shared chrome
 * ------------------------------------------------------------------ */
function shell({ headHtml, bodyHtml, bootstrap }) {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
${headHtml}
</head>
<body>
${bodyHtml}
${bootstrap ? `<script>window.__PA__=${JSON.stringify(bootstrap).replace(/</g, '\\u003c')};</script>` : ''}
<script src="/app.js?v=${assetV}" defer></script>
</body>
</html>`;
}

const header = (active = '') => `
<a href="#main" class="skip">پرش به محتوا</a>
<header class="site">
  <div class="wrap hdr">
    <a href="/" class="logo" aria-label="${NAME} — صفحه اصلی">
      <span class="mark" aria-hidden="true">✦</span>
      <span>Promptaria<small>${NAME_FA}</small></span>
    </a>
    <nav aria-label="ناوبری اصلی">
      <a href="/"${active === 'home' ? ' aria-current="page"' : ''}>خانه</a>
      <a href="/categories"${active === 'cats' ? ' aria-current="page"' : ''}>دسته‌بندی‌ها</a>
      <a href="/guide"${active === 'guide' ? ' aria-current="page"' : ''}>راهنمای پرامپت‌نویسی</a>
      <a href="/admin" class="cta">ورود ادمین</a>
    </nav>
  </div>
</header>`;

const footer = (cats = []) => `
<footer class="site">
  <div class="wrap">
    <nav class="foot-cats" aria-label="دسته‌بندی‌ها">
      ${cats.map((c) => `<a href="/c/${esc(c.slug)}">${esc(c.icon)} ${esc(c.name_fa)}</a>`).join('')}
    </nav>
    <p><b>${NAME}</b> — کتابخانه پرامپت‌های هوش مصنوعی به زبان فارسی. پرامپت‌ها از مجموعه‌های معتبر جهانی گردآوری و برای فارسی‌زبان‌ها بازنویسی و مستند می‌شوند.</p>
    <p class="dim"><a href="/guide">راهنمای پرامپت‌نویسی</a> · <a href="/categories">همه دسته‌ها</a> · <a href="/sitemap.xml">نقشه سایت</a> · <a href="/admin">پنل مدیریت</a></p>
  </div>
</footer>`;

const DIFF_FA = { easy: 'ساده', medium: 'متوسط', advanced: 'پیشرفته' };

const cardHtml = (p) => `
<article class="card${p.featured ? ' feat' : ''}" data-id="${esc(p.uid)}">
  <a class="card-link" href="/p/${esc(p.slug)}-${esc(p.uid)}">
    <div class="top">
      <div class="cat-ico" aria-hidden="true">${esc(p.icon || '✦')}</div>
      <div class="tw">
        <h3>${esc(p.title)}</h3>
        <div class="cat-name">${esc(p.cat_name || 'عمومی')}</div>
      </div>
    </div>
    <p class="sum">${esc(clip(p.summary, 165))}</p>
    <div class="meta">
      <span class="pill ${esc(p.difficulty)}">${DIFF_FA[p.difficulty] || ''}</span>
      ${p.featured ? '<span class="pill gold">★ منتخب</span>' : ''}
      <span class="stat-mini">⧉ ${p.copies} · ◉ ${p.views}</span>
    </div>
  </a>
</article>`;

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */
const SEL = `
  SELECT p.id, p.uid, p.slug, p.title, p.summary, p.difficulty, p.featured, p.views, p.copies,
         p.quality, p.updated_at, p.created_at, c.slug AS cat_slug, c.name_fa AS cat_name, c.icon
  FROM prompts p LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.status = 'published'`;

const allCategories = () =>
  db
    .prepare(
      `SELECT c.slug, c.name_fa, c.name_en, c.icon, c.description,
              (SELECT COUNT(*) FROM prompts p WHERE p.category_id=c.id AND p.status='published') AS count
       FROM categories c ORDER BY c.sort_order`
    )
    .all()
    .filter((c) => c.count > 0);

/* ------------------------------------------------------------------ *
 * Pages
 * ------------------------------------------------------------------ */
function renderHome() {
  const cats = allCategories();
  const total = db.prepare("SELECT COUNT(*) n FROM prompts WHERE status='published'").get().n;
  const items = db.prepare(`${SEL} ORDER BY p.featured DESC, p.quality DESC, p.copies DESC LIMIT 24`).all();

  const title = `Promptaria — کتابخانه پرامپت‌های هوش مصنوعی به فارسی | ${total.toLocaleString('en-US')} پرامپت آماده`;
  const description = `بیش از ${total.toLocaleString('en-US')} پرامپت آماده ChatGPT، Claude و Gemini در ${cats.length} دسته‌بندی — با آموزش کامل فارسی، نمونه استفاده و نکته‌های حرفه‌ای. رایگان و همیشه به‌روز.`;

  return shell({
    headHtml: head({
      title,
      description,
      canonical: SITE + '/',
      keywords: ['پرامپت', 'پرامپت فارسی', 'ChatGPT', 'کلود', 'هوش مصنوعی', 'prompt', 'آموزش پرامپت‌نویسی'],
      extraLd: [
        siteLd,
        orgLd,
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: title,
          description,
          url: SITE + '/',
          inLanguage: 'fa-IR',
          isPartOf: { '@id': `${SITE}/#website` },
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: items.length,
            itemListElement: items.map((p, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              url: promptUrl(p),
              name: p.title,
            })),
          },
        },
      ],
    }),
    bodyHtml: `
${header('home')}
<main id="main">
  <section class="hero wrap">
    <div class="orbs" aria-hidden="true"><span></span><span></span><span></span></div>
    <p class="badge"><span class="dot"></span> کتابخانه‌ای که خودش را به‌روز می‌کند</p>
    <h1 class="reveal">هر کاری با هوش مصنوعی،<br><span class="grad">با پرامپت درستش</span></h1>
    <p class="lede reveal d1">
      ${total.toLocaleString('en-US')} پرامپت آماده برای ChatGPT، Claude و Gemini — دسته‌بندی‌شده،
      امتیازدهی‌شده و همراه با آموزش فارسی که دقیقاً می‌گوید چطور از هرکدام بهترین نتیجه را بگیری.
    </p>
    <form class="searchbar reveal d2" role="search" action="/search" method="get">
      <span class="icon" aria-hidden="true">⌕</span>
      <label class="sr-only" for="q">جستجوی پرامپت</label>
      <input id="q" name="q" type="search" placeholder="دنبال چی می‌گردی؟ رزومه، تحلیل داده، اینستاگرام، ریفکتور کد…" autocomplete="off">
    </form>
    <div class="stats-row reveal d3">
      <div class="stat"><b class="counter" data-to="${total}">${total.toLocaleString('en-US')}</b><span>پرامپت آماده</span></div>
      <div class="stat"><b class="counter" data-to="${cats.length}">${cats.length}</b><span>دسته‌بندی</span></div>
      <div class="stat"><b id="stUpd">—</b><span>آخرین به‌روزرسانی</span></div>
    </div>
  </section>

  <nav class="chips wrap" id="chips" aria-label="دسته‌بندی پرامپت‌ها">
    <a class="chip active" href="/" data-cat="all">✨ همه <span class="n">${total}</span></a>
    ${cats.map((c) => `<a class="chip" href="/c/${esc(c.slug)}" data-cat="${esc(c.slug)}" title="${esc(c.description)}">${esc(c.icon)} ${esc(c.name_fa)} <span class="n">${c.count}</span></a>`).join('')}
  </nav>

  <div class="wrap">
    <div class="toolbar">
      <p class="count" id="count"><b>${total.toLocaleString('en-US')}</b> پرامپت</p>
      <label class="sr-only" for="difficulty">سطح</label>
      <select class="sel" id="difficulty">
        <option value="all">همه سطح‌ها</option><option value="easy">ساده</option>
        <option value="medium">متوسط</option><option value="advanced">پیشرفته</option>
      </select>
      <label class="sr-only" for="sort">ترتیب</label>
      <select class="sel" id="sort">
        <option value="best">بهترین‌ها</option><option value="popular">پرکاربردترین</option>
        <option value="new">جدیدترین</option><option value="az">حروف الفبا</option>
      </select>
    </div>
    <div class="grid stagger" id="grid">${items.map(cardHtml).join('')}</div>
    <div class="pager" id="pager"></div>
  </div>

  <section class="wrap seo-block">
    <h2>پرامپت چیست و چرا کیفیتش این‌قدر مهم است؟</h2>
    <p>
      پرامپت همان دستوری است که به هوش مصنوعی می‌دهی. تفاوت یک جواب معمولی با یک جواب واقعاً کاربردی،
      تقریباً همیشه در متن پرامپت است نه در مدل. یک پرامپت خوب سه چیز را روشن می‌کند:
      <b>مدل چه نقشی دارد</b>، <b>برای چه کسی و با چه هدفی</b> می‌نویسد، و <b>خروجی در چه قالبی</b> باشد.
    </p>
    <h2>چطور از پرامپت‌های Promptaria استفاده کنم؟</h2>
    <p>
      روی هر پرامپت که کلیک کنی، جدا از خود متن، یک آموزش کامل فارسی می‌بینی: جای‌خالی‌هایی که باید پر کنی،
      نمونه استفاده واقعی، توضیح اینکه چه خروجی‌ای باید بگیری و نکته‌هایی که کیفیت جواب را بالا می‌برند.
      کافی است پرامپت را کپی کنی و در یک گفتگوی تازه بفرستی.
    </p>
    <h2>این پرامپت‌ها روی کدام هوش مصنوعی کار می‌کنند؟</h2>
    <p>
      تقریباً همه‌شان روی ChatGPT، Claude، Gemini، Copilot و مدل‌های متن‌باز کار می‌کنند. برای هر پرامپت
      مدل‌های پیشنهادی هم مشخص شده — پرامپت‌های طولانی و چندمرحله‌ای معمولاً روی مدل‌های قوی‌تر نتیجه بهتری می‌دهند.
    </p>
  </section>
</main>
${footer(cats)}`,
    bootstrap: { page: 'home', cat: 'all' },
  });
}

function renderCategory(slug, page = 1) {
  const cat = db.prepare('SELECT * FROM categories WHERE slug = ?').get(slug);
  if (!cat) return null;
  const per = 24;
  const total = db
    .prepare("SELECT COUNT(*) n FROM prompts WHERE category_id = ? AND status='published'")
    .get(cat.id).n;
  if (!total) return null;

  const items = db
    .prepare(`${SEL} AND p.category_id = ? ORDER BY p.featured DESC, p.quality DESC LIMIT ? OFFSET ?`)
    .all(cat.id, per, (page - 1) * per);
  const pages = Math.ceil(total / per);
  const cats = allCategories();

  const title = `${total} پرامپت ${cat.name_fa} برای هوش مصنوعی | Promptaria`;
  const description = `مجموعه پرامپت‌های ${cat.name_fa} برای ChatGPT و Claude: ${cat.description}. هر پرامپت با آموزش کامل فارسی و نمونه استفاده.`;
  const canonical = catUrl(slug) + (page > 1 ? `?page=${page}` : '');

  return shell({
    headHtml:
      head({
        title,
        description,
        canonical,
        keywords: [`پرامپت ${cat.name_fa}`, cat.name_en, 'ChatGPT', 'پرامپت فارسی'],
        extraLd: [
          orgLd,
          breadcrumbLd([
            { name: 'خانه', url: SITE + '/' },
            { name: 'دسته‌بندی‌ها', url: SITE + '/categories' },
            { name: cat.name_fa, url: catUrl(slug) },
          ]),
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: title,
            description,
            url: canonical,
            inLanguage: 'fa-IR',
            isPartOf: { '@id': `${SITE}/#website` },
            mainEntity: {
              '@type': 'ItemList',
              numberOfItems: items.length,
              itemListElement: items.map((p, i) => ({
                '@type': 'ListItem',
                position: (page - 1) * per + i + 1,
                url: promptUrl(p),
                name: p.title,
              })),
            },
          },
        ],
      }) +
      (page > 1 ? `\n<link rel="prev" href="${catUrl(slug)}${page - 1 > 1 ? `?page=${page - 1}` : ''}">` : '') +
      (page < pages ? `\n<link rel="next" href="${catUrl(slug)}?page=${page + 1}">` : ''),
    bodyHtml: `
${header('cats')}
<main id="main">
  <nav class="crumbs wrap" aria-label="مسیر"><a href="/">خانه</a> › <a href="/categories">دسته‌بندی‌ها</a> › <span>${esc(cat.name_fa)}</span></nav>
  <section class="wrap cat-head">
    <h1><span aria-hidden="true">${esc(cat.icon)}</span> پرامپت‌های ${esc(cat.name_fa)}</h1>
    <p class="lede">${esc(cat.description)} — ${total} پرامپت آماده، هرکدام با آموزش فارسی استفاده.</p>
  </section>

  <nav class="chips wrap" aria-label="دسته‌بندی پرامپت‌ها">
    <a class="chip" href="/">✨ همه</a>
    ${cats.map((c) => `<a class="chip${c.slug === slug ? ' active' : ''}" href="/c/${esc(c.slug)}">${esc(c.icon)} ${esc(c.name_fa)} <span class="n">${c.count}</span></a>`).join('')}
  </nav>

  <div class="wrap">
    <div class="grid stagger">${items.map(cardHtml).join('')}</div>
    ${
      pages > 1
        ? `<nav class="pager" aria-label="صفحه‌بندی">
            ${page > 1 ? `<a href="${catUrl(slug)}${page - 1 > 1 ? `?page=${page - 1}` : ''}">‹ قبلی</a>` : ''}
            <span class="on">${page} از ${pages}</span>
            ${page < pages ? `<a href="${catUrl(slug)}?page=${page + 1}">بعدی ›</a>` : ''}
           </nav>`
        : ''
    }
  </div>
</main>
${footer(cats)}`,
    bootstrap: { page: 'category', cat: slug },
  });
}

function renderPrompt(uid) {
  const p = db
    .prepare(
      `SELECT p.*, c.slug AS cat_slug, c.name_fa AS cat_name, c.icon
       FROM prompts p LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.uid = ? AND p.status = 'published'`
    )
    .get(uid);
  if (!p) return null;

  db.prepare('UPDATE prompts SET views = views + 1 WHERE id = ?').run(p.id);

  const parse = (s, f) => {
    try {
      return JSON.parse(s);
    } catch {
      return f;
    }
  };
  const tips = parse(p.tips, []);
  const vars = parse(p.variables, []);
  const models = parse(p.best_models, []);
  const tags = parse(p.tags, []);

  const related = db
    .prepare(`${SEL} AND p.category_id = ? AND p.id != ? ORDER BY p.quality DESC LIMIT 6`)
    .all(p.category_id, p.id);

  const title = `${p.title} — پرامپت ${p.cat_name || ''} با آموزش فارسی | Promptaria`;
  const description = clip(p.summary, 158);
  const canonical = promptUrl(p);
  const iso = (d) => (d ? new Date(String(d).replace(' ', 'T') + 'Z').toISOString() : undefined);

  // HowTo mirrors what the page actually teaches: turning this prompt into a result.
  const steps = String(p.how_to || '')
    .split(/\n{2,}/)
    .filter((s) => /^\*\*/.test(s.trim()))
    .map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: clip(s.replace(/\*\*/g, '').split('.')[0], 70),
      text: clip(s.replace(/\*\*/g, '').replace(/`/g, ''), 300),
    }));

  const cats = allCategories();

  return shell({
    headHtml: head({
      title,
      description,
      canonical,
      type: 'article',
      published: iso(p.created_at),
      modified: iso(p.updated_at),
      keywords: [p.title, `پرامپت ${p.cat_name}`, ...tags, 'ChatGPT', 'پرامپت فارسی'],
      extraLd: [
        orgLd,
        breadcrumbLd([
          { name: 'خانه', url: SITE + '/' },
          { name: p.cat_name || 'عمومی', url: catUrl(p.cat_slug || 'general') },
          { name: p.title, url: canonical },
        ]),
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: clip(p.title, 110),
          description,
          url: canonical,
          inLanguage: 'fa-IR',
          datePublished: iso(p.created_at),
          dateModified: iso(p.updated_at),
          author: { '@id': `${SITE}/#organization` },
          publisher: { '@id': `${SITE}/#organization` },
          mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
          articleSection: p.cat_name,
          keywords: tags.join(', '),
        },
        ...(steps.length
          ? [
              {
                '@context': 'https://schema.org',
                '@type': 'HowTo',
                name: `چطور از پرامپت «${p.title}» استفاده کنیم`,
                description,
                inLanguage: 'fa-IR',
                totalTime: 'PT3M',
                step: steps,
              },
            ]
          : []),
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: [
            {
              '@type': 'Question',
              name: 'این پرامپت را کجا باید بچسبانم؟',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'به عنوان اولین پیام یک گفتگوی تازه در ChatGPT، Claude یا Gemini. اگر وسط یک گفتگوی طولانی بفرستی، مدل هنوز تحت تأثیر موضوع قبلی است و از نقش خواسته‌شده بیرون می‌زند.',
              },
            },
            {
              '@type': 'Question',
              name: 'چه خروجی‌ای باید بگیرم؟',
              acceptedAnswer: { '@type': 'Answer', text: clip(p.expected_out, 300) },
            },
            {
              '@type': 'Question',
              name: 'استفاده از این پرامپت رایگان است؟',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'بله. همه پرامپت‌های Promptaria رایگان‌اند و بدون ثبت‌نام قابل کپی و استفاده هستند.',
              },
            },
          ],
        },
      ],
    }),
    bodyHtml: `
${header()}
<main id="main" class="wrap article">
  <nav class="crumbs" aria-label="مسیر">
    <a href="/">خانه</a> › <a href="/c/${esc(p.cat_slug || 'general')}">${esc(p.cat_name || 'عمومی')}</a> › <span>${esc(clip(p.title, 45))}</span>
  </nav>

  <article class="sheet static">
    <header class="sh-head">
      <h1>${esc(p.title)}</h1>
      <div class="kv">
        <a class="pill" href="/c/${esc(p.cat_slug || 'general')}">${esc(p.icon || '✦')} ${esc(p.cat_name || 'عمومی')}</a>
        <span class="pill ${esc(p.difficulty)}">سطح ${DIFF_FA[p.difficulty] || ''}</span>
        <span class="pill">کیفیت ${p.quality}٪</span>
        <span class="pill">${p.body.length} کاراکتر</span>
        ${p.featured ? '<span class="pill gold">★ منتخب</span>' : ''}
      </div>
      <p class="lede">${esc(p.summary)}</p>
    </header>

    <div class="sh-body">
      <section class="sec">
        <h2><span class="ic" aria-hidden="true">◇</span> متن پرامپت</h2>
        <div class="prompt-box">
          <button class="copybtn" id="copyBtn" data-uid="${esc(p.uid)}" type="button">کپی پرامپت</button>
          <pre id="promptText">${esc(p.body)}</pre>
        </div>
      </section>

      ${
        vars.length
          ? `<section class="sec">
              <h2><span class="ic" aria-hidden="true">⚙</span> جای‌خالی‌هایی که باید پر کنی</h2>
              <div class="varbox">${vars
                .map((v) => `<div class="v"><code>${esc(v.token)}</code><span>«${esc(v.name)}» را با مقدار واقعی خودت جایگزین کن</span></div>`)
                .join('')}</div>
            </section>`
          : ''
      }

      <section class="sec">
        <h2><span class="ic" aria-hidden="true">▶</span> چطور از این پرامپت استفاده کنم؟</h2>
        <div class="howto">${mdLiteServer(p.how_to)}</div>
      </section>

      <section class="sec">
        <h2><span class="ic" aria-hidden="true">✎</span> نمونه استفاده واقعی</h2>
        <div class="note">${esc(p.example_use)}</div>
      </section>

      <section class="sec">
        <h2><span class="ic" aria-hidden="true">✓</span> چه خروجی‌ای باید بگیری</h2>
        <div class="note out">${esc(p.expected_out)}</div>
      </section>

      ${
        tips.length
          ? `<section class="sec"><h2><span class="ic" aria-hidden="true">★</span> نکته‌های حرفه‌ای</h2>
             <ul class="tips">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`
          : ''
      }

      <section class="sec">
        <h2><span class="ic" aria-hidden="true">◈</span> روی کدام مدل‌ها بهتر جواب می‌دهد</h2>
        <div class="kv">${models.map((m) => `<span class="pill">${esc(m)}</span>`).join('')}
          ${tags.map((t) => `<span class="pill">#${esc(t)}</span>`).join('')}</div>
      </section>

      ${
        related.length
          ? `<section class="sec">
              <h2><span class="ic" aria-hidden="true">⇄</span> پرامپت‌های مرتبط</h2>
              <div class="rel-grid">${related
                .map((r) => `<a class="rel" href="/p/${esc(r.slug)}-${esc(r.uid)}">${esc(r.title)}</a>`)
                .join('')}</div>
            </section>`
          : ''
      }
    </div>
  </article>
</main>
${footer(cats)}`,
    bootstrap: { page: 'prompt', uid: p.uid },
  });
}

/** Same subset the client renderer supports, so SSR and hydration agree. */
function mdLiteServer(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .split(/\n{2,}/)
    .map((x) => '<p>' + x.replace(/\n/g, '<br>') + '</p>')
    .join('');
}

function renderCategories() {
  const cats = allCategories();
  const total = cats.reduce((a, c) => a + c.count, 0);
  const title = `همه دسته‌بندی‌های پرامپت هوش مصنوعی | Promptaria`;
  const description = `${cats.length} دسته‌بندی پرامپت هوش مصنوعی با ${total} پرامپت آماده — از برنامه‌نویسی و مارکتینگ تا آموزش، طراحی و پژوهش.`;
  return shell({
    headHtml: head({
      title,
      description,
      canonical: SITE + '/categories',
      extraLd: [
        orgLd,
        breadcrumbLd([
          { name: 'خانه', url: SITE + '/' },
          { name: 'دسته‌بندی‌ها', url: SITE + '/categories' },
        ]),
      ],
    }),
    bodyHtml: `
${header('cats')}
<main id="main" class="wrap">
  <nav class="crumbs" aria-label="مسیر"><a href="/">خانه</a> › <span>دسته‌بندی‌ها</span></nav>
  <section class="cat-head">
    <h1>دسته‌بندی‌های پرامپت</h1>
    <p class="lede">${total.toLocaleString('en-US')} پرامپت در ${cats.length} دسته. روی هر دسته بزن تا همه پرامپت‌هایش را ببینی.</p>
  </section>
  <div class="grid stagger">
    ${cats
      .map(
        (c) => `<article class="card"><a class="card-link" href="/c/${esc(c.slug)}">
          <div class="top"><div class="cat-ico" aria-hidden="true">${esc(c.icon)}</div>
          <div class="tw"><h2 class="h3">${esc(c.name_fa)}</h2><div class="cat-name">${esc(c.name_en)}</div></div></div>
          <p class="sum">${esc(c.description)}</p>
          <div class="meta"><span class="pill">${c.count} پرامپت</span></div></a></article>`
      )
      .join('')}
  </div>
</main>
${footer(cats)}`,
    bootstrap: { page: 'categories' },
  });
}

function renderGuide() {
  const cats = allCategories();
  const faqs = [
    ['پرامپت (Prompt) دقیقاً چیست؟', 'پرامپت متنی است که به هوش مصنوعی می‌دهی تا بداند چه کاری باید انجام دهد. هرچه این متن دقیق‌تر، زمینه‌دارتر و ساختارمندتر باشد، خروجی هم دقیق‌تر است.'],
    ['چرا جواب‌های من کلی و بی‌فایده‌اند؟', 'تقریباً همیشه چون زمینه کافی نداده‌ای. مخاطب، هدف، لحن، طول و قالب خروجی را بنویس. اضافه کردن همین چهار خط، بیشترین تفاوت را در کیفیت جواب ایجاد می‌کند.'],
    ['نقش دادن به مدل واقعاً فرق می‌کند؟', 'بله. وقتی می‌نویسی «تو یک وکیل قرارداد هستی»، مدل دایره واژگان، سطح دقت و چیزهایی که باید به آن‌ها اشاره کند را عوض می‌کند. این ارزان‌ترین راه برای بالا بردن کیفیت است.'],
    ['برای فارسی چه نکته‌ای هست؟', 'در انتهای پرامپت بنویس «به فارسی روان و بدون ترجمه تحت‌اللفظی جواب بده». بیشتر پرامپت‌های انگلیسی روی فارسی هم کار می‌کنند، فقط باید زبان خروجی را صریح مشخص کنی.'],
    ['چند بار باید پرامپت را اصلاح کنم؟', 'جواب اول را پیش‌نویس در نظر بگیر. یک دور اصلاح («کوتاه‌تر کن»، «مثال واقعی اضافه کن»، «سه نسخه بده») تقریباً همیشه نتیجه را به‌شکل محسوسی بهتر می‌کند.'],
    ['استفاده از پرامپت‌های این سایت رایگان است؟', 'بله، همه پرامپت‌ها رایگان‌اند و بدون ثبت‌نام قابل کپی هستند.'],
  ];
  const title = 'راهنمای پرامپت‌نویسی: چطور از هوش مصنوعی جواب بهتر بگیریم | Promptaria';
  const description = 'آموزش کامل و فارسی پرامپت‌نویسی: ساختار یک پرامپت خوب، نقش‌دهی، زمینه‌دهی، تعیین قالب خروجی و اشتباه‌های رایجی که کیفیت جواب را پایین می‌آورند.';

  return shell({
    headHtml: head({
      title,
      description,
      canonical: SITE + '/guide',
      type: 'article',
      keywords: ['آموزش پرامپت نویسی', 'prompt engineering فارسی', 'پرامپت چیست'],
      extraLd: [
        orgLd,
        breadcrumbLd([
          { name: 'خانه', url: SITE + '/' },
          { name: 'راهنمای پرامپت‌نویسی', url: SITE + '/guide' },
        ]),
        {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqs.map(([q, a]) => ({
            '@type': 'Question',
            name: q,
            acceptedAnswer: { '@type': 'Answer', text: a },
          })),
        },
      ],
    }),
    bodyHtml: `
${header('guide')}
<main id="main" class="wrap article">
  <nav class="crumbs" aria-label="مسیر"><a href="/">خانه</a> › <span>راهنمای پرامپت‌نویسی</span></nav>
  <article class="sheet static">
    <header class="sh-head">
      <h1>راهنمای پرامپت‌نویسی</h1>
      <p class="lede">هرچه در این صفحه است، نتیجه یک قاعده ساده است: هوش مصنوعی حدس نمی‌زند شما چه می‌خواهید — باید بگویید.</p>
    </header>
    <div class="sh-body">
      <section class="sec">
        <h2><span class="ic" aria-hidden="true">①</span> نقش بده</h2>
        <div class="howto"><p>با «تو یک <b>[متخصص]</b> هستی» شروع کن. این یک جمله، عمق پاسخ و دایره واژگان مدل را کاملاً عوض می‌کند. «تو یک متخصص سئو با ده سال تجربه در فروشگاه‌های اینترنتی هستی» بی‌نهایت بهتر از هیچ نقشی است.</p></div>
      </section>
      <section class="sec">
        <h2><span class="ic" aria-hidden="true">②</span> زمینه بده</h2>
        <div class="howto"><p>مخاطب کیست؟ هدف چیست؟ چه چیزی را نباید بگوید؟ بیشترِ جواب‌های ضعیف، نتیجه نبودِ سه خط زمینه‌اند، نه ضعف مدل.</p></div>
      </section>
      <section class="sec">
        <h2><span class="ic" aria-hidden="true">③</span> قالب خروجی را مشخص کن</h2>
        <div class="howto"><p>«به شکل جدول»، «در ۵ بند»، «با تیتر و زیرتیتر»، «حداکثر ۲۰۰ کلمه». خروجی ساختارمند را می‌شود مستقیم استفاده کرد؛ متن آزاد را باید دوباره سر و شکل داد.</p></div>
      </section>
      <section class="sec">
        <h2><span class="ic" aria-hidden="true">④</span> نمونه نشان بده</h2>
        <div class="howto"><p>یک نمونه از «خروجی خوب از نظر خودت» بیشتر از ده خط توضیح اثر دارد. به این کار few-shot می‌گویند و ساده‌ترین تکنیک حرفه‌ای پرامپت‌نویسی است.</p></div>
      </section>
      <section class="sec">
        <h2><span class="ic" aria-hidden="true">⑤</span> یک دور اصلاح کن</h2>
        <div class="howto"><p>جواب اول پیش‌نویس است. «این بخش را کوتاه‌تر کن»، «مثال واقعی اضافه کن»، «سه نسخه متفاوت بده» — دور دوم تقریباً همیشه بهتر از دور اول است.</p></div>
      </section>

      <section class="sec">
        <h2><span class="ic" aria-hidden="true">؟</span> سؤال‌های پرتکرار</h2>
        <div class="faq">
          ${faqs.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
        </div>
      </section>

      <section class="sec">
        <h2><span class="ic" aria-hidden="true">→</span> حالا امتحان کن</h2>
        <div class="rel-grid">
          ${cats.slice(0, 8).map((c) => `<a class="rel" href="/c/${esc(c.slug)}">${esc(c.icon)} پرامپت‌های ${esc(c.name_fa)}</a>`).join('')}
        </div>
      </section>
    </div>
  </article>
</main>
${footer(cats)}`,
    bootstrap: { page: 'guide' },
  });
}

function renderSearch(q) {
  const cats = allCategories();
  const like = '%' + String(q || '').toLowerCase().trim() + '%';
  const items = q
    ? db
        .prepare(
          `${SEL} AND (lower(p.title) LIKE ? OR lower(p.summary) LIKE ? OR lower(p.body) LIKE ?)
           ORDER BY p.quality DESC LIMIT 48`
        )
        .all(like, like, like)
    : [];
  const title = q ? `جستجوی «${q}» در پرامپت‌ها | Promptaria` : 'جستجوی پرامپت | Promptaria';

  return shell({
    // Search result pages are thin and near-duplicate by nature — keeping them
    // out of the index protects the crawl budget for the real content.
    headHtml: head({
      title,
      description: `نتایج جستجوی «${q}» میان هزاران پرامپت هوش مصنوعی با آموزش فارسی.`,
      canonical: SITE + '/search',
      noindex: true,
    }),
    bodyHtml: `
${header()}
<main id="main" class="wrap">
  <section class="cat-head">
    <h1>جستجو${q ? `: «${esc(q)}»` : ''}</h1>
    <form class="searchbar" role="search" action="/search" method="get">
      <span class="icon" aria-hidden="true">⌕</span>
      <label class="sr-only" for="q">جستجوی پرامپت</label>
      <input id="q" name="q" type="search" value="${esc(q || '')}" placeholder="جستجو در پرامپت‌ها…">
    </form>
    <p class="lede">${items.length ? `${items.length} نتیجه پیدا شد.` : q ? 'نتیجه‌ای پیدا نشد. عبارت دیگری امتحان کن.' : 'یک عبارت بنویس تا جستجو کنم.'}</p>
  </section>
  <div class="grid stagger">${items.map(cardHtml).join('')}</div>
</main>
${footer(cats)}`,
    bootstrap: { page: 'search', q },
  });
}

function render404() {
  const cats = allCategories();
  return shell({
    headHtml: head({
      title: 'صفحه پیدا نشد | Promptaria',
      description: 'این صفحه وجود ندارد.',
      canonical: SITE + '/404',
      noindex: true,
    }),
    bodyHtml: `${header()}
<main id="main" class="wrap">
  <div class="empty"><div class="big">🔍</div>
    <h1>این صفحه پیدا نشد</h1>
    <p>شاید پرامپت حذف شده یا آدرس اشتباه است.</p>
    <p><a class="btn-link" href="/">برگرد به صفحه اصلی</a></p>
  </div>
</main>${footer(cats)}`,
  });
}

/* ------------------------------------------------------------------ *
 * robots.txt + sitemaps
 * ------------------------------------------------------------------ */
function robots() {
  return `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /search

Sitemap: ${SITE}/sitemap.xml
`;
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PER_MAP = 2000;

function sitemapIndex() {
  const total = db.prepare("SELECT COUNT(*) n FROM prompts WHERE status='published'").get().n;
  const chunks = Math.max(1, Math.ceil(total / PER_MAP));
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>${SITE}/sitemap-pages.xml</loc><lastmod>${now}</lastmod></sitemap>
${Array.from({ length: chunks }, (_, i) => `<sitemap><loc>${SITE}/sitemap-prompts-${i + 1}.xml</loc><lastmod>${now}</lastmod></sitemap>`).join('\n')}
</sitemapindex>`;
}

function sitemapPages() {
  const now = new Date().toISOString();
  const urls = [
    { loc: SITE + '/', pri: '1.0', freq: 'daily' },
    { loc: SITE + '/categories', pri: '0.8', freq: 'weekly' },
    { loc: SITE + '/guide', pri: '0.8', freq: 'monthly' },
    ...allCategories().map((c) => ({ loc: catUrl(c.slug), pri: '0.9', freq: 'daily' })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `<url><loc>${xmlEsc(u.loc)}</loc><lastmod>${now}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.pri}</priority></url>`
  )
  .join('\n')}
</urlset>`;
}

function sitemapPrompts(chunk) {
  const rows = db
    .prepare(
      `SELECT uid, slug, updated_at, quality FROM prompts WHERE status='published'
       ORDER BY id LIMIT ? OFFSET ?`
    )
    .all(PER_MAP, (chunk - 1) * PER_MAP);
  if (!rows.length) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows
  .map((r) => {
    const lm = r.updated_at ? new Date(String(r.updated_at).replace(' ', 'T') + 'Z').toISOString() : new Date().toISOString();
    const pri = (0.4 + (Math.min(99, r.quality || 50) / 100) * 0.4).toFixed(1);
    return `<url><loc>${xmlEsc(`${SITE}/p/${r.slug}-${r.uid}`)}</loc><lastmod>${lm}</lastmod><changefreq>monthly</changefreq><priority>${pri}</priority></url>`;
  })
  .join('\n')}
</urlset>`;
}

module.exports = {
  SITE,
  assetV,
  renderHome,
  renderCategory,
  renderPrompt,
  renderCategories,
  renderGuide,
  renderSearch,
  render404,
  robots,
  sitemapIndex,
  sitemapPages,
  sitemapPrompts,
};
