'use strict';
/**
 * A very small Chrome DevTools Protocol client.
 *
 * Node 24 ships both `fetch` and `WebSocket`, which is everything CDP needs, so
 * this project drives Chrome without puppeteer, playwright or any native
 * dependency — the same reason it uses node:sqlite instead of better-sqlite3.
 *
 * Only the handful of domains the Instagram flow actually uses are wrapped.
 */
const fs = require('fs');
const { spawn } = require('child_process');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath(extra) {
  const candidates = [
    extra,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

/** True when something is already listening on the debugging port. */
async function probe(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/**
 * Starts Chrome on `port` unless it is already up.
 *
 * The profile directory is what carries the Instagram session, so it must be
 * stable across runs — a temp profile would mean signing in again every time.
 */
async function launch({ port, profileDir, headless = true, exe = null, url = 'about:blank' }) {
  const existing = await probe(port);
  if (existing) return { port, reused: true, browser: existing.Browser, child: null };

  const bin = chromePath(exe);
  if (!bin) throw new Error('کروم پیدا نشد');
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-features=Translate,MediaRouter',
    '--disable-gpu',
  ];
  if (headless) args.push('--headless=new', '--window-size=1280,1000');
  args.push(url);

  // Chrome outlives the call on purpose — the next publish reuses it rather
  // than paying the startup cost again. unref() so it never holds Node open.
  const child = spawn(bin, args, { stdio: 'ignore', windowsHide: headless, detached: true });
  child.unref();

  for (let i = 0; i < 50; i++) {
    await wait(400);
    const v = await probe(port);
    if (v) return { port, reused: false, browser: v.Browser, child };
  }
  try {
    child.kill();
  } catch {}
  throw new Error('کروم بالا آمد ولی پورت دیباگ جواب نداد');
}

/** Picks a page target, creating one if the browser has none. */
async function firstPage(port) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) return page;
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).catch(() => {});
    await wait(400);
  }
  throw new Error('هیچ تبی در کروم پیدا نشد');
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.closed = false;
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(`${m.error.message} (${m.method || ''})`));
        else resolve(m.result);
      }
    };
    ws.onclose = () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error('اتصال CDP بسته شد'));
      this.pending.clear();
    };
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error('اتصال CDP بسته است'));
    const n = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(n);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(n, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id: n, method, params }));
    });
  }

  /** Evaluates in the page and returns the value, not the wrapper. */
  async eval(expression, { awaitPromise = false } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      const e = r.exceptionDetails;
      throw new Error('JS: ' + (e.exception?.description || e.text || 'error').split('\n')[0]);
    }
    return r.result ? r.result.value : undefined;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
  }

  /** Polls an expression until it is truthy, or gives up. */
  async until(expression, { timeoutMs = 20000, everyMs = 400, what = expression } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let v;
      try {
        v = await this.eval(expression);
      } catch {
        v = null;
      }
      if (v) return v;
      await wait(everyMs);
    }
    throw new Error(`منتظر «${String(what).slice(0, 60)}» ماندم و نیامد`);
  }

  /** Sets files on an <input type=file> without any native dialog. */
  async setFiles(selector, files) {
    const doc = await this.send('DOM.getDocument', { depth: 1 });
    const node = await this.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
    if (!node.nodeId) throw new Error(`ورودی فایل «${selector}» پیدا نشد`);
    await this.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files });
  }

  /** Types into whatever has focus, as key events rather than a value assignment. */
  async type(text) {
    await this.send('Input.insertText', { text });
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function attach(port) {
  const page = await firstPage(port);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('اتصال به CDP طول کشید')), 10000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error('اتصال به CDP نشد'));
    };
  });
  const s = new Session(ws);
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  await s.send('DOM.enable');
  return s;
}

module.exports = { launch, attach, probe, firstPage, chromePath, wait, Session };
