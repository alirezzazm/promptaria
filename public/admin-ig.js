'use strict';
/**
 * Instagram tab for the admin panel.
 *
 * Loaded after admin.js and reuses its $ / api / esc / toast helpers.
 * Slides are drawn by ig-studio.js; nothing leaves the browser until the
 * admin explicitly saves or publishes.
 */
const igState = { post: null, canvases: [] };

async function loadInsta() {
  const [status, picks] = await Promise.all([api('/api/admin/ig/status'), api('/api/admin/ig/pick')]);

  $('#tab-insta').innerHTML = `
    <div class="panel">
      <h3>استودیو اینستاگرام
        <span class="sp">
          <span class="conn ${status.connected ? 'on' : 'off'}">${status.connected ? '● حساب وصل است' : '● حساب وصل نیست'}</span>
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
