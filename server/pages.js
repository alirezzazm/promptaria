'use strict';
/**
 * Server-rendered pages for the authored content: /learn, /collections and
 * /builder. They reuse seo.js for the shell so head tags, header, footer and
 * asset versioning stay in one place.
 */
const seo = require('./seo');
const content = require('./content');

const { esc, renderBody, collectionItems } = content;
const SITE = seo.SITE;
const DIFF_FA = { easy: 'ساده', medium: 'متوسط', advanced: 'پیشرفته' };

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
};

const promptCard = (p) => `
<article class="card${p.featured ? ' feat' : ''}">
  <a class="card-link" href="/p/${esc(p.slug)}-${esc(p.uid)}">
    <div class="top">
      <div class="cat-ico" aria-hidden="true">${esc(p.icon || '✦')}</div>
      <div class="tw">
        <h3>${esc(p.title)}</h3>
        <div class="cat-name">${esc(p.cat_name || 'عمومی')}</div>
      </div>
    </div>
    <p class="sum">${esc(clip(p.summary, 160))}</p>
    <div class="meta">
      <span class="pill ${esc(p.difficulty)}">${DIFF_FA[p.difficulty] || ''}</span>
      ${p.lang === 'fa' ? '<span class="pill fa">فارسی</span>' : ''}
      <span class="stat-mini">⧉ ${p.copies} · ◉ ${p.views}</span>
    </div>
  </a>
</article>`;

/* ------------------------------------------------------------------ *
 * /learn
 * ------------------------------------------------------------------ */
function renderLearnIndex() {
  const arts = content.articles;
  const title = 'آموزش هوش مصنوعی و پرامپت‌نویسی به فارسی | Promptaria';
  const description =
    'مقاله‌های فارسی درباره کار با هوش مصنوعی: پرامپت‌نویسی، مقایسه ChatGPT و Claude و Gemini، ابزارهای رایگان، و استفاده از AI در کسب‌وکار.';

  return seo.shell({
    headHtml: seo.head({
      title,
      description,
      canonical: SITE + '/learn',
      keywords: ['آموزش هوش مصنوعی', 'پرامپت نویسی', 'آموزش ChatGPT فارسی'],
      extraLd: [
        seo.orgLd,
        seo.breadcrumbLd([
          { name: 'خانه', url: SITE + '/' },
          { name: 'آموزش', url: SITE + '/learn' },
        ]),
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: title,
          description,
          url: SITE + '/learn',
          inLanguage: 'fa-IR',
          mainEntity: {
            '@type': 'ItemList',
            itemListElement: arts.map((a, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              url: `${SITE}/learn/${a.slug}`,
              name: a.title,
            })),
          },
        },
      ],
    }),
    bodyHtml: `
${seo.header('learn')}
<main id="main" class="wrap">
  <nav class="crumbs" aria-label="مسیر"><a href="/">خانه</a> › <span>آموزش</span></nav>
  <section class="cat-head">
    <h1>آموزش هوش مصنوعی به زبان فارسی</h1>
    <p class="lede">مقاله‌هایی که فرض نمی‌کنند از قبل چیزی بلدی. از «پرامپت چیست» تا انتخاب ابزار و استفاده در کسب‌وکار.</p>
  </section>
  <div class="grid stagger">
    ${arts
      .map(
        (a) => `<article class="card"><a class="card-link" href="/learn/${esc(a.slug)}">
          <div class="top"><div class="cat-ico" aria-hidden="true">${esc(a.icon)}</div>
          <div class="tw"><h2 class="h3">${esc(a.title)}</h2>
          <div class="cat-name">${a.readMins} دقیقه مطالعه</div></div></div>
          <p class="sum">${esc(a.description)}</p>
          <div class="meta"><span class="pill">مقاله</span></div></a></article>`
      )
      .join('')}
  </div>
</main>
${seo.footer(seo.allCategories())}`,
    bootstrap: { page: 'learn' },
  });
}

function renderArticle(slug) {
  const a = content.articleBySlug(slug);
  if (!a) return null;

  const related = content.articles.filter((x) => x.slug !== slug).slice(0, 3);
  const canonical = `${SITE}/learn/${a.slug}`;

  return seo.shell({
    headHtml: seo.head({
      title: `${a.title} | Promptaria`,
      description: a.description,
      canonical,
      type: 'article',
      keywords: a.keywords,
      published: new Date(a.published).toISOString(),
      modified: new Date(a.updated).toISOString(),
      extraLd: [
        seo.orgLd,
        seo.breadcrumbLd([
          { name: 'خانه', url: SITE + '/' },
          { name: 'آموزش', url: SITE + '/learn' },
          { name: a.title, url: canonical },
        ]),
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: clip(a.title, 110),
          description: a.description,
          url: canonical,
          inLanguage: 'fa-IR',
          datePublished: new Date(a.published).toISOString(),
          dateModified: new Date(a.updated).toISOString(),
          author: { '@id': `${SITE}/#organization` },
          publisher: { '@id': `${SITE}/#organization` },
          mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
          keywords: a.keywords.join(', '),
        },
        ...(a.faq && a.faq.length
          ? [
              {
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                mainEntity: a.faq.map(([q, ans]) => ({
                  '@type': 'Question',
                  name: q,
                  acceptedAnswer: { '@type': 'Answer', text: ans },
                })),
              },
            ]
          : []),
      ],
    }),
    bodyHtml: `
${seo.header('learn')}
<main id="main" class="wrap article">
  <nav class="crumbs" aria-label="مسیر"><a href="/">خانه</a> › <a href="/learn">آموزش</a> › <span>${esc(clip(a.title, 40))}</span></nav>
  <article class="sheet static">
    <header class="sh-head">
      <h1>${esc(a.title)}</h1>
      <div class="kv">
        <span class="pill">${esc(a.icon)} مقاله</span>
        <span class="pill">${a.readMins} دقیقه مطالعه</span>
        <span class="pill">به‌روزرسانی: ${esc(a.updated)}</span>
      </div>
      <p class="lede">${esc(a.description)}</p>
    </header>
    <div class="sh-body prose">
      ${renderBody(a.body)}

      ${
        a.faq && a.faq.length
          ? `<h2>سؤال‌های پرتکرار</h2>
             <div class="faq">${a.faq
               .map(([q, ans]) => `<details><summary>${esc(q)}</summary><p>${esc(ans)}</p></details>`)
               .join('')}</div>`
          : ''
      }

      <div class="cta-box">
        <b>پرامپت آماده می‌خواهی؟</b>
        <p>بیش از سه هزار پرامپت دسته‌بندی‌شده، هرکدام با آموزش فارسی استفاده.</p>
        <a class="btn-link" href="/collections">دیدن مجموعه‌ها</a>
      </div>

      ${
        related.length
          ? `<h2>مقاله‌های دیگر</h2>
             <div class="rel-grid">${related
               .map((r) => `<a class="rel" href="/learn/${esc(r.slug)}">${esc(r.icon)} ${esc(r.title)}</a>`)
               .join('')}</div>`
          : ''
      }
    </div>
  </article>
</main>
${seo.footer(seo.allCategories())}`,
    bootstrap: { page: 'article' },
  });
}

/* ------------------------------------------------------------------ *
 * /collections
 * ------------------------------------------------------------------ */
function renderCollectionsIndex() {
  const cols = content.collections;
  const title = 'مجموعه‌های پرامپت آماده برای هر هدف | Promptaria';
  const description =
    'پرامپت‌های دسته‌بندی‌شده حول یک هدف مشخص: فروشگاه اینترنتی، رزومه و مصاحبه، تولید محتوا، برنامه‌نویسی، درس خواندن و کسب‌وکار ایرانی.';

  return seo.shell({
    headHtml: seo.head({
      title,
      description,
      canonical: SITE + '/collections',
      keywords: ['مجموعه پرامپت', 'پرامپت آماده', 'بسته پرامپت'],
      extraLd: [
        seo.orgLd,
        seo.breadcrumbLd([
          { name: 'خانه', url: SITE + '/' },
          { name: 'مجموعه‌ها', url: SITE + '/collections' },
        ]),
      ],
    }),
    bodyHtml: `
${seo.header('collections')}
<main id="main" class="wrap">
  <nav class="crumbs" aria-label="مسیر"><a href="/">خانه</a> › <span>مجموعه‌ها</span></nav>
  <section class="cat-head">
    <h1>مجموعه‌های آماده</h1>
    <p class="lede">به‌جای گشتن میان هزاران پرامپت، یک هدف را انتخاب کن و پرامپت‌هایش را به ترتیبی که واقعاً استفاده می‌شوند بردار.</p>
  </section>
  <div class="grid stagger">
    ${cols
      .map(
        (c) => `<article class="card"><a class="card-link" href="/collections/${esc(c.slug)}">
          <div class="top"><div class="cat-ico" aria-hidden="true">${esc(c.icon)}</div>
          <div class="tw"><h2 class="h3">${esc(c.title)}</h2>
          <div class="cat-name">مجموعه</div></div></div>
          <p class="sum">${esc(c.lead)}</p>
          <div class="meta"><span class="pill">تا ${c.limit} پرامپت</span>
          ${c.faOnly ? '<span class="pill fa">فارسی</span>' : ''}</div></a></article>`
      )
      .join('')}
  </div>
</main>
${seo.footer(seo.allCategories())}`,
    bootstrap: { page: 'collections' },
  });
}

function renderCollection(slug) {
  const col = content.collectionBySlug(slug);
  if (!col) return null;
  const items = collectionItems(col);
  if (!items.length) return null;

  const canonical = `${SITE}/collections/${col.slug}`;
  const title = `${col.title} — ${items.length} پرامپت آماده | Promptaria`;

  return seo.shell({
    headHtml: seo.head({
      title,
      description: col.lead,
      canonical,
      keywords: [col.title, 'پرامپت آماده', 'مجموعه پرامپت'],
      extraLd: [
        seo.orgLd,
        seo.breadcrumbLd([
          { name: 'خانه', url: SITE + '/' },
          { name: 'مجموعه‌ها', url: SITE + '/collections' },
          { name: col.title, url: canonical },
        ]),
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: title,
          description: col.lead,
          url: canonical,
          inLanguage: 'fa-IR',
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: items.length,
            itemListElement: items.map((p, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              url: `${SITE}/p/${p.slug}-${p.uid}`,
              name: p.title,
            })),
          },
        },
      ],
    }),
    bodyHtml: `
${seo.header('collections')}
<main id="main" class="wrap">
  <nav class="crumbs" aria-label="مسیر"><a href="/">خانه</a> › <a href="/collections">مجموعه‌ها</a> › <span>${esc(clip(col.title, 40))}</span></nav>
  <section class="cat-head">
    <h1><span aria-hidden="true">${esc(col.icon)}</span> ${esc(col.title)}</h1>
    <p class="lede">${esc(col.lead)}</p>
  </section>
  <div class="note col-intro">${esc(col.intro)}</div>
  <div class="grid stagger">${items.map(promptCard).join('')}</div>

  <section class="seo-block">
    <h2>مجموعه‌های دیگر</h2>
    <div class="rel-grid">
      ${content.collections
        .filter((c) => c.slug !== col.slug)
        .slice(0, 6)
        .map((c) => `<a class="rel" href="/collections/${esc(c.slug)}">${esc(c.icon)} ${esc(c.title)}</a>`)
        .join('')}
    </div>
  </section>
</main>
${seo.footer(seo.allCategories())}`,
    bootstrap: { page: 'collection', cat: null },
  });
}

/* ------------------------------------------------------------------ *
 * /builder — the step-by-step prompt builder
 * ------------------------------------------------------------------ */
function renderBuilder() {
  const title = 'ساخت پرامپت قدم‌به‌قدم | Promptaria';
  const description =
    'ابزار رایگان ساخت پرامپت: به چند سؤال ساده جواب بده تا یک پرامپت کامل فارسی برایت ساخته شود — نقش، مخاطب، لحن و قالب خروجی.';

  return seo.shell({
    headHtml: seo.head({
      title,
      description,
      canonical: SITE + '/builder',
      keywords: ['ساخت پرامپت', 'پرامپت ساز', 'ابزار پرامپت نویسی'],
      extraLd: [
        seo.orgLd,
        seo.breadcrumbLd([
          { name: 'خانه', url: SITE + '/' },
          { name: 'ساخت پرامپت', url: SITE + '/builder' },
        ]),
        {
          '@context': 'https://schema.org',
          '@type': 'WebApplication',
          name: 'پرامپت‌ساز Promptaria',
          url: SITE + '/builder',
          applicationCategory: 'UtilitiesApplication',
          operatingSystem: 'Web',
          inLanguage: 'fa-IR',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'IRR' },
        },
      ],
    }),
    bodyHtml: `
${seo.header('builder')}
<main id="main" class="wrap">
  <nav class="crumbs" aria-label="مسیر"><a href="/">خانه</a> › <span>ساخت پرامپت</span></nav>
  <section class="cat-head">
    <h1>پرامپت‌ساز</h1>
    <p class="lede">به این پنج سؤال جواب بده تا یک پرامپت کامل برایت ساخته شود. هرچه دقیق‌تر پر کنی، خروجی بهتری می‌گیری — و هر فیلد را خالی بگذاری، جای خالی‌اش در پرامپت می‌ماند تا خودت پر کنی.</p>
  </section>

  <div class="builder">
    <form class="builder-form" id="bForm" autocomplete="off">
      <label class="bf">
        <span>۱. می‌خواهی هوش مصنوعی چه کاری برایت بکند؟ <b>*</b></span>
        <textarea id="bTask" rows="3" placeholder="مثلاً: برای فروشگاه لوستر دست‌سازم کپشن اینستاگرام بنویسد"></textarea>
      </label>

      <label class="bf">
        <span>۲. مدل چه نقشی داشته باشد؟</span>
        <input id="bRole" placeholder="مثلاً: یک سوشال‌مدیا مارکتر با تجربه در پیج‌های فارسی">
        <small>خالی بگذاری، خودم از روی کارت پیشنهاد می‌دهم.</small>
      </label>

      <label class="bf">
        <span>۳. مخاطب کیست؟</span>
        <input id="bAudience" placeholder="مثلاً: زنان ۲۵ تا ۴۵ ساله علاقه‌مند به دکوراسیون">
      </label>

      <div class="bf-row">
        <label class="bf">
          <span>۴. لحن</span>
          <select id="bTone">
            <option value="">— انتخاب کن —</option>
            <option>صمیمی و خودمانی</option>
            <option>رسمی و حرفه‌ای</option>
            <option>تبلیغاتی و ترغیب‌کننده</option>
            <option>آموزشی و قدم‌به‌قدم</option>
            <option>طنز و غیررسمی</option>
          </select>
        </label>
        <label class="bf">
          <span>۵. قالب خروجی</span>
          <select id="bFormat">
            <option value="">— انتخاب کن —</option>
            <option>فهرست شماره‌دار</option>
            <option>جدول</option>
            <option>متن بلند با تیتر</option>
            <option>متن کوتاه، حداکثر یک پاراگراف</option>
            <option>کد با توضیح</option>
          </select>
        </label>
      </div>

      <div class="bf-check">
        <label><input type="checkbox" id="bAsk" checked> قبل از شروع، سؤال‌های ابهام را بپرسد</label>
        <label><input type="checkbox" id="bFa" checked> خروجی به فارسی روان باشد</label>
        <label><input type="checkbox" id="bVerify"> منابع و اعداد را علامت بزند که راستی‌آزمایی شوند</label>
      </div>

      <div class="row">
        <button class="btn-link" type="submit" id="bMake">بساز</button>
        <button class="btn-plain" type="button" id="bReset">پاک کن</button>
      </div>
    </form>

    <div class="builder-out">
      <div class="assist-label">پرامپت ساخته‌شده</div>
      <div class="prompt-box">
        <button class="copybtn" id="bCopy" type="button">کپی</button>
        <pre id="bOut" class="fa-pre">اول فرم را پر کن و «بساز» را بزن.</pre>
      </div>
      <div id="bMatches"></div>
    </div>
  </div>

  <section class="seo-block">
    <h2>چرا این پنج سؤال؟</h2>
    <p>
      چون دقیقاً همان چیزهایی‌اند که مدل نمی‌داند و حدس می‌زند. وقتی نقش، مخاطب، لحن و قالب را مشخص نکنی،
      مدل میانگین همه‌ی متن‌هایی را که دیده تولید می‌کند — و میانگین همیشه کلی و بی‌روح است.
      اگر می‌خواهی عمیق‌تر یاد بگیری، <a href="/learn/promptnevisi-chist">راهنمای پرامپت‌نویسی</a> را بخوان.
    </p>
  </section>
</main>
${seo.footer(seo.allCategories())}`,
    bootstrap: { page: 'builder' },
  });
}

module.exports = {
  renderLearnIndex,
  renderArticle,
  renderCollectionsIndex,
  renderCollection,
  renderBuilder,
};
