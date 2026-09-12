'use strict';
/**
 * Posting to Instagram by driving a real Chrome, the way a person would.
 *
 * This is the fallback for not having a Graph API token, and it is worth being
 * clear about what it is: automating instagram.com is against Instagram's
 * terms, and the account carries the risk. The Graph API remains the right
 * answer; this exists because the Graph API needs a Meta app, and that needs a
 * Facebook account.
 *
 * Two deliberate choices limit the damage:
 *
 *   * **No password is ever stored or seen by this code.** Signing in happens
 *     once, by hand, in a visible Chrome window; the session then lives in the
 *     profile directory like any normal browser session.
 *   * **Nothing is randomised to look human.** There is no attempt to evade
 *     detection — the flow clicks the same buttons a person clicks, and if
 *     Instagram blocks it, it reports that rather than working around it.
 *
 * The selectors are the fragile part. Instagram's class names are generated,
 * so every step matches on visible text or role and each failure names the
 * step it died on.
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const cdp = require('./cdp');

const PROFILE_DIR = process.env.IG_PROFILE_DIR || 'C:\\ProgramData\\promptaria\\chrome-profile';
const LOGIN_REQUEST = 'C:\\ProgramData\\promptaria\\login-request.json';
const MEDIA_DIR = path.join(__dirname, '..', 'public', 'ig');

const setting = (k, d = null) => {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
  return r ? r.value : d;
};
const port = () => Number(setting('ig_cdp_port', '9222')) || 9222;
const wait = cdp.wait;

/* ------------------------------------------------------------------ *
 * Session
 * ------------------------------------------------------------------ */
/**
 * Whether instagram.com considers this profile signed in.
 *
 * The reliable marker is the nav rail, which only renders for a session; the
 * login form's presence is the negative case.
 */
async function loginState(log = () => {}) {
  const run = await cdp.launch({ port: port(), profileDir: PROFILE_DIR, headless: true });
  const s = await cdp.attach(port());
  try {
    await s.navigate('https://www.instagram.com/');
    await wait(4000);
    const info = await s.eval(`(() => {
      const t = document.body ? document.body.innerText : '';
      return JSON.stringify({
        url: location.href,
        hasLoginForm: !!document.querySelector('input[name="username"]'),
        hasNav: !!document.querySelector('nav, [role="navigation"]'),
        hasCreate: /Create|ایجاد/.test(t),
        challenge: /challenge|suspended|disabled|confirm it.s you/i.test(t + location.href),
      });
    })()`);
    const st = JSON.parse(info || '{}');
    log(`instagram.com → ${st.url}`);
    return {
      loggedIn: Boolean(!st.hasLoginForm && st.hasNav),
      challenge: Boolean(st.challenge),
      url: st.url,
    };
  } finally {
    s.close();
    await release(run);
  }
}

/**
 * Lets go of the profile once a headless run is over.
 *
 * Leaving headless Chrome running looked like a cheap speed-up and was the bug:
 * it held the profile, so the sign-in window could never open. A visible window
 * is left alone — that one belongs to the user.
 */
async function release(run) {
  if (run && run.headless) await cdp.closeBrowser(port());
}

/**
 * Asks for a visible Chrome window so the sign-in can be done by hand.
 *
 * A process started by a service lives in session 0 and its windows are
 * invisible to whoever is signed in, so the window has to be opened from an
 * interactive session — the same problem, and the same fix, as the scrap
 * panel's sign-in button.
 */
async function requestLoginWindow() {
  // Free the profile first, or the window hands its URL to an invisible
  // headless instance and never appears. The .ps1 does this too; doing it
  // here as well means a slow task start cannot race a fresh headless launch.
  await cdp.stopProfile(PROFILE_DIR);
  fs.mkdirSync(path.dirname(LOGIN_REQUEST), { recursive: true });
  fs.writeFileSync(
    LOGIN_REQUEST,
    JSON.stringify({ url: 'https://www.instagram.com/accounts/login/', profile_dir: PROFILE_DIR }, null, 2),
    'utf8'
  );
  return { profileDir: PROFILE_DIR, requestFile: LOGIN_REQUEST };
}

/* ------------------------------------------------------------------ *
 * Posting
 * ------------------------------------------------------------------ */
/** Clicks the first visible element whose text matches, and says whether it found one. */
const CLICK_BY_TEXT = (patterns) => `(() => {
  const want = [${patterns.map((p) => JSON.stringify(p)).join(',')}];
  const els = [...document.querySelectorAll('button,div[role="button"],a[role="link"],span[role="button"]')];
  for (const el of els) {
    const t = (el.innerText || el.textContent || '').trim();
    if (!t || t.length > 40) continue;
    if (!want.some((w) => t === w || t.toLowerCase() === w.toLowerCase())) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    el.click();
    return t;
  }
  return null;
})()`;

const NEXT = ['Next', 'بعدی', 'ادامه'];
const SHARE = ['Share', 'اشتراک‌گذاری', 'اشتراک گذاری', 'همرسانی'];

/**
 * Runs the whole create flow for one queued post.
 *
 * `imagePaths` are local files; Instagram's uploader is a plain file input, so
 * CDP can hand them over directly and no dialog is involved.
 */
async function publish({ imagePaths, caption }, log = () => {}) {
  for (const p of imagePaths) if (!fs.existsSync(p)) throw new Error('فایل تصویر نیست: ' + path.basename(p));

  const run = await cdp.launch({ port: port(), profileDir: PROFILE_DIR, headless: true });
  const s = await cdp.attach(port());

  try {
    log('باز کردن اینستاگرام…');
    await s.navigate('https://www.instagram.com/');
    await wait(4000);

    const signedIn = await s.eval(
      `!document.querySelector('input[name="username"]') && !!document.querySelector('nav, [role="navigation"]')`
    );
    if (!signedIn) throw new Error('این پروفایل کروم به اینستاگرام لاگین نیست — اول دکمه‌ی ورود را بزن');

    log('باز کردن صفحه‌ی ساخت پست…');
    await s.navigate('https://www.instagram.com/create/style/');
    await wait(3500);

    log('دادن تصاویر به آپلودر…');
    await s.until(`!!document.querySelector('input[type="file"]')`, {
      timeoutMs: 20000,
      what: 'ورودی فایل',
    });
    await s.setFiles('input[type="file"]', imagePaths);
    await wait(1500);

    // Our slides are 4:5; the cropper opens at 1:1 and would cut them.
    log('تنظیم نسبت تصویر روی ۴:۵…');
    try {
      await s.eval(`(() => {
        const btn = document.querySelector('[aria-label="Select crop"], [aria-label="انتخاب برش"]');
        if (btn) btn.click();
        return !!btn;
      })()`);
      await wait(900);
      const picked = await s.eval(CLICK_BY_TEXT(['Original', 'اصلی', '4:5']));
      log(picked ? `  نسبت: ${picked}` : '  دکمه‌ی برش پیدا نشد — با نسبت پیش‌فرض ادامه می‌دهم');
      await wait(800);
    } catch (e) {
      log('  برش رد شد: ' + e.message);
    }

    // Crop → Edit → Caption. Two "Next" screens, occasionally three.
    for (let i = 0; i < 3; i++) {
      const hit = await s.eval(CLICK_BY_TEXT(NEXT));
      if (!hit) break;
      log(`«${hit}»`);
      await wait(2500);
      const atCaption = await s.eval(
        `!!document.querySelector('textarea[aria-label], div[contenteditable="true"][role="textbox"]')`
      );
      if (atCaption) break;
    }

    log('نوشتن کپشن…');
    const focused = await s.eval(`(() => {
      const el = document.querySelector('div[contenteditable="true"][role="textbox"], textarea[aria-label]');
      if (!el) return false;
      el.focus();
      return true;
    })()`);
    if (!focused) throw new Error('جعبه‌ی کپشن پیدا نشد — احتمالاً ظاهر اینستاگرام عوض شده');
    await s.type(caption);
    await wait(1200);

    log('انتشار…');
    const shared = await s.eval(CLICK_BY_TEXT(SHARE));
    if (!shared) throw new Error('دکمه‌ی انتشار پیدا نشد');

    // The confirmation panel is the only trustworthy signal; a spinner is not.
    const ok = await s.until(
      `/Your post has been shared|Post shared|پست شما به اشتراک گذاشته شد|منتشر شد/i.test(document.body.innerText)`,
      { timeoutMs: 120000, everyMs: 1500, what: 'تأیید انتشار' }
    );
    log('اینستاگرام انتشار را تأیید کرد ✔');
    return { ok: true, confirmation: String(ok).slice(0, 80) };
  } finally {
    s.close();
    await release(run);
  }
}

/** Local file paths for a queue row's already-rendered slides. */
function pathsFor(imageUrls) {
  return JSON.parse(imageUrls).map((u) => path.join(MEDIA_DIR, u.split('/').pop()));
}

module.exports = { loginState, requestLoginWindow, publish, pathsFor, PROFILE_DIR, LOGIN_REQUEST };
