'use strict';
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');

const db = require('./db');
const { ensureCategories } = require('./categories');
const { runAll, syncSources } = require('../scraper/run');
const seo = require('./seo');
const ig = require('./instagram');
const igAuto = require('./ig-auto');
const igBrowser = require('./ig-browser');
const postkit = require('./postkit');
const assistant = require('./assistant');
const pages = require('./pages');

const PORT = Number(process.env.PORT || 3400);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'promptaria';
const SESSION_HOURS = 12;

ensureCategories();
syncSources();

const app = express();
// Carousel renders arrive as base64 PNGs and blow past a sane global limit, so
// the two Instagram upload routes get their own, much larger, parser. The global
// one has to skip those paths or it would reject the body before they run.
const IG_UPLOAD = /^\/(api\/admin\/ig\/(publish|render-only)|ig\/auto\/[0-9a-f]+)$/;
const smallJson = express.json({ limit: '1mb' });
const bigJson = express.json({ limit: '30mb' });
app.use((req, res, next) => (IG_UPLOAD.test(req.path) ? next() : smallJson(req, res, next)));
app.use(cookieParser());
app.disable('x-powered-by');

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const setting = (key, fallback = null) => {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
};
const putSetting = (key, value) =>
  db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));

const parseJson = (s, f) => {
  try {
    return JSON.parse(s);
  } catch {
    return f;
  }
};

/** Public shape — deliberately omits source_url / source_id / source_author / body_hash. */
function publicPrompt(row, full = false) {
  const base = {
    id: row.uid,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    category: row.cat_slug,
    category_name: row.cat_name,
    category_icon: row.cat_icon,
    tags: parseJson(row.tags, []),
    difficulty: row.difficulty,
    lang: row.lang,
    quality: row.quality,
    featured: !!row.featured,
    views: row.views,
    copies: row.copies,
    likes: row.likes,
    updated_at: row.updated_at,
    length: row.body ? row.body.length : 0,
  };
  if (!full) return base;
  return {
    ...base,
    body: row.body,
    how_to: row.how_to,
    tips: parseJson(row.tips, []),
    variables: parseJson(row.variables, []),
    example_use: row.example_use,
    expected_out: row.expected_out,
    best_models: parseJson(row.best_models, []),
  };
}

const SELECT_PUBLIC = `
  SELECT p.*, c.slug AS cat_slug, c.name_fa AS cat_name, c.icon AS cat_icon
  FROM prompts p LEFT JOIN categories c ON c.id = p.category_id
`;

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */
app.get('/api/categories', (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.slug, c.name_fa, c.name_en, c.icon, c.description,
              (SELECT COUNT(*) FROM prompts p WHERE p.category_id = c.id AND p.status='published') AS count
       FROM categories c ORDER BY c.sort_order`
    )
    .all();
  res.json(rows.filter((r) => r.count > 0));
});

app.get('/api/stats', (req, res) => {
  const total = db.prepare("SELECT COUNT(*) n FROM prompts WHERE status='published'").get().n;
  const cats = db.prepare('SELECT COUNT(*) n FROM categories').get().n;
  const srcs = db.prepare('SELECT COUNT(*) n FROM sources WHERE enabled=1').get().n;
  res.json({ prompts: total, categories: cats, sources: srcs, last_update: setting('last_scrape', null) });
});

app.get('/api/prompts', (req, res) => {
  const per = Math.min(48, Math.max(6, Number(req.query.per) || 24));
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = ["p.status = 'published'"];
  const args = [];

  if (req.query.cat && req.query.cat !== 'all') {
    where.push('c.slug = ?');
    args.push(String(req.query.cat));
  }
  if (req.query.difficulty && req.query.difficulty !== 'all') {
    where.push('p.difficulty = ?');
    args.push(String(req.query.difficulty));
  }
  if (req.query.q) {
    const q = '%' + String(req.query.q).trim().toLowerCase() + '%';
    where.push('(lower(p.title) LIKE ? OR lower(p.summary) LIKE ? OR lower(p.body) LIKE ? OR lower(p.tags) LIKE ?)');
    args.push(q, q, q, q);
  }
  if (req.query.featured === '1') where.push('p.featured = 1');

  const sortMap = {
    best: 'p.featured DESC, p.quality DESC, p.copies DESC',
    new: 'p.created_at DESC, p.id DESC',
    popular: 'p.copies DESC, p.views DESC',
    az: 'p.title ASC',
  };
  const order = sortMap[req.query.sort] || sortMap.best;
  const clause = 'WHERE ' + where.join(' AND ');

  const total = db
    .prepare(`SELECT COUNT(*) n FROM prompts p LEFT JOIN categories c ON c.id = p.category_id ${clause}`)
    .get(...args).n;
  const rows = db
    .prepare(`${SELECT_PUBLIC} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, per, (page - 1) * per);

  res.json({ total, page, per, pages: Math.ceil(total / per), items: rows.map((r) => publicPrompt(r)) });
});

app.get('/api/prompts/:uid', (req, res) => {
  const row = db.prepare(`${SELECT_PUBLIC} WHERE p.uid = ? AND p.status='published'`).get(req.params.uid);
  if (!row) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE prompts SET views = views + 1 WHERE id = ?').run(row.id);

  const related = db
    .prepare(`${SELECT_PUBLIC} WHERE p.category_id = ? AND p.id != ? AND p.status='published'
              ORDER BY p.quality DESC LIMIT 6`)
    .all(row.category_id, row.id);

  res.json({ prompt: publicPrompt(row, true), related: related.map((r) => publicPrompt(r)) });
});

app.post('/api/prompts/:uid/:action(copy|like)', (req, res) => {
  const col = req.params.action === 'copy' ? 'copies' : 'likes';
  const info = db.prepare(`UPDATE prompts SET ${col} = ${col} + 1 WHERE uid = ?`).run(req.params.uid);
  res.json({ ok: info.changes > 0 });
});

app.post('/api/assist', (req, res) => {
  const q = (req.body && req.body.q) || '';
  res.json(assistant.ask(q));
});

/* ------------------------------------------------------------------ *
 * Admin auth
 * ------------------------------------------------------------------ */
function hash(pw) {
  return crypto.createHash('sha256').update('promptaria::' + pw).digest('hex');
}
if (!setting('admin_hash')) putSetting('admin_hash', hash(ADMIN_PASSWORD));

function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies.pa_admin;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  const s = db.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(token);
  if (!s) return res.status(401).json({ error: 'unauthorized' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  const pw = String((req.body && req.body.password) || '');
  if (hash(pw) !== setting('admin_hash')) return res.status(401).json({ error: 'رمز عبور اشتباه است' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token, expires_at) VALUES (?, datetime('now', '+${SESSION_HOURS} hours'))`).run(token);
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  res.cookie('pa_admin', token, { httpOnly: true, sameSite: 'lax', maxAge: SESSION_HOURS * 3600e3 });
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  if (req.cookies && req.cookies.pa_admin) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.pa_admin);
  res.clearCookie('pa_admin');
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true }));

app.post('/api/admin/password', requireAdmin, (req, res) => {
  const pw = String((req.body && req.body.password) || '');
  if (pw.length < 6) return res.status(400).json({ error: 'رمز باید حداقل ۶ کاراکتر باشد' });
  putSetting('admin_hash', hash(pw));
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Admin API  (source links ARE exposed here — and only here)
 * ------------------------------------------------------------------ */
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const q = (sql, ...a) => db.prepare(sql).get(...a);
  res.json({
    prompts: q('SELECT COUNT(*) n FROM prompts').n,
    published: q("SELECT COUNT(*) n FROM prompts WHERE status='published'").n,
    hidden: q("SELECT COUNT(*) n FROM prompts WHERE status!='published'").n,
    featured: q('SELECT COUNT(*) n FROM prompts WHERE featured=1').n,
    views: q('SELECT COALESCE(SUM(views),0) n FROM prompts').n,
    copies: q('SELECT COALESCE(SUM(copies),0) n FROM prompts').n,
    sources: q('SELECT COUNT(*) n FROM sources').n,
    sources_ok: q("SELECT COUNT(*) n FROM sources WHERE last_status='ok'").n,
    last_scrape: setting('last_scrape', null),
    auto_hours: Number(setting('auto_hours', '12')),
    by_category: db
      .prepare(
        `SELECT c.slug, c.name_fa, COUNT(p.id) n FROM categories c
         LEFT JOIN prompts p ON p.category_id = c.id
         GROUP BY c.id ORDER BY n DESC`
      )
      .all(),
    by_source: db
      .prepare(
        `SELECT s.key, s.name, s.home_url, s.trust, s.last_status, s.last_run_at, COUNT(p.id) n
         FROM sources s LEFT JOIN prompts p ON p.source_id = s.id
         GROUP BY s.id ORDER BY n DESC`
      )
      .all(),
  });
});

app.get('/api/admin/prompts', requireAdmin, (req, res) => {
  const per = Math.min(100, Number(req.query.per) || 30);
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = [];
  const args = [];
  if (req.query.q) {
    const q = '%' + String(req.query.q).toLowerCase() + '%';
    where.push('(lower(p.title) LIKE ? OR lower(p.body) LIKE ? OR lower(p.source_url) LIKE ?)');
    args.push(q, q, q);
  }
  if (req.query.source) {
    where.push('s.key = ?');
    args.push(String(req.query.source));
  }
  if (req.query.cat) {
    where.push('c.slug = ?');
    args.push(String(req.query.cat));
  }
  if (req.query.status) {
    where.push('p.status = ?');
    args.push(String(req.query.status));
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const from = `FROM prompts p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN sources s ON s.id = p.source_id ${clause}`;

  const total = db.prepare(`SELECT COUNT(*) n ${from}`).get(...args).n;
  const rows = db
    .prepare(
      `SELECT p.id, p.uid, p.title, p.status, p.featured, p.quality, p.difficulty, p.lang,
              p.views, p.copies, p.likes, p.updated_at, p.created_at,
              p.source_url, p.source_author, substr(p.body, 1, 220) AS excerpt,
              c.slug AS cat_slug, c.name_fa AS cat_name,
              s.key AS source_key, s.name AS source_name, s.home_url AS source_home
       ${from} ORDER BY p.id DESC LIMIT ? OFFSET ?`
    )
    .all(...args, per, (page - 1) * per);
  res.json({ total, page, per, pages: Math.ceil(total / per), items: rows });
});

app.get('/api/admin/prompts/:id', requireAdmin, (req, res) => {
  const row = db
    .prepare(
      `SELECT p.*, c.slug AS cat_slug, s.key AS source_key, s.name AS source_name, s.home_url AS source_home
       FROM prompts p LEFT JOIN categories c ON c.id=p.category_id
       LEFT JOIN sources s ON s.id=p.source_id WHERE p.id = ?`
    )
    .get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(row);
});

app.patch('/api/admin/prompts/:id', requireAdmin, (req, res) => {
  const allowed = ['title', 'body', 'summary', 'how_to', 'example_use', 'expected_out', 'status', 'featured', 'quality', 'difficulty'];
  const sets = [];
  const args = [];
  for (const k of allowed) {
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, k)) {
      sets.push(`${k} = ?`);
      args.push(typeof req.body[k] === 'boolean' ? (req.body[k] ? 1 : 0) : req.body[k]);
    }
  }
  if (req.body && req.body.category) {
    const c = db.prepare('SELECT id FROM categories WHERE slug = ?').get(req.body.category);
    if (c) {
      sets.push('category_id = ?');
      args.push(c.id);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  args.push(Number(req.params.id));
  db.prepare(`UPDATE prompts SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args);
  res.json({ ok: true });
});

app.delete('/api/admin/prompts/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM prompts WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/admin/sources', requireAdmin, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM prompts p WHERE p.source_id = s.id) AS prompt_count
         FROM sources s ORDER BY prompt_count DESC`
      )
      .all()
  );
});

app.patch('/api/admin/sources/:id', requireAdmin, (req, res) => {
  if (req.body && typeof req.body.enabled !== 'undefined')
    db.prepare('UPDATE sources SET enabled = ? WHERE id = ?').run(req.body.enabled ? 1 : 0, Number(req.params.id));
  if (req.body && typeof req.body.trust !== 'undefined')
    db.prepare('UPDATE sources SET trust = ? WHERE id = ?').run(Number(req.body.trust), Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/admin/runs', requireAdmin, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT r.*, s.name AS source_name, s.key AS source_key FROM scrape_runs r
         LEFT JOIN sources s ON s.id = r.source_id ORDER BY r.id DESC LIMIT 60`
      )
      .all()
  );
});

/* ---- scraping job (single-flight, streamed log) ---- */
const job = { running: false, startedAt: null, log: [], result: null };

function startScrape(only) {
  if (job.running) return false;
  job.running = true;
  job.startedAt = new Date().toISOString();
  job.log = [];
  job.result = null;
  const log = (line) => {
    job.log.push(line);
    if (job.log.length > 300) job.log.shift();
    console.log('[scrape]', line);
  };
  runAll({ only, log })
    .then((r) => {
      job.result = r.total;
      log('پایان بروزرسانی');
    })
    .catch((e) => log('خطا: ' + e.message))
    .finally(() => {
      job.running = false;
    });
  return true;
}

app.post('/api/admin/scrape', requireAdmin, (req, res) => {
  const only = req.body && Array.isArray(req.body.keys) && req.body.keys.length ? req.body.keys : null;
  if (!startScrape(only)) return res.status(409).json({ error: 'یک بروزرسانی در حال اجراست' });
  res.json({ ok: true });
});

app.get('/api/admin/scrape/status', requireAdmin, (req, res) =>
  res.json({ running: job.running, startedAt: job.startedAt, log: job.log, result: job.result })
);

/* ------------------------------------------------------------------ *
 * Instagram studio (admin only)
 * ------------------------------------------------------------------ */
const igJob = { running: false, log: [], result: null, error: null };
let autoIgRunning = false;

app.get('/api/admin/ig/status', requireAdmin, (req, res) => {
  const cfg = ig.igConfig();
  res.json({ connected: cfg.connected, userId: cfg.userId, job: igJob });
});

app.post('/api/admin/ig/connect', requireAdmin, async (req, res) => {
  try {
    ig.saveIgConfig({ userId: req.body && req.body.userId, token: req.body && req.body.token });
    const me = await ig.verifyAccount();
    res.json({ ok: true, account: me });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/admin/ig/compose', requireAdmin, (req, res) => {
  const where = req.query.uid ? 'p.uid = ?' : "p.status='published'";
  const args = req.query.uid ? [String(req.query.uid)] : [];
  const row = db
    .prepare(
      `SELECT p.*, c.slug AS cat_slug, c.name_fa AS cat_name, c.icon
       FROM prompts p LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${where} ORDER BY ${req.query.uid ? 'p.id' : 'p.featured DESC, RANDOM()'} LIMIT 1`
    )
    .get(...args);
  if (!row) return res.status(404).json({ error: 'پرامپتی پیدا نشد' });
  res.json(ig.composePost(row, { hook: req.query.hook }));
});

app.get('/api/admin/ig/pick', requireAdmin, (req, res) => {
  const q = req.query.q ? '%' + String(req.query.q).toLowerCase() + '%' : null;
  const rows = db
    .prepare(
      `SELECT p.uid, p.title, p.quality, c.name_fa AS cat_name FROM prompts p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.status='published' ${q ? 'AND lower(p.title) LIKE ?' : ''}
       ORDER BY p.featured DESC, p.quality DESC LIMIT 40`
    )
    .all(...(q ? [q] : []));
  res.json(rows);
});

app.post('/api/admin/ig/publish', bigJson, requireAdmin, (req, res) => {
  if (igJob.running) return res.status(409).json({ error: 'یک انتشار در حال اجراست' });
  const { images, caption, uid } = req.body || {};
  let urls;
  try {
    urls = ig.saveSlides(String(uid || 'post'), images);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  igJob.running = true;
  igJob.log = [];
  igJob.result = null;
  igJob.error = null;
  const log = (l) => {
    igJob.log.push(l);
    console.log('[ig]', l);
  };
  log(`${urls.length} تصویر ذخیره شد`);

  ig.publishCarousel({ imageUrls: urls, caption: String(caption || ''), log })
    .then((r) => {
      igJob.result = r;
    })
    .catch((e) => {
      igJob.error = e.message;
      log('خطا: ' + e.message);
    })
    .finally(() => {
      igJob.running = false;
      ig.pruneMedia();
    });

  res.json({ ok: true, images: urls });
});

app.post('/api/admin/ig/kit', bigJson, requireAdmin, async (req, res) => {
  try {
    const { uid, title, caption, hashtags, images } = req.body || {};
    const urls = ig.saveSlides(String(uid || 'post'), images);
    const kit = postkit.createKit({ uid, title, caption, hashtags, images: urls });
    kit.qr = await postkit.qrSvg(kit.url);
    res.json({ ok: true, ...kit });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/admin/ig/render-only', bigJson, requireAdmin, (req, res) => {
  try {
    const urls = ig.saveSlides(String((req.body && req.body.uid) || 'post'), req.body && req.body.images);
    res.json({ ok: true, images: urls });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  if (req.body && req.body.auto_hours !== undefined) {
    const h = Math.max(0, Math.min(168, Number(req.body.auto_hours) || 0));
    putSetting('auto_hours', h);
    scheduleAuto();
  }
  res.json({ ok: true, auto_hours: Number(setting('auto_hours', '12')) });
});

/* ------------------------------------------------------------------ *
 * Static + SPA routes
 * ------------------------------------------------------------------ */
const PUB = path.join(__dirname, '..', 'public');

// Carousel renders are meant to be fetched by other origins — Instagram's Graph
// API pulls them, and the studio hands them to Business Suite in the browser.
// They are already public URLs, so an open CORS header costs nothing.
/* --- unattended carousel rendering ---------------------------------
 * Headless Chrome loads this page, runs the same IGStudio renderer the admin
 * studio uses, and posts the JPEGs straight back. The one-time job token is
 * the only credential: it is unguessable, single-use, and useless once the
 * row leaves `pending`. */
app.get('/ig/auto/:token', (req, res) => {
  const job = igAuto.jobByToken(String(req.params.token));
  if (!job || job.status !== 'pending') return res.status(404).type('text/plain').send('no such job');
  const payload = JSON.stringify({ token: job.job_token, slides: JSON.parse(job.slides) })
    .replace(/</g, '\\u003c');
  res.type('html').set('Cache-Control', 'no-store').send(`<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<title>render</title>
<link rel="stylesheet" href="/styles.css">
<style>body{margin:0;background:#0a0a12}canvas{display:none}</style>
</head><body>
<div id="state">rendering</div>
<script src="/ig-studio.js"></script>
<script>
const JOB = ${payload};
(async () => {
  const done = (s) => { document.getElementById('state').textContent = s; };
  try {
    const canvases = await window.IGStudio.renderAll(JOB.slides);
    const images = window.IGStudio.toDataUrls(canvases, 'image/jpeg');
    const r = await fetch('/ig/auto/' + JOB.token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ images }),
    });
    done(r.ok ? 'ok' : 'save-failed');
  } catch (e) {
    done('error');
    fetch('/ig/auto/' + JOB.token + '/fail', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: String(e && e.message || e) }),
    }).catch(() => {});
  }
})();
</script>
</body></html>`);
});

app.post('/ig/auto/:token', bigJson, (req, res) => {
  try {
    const urls = igAuto.acceptRender(String(req.params.token), (req.body || {}).images);
    res.json({ ok: true, count: urls.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/ig/auto/:token/fail', (req, res) => {
  igAuto.failRender(String(req.params.token), (req.body || {}).message || 'render failed');
  res.json({ ok: true });
});

/* --- admin control over the autopilot --- */
app.get('/api/admin/ig/auto', requireAdmin, (req, res) => {
  res.json({ ...igAuto.stats(), chrome: Boolean(igAuto.chromePath()), queue: igAuto.queue(40) });
});

app.post('/api/admin/ig/auto', requireAdmin, (req, res) => {
  const b = req.body || {};
  const set = (k, v) =>
    db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(k, String(v));
  if (b.enabled !== undefined) set('ig_auto', b.enabled ? '1' : '0');
  if (b.per_day !== undefined) set('ig_auto_per_day', Math.max(1, Math.min(3, Number(b.per_day) || 1)));
  if (b.slots !== undefined) set('ig_auto_slots', String(b.slots));
  res.json(igAuto.stats());
});

app.post('/api/admin/ig/auto/enqueue', requireAdmin, (req, res) => {
  try {
    res.json(igAuto.enqueue({ uid: (req.body || {}).uid || null, at: (req.body || {}).at || null }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/admin/ig/auto/run', requireAdmin, async (req, res) => {
  if (autoIgRunning) return res.status(409).json({ error: 'یک اجرا در جریان است' });
  autoIgRunning = true;
  const lines = [];
  try {
    const out = await igAuto.tick((l) => {
      lines.push(l);
      console.log('[ig-auto] ' + l);
    });
    res.json({ ...out, log: lines });
  } catch (e) {
    res.status(500).json({ error: e.message, log: lines });
  } finally {
    autoIgRunning = false;
  }
});

app.delete('/api/admin/ig/auto/:id', requireAdmin, (req, res) => {
  db.prepare("UPDATE ig_queue SET status = 'cancelled' WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

app.use('/ig', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

app.use(express.static(PUB, { maxAge: '7d', index: false }));

const html = (res, body, status = 200) =>
  res.status(status).type('html').set('Cache-Control', 'public, max-age=120').send(body);

/* --- crawler files --- */
app.get('/robots.txt', (req, res) => res.type('text/plain').send(seo.robots()));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(seo.sitemapIndex()));
app.get('/sitemap-pages.xml', (req, res) => res.type('application/xml').send(seo.sitemapPages()));
app.get('/sitemap-prompts-:n.xml', (req, res) => {
  const xml = seo.sitemapPrompts(Math.max(1, Number(req.params.n) || 1));
  if (!xml) return res.status(404).end();
  res.type('application/xml').send(xml);
});

/* --- server-rendered public pages --- */
app.get('/', (req, res) => html(res, seo.renderHome()));
app.get('/categories', (req, res) => html(res, seo.renderCategories()));
app.get('/guide', (req, res) => html(res, seo.renderGuide()));

/* --- authored content: articles, collections, the builder --- */
app.get('/learn', (req, res) => html(res, pages.renderLearnIndex()));
app.get('/learn/:slug', (req, res) => {
  const out = pages.renderArticle(req.params.slug);
  return out ? html(res, out) : html(res, seo.render404(), 404);
});
app.get('/collections', (req, res) => html(res, pages.renderCollectionsIndex()));
app.get('/collections/:slug', (req, res) => {
  const out = pages.renderCollection(req.params.slug);
  return out ? html(res, out) : html(res, seo.render404(), 404);
});
app.get('/builder', (req, res) => html(res, pages.renderBuilder()));
app.get('/search', (req, res) => html(res, seo.renderSearch(String(req.query.q || '').slice(0, 80))));

app.get('/c/:slug', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const out = seo.renderCategory(req.params.slug, page);
  return out ? html(res, out) : html(res, seo.render404(), 404);
});

// /p/<slug>-<uid> — the uid is the last dash-separated segment, so a changed
// title still resolves and the old URL keeps working.
app.get('/p/:slugUid', (req, res) => {
  const uid = String(req.params.slugUid).split('-').pop();
  const out = seo.renderPrompt(uid);
  return out ? html(res, out) : html(res, seo.render404(), 404);
});

// The admin shell is static, but its asset URLs get the same build stamp as the
// public pages so a deploy never leaves a stale panel script cached.
// Post kits live behind an unguessable, expiring token — the URL is the only
// credential, so it must never be cached by a shared proxy or indexed.
app.get('/kit/:token', (req, res) => {
  const kit = postkit.getKit(req.params.token);
  res
    .type('html')
    .set('Cache-Control', 'private, no-store')
    .set('X-Robots-Tag', 'noindex, nofollow')
    .status(kit ? 200 : 404)
    .send(kit ? postkit.renderKit(kit) : postkit.renderExpired());
});

/* --- the standing list of ready post kits ---------------------------
 * With no Graph token the kit is how a post actually reaches Instagram, so
 * there has to be one address that always shows the current ones. Admin-only,
 * noindex, and it prints each kit's QR so the phone never has to type a URL. */
/** Publish one queued post right now, straight from the kit list. */
app.post('/api/admin/ig/auto/publish/:id', requireAdmin, async (req, res) => {
  if (autoIgRunning) return res.status(409).json({ error: 'یک اجرای خودکار در جریان است — چند لحظه بعد دوباره بزن' });

  const row = db.prepare('SELECT * FROM ig_queue WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'این پست در صف نیست' });
  if (row.status === 'published') return res.status(409).json({ error: 'قبلاً منتشر شده' });
  if (!row.image_urls) return res.status(409).json({ error: 'هنوز رندر نشده' });
  if (!ig.igConfig().connected)
    return res.status(412).json({
      error: 'توکن Graph API تنظیم نشده — تا وقتی اپ متا ساخته نشود، انتشار از اینجا ممکن نیست',
      needs: 'ig_token',
    });

  autoIgRunning = true;
  const lines = [];
  try {
    const r = await ig.publishCarousel({
      imageUrls: JSON.parse(row.image_urls),
      caption: row.caption,
      log: (l) => lines.push(l),
    });
    db.prepare(
      `UPDATE ig_queue SET status = 'published', published_at = datetime('now'), media_id = ?, error = NULL
       WHERE id = ?`
    ).run(String((r && (r.id || r.media_id)) || ''), row.id);
    res.json({ ok: true, media_id: (r && r.id) || null, log: lines });
  } catch (e) {
    db.prepare('UPDATE ig_queue SET attempts = attempts + 1, error = ? WHERE id = ?').run(
      String(e.message).slice(0, 400),
      row.id
    );
    res.status(502).json({ error: e.message, log: lines });
  } finally {
    autoIgRunning = false;
  }
});

/** Mark a post done by hand, for when it was posted from the phone. */
app.post('/api/admin/ig/auto/done/:id', requireAdmin, (req, res) => {
  const done = db
    .prepare("UPDATE ig_queue SET status = 'posted', published_at = datetime('now') WHERE id = ? AND status = 'ready'")
    .run(Number(req.params.id)).changes;
  res.json({ ok: Boolean(done) });
});

/* --- posting through a real Chrome ----------------------------------
 * The fallback for having no Graph token. See server/ig-browser.js for what
 * this costs; the short version is that it automates instagram.com, which
 * Instagram's terms forbid, and the account carries that risk. */
app.get('/api/admin/ig/browser/state', requireAdmin, async (req, res) => {
  try {
    const st = await igBrowser.loginState();
    res.json({ ...st, profile: igBrowser.PROFILE_DIR });
  } catch (e) {
    res.status(500).json({ error: e.message, profile: igBrowser.PROFILE_DIR });
  }
});

app.post('/api/admin/ig/browser/login', requireAdmin, (req, res) => {
  try {
    const info = igBrowser.requestLoginWindow();
    execFile(
      'schtasks',
      ['/run', '/tn', 'promptaria-ig-login'],
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (err) console.log('[ig-browser] login task failed:', String(stderr || err.message).slice(0, 200));
      }
    );
    res.json({
      ok: true,
      ...info,
      note: 'یک پنجره‌ی کروم روی دسکتاپ سرور باز می‌شود. وارد شو، بعد ببندش و «بررسی وضعیت» را بزن.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/ig/browser/publish/:id', requireAdmin, async (req, res) => {
  if (autoIgRunning) return res.status(409).json({ error: 'یک اجرای دیگر در جریان است' });

  const row = db.prepare('SELECT * FROM ig_queue WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'این پست در صف نیست' });
  if (row.status === 'published') return res.status(409).json({ error: 'قبلاً منتشر شده' });
  if (!row.image_urls) return res.status(409).json({ error: 'هنوز رندر نشده' });

  autoIgRunning = true;
  const lines = [];
  const log = (l) => {
    lines.push(l);
    console.log('[ig-browser] ' + l);
  };
  try {
    await igBrowser.publish(
      { imagePaths: igBrowser.pathsFor(row.image_urls), caption: row.caption },
      log
    );
    db.prepare(
      `UPDATE ig_queue SET status = 'published', published_at = datetime('now'), media_id = 'browser', error = NULL
       WHERE id = ?`
    ).run(row.id);
    putSetting('ig_last_post', new Date().toISOString());
    res.json({ ok: true, log: lines });
  } catch (e) {
    db.prepare('UPDATE ig_queue SET attempts = attempts + 1, error = ? WHERE id = ?').run(
      String(e.message).slice(0, 400),
      row.id
    );
    res.status(502).json({ error: e.message, log: lines });
  } finally {
    autoIgRunning = false;
  }
});

app.get('/admin/kits', requireAdmin, async (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, title, status, scheduled_at, kit_url, kit_expires
       FROM ig_queue
       WHERE kit_url IS NOT NULL AND status IN ('ready', 'pending')
       ORDER BY scheduled_at`
    )
    .all();

  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const cards = rows.length
    ? (
        await Promise.all(
          rows.map(async (r) => {
          const when = new Date(r.scheduled_at.replace(' ', 'T') + 'Z').toLocaleString('fa-IR', {
            timeZone: 'Asia/Tehran',
            dateStyle: 'full',
            timeStyle: 'short',
          });
          return `<article class="kit">
  <div class="qr">${await postkit.qrSvg(r.kit_url, { onWhite: true })}</div>
  <div class="meta">
    <h2>${esc(r.title)}</h2>
    <p class="when">زمان پیشنهادی: ${esc(when)}</p>
    <p><a href="${esc(r.kit_url)}" target="_blank" rel="noopener">${esc(r.kit_url)}</a></p>
    <div class="acts">
      <button type="button" class="go" data-id="${r.id}">انتشار خودکار</button>
      <button type="button" class="done" data-done="${r.id}">پست شد</button>
    </div>
    <p class="msg" id="msg-${r.id}"></p>
  </div>
</article>`;
          })
        )
      ).join('\n')
    : '<p class="empty">هنوز کیتی آماده نیست. تا چند دقیقه دیگر خودکار ساخته می‌شود.</p>';

  res
    .type('html')
    .set('Cache-Control', 'no-store')
    .send(`<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>کیت‌های آماده</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; background:#0a0a12; color:#eceefb;
         font:16px/1.7 Vazirmatn, Tahoma, sans-serif; padding:28px 18px 60px }
  h1 { font-size:24px; margin:0 0 6px }
  .lead { color:#9aa0c8; margin:0 0 28px }
  .kit { display:flex; gap:20px; align-items:center; flex-wrap:wrap;
         background:#141527; border:1px solid #262845; border-radius:18px;
         padding:18px; margin:0 0 16px; max-width:760px }
  .qr { background:#fff; padding:8px; border-radius:12px; line-height:0 }
  .qr svg { width:132px; height:132px; display:block }
  .meta { flex:1 1 280px; min-width:0 }
  h2 { font-size:19px; margin:0 0 6px }
  .when { color:#9aa0c8; margin:0 0 10px; font-size:14px }
  a { color:#7dd3fc; word-break:break-all; font-size:13px }
  .empty { color:#9aa0c8 }
  .acts { display:flex; gap:8px; flex-wrap:wrap; margin-top:12px }
  .acts button { border:none; border-radius:10px; padding:9px 16px; font:inherit; font-size:13.5px;
                 font-weight:700; color:#fff; cursor:pointer }
  .acts .go { background:linear-gradient(135deg,#7c5cff,#6247e0) }
  .acts .done { background:#262845; color:#c3c8e8 }
  .acts button[disabled] { opacity:.55; cursor:default }
  .msg { font-size:13px; margin:10px 0 0; min-height:1px }
  .msg.err { color:#fca5a5 } .msg.ok { color:#86efac }
  footer { color:#6b7194; font-size:13px; margin-top:32px; max-width:760px }
  footer code { color:#9aa0c8 }
</style></head><body>
<h1>کیت‌های آماده‌ی اینستاگرام</h1>
<p class="lead">با دوربین گوشی QR را بخوان: عکس‌ها و کپشن همان‌جا آماده است.</p>
${cards}
<footer>
  «انتشار خودکار» پست را مستقیم از طریق Graph API می‌فرستد و تا وقتی توکن تنظیم نشده باشد
  با خطا برمی‌گردد. «پست شد» را بعد از انتشار دستی بزن تا صف سراغ محتوای بعدی برود.
  هر کیت ۷۲ ساعت اعتبار دارد و بعد خودکار از نو ساخته می‌شود. این صفحه برای موتورهای جستجو مسدود است.
</footer>
<script>
document.addEventListener('click', function (ev) {
  var btn = ev.target.closest('button[data-id], button[data-done]');
  if (!btn) return;
  var publish = btn.hasAttribute('data-id');
  var id = btn.getAttribute(publish ? 'data-id' : 'data-done');
  var msg = document.getElementById('msg-' + id);
  var url = '/api/admin/ig/auto/' + (publish ? 'publish/' : 'done/') + id;

  btn.disabled = true;
  msg.className = 'msg';
  msg.textContent = publish ? 'در حال انتشار…' : 'ثبت می‌شود…';

  fetch(url, { method: 'POST' })
    .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      if (res.ok) {
        msg.className = 'msg ok';
        msg.textContent = publish ? 'منتشر شد ✔' : 'ثبت شد ✔';
        btn.closest('article').style.opacity = '.5';
      } else {
        msg.className = 'msg err';
        msg.textContent = res.j.error || 'نشد';
        btn.disabled = false;
      }
    })
    .catch(function (e) {
      msg.className = 'msg err';
      msg.textContent = 'خطای شبکه: ' + e.message;
      btn.disabled = false;
    });
});
</script>
</body></html>`);
});

app.get('/admin', (req, res) => {
  let page = fs.readFileSync(path.join(PUB, 'admin.html'), 'utf8');
  page = page.replace(/(href|src)="\/(styles\.css|admin\.js|admin-ig\.js|ig-studio\.js)"/g,
    (m, attr, file) => `${attr}="/${file}?v=${seo.assetV}"`);
  res.type('html').set('Cache-Control', 'no-cache').send(page);
});
app.use((req, res) => (req.path.startsWith('/api/') ? res.status(404).json({ error: 'not found' }) : html(res, seo.render404(), 404)));

// Body-parser failures (oversized carousel, malformed JSON) should reach the
// caller as JSON, not as an unhandled stack trace.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413))
    return res.status(413).json({ error: 'حجم داده ارسالی بیش از حد مجاز است' });
  if (err && err.status === 400 && err.type === 'entity.parse.failed')
    return res.status(400).json({ error: 'داده ارسالی معتبر نیست' });
  console.error(err);
  res.status(500).json({ error: 'خطای داخلی سرور' });
});

/* ------------------------------------------------------------------ *
 * Auto-update timer
 * ------------------------------------------------------------------ */
let autoTimer = null;
let catchUpTimer = null;

/**
 * setInterval alone is not enough: it restarts from zero on every boot, so a
 * server that is deployed or rebooted more often than the interval would never
 * scrape at all. The schedule is therefore anchored to the stored last_scrape
 * time, and a run that is already overdue at startup fires shortly after boot
 * rather than waiting a full cycle.
 */
function scheduleAuto() {
  clearInterval(autoTimer);
  clearTimeout(catchUpTimer);
  autoTimer = null;
  catchUpTimer = null;

  const hours = Number(setting('auto_hours', '12'));
  if (!hours) return console.log('auto-update disabled');

  const periodMs = hours * 3600e3;
  autoTimer = setInterval(() => {
    console.log('[auto] scheduled scrape starting');
    startScrape(null);
  }, periodMs);

  const last = setting('last_scrape', null);
  const lastMs = last ? Date.parse(String(last).replace(' ', 'T') + 'Z') : NaN;
  const elapsed = Number.isNaN(lastMs) ? Infinity : Date.now() - lastMs;

  if (elapsed >= periodMs) {
    // overdue — but give the server a couple of minutes to settle first
    const delay = 2 * 60e3;
    const overdueH = Number.isFinite(elapsed) ? Math.round(elapsed / 3600e3) : null;
    console.log(
      `auto-update every ${hours}h — last run ${overdueH === null ? 'never' : overdueH + 'h ago'}, catching up in 2min`
    );
    catchUpTimer = setTimeout(() => startScrape(null), delay);
  } else {
    const dueInH = ((periodMs - elapsed) / 3600e3).toFixed(1);
    console.log(`auto-update every ${hours}h — next run in ~${dueInH}h`);
  }
}
scheduleAuto();

/* The Instagram autopilot runs on its own clock. It ticks every 20 minutes so
 * a post goes out close to its slot rather than whenever the maintenance task
 * happens to fire, and each tick is cheap when there is nothing to do. */
let igTimer = null;
async function igTick() {
  if (autoIgRunning || !igAuto.enabled()) return;
  autoIgRunning = true;
  try {
    await igAuto.tick((l) => console.log('[ig-auto] ' + l));
  } catch (e) {
    console.log('[ig-auto] tick failed: ' + e.message);
  } finally {
    autoIgRunning = false;
  }
}
clearInterval(igTimer);
igTimer = setInterval(igTick, 20 * 60e3);
setTimeout(igTick, 90e3); // once shortly after boot, past the startup rush

// Bind to loopback only: nginx is the sole public entry point, so port 3400
// must not be reachable from the internet directly.
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`Promptaria running on http://${HOST}:${PORT}  (admin: /admin)`);
});
