'use strict';

const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fa = (n) => String(n == null ? 0 : n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const num = (n) => fa(Number(n || 0).toLocaleString('en-US').replace(/,/g, '٬'));

async function api(url, opts = {}) {
  const r = await fetch(url, {
    credentials: 'same-origin',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  return r.json();
}

function toast(msg, ok = true) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.borderColor = ok ? 'var(--green)' : '#fb7185';
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2400);
}

const dateFa = (iso) => (iso ? new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/* ------------------------------------------------------------------ *
 * auth
 * ------------------------------------------------------------------ */
function showLogin() {
  $('#login').classList.remove('hidden');
  $('#panel').classList.add('hidden');
}
function showPanel() {
  $('#login').classList.add('hidden');
  $('#panel').classList.remove('hidden');
  loadDash();
}

async function doLogin() {
  const r = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: $('#pw').value }),
  }).then((x) => x.json());
  if (r.ok) showPanel();
  else $('#loginErr').textContent = r.error || 'ورود ناموفق';
}

/* ------------------------------------------------------------------ *
 * dashboard
 * ------------------------------------------------------------------ */
async function loadDash() {
  const d = await api('/api/admin/overview');
  $('#tab-dash').innerHTML = `
    <div class="kpis">
      <div class="kpi"><b>${num(d.prompts)}</b><span>کل پرامپت‌ها</span></div>
      <div class="kpi g"><b>${num(d.published)}</b><span>منتشرشده</span></div>
      <div class="kpi"><b>${num(d.hidden)}</b><span>مخفی</span></div>
      <div class="kpi y"><b>${num(d.featured)}</b><span>منتخب</span></div>
      <div class="kpi a"><b>${num(d.views)}</b><span>بازدید</span></div>
      <div class="kpi a"><b>${num(d.copies)}</b><span>کپی</span></div>
      <div class="kpi"><b>${fa(d.sources_ok)}/${fa(d.sources)}</b><span>منابع سالم</span></div>
    </div>

    <div class="panel">
      <h3>وضعیت به‌روزرسانی خودکار
        <span class="sp">
          <span class="badge-s">آخرین اجرا: ${dateFa(d.last_scrape)}</span>
          <span class="badge-s">هر ${fa(d.auto_hours)} ساعت</span>
          <button class="btn primary" id="runNow">اجرای دستی اسکرپر</button>
        </span>
      </h3>
      <div class="inner"><div class="logbox" id="jobLog">آماده. برای گردآوری پرامپت‌های تازه از همه منابع فعال، دکمه بالا را بزن.</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:22px" class="dash-cols">
      <div class="panel">
        <h3>پرامپت‌ها بر اساس دسته</h3>
        <div class="inner tbl-scroll"><table><tbody>
          ${d.by_category
            .filter((c) => c.n)
            .map(
              (c) =>
                `<tr><td>${esc(c.name_fa)}</td><td style="width:60%">
                  <div style="background:#ffffff0d;height:7px;border-radius:99px;overflow:hidden">
                    <div style="height:100%;width:${Math.round((c.n / d.by_category[0].n) * 100)}%;background:linear-gradient(90deg,var(--accent),var(--accent-2))"></div>
                  </div></td><td style="text-align:left;color:var(--muted)">${fa(c.n)}</td></tr>`
            )
            .join('')}
        </tbody></table></div>
      </div>

      <div class="panel">
        <h3>سهم هر منبع</h3>
        <div class="inner tbl-scroll"><table><tbody>
          ${d.by_source
            .map(
              (s) =>
                `<tr><td><span class="dot-s ${esc(s.last_status || 'none')}"></span>${esc(s.name)}</td>
                 <td><a class="srclink" href="${esc(s.home_url)}" target="_blank" rel="noopener">${esc(s.home_url)}</a></td>
                 <td style="text-align:left;color:var(--muted)">${fa(s.n)}</td></tr>`
            )
            .join('')}
        </tbody></table></div>
      </div>
    </div>`;

  $('#runNow').onclick = startScrape;
}

/* ------------------------------------------------------------------ *
 * scraper job
 * ------------------------------------------------------------------ */
let pollTimer = null;
async function startScrape(keys) {
  const r = await api('/api/admin/scrape', { method: 'POST', body: { keys: Array.isArray(keys) ? keys : [] } });
  if (r.error) return toast(r.error, false);
  toast('اسکرپر شروع شد…');
  pollJob();
}
async function pollJob() {
  clearInterval(pollTimer);
  const tick = async () => {
    const s = await api('/api/admin/scrape/status');
    const box = $('#jobLog') || $('#jobLog2');
    if (box) {
      box.textContent = s.log.join('\n') || 'در حال شروع…';
      box.scrollTop = box.scrollHeight;
    }
    if (!s.running) {
      clearInterval(pollTimer);
      if (s.result) toast(`تمام شد — ${fa(s.result.added)} پرامپت جدید اضافه شد`);
      if (!$('#tab-dash').classList.contains('hidden')) loadDash();
    }
  };
  await tick();
  pollTimer = setInterval(tick, 1500);
}

/* ------------------------------------------------------------------ *
 * prompts tab (source links visible here — admin only)
 * ------------------------------------------------------------------ */
const pState = { page: 1, q: '', source: '', cat: '', status: '' };

async function loadPrompts() {
  const qs = new URLSearchParams({ page: pState.page, per: 30 });
  ['q', 'source', 'cat', 'status'].forEach((k) => pState[k] && qs.set(k, pState[k]));
  const [d, srcs] = await Promise.all([api('/api/admin/prompts?' + qs), api('/api/admin/sources')]);

  $('#tab-prompts').innerHTML = `
    <div class="panel">
      <h3>مدیریت پرامپت‌ها <span class="sp"><span class="badge-s">${num(d.total)} مورد</span></span></h3>
      <div class="inner">
        <div class="row" style="margin-bottom:16px">
          <input class="fld" id="pq" style="max-width:280px" placeholder="جستجو در عنوان، متن یا لینک منبع…" value="${esc(pState.q)}">
          <select class="fld" id="psrc" style="max-width:230px">
            <option value="">همه منابع</option>
            ${srcs.map((s) => `<option value="${esc(s.key)}" ${pState.source === s.key ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select>
          <select class="fld" id="pstatus" style="max-width:150px">
            <option value="">همه وضعیت‌ها</option>
            <option value="published" ${pState.status === 'published' ? 'selected' : ''}>منتشرشده</option>
            <option value="hidden" ${pState.status === 'hidden' ? 'selected' : ''}>مخفی</option>
          </select>
        </div>

        <div class="tbl-scroll"><table>
          <thead><tr>
            <th>عنوان</th><th>دسته</th><th>منبع اصلی (فقط ادمین)</th>
            <th>کیفیت</th><th>آمار</th><th>وضعیت</th><th></th>
          </tr></thead>
          <tbody>${d.items
            .map(
              (p) => `<tr data-id="${p.id}">
                <td style="max-width:280px">
                  <div style="font-weight:600">${esc(p.title)}</div>
                  <div style="font-size:11.5px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:270px">${esc(p.excerpt)}</div>
                </td>
                <td style="white-space:nowrap">${esc(p.cat_name || '—')}</td>
                <td>
                  <div style="font-size:11.5px;color:var(--muted)">${esc(p.source_name || '—')}</div>
                  <a class="srclink" href="${esc(p.source_url)}" target="_blank" rel="noopener">${esc(p.source_url)}</a>
                </td>
                <td>${fa(p.quality)}٪</td>
                <td style="white-space:nowrap;color:var(--muted);font-size:11.5px">◉ ${fa(p.views)} · ⧉ ${fa(p.copies)}</td>
                <td><span class="badge-s ${p.status === 'published' ? 'pub' : 'hid'}">${p.status === 'published' ? 'منتشر' : 'مخفی'}</span>
                    ${p.featured ? '<span class="badge-s" style="color:var(--gold)">★</span>' : ''}</td>
                <td style="white-space:nowrap">
                  <button class="btn" data-act="edit">ویرایش</button>
                  <button class="btn" data-act="feat">${p.featured ? 'حذف منتخب' : 'منتخب'}</button>
                  <button class="btn" data-act="toggle">${p.status === 'published' ? 'مخفی' : 'انتشار'}</button>
                  <button class="btn danger" data-act="del">حذف</button>
                </td>
              </tr>`
            )
            .join('')}</tbody>
        </table></div>

        <div class="pager" id="ppager" style="margin:22px 0 0">
          ${Array.from({ length: Math.min(d.pages, 12) }, (_, i) => i + 1)
            .map((n) => `<button class="${n === d.page ? 'on' : ''}" data-p="${n}">${fa(n)}</button>`)
            .join('')}
          ${d.pages > 12 ? `<button data-p="${d.pages}">${fa(d.pages)} ‹آخر</button>` : ''}
        </div>
      </div>
    </div>`;

  let t;
  $('#pq').oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      pState.q = e.target.value.trim();
      pState.page = 1;
      loadPrompts();
    }, 350);
  };
  $('#psrc').onchange = (e) => {
    pState.source = e.target.value;
    pState.page = 1;
    loadPrompts();
  };
  $('#pstatus').onchange = (e) => {
    pState.status = e.target.value;
    pState.page = 1;
    loadPrompts();
  };
  $('#ppager').onclick = (e) => {
    const b = e.target.closest('button[data-p]');
    if (b) {
      pState.page = Number(b.dataset.p);
      loadPrompts();
    }
  };
  $('#tab-prompts').querySelector('tbody').onclick = async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('tr').dataset.id;
    const row = d.items.find((x) => String(x.id) === id);
    if (btn.dataset.act === 'edit') return openEditor(id);
    if (btn.dataset.act === 'del') {
      if (!confirm('این پرامپت برای همیشه حذف شود؟')) return;
      await api('/api/admin/prompts/' + id, { method: 'DELETE' });
      toast('حذف شد');
    } else if (btn.dataset.act === 'feat') {
      await api('/api/admin/prompts/' + id, { method: 'PATCH', body: { featured: !row.featured } });
      toast('بروزرسانی شد');
    } else if (btn.dataset.act === 'toggle') {
      await api('/api/admin/prompts/' + id, {
        method: 'PATCH',
        body: { status: row.status === 'published' ? 'hidden' : 'published' },
      });
      toast('وضعیت تغییر کرد');
    }
    loadPrompts();
  };
}

async function openEditor(id) {
  const p = await api('/api/admin/prompts/' + id);
  $('#overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  $('#sheet').innerHTML = `
    <div class="sh-head">
      <button class="close-x" id="cx">✕</button>
      <h2>ویرایش پرامپت</h2>
      <div class="kv">
        <span class="pill">${esc(p.source_name || '—')}</span>
        <span class="pill">کیفیت ${fa(p.quality)}٪</span>
        <span class="pill">${esc(p.difficulty)}</span>
      </div>
      <p style="margin:12px 0 0;font-size:12.5px">
        <span style="color:var(--dim)">لینک منبع (فقط در پنل دیده می‌شود): </span>
        <a class="srclink" href="${esc(p.source_url)}" target="_blank" rel="noopener">${esc(p.source_url)}</a>
      </p>
    </div>
    <div class="sh-body editgrid">
      <div><label>عنوان</label><input class="fld" id="eTitle" value="${esc(p.title)}"></div>
      <div><label>خلاصه (کاربر می‌بیند)</label><textarea class="fld" id="eSummary" style="min-height:80px">${esc(p.summary)}</textarea></div>
      <div><label>متن پرامپت</label><textarea class="fld mono" id="eBody" style="min-height:220px;direction:ltr;text-align:left">${esc(p.body)}</textarea></div>
      <div><label>آموزش استفاده (کاربر می‌بیند)</label><textarea class="fld" id="eHow" style="min-height:200px">${esc(p.how_to)}</textarea></div>
      <div><label>نمونه استفاده</label><textarea class="fld" id="eEx" style="min-height:100px">${esc(p.example_use)}</textarea></div>
      <div class="row">
        <div style="flex:1"><label>کیفیت (٪)</label><input class="fld" id="eQ" type="number" min="1" max="99" value="${p.quality}"></div>
        <div style="flex:1"><label>سطح</label>
          <select class="fld" id="eDiff">
            ${['easy', 'medium', 'advanced'].map((x) => `<option ${p.difficulty === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select></div>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn primary" id="eSave">ذخیره تغییرات</button>
        <button class="btn" id="eCancel">انصراف</button>
      </div>
    </div>`;
  const close = () => {
    $('#overlay').classList.remove('open');
    document.body.style.overflow = '';
  };
  $('#cx').onclick = close;
  $('#eCancel').onclick = close;
  $('#eSave').onclick = async () => {
    await api('/api/admin/prompts/' + id, {
      method: 'PATCH',
      body: {
        title: $('#eTitle').value,
        summary: $('#eSummary').value,
        body: $('#eBody').value,
        how_to: $('#eHow').value,
        example_use: $('#eEx').value,
        quality: Number($('#eQ').value),
        difficulty: $('#eDiff').value,
      },
    });
    toast('ذخیره شد');
    close();
    loadPrompts();
  };
}

/* ------------------------------------------------------------------ *
 * sources tab
 * ------------------------------------------------------------------ */
async function loadSources() {
  const [srcs, runs] = await Promise.all([api('/api/admin/sources'), api('/api/admin/runs')]);
  $('#tab-sources').innerHTML = `
    <div class="panel">
      <h3>منابع اسکرپینگ
        <span class="sp">
          <span class="badge-s">${fa(srcs.length)} منبع</span>
          <button class="btn primary" id="runAll">اجرای همه</button>
        </span>
      </h3>
      <div class="inner">
        <div class="tbl-scroll"><table>
          <thead><tr><th>فعال</th><th>منبع</th><th>آدرس</th><th>نوع</th><th>اعتبار</th><th>پرامپت</th><th>آخرین اجرا</th><th></th></tr></thead>
          <tbody>${srcs
            .map(
              (s) => `<tr data-id="${s.id}" data-key="${esc(s.key)}">
                <td><button class="sw ${s.enabled ? 'on' : ''}" data-act="toggle"></button></td>
                <td style="font-weight:600;white-space:nowrap">${esc(s.name)}</td>
                <td><a class="srclink" href="${esc(s.home_url)}" target="_blank" rel="noopener">${esc(s.home_url)}</a></td>
                <td><span class="badge-s">${esc(s.kind)}</span></td>
                <td>${fa(s.trust)}</td>
                <td>${fa(s.prompt_count)}</td>
                <td style="white-space:nowrap;font-size:11.5px;color:var(--muted)">
                  <span class="dot-s ${esc(s.last_status || 'none')}"></span>${dateFa(s.last_run_at)}
                  ${s.last_error ? `<div style="color:#fda4af;max-width:220px;overflow:hidden;text-overflow:ellipsis">${esc(s.last_error)}</div>` : ''}
                </td>
                <td><button class="btn" data-act="run">اجرا</button></td>
              </tr>`
            )
            .join('')}</tbody>
        </table></div>
        <div class="logbox" id="jobLog2" style="margin-top:18px">گزارش اجرا اینجا نمایش داده می‌شود.</div>
      </div>
    </div>

    <div class="panel">
      <h3>تاریخچه اجراها</h3>
      <div class="inner tbl-scroll"><table>
        <thead><tr><th>منبع</th><th>شروع</th><th>وضعیت</th><th>یافت‌شده</th><th>جدید</th><th>بروزشده</th><th>خطا</th></tr></thead>
        <tbody>${runs
          .map(
            (r) => `<tr>
              <td>${esc(r.source_name || '—')}</td>
              <td style="white-space:nowrap;font-size:11.5px;color:var(--muted)">${dateFa(r.started_at)}</td>
              <td><span class="badge-s ${r.status === 'ok' ? 'pub' : r.status === 'error' ? 'hid' : ''}">${esc(r.status)}</span></td>
              <td>${fa(r.found)}</td><td style="color:var(--green)">${fa(r.added)}</td><td>${fa(r.updated)}</td>
              <td style="max-width:260px;font-size:11.5px;color:#fda4af;overflow:hidden;text-overflow:ellipsis">${esc(r.error || '')}</td>
            </tr>`
          )
          .join('')}</tbody>
      </table></div>
    </div>`;

  $('#runAll').onclick = () => startScrape([]);
  $('#tab-sources').querySelector('tbody').onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const tr = btn.closest('tr');
    if (btn.dataset.act === 'run') return startScrape([tr.dataset.key]);
    const on = btn.classList.toggle('on');
    await api('/api/admin/sources/' + tr.dataset.id, { method: 'PATCH', body: { enabled: on } });
    toast(on ? 'منبع فعال شد' : 'منبع غیرفعال شد');
  };
}

/* ------------------------------------------------------------------ *
 * settings tab
 * ------------------------------------------------------------------ */
async function loadSettings() {
  const d = await api('/api/admin/overview');
  $('#tab-settings').innerHTML = `
    <div class="panel" style="max-width:620px">
      <h3>به‌روزرسانی خودکار</h3>
      <div class="inner editgrid">
        <div>
          <label>هر چند ساعت یک‌بار همه منابع دوباره اسکرپ شوند؟ (۰ = غیرفعال)</label>
          <input class="fld" id="sHours" type="number" min="0" max="168" value="${d.auto_hours}">
        </div>
        <div><button class="btn primary" id="sSave">ذخیره</button></div>
      </div>
    </div>

    <div class="panel" style="max-width:620px">
      <h3>تغییر رمز عبور</h3>
      <div class="inner editgrid">
        <div><label>رمز جدید (حداقل ۶ کاراکتر)</label><input class="fld" id="sPw" type="password" placeholder="••••••••"></div>
        <div><button class="btn primary" id="sPwSave">تغییر رمز</button></div>
      </div>
    </div>

    <div class="panel" style="max-width:620px">
      <h3>درباره حریم لینک‌ها</h3>
      <div class="inner" style="font-size:13.2px;color:var(--muted);line-height:2">
        لینک منبع هر پرامپت (<code>source_url</code>) فقط از طریق مسیرهای <code>/api/admin/*</code> برگردانده می‌شود
        و در هیچ‌کدام از پاسخ‌های عمومی سایت وجود ندارد — نه در فهرست، نه در صفحه جزئیات، نه در HTML.
        کاربر عادی متن پرامپت و آموزش فارسی را می‌بیند؛ مسیر منبع فقط برای شما قابل مشاهده است.
      </div>
    </div>`;

  $('#sSave').onclick = async () => {
    await api('/api/admin/settings', { method: 'POST', body: { auto_hours: Number($('#sHours').value) } });
    toast('ذخیره شد');
  };
  $('#sPwSave').onclick = async () => {
    const r = await api('/api/admin/password', { method: 'POST', body: { password: $('#sPw').value } });
    r.ok ? toast('رمز تغییر کرد') : toast(r.error, false);
  };
}

/* ------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', async () => {
  $('#loginBtn').onclick = doLogin;
  $('#pw').addEventListener('keydown', (e) => e.key === 'Enter' && doLogin());

  $('.tabs').addEventListener('click', async (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    if (t.id === 'logout') {
      await api('/api/admin/logout', { method: 'POST' });
      return location.reload();
    }
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
    t.classList.add('on');
    ['dash', 'prompts', 'sources', 'insta', 'settings'].forEach((n) =>
      $('#tab-' + n).classList.toggle('hidden', n !== t.dataset.tab)
    );
    ({ dash: loadDash, prompts: loadPrompts, sources: loadSources, insta: loadInsta, settings: loadSettings }[t.dataset.tab])();
  });

  $('#overlay').addEventListener('click', (e) => {
    if (e.target.id === 'overlay') {
      $('#overlay').classList.remove('open');
      document.body.style.overflow = '';
    }
  });

  try {
    const me = await fetch('/api/admin/me', { credentials: 'same-origin' });
    me.ok ? showPanel() : showLogin();
  } catch {
    showLogin();
  }
});
