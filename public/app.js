'use strict';
/**
 * Progressive enhancement only.
 *
 * Every public page is fully rendered on the server, so the site works with
 * JavaScript disabled and crawlers get real content. This file adds the
 * interactive layer on top: live filtering, copy buttons, counters, motion.
 */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const BOOT = window.__PA__ || { page: 'home' };

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FA = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
// Same as the server-rendered cards: Persian digits with grouping ("۱٬۲۳۴").
const faNum = (n) => Number(n || 0).toLocaleString('fa-IR');
// Mirrors badge() in server/seo.js — keep the two in step.
const badge = (p) =>
  p.original
    ? '<span class="pill fa" title="این پرامپت را خود پرامپت‌آریا به فارسی نوشته است">✎ تألیف اختصاصی</span>'
    : p.featured
      ? '<span class="pill gold" title="از میان پرامپت‌های کتابخانه دستی انتخاب شده">★ منتخب</span>'
      : '';
const DIFF_FA = { easy: 'ساده', medium: 'متوسط', advanced: 'پیشرفته' };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The assistant's prose carries **bold** emphasis; render just that, escaped. */
function mdLite(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function timeAgo(iso) {
  if (!iso) return '—';
  const mins = Math.round((Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 60000);
  if (mins < 60) return FA(Math.max(1, mins)) + ' دقیقه پیش';
  if (mins < 1440) return FA(Math.round(mins / 60)) + ' ساعت پیش';
  return FA(Math.round(mins / 1440)) + ' روز پیش';
}

function toast(msg) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ------------------------------------------------------------------ *
 * Copy button (works on every prompt page)
 * ------------------------------------------------------------------ */
async function copyPrompt(btn, text, uid) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const label = btn.textContent;
  btn.textContent = 'کپی شد ✓';
  btn.classList.add('done');
  setTimeout(() => {
    btn.textContent = label;
    btn.classList.remove('done');
  }, 1800);
  toast('پرامپت در کلیپ‌بورد کپی شد ✓');
  if (uid) fetch('/api/prompts/' + encodeURIComponent(uid) + '/copy', { method: 'POST' }).catch(() => {});
}

function wireCopy() {
  const btn = $('#copyBtn');
  if (!btn) return;
  btn.addEventListener('click', () => copyPrompt(btn, $('#promptText').textContent, btn.dataset.uid));
}

/* ------------------------------------------------------------------ *
 * Animated counters + scroll reveal + reading progress
 * ------------------------------------------------------------------ */
function animateCounters() {
  const els = $$('.counter');
  if (!els.length) return;
  if (reduceMotion) return;
  for (const el of els) {
    const to = Number(el.dataset.to) || 0;
    if (to < 2) continue;
    const dur = 1100;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = faNum(Math.round(to * eased));
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = faNum(to);
    };
    requestAnimationFrame(tick);
  }
}

function scrollReveal() {
  if (reduceMotion || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.style.animation = 'card-in .55s cubic-bezier(.2,1,.3,1) both';
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -40px 0px', threshold: 0.05 }
  );
  // sections below the fold animate in as they are reached
  $$('.seo-block h2, .seo-block p, .sec, .faq details').forEach((el) => {
    el.style.animation = 'none';
    io.observe(el);
  });
}

function readingProgress() {
  if (!$('.article') || reduceMotion) return;
  const bar = document.createElement('div');
  bar.className = 'progress';
  document.body.appendChild(bar);
  const update = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = `scaleX(${h > 0 ? Math.min(1, window.scrollY / h) : 0})`;
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}

/* ------------------------------------------------------------------ *
 * Home / category live filtering (no page reload)
 * ------------------------------------------------------------------ */
const cardHtml = (p) => `
<article class="card${p.featured && !p.original ? ' feat' : ''}">
  <a class="card-link" href="/p/${esc(p.slug)}-${esc(p.id)}">
    <div class="top">
      <div class="cat-ico" aria-hidden="true">${esc(p.category_icon || '✦')}</div>
      <div class="tw">
        <h3>${esc(p.title)}</h3>
        <div class="cat-name">${esc(p.category_name || 'عمومی')}</div>
      </div>
    </div>
    <p class="sum">${esc(p.summary)}</p>
    <div class="meta">
      <span class="pill ${esc(p.difficulty)}">${DIFF_FA[p.difficulty] || ''}</span>
      ${badge(p)}
      <span class="stat-mini">${faNum(p.views)} بازدید${p.copies ? ` · ${faNum(p.copies)} کپی` : ''}</span>
    </div>
  </a>
</article>`;

function wireCatalog() {
  const grid = $('#grid');
  if (!grid) return;

  const state = { cat: BOOT.cat || 'all', q: '', sort: 'best', difficulty: 'all', page: 1 };
  let seq = 0;

  async function load(scroll = false) {
    const mine = ++seq;
    grid.innerHTML = Array.from({ length: 8 }, () => '<div class="skeleton"></div>').join('');
    const qs = new URLSearchParams({
      cat: state.cat,
      sort: state.sort,
      difficulty: state.difficulty,
      page: state.page,
      per: 24,
    });
    if (state.q) qs.set('q', state.q);

    const d = await fetch('/api/prompts?' + qs).then((r) => r.json());
    if (mine !== seq) return; // a newer request already won

    const count = $('#count');
    if (count) {
      count.innerHTML = d.total
        ? `<b>${faNum(d.total)}</b> پرامپت${state.q ? ` برای «${esc(state.q)}»` : ''}`
        : 'نتیجه‌ای پیدا نشد';
    }
    grid.className = 'grid stagger';
    grid.innerHTML = d.items.length
      ? d.items.map(cardHtml).join('')
      : `<div class="empty"><div class="big">🔍</div>چیزی با این فیلترها پیدا نشد.<br>عبارت دیگری امتحان کن یا دسته را عوض کن.</div>`;
    renderPager(d);
    if (scroll) grid.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function renderPager(d) {
    const pager = $('#pager');
    if (!pager) return;
    if (d.pages <= 1) return (pager.innerHTML = '');
    const cur = d.page;
    const nums = [...new Set([1, d.pages, cur, cur - 1, cur + 1, cur - 2, cur + 2])]
      .filter((n) => n >= 1 && n <= d.pages)
      .sort((a, b) => a - b);
    let html = `<button ${cur === 1 ? 'disabled' : ''} data-p="${cur - 1}" aria-label="صفحه قبل">‹</button>`;
    let prev = 0;
    for (const n of nums) {
      if (n - prev > 1) html += '<button disabled>…</button>';
      html += `<button class="${n === cur ? 'on' : ''}" data-p="${n}">${FA(n)}</button>`;
      prev = n;
    }
    html += `<button ${cur === d.pages ? 'disabled' : ''} data-p="${cur + 1}" aria-label="صفحه بعد">›</button>`;
    pager.innerHTML = html;
  }

  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  const q = $('#q');
  if (q) {
    // The search box also submits to /search for no-JS users; with JS we filter in place.
    const form = q.closest('form');
    if (form) form.addEventListener('submit', (e) => e.preventDefault());
    q.addEventListener(
      'input',
      debounce((e) => {
        state.q = e.target.value.trim();
        state.page = 1;
        load();
      }, 300)
    );
  }

  const sort = $('#sort');
  if (sort)
    sort.addEventListener('change', (e) => {
      state.sort = e.target.value;
      state.page = 1;
      load();
    });

  const diff = $('#difficulty');
  if (diff)
    diff.addEventListener('change', (e) => {
      state.difficulty = e.target.value;
      state.page = 1;
      load();
    });

  const chips = $('#chips');
  if (chips)
    chips.addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c || !c.dataset.cat) return;
      e.preventDefault(); // stay on the page; the href is the no-JS fallback
      $$('.chip', chips).forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
      state.cat = c.dataset.cat;
      state.page = 1;
      const url = state.cat === 'all' ? '/' : '/c/' + state.cat;
      history.pushState({ cat: state.cat }, '', url);
      load(true);
    });

  const pager = $('#pager');
  if (pager)
    pager.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-p]');
      if (!b || b.disabled) return;
      state.page = Number(b.dataset.p);
      load(true);
    });

  window.addEventListener('popstate', () => location.reload());
}


/* ------------------------------------------------------------------ *
 * پرامپت‌یار — the search assistant
 *
 * The hero box does double duty: it filters the catalogue as you type, and
 * pressing the button asks the assistant to read the request properly and
 * build a prompt around it. Without JS the same box still submits to /search.
 * ------------------------------------------------------------------ */
function assistHtml(d) {
  const u = d.understood || {};
  const chips = [
    u.category_name && ['حوزه', u.category_name],
    u.audience && ['مخاطب', u.audience],
    u.tone && ['لحن', u.tone],
    u.format && ['قالب', u.format],
  ].filter(Boolean);

  return `
  <div class="assist-card">
    <div class="assist-head">
      <span class="assist-badge">پرامپت‌یار</span>
      <button class="assist-close" id="assistClose" type="button" aria-label="بستن">✕</button>
    </div>

    ${chips.length ? `<div class="kv assist-chips">${chips
      .map(([k, v]) => `<span class="pill"><b>${esc(k)}:</b> ${esc(v)}</span>`)
      .join('')}</div>` : ''}

    <div class="assist-say">${d.explanation.map((p) => `<p>${mdLite(p)}</p>`).join('')}</div>

    <div class="assist-prompt">
      <div class="assist-label">پرامپت ساخته‌شده برای همین خواسته</div>
      <div class="prompt-box">
        <button class="copybtn" id="assistCopy" type="button">کپی</button>
        <pre id="assistText">${esc(d.generated_prompt)}</pre>
      </div>
    </div>

    ${d.matches.length ? `
      <div class="assist-label">پرامپت‌های آماده‌ای که به کارت می‌آیند</div>
      <div class="assist-matches">
        ${d.matches.map((m) => `
          <a class="assist-match" href="${esc(m.url)}">
            <span class="am-ico" aria-hidden="true">${esc(m.category_icon || '✦')}</span>
            <span class="am-body">
              <b>${esc(m.title)}</b>
              <small>${esc(m.reason)}</small>
            </span>
          </a>`).join('')}
      </div>` : ''}
  </div>`;
}

function wireAssistant() {
  const box = $('#assist');
  const input = $('#q');
  const btn = $('#askBtn');
  if (!box || !input || !btn) return;

  async function ask() {
    const q = input.value.trim();
    if (q.length < 3) {
      input.focus();
      toast('یک جمله بنویس که بگوید می‌خواهی چه کار کنی');
      return;
    }
    box.hidden = false;
    box.innerHTML = '<div class="assist-card"><div class="skeleton" style="height:150px"></div></div>';
    box.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });

    let d;
    try {
      d = await fetch('/api/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q }),
      }).then((r) => r.json());
    } catch {
      box.innerHTML = '<div class="assist-card">ارتباط با سرور برقرار نشد. دوباره امتحان کن.</div>';
      return;
    }

    if (!d.ok) {
      box.innerHTML = `<div class="assist-card">${esc(d.error || 'نتوانستم درخواست را بخوانم.')}</div>`;
      return;
    }

    box.innerHTML = assistHtml(d);
    $('#assistClose').onclick = () => {
      box.hidden = true;
      box.innerHTML = '';
    };
    $('#assistCopy').onclick = (e) => copyPrompt(e.currentTarget, $('#assistText').textContent, null);
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    ask();
  });
  input.addEventListener('keydown', (e) => {
    // Enter asks the assistant; the live filter keeps running on plain typing
    if (e.key === 'Enter') {
      e.preventDefault();
      ask();
    }
  });
}


/* ------------------------------------------------------------------ *
 * /builder — assembles a prompt from five answers
 *
 * Deliberately the same shape as the assistant's generated prompt, so someone
 * who used پرامپت‌یار first sees a familiar structure here.
 * ------------------------------------------------------------------ */
const ROLE_GUESS = [
  [/اینستاگرام|کپشن|استوری|ریلز|پیج|فالوور/, 'یک سوشال‌مدیا مارکتر با تجربه در رشد پیج‌های فارسی'],
  [/تبلیغ|فروش|مشتری|بازاریابی|کمپین/, 'یک کپی‌رایتر تبلیغاتی که کارش فروش است نه فقط زیبانویسی'],
  [/سئو|گوگل|کلمه کلیدی|رتبه/, 'یک متخصص سئو با ده سال تجربه روی سایت‌های فارسی'],
  [/کد|برنامه|باگ|دیباگ|ریفکتور|تست|سایت|اپلیکیشن/, 'یک مهندس نرم‌افزار ارشد که کد را بازبینی و بهینه می‌کند'],
  [/رزومه|مصاحبه|شغل|استخدام|لینکدین/, 'یک مشاور شغلی که رزومه‌های موفق نوشته'],
  [/درس|آموزش|یاد|امتحان|کنکور|دانشجو|دانش‌آموز/, 'یک معلم خصوصی که مفاهیم سخت را ساده توضیح می‌دهد'],
  [/داده|دیتا|اکسل|تحلیل|آمار|گزارش/, 'یک تحلیلگر داده که از عدد، تصمیم بیرون می‌کشد'],
  [/عکس|تصویر|طراحی|لوگو|میدجرنی|گرافیک/, 'یک کارگردان هنری که پرامپت‌های تصویری دقیق می‌نویسد'],
  [/مقاله|متن|بنویس|محتوا|داستان|نویسند/, 'یک نویسنده و ویراستار حرفه‌ای فارسی'],
  [/قرارداد|حقوق|وکیل|قانون/, 'یک کارشناس حقوقی که زبان قرارداد را ساده می‌کند'],
  [/برنامه‌ریزی|زمان|تسک|اولویت|بهره‌وری/, 'یک مربی بهره‌وری که برنامه‌های عملی می‌چیند'],
];

function guessRole(task) {
  const t = String(task || '');
  for (const [re, role] of ROLE_GUESS) if (re.test(t)) return role;
  return 'یک متخصص باتجربه در همین حوزه';
}

function buildPrompt(v) {
  const L = [];
  L.push('تو ' + (v.role || guessRole(v.task)) + ' هستی.');
  L.push('');
  L.push('کاری که از تو می‌خواهم: ' + v.task);
  L.push('');
  L.push('این نکته‌ها را رعایت کن:');
  L.push('• مخاطب: ' + (v.audience || '[اینجا بنویس برای چه کسی است]'));
  L.push('• لحن: ' + (v.tone || '[مثلاً صمیمی، رسمی، تبلیغاتی]'));
  L.push('• قالب خروجی: ' + (v.format || '[مثلاً فهرست، جدول، متن بلند با تیتر]'));
  if (v.fa) L.push('• زبان: فارسی روان و بدون ترجمه تحت‌اللفظی');
  L.push('');
  if (v.ask) L.push('قبل از شروع، اگر چیزی از صورت مسئله برایت مبهم است حداکثر سه سؤال بپرس.');
  L.push('اول یک طرح کلی کوتاه بده، بعد وارد جزئیات شو.');
  if (v.verify) L.push('هر عدد، آمار یا ارجاعی که مطمئن نیستی را صراحتاً «نیازمند راستی‌آزمایی» علامت بزن.');
  return L.join(String.fromCharCode(10));
}

function wireBuilder() {
  const form = $('#bForm');
  if (!form) return;
  const out = $('#bOut');

  const collect = () => ({
    task: $('#bTask').value.trim(),
    role: $('#bRole').value.trim(),
    audience: $('#bAudience').value.trim(),
    tone: $('#bTone').value,
    format: $('#bFormat').value,
    ask: $('#bAsk').checked,
    fa: $('#bFa').checked,
    verify: $('#bVerify').checked,
  });

  async function make(e) {
    if (e) e.preventDefault();
    const v = collect();
    if (v.task.length < 5) {
      $('#bTask').focus();
      toast('اول بنویس می‌خواهی چه کاری انجام شود');
      return;
    }
    out.textContent = buildPrompt(v);

    // the assistant already knows how to find close matches — reuse it
    try {
      const d = await fetch('/api/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: v.task }),
      }).then((r) => r.json());
      const box = $('#bMatches');
      box.innerHTML =
        d.ok && d.matches.length
          ? `<div class="assist-label">پرامپت‌های آماده‌ی نزدیک به این خواسته</div>
             <div class="assist-matches">${d.matches
               .slice(0, 4)
               .map(
                 (m) => `<a class="assist-match" href="${esc(m.url)}">
                   <span class="am-ico" aria-hidden="true">${esc(m.category_icon || '✦')}</span>
                   <span class="am-body"><b>${esc(m.title)}</b><small>${esc(m.reason)}</small></span></a>`
               )
               .join('')}</div>`
          : '';
    } catch {
      /* the built prompt is the point; matches are a bonus */
    }
  }

  form.addEventListener('submit', make);
  $('#bReset').addEventListener('click', () => {
    form.reset();
    out.textContent = 'اول فرم را پر کن و «بساز» را بزن.';
    $('#bMatches').innerHTML = '';
  });
  $('#bCopy').addEventListener('click', (e) => copyPrompt(e.currentTarget, out.textContent, null));
}

/* ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  wireCopy();
  wireCatalog();
  wireAssistant();
  wireBuilder();
  animateCounters();
  scrollReveal();
  readingProgress();

  const upd = $('#stUpd');
  if (upd)
    fetch('/api/stats')
      .then((r) => r.json())
      .then((s) => (upd.textContent = timeAgo(s.last_update)))
      .catch(() => (upd.textContent = 'امروز'));
});
