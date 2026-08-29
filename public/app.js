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
const DIFF_FA = { easy: 'ساده', medium: 'متوسط', advanced: 'پیشرفته' };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      el.textContent = Math.round(to * eased).toLocaleString('en-US');
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = to.toLocaleString('en-US');
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
<article class="card${p.featured ? ' feat' : ''}">
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
      ${p.featured ? '<span class="pill gold">★ منتخب</span>' : ''}
      <span class="stat-mini">⧉ ${FA(p.copies)} · ◉ ${FA(p.views)}</span>
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
        ? `<b>${FA(d.total.toLocaleString('en-US'))}</b> پرامپت${state.q ? ` برای «${esc(state.q)}»` : ''}`
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

/* ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  wireCopy();
  wireCatalog();
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
