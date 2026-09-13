'use strict';
/**
 * Instagram tab for the admin panel.
 *
 * Loaded after admin.js and reuses its $ / api / esc / toast helpers.
 * Slides are drawn by ig-studio.js; nothing leaves the browser until the
 * admin explicitly saves or publishes.
 */
// autoLog outlives a re-render: every autopilot action reloads the tab, which
// would otherwise throw away the run output the moment it arrived.
const igState = { post: null, canvases: [], autoLog: '' };

async function loadInsta() {
  const [status, picks, auto] = await Promise.all([
    api('/api/admin/ig/status'),
    api('/api/admin/ig/pick'),
    api('/api/admin/ig/auto'),
  ]);

  $('#tab-insta').innerHTML = `
    ${autoPanelHtml(auto)}

    <div class="panel">
      <h3>استودیو اینستاگرام
        <span class="sp">
          <span class="conn ${status.connected ? 'on' : 'off'}">${
            status.connected ? '● توکن API ذخیره است' : '● توکن API ندارد'
          }</span>
        </span>
      </h3>
      <div class="inner">
        <div class="row" style="margin-bottom:16px">
          <select class="fld" id="igPick" style="max-width:430px">
            ${picks.map((p) => `<option value="${esc(p.uid)}">${esc(p.title)} — ${esc(p.cat_name || '')}</option>`).join('')}
          </select>
          <button class="btn primary" id="igMake">ساخت پست</button>
          <button class="btn" id="igRandom">یک پرامپت تصادفی</button>
        </div>
        ${
          status.connected
            ? ''
            : `<p style="margin:0 0 14px;color:var(--muted);font-size:12.5px;line-height:2">
                این نشانه ربطی به لاگین بودنت در اینستاگرام ندارد — یعنی <b>سرور</b> هنوز توکن
                Graph API ندارد تا از طرف تو پست بگذارد. ساخت کپشن، اسلاید و
                <a class="srclink" href="/admin/kits">کیت پست</a> بدون آن هم کار می‌کند.
              </p>`
        }
        <div id="igOut" style="color:var(--dim);font-size:13px">
          یک پرامپت انتخاب کن و «ساخت پست» را بزن — کپشن فارسی، هشتگ‌ها و اسلایدهای کاروسل ساخته می‌شوند.
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>اتصال به حساب اینستاگرام</h3>
      <div class="inner editgrid" style="max-width:700px">
        <p style="margin:0;color:var(--muted);font-size:13px;line-height:2">
          انتشار خودکار فقط با حساب <b>Business</b> یا <b>Creator</b> که به یک صفحه فیسبوک وصل باشد کار می‌کند.
          در <a class="srclink" href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com</a>
          یک اپ بساز، دسترسی‌های <code>instagram_basic</code>، <code>instagram_content_publish</code> و
          <code>pages_show_list</code> را بگیر و توکن بلندمدت را اینجا وارد کن.
        </p>
        <div><label>Instagram User ID</label>
          <input class="fld" id="igUid" value="${esc(status.userId || '')}" placeholder="17841400000000000"></div>
        <div><label>Access Token (بلندمدت)</label>
          <input class="fld" id="igTok" type="password" placeholder="${status.connected ? 'ذخیره شده — برای تغییر، مقدار جدید بگذار' : 'EAAG...'}"></div>
        <div class="row">
          <button class="btn primary" id="igConnect">ذخیره و تست اتصال</button>
          <span id="igConnMsg" style="font-size:12.5px;color:var(--muted)"></span>
        </div>
      </div>
    </div>`;

  wireAutoPanel();
  $('#igMake').onclick = () => composeIg($('#igPick').value);
  $('#igRandom').onclick = () => composeIg(null);
  $('#igConnect').onclick = async () => {
    const msg = $('#igConnMsg');
    msg.style.color = 'var(--muted)';
    msg.textContent = 'در حال بررسی…';
    const r = await api('/api/admin/ig/connect', {
      method: 'POST',
      body: { userId: $('#igUid').value.trim(), token: $('#igTok').value.trim() },
    });
    if (r.error) {
      msg.style.color = '#fda4af';
      msg.textContent = r.error;
    } else {
      msg.style.color = 'var(--green)';
      msg.textContent = `وصل شد: @${r.account.username}` + (r.account.followers_count != null ? ` — ${r.account.followers_count} فالوور` : '');
      toast('حساب اینستاگرام وصل شد');
    }
  };
}

async function composeIg(uid) {
  const out = $('#igOut');
  out.innerHTML = '<div class="skeleton" style="height:200px"></div>';

  const post = await api('/api/admin/ig/compose' + (uid ? '?uid=' + encodeURIComponent(uid) : ''));
  if (post.error) {
    out.textContent = post.error;
    return;
  }
  igState.post = post;

  const over = post.caption_length > 2200;
  out.innerHTML = `
    <div class="ig-cols">
      <div>
        <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:8px">
          اسلایدهای کاروسل (${post.slides.length} تا — برای بزرگ‌نمایی روی هرکدام کلیک کن)
        </label>
        <div class="ig-slides" id="igSlides"></div>
        <div class="row" style="margin-top:6px">
          <button class="btn" id="igDownload">دانلود تصاویر</button>
          <button class="btn primary" id="igKit">ساخت لینک موبایل</button>
          <button class="btn" id="igPublish">انتشار مستقیم</button>
        </div>
        <div class="logbox" id="igLog" style="margin-top:14px;display:none"></div>
      </div>
      <div>
        <label style="font-size:12.5px;color:var(--muted);display:block;margin-bottom:8px">
          کپشن — <span style="color:${over ? '#fda4af' : 'var(--green)'}">${post.caption_length}</span> از ۲۲۰۰ کاراکتر مجاز
        </label>
        <textarea class="fld" id="igCaption" style="min-height:380px">${esc(post.caption)}</textarea>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="igCopyCap">کپی کپشن</button>
          <button class="btn" id="igCopyTags">کپی هشتگ‌ها</button>
        </div>
        <p style="font-size:12.5px;color:var(--dim);margin-top:12px;line-height:1.9">
          ${esc(post.best_time)}<br>
          لینک پرامپت: <a class="srclink" href="${esc(post.link)}" target="_blank" rel="noopener">${esc(post.link)}</a>
        </p>
      </div>
    </div>`;

  const holder = $('#igSlides');
  igState.canvases = await window.IGStudio.renderAll(post.slides);
  igState.canvases.forEach((c, i) => {
    c.title = `اسلاید ${i + 1}`;
    c.onclick = () => zoomSlide(c);
    holder.appendChild(c);
  });

  $('#igCopyCap').onclick = () => {
    navigator.clipboard.writeText($('#igCaption').value);
    toast('کپشن کپی شد');
  };
  $('#igCopyTags').onclick = () => {
    navigator.clipboard.writeText(post.first_comment);
    toast('هشتگ‌ها کپی شدند — می‌توانی در کامنت اول بگذاری');
  };
  $('#igDownload').onclick = () => {
    igState.canvases.forEach((c, i) => {
      const a = document.createElement('a');
      a.download = `${post.uid}-slide-${i + 1}.png`;
      a.href = c.toDataURL('image/png');
      a.click();
    });
    toast('تصاویر دانلود شدند');
  };
  $('#igKit').onclick = makeKit;
  $('#igPublish').onclick = () => {
    if (!confirm('این پست همین حالا روی صفحه اینستاگرام منتشر می‌شود. مطمئنی؟')) return;
    sendSlides('/api/admin/ig/publish');
  };
}

/**
 * The no-API handoff: park the render behind a private link and show a QR so
 * the post can be finished from the phone's own Instagram app.
 */
async function makeKit() {
  const log = $('#igLog');
  log.style.display = 'block';
  log.textContent = 'در حال آماده‌سازی تصاویر…';

  const images = window.IGStudio.toDataUrls(igState.canvases, 'image/jpeg');
  const r = await api('/api/admin/ig/kit', {
    method: 'POST',
    body: {
      uid: igState.post.uid,
      title: igState.post.title,
      caption: $('#igCaption').value,
      hashtags: igState.post.first_comment,
      images,
    },
  });
  if (r.error) {
    log.textContent = 'خطا: ' + r.error;
    toast(r.error, false);
    return;
  }

  log.innerHTML = '';
  log.style.display = 'none';
  const box = document.createElement('div');
  box.className = 'kitbox';
  box.innerHTML = `
    <div class="kitqr">${r.qr}</div>
    <div class="kitinfo">
      <b>لینک آماده است</b>
      <p>با دوربین گوشی QR را اسکن کن، یا لینک را برای خودت بفرست. در صفحه‌ای که باز می‌شود
         تصاویر را ذخیره می‌کنی و کپشن را با یک لمس کپی می‌کنی.</p>
      <input class="fld" id="kitUrl" readonly value="${esc(r.url)}">
      <div class="row" style="margin-top:10px">
        <button class="btn primary" id="kitCopy" type="button">کپی لینک</button>
        <a class="btn" href="${esc(r.url)}" target="_blank" rel="noopener">باز کردن</a>
        <span style="font-size:12px;color:var(--dim)">اعتبار: ${r.expiresInHours} ساعت</span>
      </div>
    </div>`;
  log.parentNode.insertBefore(box, log);
  $('#kitCopy').onclick = () => {
    const el = $('#kitUrl');
    el.select();
    navigator.clipboard.writeText(el.value);
    toast('لینک کپی شد');
  };
  toast('کیت پست ساخته شد');
}

function zoomSlide(canvas) {
  const wrap = document.createElement('div');
  wrap.className = 'zoomwrap';
  const img = new Image();
  img.src = canvas.toDataURL('image/png');
  img.alt = 'پیش‌نمایش اسلاید';
  wrap.appendChild(img);
  wrap.onclick = () => wrap.remove();
  document.body.appendChild(wrap);
}

async function sendSlides(endpoint) {
  const log = $('#igLog');
  log.style.display = 'block';
  log.textContent = 'در حال آماده‌سازی تصاویر…';

  const images = window.IGStudio.toDataUrls(igState.canvases, 'image/jpeg');
  const r = await api(endpoint, {
    method: 'POST',
    body: { uid: igState.post.uid, caption: $('#igCaption').value, images },
  });
  if (r.error) {
    log.textContent = 'خطا: ' + r.error;
    toast(r.error, false);
    return;
  }
  log.textContent = 'تصاویر ذخیره شدند:\n' + (r.images || []).join('\n');
  if (endpoint.endsWith('render-only')) {
    toast('تصاویر روی سرور ذخیره شدند');
    return;
  }

  toast('انتشار شروع شد…');
  const poll = setInterval(async () => {
    const s = await api('/api/admin/ig/status');
    log.textContent = s.job.log.join('\n');
    if (s.job.running) return;
    clearInterval(poll);
    if (s.job.error) toast(s.job.error, false);
    else if (s.job.result) {
      toast('پست منتشر شد ✓');
      if (s.job.result.permalink) log.textContent += '\n' + s.job.result.permalink;
    }
  }, 1800);
}

/* ------------------------------------------------------------------ *
 * Autopilot — the queue that runs without anyone watching
 * ------------------------------------------------------------------ */
const IG_STATUS_FA = {
  pending: ['در نوبت رندر', 'var(--muted)'],
  ready: ['آماده', 'var(--green)'],
  published: ['منتشر شد', 'var(--accent-2)'],
  posted: ['دستی پست شد', 'var(--accent-2)'],
  skipped: ['رد شد', 'var(--dim)'],
  failed: ['خطا', '#fda4af'],
  cancelled: ['لغو شد', 'var(--dim)'],
};

function igWhen(utc) {
  try {
    return new Date(utc.replace(' ', 'T') + 'Z').toLocaleString('fa-IR', {
      timeZone: 'Asia/Tehran',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return utc;
  }
}

function autoPanelHtml(a) {
  const rows = a.queue.filter((r) => r.status !== 'cancelled');
  const body = rows.length
    ? rows
        .map((r) => {
          const [label, color] = IG_STATUS_FA[r.status] || [r.status, 'var(--muted)'];
          const live = r.status === 'ready';
          return `<tr>
            <td style="white-space:nowrap;color:var(--dim);font-size:12px">${esc(igWhen(r.scheduled_at))}</td>
            <td>${esc(r.title)}</td>
            <td style="white-space:nowrap;color:${color};font-size:12.5px">${label}${
              r.error ? ` <span title="${esc(r.error)}">⚠</span>` : ''
            }</td>
            <td style="white-space:nowrap">${
              r.kit_url
                ? `<a class="srclink" href="${esc(r.kit_url)}" target="_blank" rel="noopener">کیت موبایل</a>`
                : '<span style="color:var(--dim)">—</span>'
            }</td>
            <td style="white-space:nowrap">${
              live
                ? `<button class="btn small" data-pub="${r.id}">انتشار API</button>
                   <button class="btn small" data-brpub="${r.id}">انتشار با مرورگر</button>
                   <button class="btn small" data-done="${r.id}">پست شد</button>
                   <button class="btn small" data-drop="${r.id}">حذف</button>`
                : ''
            }</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="5" style="color:var(--dim)">صف خالی است — «اجرای فوری» را بزن تا پر شود.</td></tr>';

  return `
    <div class="panel">
      <h3>خلبان خودکار
        <span class="sp">
          <span class="conn ${a.enabled ? 'on' : 'off'}">${a.enabled ? '● روشن' : '● خاموش'}</span>
        </span>
      </h3>
      <div class="inner">
        <p style="margin:0 0 14px;color:var(--muted);font-size:12.5px;line-height:2">
          هر ۲۰ دقیقه: یک پرامپت تازه انتخاب می‌شود، کپشن و ۶ اسلاید ساخته می‌شود، و کیت موبایلش آماده می‌شود.
          ${
            a.connected
              ? 'توکن API هست، پس سر ساعت خودش منتشر می‌کند.'
              : 'توکن API نیست، پس پست‌ها آماده می‌مانند تا از کیت یا دکمه‌ی انتشار بفرستی‌شان.'
          }
        </p>

        <div class="row" style="gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px">
          <div><label>وضعیت</label>
            <select class="fld" id="igAutoOn" style="max-width:130px">
              <option value="1" ${a.enabled ? 'selected' : ''}>روشن</option>
              <option value="0" ${a.enabled ? '' : 'selected'}>خاموش</option>
            </select></div>
          <div><label>پست در روز</label>
            <select class="fld" id="igAutoPer" style="max-width:100px">
              ${[1, 2, 3].map((n) => `<option value="${n}" ${a.per_day === n ? 'selected' : ''}>${n}</option>`).join('')}
            </select></div>
          <div><label>ساعت‌ها (تهران)</label>
            <input class="fld" id="igAutoSlots" style="max-width:150px" value="${esc((a.slots || []).join(','))}"
                   placeholder="21,13"></div>
          <div><label>انتشار خودکار با مرورگر</label>
            <select class="fld" id="igAutoBrowser" style="max-width:130px">
              <option value="1" ${a.browser_auto ? 'selected' : ''}>روشن</option>
              <option value="0" ${a.browser_auto ? '' : 'selected'}>خاموش</option>
            </select></div>
          <div><label>کمینه فاصله (ساعت)</label>
            <input class="fld" id="igAutoGap" style="max-width:110px" value="${esc(a.min_gap_hours || 6)}"></div>
          <button class="btn primary" id="igAutoSave">ذخیره</button>
          <button class="btn" id="igAutoRun">اجرای فوری</button>
          <span id="igAutoMsg" style="font-size:12.5px;color:var(--muted)"></span>
        </div>
        ${
          a.browser_auto && !a.connected
            ? `<p style="margin:0 0 14px;color:var(--gold);font-size:12px;line-height:1.9">
                انتشار خودکار با مرورگر روشن است: هر پست سر ساعت خودش از طریق پنجره‌ی کروم منتشر می‌شود،
                با کمینه ${esc(a.min_gap_hours || 6)} ساعت فاصله. پنجره‌ی ورود باید همیشه باز و لاگین بماند.
                این خلاف شرایط اینستاگرام است و ریسکش روی حساب توست.
              </p>`
            : ''
        }

        <div style="font-size:12px;color:var(--dim);margin-bottom:10px">
          کروم برای رندر: ${a.chrome ? '✔ پیدا شد' : '✘ پیدا نشد'} ·
          توکن API: ${a.connected ? '✔ هست' : '✘ نیست'} ·
          آخرین انتشار: ${a.last_post ? esc(igWhen(a.last_post.slice(0, 19).replace('T', ' '))) : '—'}
        </div>

        <div style="overflow-x:auto">
          <table>
            <thead><tr>
              <th>زمان</th><th>عنوان</th><th>وضعیت</th><th>کیت</th><th></th>
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        <div class="logbox" id="igAutoLog" style="margin-top:14px;display:${
          igState.autoLog ? 'block' : 'none'
        }">${esc(igState.autoLog)}</div>

        <div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--border)">
          <div class="row" style="justify-content:space-between;margin-bottom:8px">
            <b style="font-size:13.5px">انتشار از طریق مرورگر</b>
            <span id="igBrState" style="font-size:12.5px;color:var(--dim)">وضعیت نامشخص</span>
          </div>
          <p style="margin:0 0 12px;color:var(--muted);font-size:12.5px;line-height:2">
            وقتی توکن API نداری، سرور یک کروم واقعی باز می‌کند و پست را مثل یک آدم می‌گذارد.
            <b style="color:var(--gold)">این خلاف شرایط استفاده‌ی اینستاگرام است و ریسکش محدود شدن حساب است.</b>
            رمزت هیچ‌جا ذخیره نمی‌شود — یک بار در پنجره‌ای که باز می‌شود خودت وارد می‌شوی.
          </p>
          <div class="row">
            <button class="btn" id="igBrCheck">بررسی وضعیت ورود</button>
            <button class="btn" id="igBrLogin">باز کردن پنجره‌ی ورود</button>
          </div>
        </div>
      </div>
    </div>`;
}

function wireAutoPanel() {
  const msg = $('#igAutoMsg');
  const say = (t, bad) => {
    msg.style.color = bad ? '#fda4af' : 'var(--muted)';
    msg.textContent = t;
  };

  $('#igAutoSave').onclick = async () => {
    say('در حال ذخیره…');
    const r = await api('/api/admin/ig/auto', {
      method: 'POST',
      body: {
        enabled: $('#igAutoOn').value === '1',
        per_day: Number($('#igAutoPer').value),
        slots: $('#igAutoSlots').value.trim(),
        browser_auto: $('#igAutoBrowser').value === '1',
        min_gap_hours: Number($('#igAutoGap').value) || 6,
      },
    });
    if (r.error) return say(r.error, true);
    toast('تنظیمات ذخیره شد');
    loadInsta();
  };

  $('#igAutoRun').onclick = async () => {
    const box = $('#igAutoLog');
    box.style.display = 'block';
    box.textContent = 'در حال اجرا — رندر هر پست چند ثانیه طول می‌کشد…';
    say('');
    const r = await api('/api/admin/ig/auto/run', { method: 'POST' });
    igState.autoLog = (r.log || []).join('\n') || r.error || 'کاری برای انجام نبود.';
    if (r.error) say(r.error, true);
    else toast(`رندر ${r.rendered || 0} · کیت ${r.kits || 0} · انتشار ${r.published || 0}`);
    loadInsta();
  };

  /* Browser-route controls. The state check drives a real Chrome, so it is
   * slow enough to need its own "working…" text. */
  const brState = $('#igBrState');
  $('#igBrCheck').onclick = async () => {
    brState.style.color = 'var(--dim)';
    brState.textContent = 'در حال بررسی — کروم باز می‌شود…';
    const r = await api('/api/admin/ig/browser/state');
    if (r.error) {
      brState.style.color = '#fda4af';
      brState.textContent = r.error;
    } else if (r.challenge) {
      brState.style.color = '#fda4af';
      brState.textContent = 'اینستاگرام تأیید هویت می‌خواهد — پنجره را باز کن و رفعش کن';
    } else {
      brState.style.color = r.loggedIn ? 'var(--green)' : 'var(--gold)';
      brState.textContent = r.loggedIn ? '● لاگین است' : '● لاگین نیست';
    }
  };
  $('#igBrLogin').onclick = async () => {
    brState.style.color = 'var(--dim)';
    brState.textContent = 'در حال باز کردن پنجره…';
    const r = await api('/api/admin/ig/browser/login', { method: 'POST' });
    if (r.error) {
      brState.style.color = '#fda4af';
      brState.textContent = r.error;
      return;
    }
    brState.style.color = 'var(--muted)';
    brState.textContent = r.note;
    toast('پنجره روی دسکتاپ سرور باز شد');
  };

  // One handler for every row button; the table is rebuilt on each load.
  document.querySelectorAll('#tab-insta [data-pub],[data-brpub],[data-done],[data-drop]').forEach((btn) => {
    btn.onclick = async () => {
      const pub = btn.getAttribute('data-pub');
      const brpub = btn.getAttribute('data-brpub');
      const done = btn.getAttribute('data-done');
      const drop = btn.getAttribute('data-drop');
      btn.disabled = true;
      say(pub || brpub ? 'در حال انتشار…' : 'ثبت می‌شود…');

      const r = pub
        ? await api('/api/admin/ig/auto/publish/' + pub, { method: 'POST' })
        : brpub
          ? await api('/api/admin/ig/browser/publish/' + brpub, { method: 'POST' })
          : done
            ? await api('/api/admin/ig/auto/done/' + done, { method: 'POST' })
            : await api('/api/admin/ig/auto/' + drop, { method: 'DELETE' });

      if (r.log) igState.autoLog = r.log.join('\n');

      if (r.error) {
        // The status line sits above the table; with several rows on screen a
        // message up there is easy to miss, so the toast carries it too.
        say(r.error, true);
        toast(r.error, false);
        btn.disabled = false;
        return;
      }
      toast(pub || brpub ? 'منتشر شد' : done ? 'ثبت شد' : 'حذف شد');
      loadInsta();
    };
  });
}
