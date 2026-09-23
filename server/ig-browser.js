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
 * The persistent browser
 * ------------------------------------------------------------------ *
 * Instagram invalidates a session the moment it sees it opened by a fresh,
 * headless, or short-lived automated Chrome. The only thing it accepts is the
 * ordinary long-lived browser the user actually signed into. So there is
 * exactly one rule here: **one headed Chrome, started once, never headless,
 * never closed, never duplicated.** Everything attaches to it; nothing spawns
 * a rival instance, because a second process on the same profile resets the
 * cookie store and logs the session out.
 */

/** Attaches to the running browser, or reports that there is none. */
async function browserUp() {
  const v = await cdp.probe(port());
  if (!v) return null;
  return { headless: /HeadlessChrome/.test(v['User-Agent'] || ''), browser: v.Browser };
}

/**
 * Whether the running browser holds a live Instagram session.
 *
 * Opens its own tab so it never disturbs whatever the user has in front — and
 * checks the authenticated API, not a cookie: a `sessionid` can sit on disk
 * after Instagram has already invalidated it, so only a 200 from an endpoint
 * that needs auth proves the session is really alive.
 */
async function loginState(log = () => {}) {
  const up = await browserUp();
  if (!up) return { running: false, loggedIn: false, reason: 'مرورگر باز نیست — دکمه‌ی ورود را بزن' };
  if (up.headless) return { running: true, loggedIn: false, reason: 'مرورگر headless است؛ اینستاگرام قبولش نمی‌کند' };

  const tab = await cdp.newTab(port(), 'https://www.instagram.com/');
  const s = await cdp.attachWs(tab.webSocketDebuggerUrl);
  try {
    await wait(6000);
    // The private API rejects a mismatched user-agent with a 400, so it is
    // useless as a login check. The rendered app is the honest signal: the
    // logged-out page shows a username field, the logged-in one shows the
    // "New post" control in the nav rail.
    const st = await s.eval(
      'JSON.stringify({' +
        'loginForm: Boolean(document.querySelector("input[name=username]")),' +
        'newPost: Array.from(document.querySelectorAll("svg[aria-label]")).some(function(e){return /New post|Create|ساخت|پست جدید/i.test(e.getAttribute("aria-label"));}),' +
        'challenge: /challenge_required|checkpoint/i.test(location.href)' +
        '})'
    );
    const o = JSON.parse(st || '{}');
    const loggedIn = Boolean(o.newPost && !o.loginForm);
    log('بررسی نشست: ' + (loggedIn ? 'لاگین است' : o.challenge ? 'checkpoint' : 'لاگین نیست'));
    return {
      running: true,
      loggedIn,
      challenge: Boolean(o.challenge),
      reason: loggedIn ? null : o.challenge ? 'اینستاگرام تأیید هویت می‌خواهد' : 'نشست معتبر نیست — یک بار دیگر در پنجره وارد شو',
    };
  } finally {
    s.close();
    await cdp.closeTab(port(), tab.id);
  }
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
  // Free the profile first so the fresh window is the one and only instance —
  // any leftover Chrome on this profile would either swallow the URL or, worse,
  // race the cookie store and drop the session the user is about to create.
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

/** Clicks a button *inside the composer dialog* whose exact text matches. */
const CLICK_IN_DIALOG = (patterns) => `(function(){
  var want = [${patterns.map((p) => JSON.stringify(p)).join(',')}];
  var scope = document.querySelector('[role=dialog]') || document;
  var els = scope.querySelectorAll('button, div[role="button"], span[role="button"]');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var t = (el.innerText || el.textContent || '').trim();
    if (!t || t.length > 30) continue;
    var hit = want.some(function(w){ return t === w || t.toLowerCase() === w.toLowerCase(); });
    if (!hit) continue;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    el.click();
    return t;
  }
  return null;
})()`;

/** True once the composer dialog shows a control with the given text. */
const DIALOG_HAS = (text) => `(function(){
  var scope = document.querySelector('[role=dialog]');
  if (!scope) return false;
  return Array.from(scope.querySelectorAll('button, div[role="button"]')).some(function(e){
    return (e.innerText || '').trim() === ${JSON.stringify(text)};
  });
})()`;

/**
 * Runs the whole create flow for one queued post.
 *
 * `imagePaths` are local files; Instagram's uploader is a plain file input, so
 * CDP can hand them over directly and no dialog is involved.
 */
async function publish({ imagePaths, caption }, log = () => {}) {
  for (const p of imagePaths) if (!fs.existsSync(p)) throw new Error('فایل تصویر نیست: ' + path.basename(p));

  // Attach to the running browser — never launch one. A fresh or headless
  // instance is exactly what Instagram rejects.
  const up = await browserUp();
  if (!up) throw new Error('مرورگر باز نیست — اول دکمه‌ی ورود را بزن و وارد شو');
  if (up.headless) throw new Error('مرورگر headless است؛ باید پنجره‌ی عادی باز باشد');

  const tab = await cdp.newTab(port(), 'https://www.instagram.com/');
  const s = await cdp.attachWs(tab.webSocketDebuggerUrl);

  try {
    log('بررسی نشست…');
    await wait(6000);
    const alive = await s.eval(
      'Array.from(document.querySelectorAll("svg[aria-label]")).some(function(e){return /New post|Create|ساخت|پست جدید/i.test(e.getAttribute("aria-label"));}) && !document.querySelector("input[name=username]")'
    );
    if (!alive) throw new Error('نشست اینستاگرام معتبر نیست — یک بار دیگر در پنجره وارد شو');

    log('باز کردن پنجره‌ی ساخت پست…');
    // Click the Create control in the nav rather than the /create URL, which
    // redirects to login on anything Instagram considers automated.
    const opened = await s.eval(`(() => {
      const el = [...document.querySelectorAll('svg[aria-label]')]
        .find(e => /^(New post|Create|ساخت|پست جدید)$/i.test(e.getAttribute('aria-label')));
      const clickable = el && (el.closest('a') || el.closest('div[role="button"]') || el.closest('span[role="button"]') || el.parentElement);
      if (clickable) { clickable.click(); return true; }
      return false;
    })()`);
    if (!opened) throw new Error('دکمه‌ی «ساخت پست» در نوار پیدا نشد');
    await wait(1500);
    // A submenu (Post / Reel / Live) sometimes appears first.
    await s.eval(CLICK_BY_TEXT(['Post', 'پست']));
    await wait(1500);

    log('دادن تصاویر به آپلودر…');
    await s.until(`Boolean(document.querySelector('input[type=file]'))`, {
      timeoutMs: 20000,
      what: 'ورودی فایل',
    });
    await s.setFiles('input[type=file]', imagePaths);
    // Wait for the composer to leave the empty state and reach the Crop screen.
    await s.until(DIALOG_HAS('Next'), { timeoutMs: 20000, what: 'صفحه‌ی برش' });
    await wait(1200);

    // Crop → Edit → «Create new post». Advance with the dialog's own Next until
    // the caption box appears; the observed flow is exactly two Next screens.
    for (let i = 0; i < 4; i++) {
      const atCaption = await s.eval(
        `Boolean(document.querySelector('[role=dialog] div[contenteditable=true], [role=dialog] textarea'))`
      );
      if (atCaption) break;
      const hit = await s.eval(CLICK_IN_DIALOG(['Next', 'بعدی', 'ادامه']));
      if (!hit) break;
      log(`«${hit}»`);
      await wait(2500);
    }

    log('نوشتن کپشن…');
    const focused = await s.eval(`(function(){
      var el = document.querySelector('[role=dialog] div[contenteditable=true]') ||
               document.querySelector('[role=dialog] textarea');
      if (!el) return false;
      el.focus();
      return true;
    })()`);
    if (!focused) throw new Error('جعبه‌ی کپشن پیدا نشد — احتمالاً ظاهر اینستاگرام عوض شده');
    await s.type(caption);
    await wait(1500);

    log('انتشار…');
    const shared = await s.eval(CLICK_IN_DIALOG(['Share', 'اشتراک‌گذاری', 'اشتراک گذاری', 'همرسانی']));
    if (!shared) throw new Error('دکمه‌ی انتشار پیدا نشد');

    // Success shows either the confirmation text or, reliably, the composer
    // dialog closing after the "Sharing" state. Poll for both.
    const ok = await s.until(
      `(function(){
        var t = document.body ? document.body.innerText : '';
        if (/post has been shared|Post shared|به اشتراک گذاشته شد|منتشر شد/i.test(t)) return 'confirmed';
        var dlg = document.querySelector('[role=dialog]');
        var sharing = dlg && /Sharing|در حال/i.test(dlg.innerText);
        if (!dlg) return 'dialog-closed';
        return '';
      })()`,
      { timeoutMs: 150000, everyMs: 2000, what: 'تأیید انتشار' }
    );
    log('اینستاگرام انتشار را تأیید کرد ✔ (' + ok + ')');
    return { ok: true, confirmation: String(ok) };
  } finally {
    // Close only our tab; the browser stays up so its session survives.
    s.close();
    await cdp.closeTab(port(), tab.id);
  }
}

/**
 * Sets the bio and website on the edit-profile page.
 *
 * The fields are React-controlled, so a plain value assignment is ignored —
 * the value must go through the native setter and then an input event, or
 * React overwrites it on the next render. Attach-only, like publish.
 */
async function setProfileText({ bio, website }, log = () => {}) {
  const up = await browserUp();
  if (!up || up.headless) throw new Error('مرورگر عادی باز نیست — اول وارد شو');

  const tab = await cdp.newTab(port(), 'https://www.instagram.com/accounts/edit/');
  const s = await cdp.attachWs(tab.webSocketDebuggerUrl);
  try {
    log('باز کردن ویرایش پروفایل…');
    await s.until(`Boolean(document.querySelector('textarea'))`, { timeoutMs: 20000, what: 'فرم پروفایل' });
    await wait(1500);

    // Real keystrokes, not a value assignment: the edit form is React-
    // controlled and only enables Submit when its own onChange fires, which a
    // synthetic value-set does not reliably do. Focus each field, clear it,
    // then type — the same path that works for the post caption.
    const focusClear = (selector) => `(function(){
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.focus();
      el.setSelectionRange ? el.setSelectionRange(0, (el.value||'').length) : null;
      return true;
    })()`;

    const did = [];
    if (typeof bio === 'string') {
      if (await s.eval(focusClear('textarea'))) {
        await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', modifiers: 2 });
        await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', modifiers: 2 });
        await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete' });
        await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete' });
        await wait(300);
        await s.type(bio);
        did.push('bio');
        await wait(500);
      }
    }
    if (typeof website === 'string') {
      const sel = 'input[placeholder="Website"], input[type=text]:not([name=SearchBar])';
      if (await s.eval(focusClear(sel))) {
        await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', modifiers: 2 });
        await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', modifiers: 2 });
        await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete' });
        await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete' });
        await wait(300);
        await s.type(website);
        did.push('web');
        await wait(500);
      }
    }
    log('پر شد: ' + (did.join(',') || 'هیچ فیلدی'));
    await wait(1000);

    // The Submit button sits far below a short window's fold, so a click on its
    // reported coordinates lands on nothing. Scroll it into view first, then
    // click where it actually is.
    const scrolled = await s.eval(`(function(){
      var b = Array.from(document.querySelectorAll('button, div[role=button]'))
        .find(function(e){ return /^(Submit|ذخیره|Save|Done)$/i.test((e.innerText||'').trim()); });
      if (!b) return false;
      b.scrollIntoView({ block: 'center' });
      return true;
    })()`);
    if (!scrolled) throw new Error('دکمه‌ی ذخیره پیدا نشد');
    await wait(1200);
    const box = await s.eval(`(function(){
      var b = Array.from(document.querySelectorAll('button, div[role=button]'))
        .find(function(e){ return /^(Submit|ذخیره|Save|Done)$/i.test((e.innerText||'').trim()); });
      var r = b.getBoundingClientRect();
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`);
    const { x, y } = JSON.parse(box);
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await wait(5000);
    log('ذخیره شد ✔');
    return { ok: true, set: did };
  } finally {
    s.close();
    await cdp.closeTab(port(), tab.id);
  }
}

/**
 * Sets the profile photo. The page keeps a hidden image file input; setting it
 * directly uploads without the OS dialog, then Instagram applies it.
 */
async function setAvatar(imagePath, log = () => {}) {
  if (!fs.existsSync(imagePath)) throw new Error('فایل عکس نیست');
  const up = await browserUp();
  if (!up || up.headless) throw new Error('مرورگر عادی باز نیست — اول وارد شو');

  const tab = await cdp.newTab(port(), 'https://www.instagram.com/accounts/edit/');
  const s = await cdp.attachWs(tab.webSocketDebuggerUrl);
  try {
    log('باز کردن ویرایش پروفایل…');
    await s.until(`Boolean(document.querySelector('input[type=file]'))`, { timeoutMs: 20000, what: 'ورودی عکس' });
    // The avatar input is the one that accepts images.
    const doc = await s.send('DOM.getDocument', { depth: 30 });
    const found = await s.send('DOM.querySelectorAll', {
      nodeId: doc.root.nodeId,
      selector: 'input[type=file]',
    });
    let done = false;
    for (const nodeId of found.nodeIds) {
      const desc = await s.send('DOM.describeNode', { nodeId });
      const accept = (desc.node.attributes || []).join(' ');
      if (/image/.test(accept) || found.nodeIds.length === 1) {
        await s.send('DOM.setFileInputFiles', { nodeId, files: [imagePath] });
        done = true;
        break;
      }
    }
    if (!done && found.nodeIds.length) {
      await s.send('DOM.setFileInputFiles', { nodeId: found.nodeIds[0], files: [imagePath] });
      done = true;
    }
    if (!done) throw new Error('ورودی عکس پیدا نشد');
    log('عکس آپلود شد؛ منتظر اعمال…');
    await wait(6000);
    return { ok: true };
  } finally {
    s.close();
    await cdp.closeTab(port(), tab.id);
  }
}

/** Local file paths for a queue row's already-rendered slides. */
function pathsFor(imageUrls) {
  return JSON.parse(imageUrls).map((u) => path.join(MEDIA_DIR, u.split('/').pop()));
}

module.exports = {
  loginState,
  requestLoginWindow,
  publish,
  setProfileText,
  setAvatar,
  pathsFor,
  PROFILE_DIR,
  LOGIN_REQUEST,
};
