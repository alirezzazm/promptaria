'use strict';
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const db = require('./db');
const { ensureCategories } = require('./categories');
const { runAll, syncSources } = require('../scraper/run');
const seo = require('./seo');
const ig = require('./instagram');
const postkit = require('./postkit');
const assistant = require('./assistant');

const PORT = Number(process.env.PORT || 3400);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'promptaria';
const SESSION_HOURS = 12;

ensureCategories();
syncSources();

const app = express();
// Carousel renders arrive as base64 PNGs and blow past a sane global limit, so
// the two Instagram upload routes get their own, much larger, parser. The global
// one has to skip those paths or it would reject the body before they run.
const IG_UPLOAD = /^\/api\/admin\/ig\/(publish|render-only)$/;
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
function scheduleAuto() {
  if (autoTimer) clearInterval(autoTimer);
  const hours = Number(setting('auto_hours', '12'));
  if (!hours) return console.log('auto-update disabled');
  autoTimer = setInterval(() => {
    console.log('[auto] scheduled scrape starting');
    startScrape(null);
  }, hours * 3600e3);
  console.log(`auto-update every ${hours}h`);
}
scheduleAuto();

// Bind to loopback only: nginx is the sole public entry point, so port 3400
// must not be reachable from the internet directly.
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`Promptaria running on http://${HOST}:${PORT}  (admin: /admin)`);
});
