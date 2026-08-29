'use strict';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 PromptariaBot/1.0';

async function get(url, { timeout = 25000, retries = 2, json = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'user-agent': UA,
          accept: json ? 'application/json' : 'text/html,text/plain,*/*',
          'accept-language': 'en,fa;q=0.8',
        },
      });
      clearTimeout(timer);
      if (res.status === 403 || res.status === 429) throw new Error('rate limited (' + res.status + ')');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return json ? await res.json() : await res.text();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) await sleep(1200 * (attempt + 1));
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { get, sleep };
