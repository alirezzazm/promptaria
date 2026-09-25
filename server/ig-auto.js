'use strict';
/**
 * Unattended Instagram posting.
 *
 * The studio has always been able to compose a post and draw its carousel —
 * but the drawing happened in the admin's browser, so a human had to be
 * present. This module removes that requirement by rendering the very same
 * canvases in headless Chrome, which is already on this box: it loads a page
 * we serve, runs the existing IGStudio renderer, and posts the JPEGs back to
 * us. No native image dependency, no second copy of the slide design.
 *
 * The pipeline, per post:
 *
 *   pick → enqueue (scheduled) → render (headless Chrome) → publish (Graph API)
 *
 * Each stage is separately retryable and the queue survives restarts, so a
 * missing Graph token is not an error — posts simply pile up as `ready` and
 * go out the moment a token appears.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const db = require('./db');
const ig = require('./instagram');
const igBrowser = require('./ig-browser');
const postkit = require('./postkit');

const PORT = Number(process.env.PORT || 3400);
const LOCAL = `http://127.0.0.1:${PORT}`;

/* Tehran runs at a fixed +3:30 — the country dropped DST in 2022, so no
 * seasonal arithmetic is needed. */
const TEHRAN_OFFSET_MIN = 210;

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */
db.exec(`
  CREATE TABLE IF NOT EXISTS ig_queue (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_uid    TEXT NOT NULL,
    title         TEXT NOT NULL,
    caption       TEXT NOT NULL,
    slides        TEXT NOT NULL,
    image_urls    TEXT,
    job_token     TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    scheduled_at  TEXT NOT NULL,
    rendered_at   TEXT,
    published_at  TEXT,
    media_id      TEXT,
    attempts      INTEGER NOT NULL DEFAULT 0,
    error         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS ig_queue_due ON ig_queue(status, scheduled_at);
  CREATE INDEX IF NOT EXISTS ig_queue_uid ON ig_queue(prompt_uid);
`);

/* Added once the manual path became the primary one: a post kit is the phone
 * page that carries the slides and caption, so a rendered post is useful even
 * with no Graph token. Older databases predate these columns. */
for (const col of ['kit_url TEXT', 'kit_expires TEXT']) {
  try {
    db.exec(`ALTER TABLE ig_queue ADD COLUMN ${col}`);
  } catch {
    /* already there */
  }
}

const setting = (k, d = null) => {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
  return r ? r.value : d;
};
const putSetting = (k, v) =>
  db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(k, String(v));

const enabled = () => setting('ig_auto', '0') === '1';
const perDay = () => Math.max(1, Math.min(3, Number(setting('ig_auto_per_day', '1')) || 1));
/** Local hours at which posts go out, Tehran time. */
const slots = () =>
  String(setting('ig_auto_slots', '21,13,18'))
    .split(',')
    .map((h) => Number(h.trim()))
    .filter((h) => Number.isInteger(h) && h >= 0 && h < 24);

/* ------------------------------------------------------------------ *
 * Choosing what to post
 * ------------------------------------------------------------------ */
/**
 * The best prompt we have not posted yet. Persian originals come first —
 * they are ours, they are the ones worth driving traffic to, and they read
 * far better on a slide than a translated English body.
 */
function pickPrompt() {
  const lastCat = db
    .prepare(
      `SELECT c.slug FROM ig_queue q
       JOIN prompts p ON p.uid = q.prompt_uid
       LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY q.id DESC LIMIT 1`
    )
    .get();

  const sql = (extra) => `
    SELECT p.*, c.slug AS cat_slug, c.name_fa AS cat_name, c.icon, COALESCE(p.title_fa, p.title) AS title, p.title AS title_en
    FROM prompts p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN sources s ON s.id = p.source_id
    WHERE p.status = 'published'
      AND p.uid NOT IN (SELECT prompt_uid FROM ig_queue)
      AND length(p.body) BETWEEN 200 AND 4000
      AND p.summary IS NOT NULL AND p.how_to IS NOT NULL
      ${extra}
    ORDER BY s.key = 'promptaria-original' DESC, p.quality DESC, RANDOM()
    LIMIT 1`;

  // Don't post the same category twice running; fall back if that empties out.
  return (
    (lastCat && lastCat.slug
      ? db.prepare(sql('AND (c.slug IS NULL OR c.slug <> ?)')).get(lastCat.slug)
      : null) || db.prepare(sql('')).get()
  );
}

/* ------------------------------------------------------------------ *
 * Queue
 * ------------------------------------------------------------------ */
/** The next unused slot at or after `from`, as a UTC datetime string. */
function nextSlotAfter(from) {
  const hours = slots().slice(0, perDay()).sort((a, b) => a - b);
  if (!hours.length) hours.push(21);

  for (let day = 0; day < 60; day++) {
    for (const h of hours) {
      // Build the Tehran-local wall clock, then shift back to UTC.
      const local = new Date(from.getTime() + TEHRAN_OFFSET_MIN * 60e3);
      local.setUTCDate(local.getUTCDate() + day);
      local.setUTCHours(h, 0, 0, 0);
      const utc = new Date(local.getTime() - TEHRAN_OFFSET_MIN * 60e3);
      if (utc <= from) continue;

      const stamp = utc.toISOString().slice(0, 19).replace('T', ' ');
      const taken = db
        .prepare("SELECT 1 FROM ig_queue WHERE scheduled_at = ? AND status <> 'cancelled'")
        .get(stamp);
      if (!taken) return stamp;
    }
  }
  return null;
}

function enqueue({ uid = null, at = null } = {}) {
  const row = uid
    ? db
        .prepare(
          `SELECT p.*, c.slug AS cat_slug, c.name_fa AS cat_name, c.icon, COALESCE(p.title_fa, p.title) AS title, p.title AS title_en
           FROM prompts p LEFT JOIN categories c ON c.id = p.category_id WHERE p.uid = ?`
        )
        .get(uid)
    : pickPrompt();
  if (!row) throw new Error('پرامپت مناسبی برای پست پیدا نشد');

  const post = ig.composePost(row);
  const when = at || nextSlotAfter(new Date());
  if (!when) throw new Error('جای خالی در تقویم انتشار پیدا نشد');

  const info = db
    .prepare(
      `INSERT INTO ig_queue (prompt_uid, title, caption, slides, job_token, scheduled_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.uid,
      row.title,
      post.caption,
      JSON.stringify(post.slides),
      crypto.randomBytes(16).toString('hex'),
      when
    );
  return db.prepare('SELECT * FROM ig_queue WHERE id = ?').get(info.lastInsertRowid);
}

/** Keep the calendar filled `days` ahead so there is always something queued. */
function topUp(days = 3, log = () => {}) {
  const want = days * perDay();
  const have = db
    .prepare("SELECT COUNT(*) n FROM ig_queue WHERE status IN ('pending','ready')")
    .get().n;
  let made = 0;
  for (let i = have; i < want; i++) {
    try {
      const r = enqueue();
      log(`صف: «${r.title}» برای ${r.scheduled_at} UTC`);
      made++;
    } catch (e) {
      log('صف پر نشد: ' + e.message);
      break;
    }
  }
  return made;
}

/* ------------------------------------------------------------------ *
 * Rendering — headless Chrome draws the same canvases the studio does
 * ------------------------------------------------------------------ */
function chromePath() {
  const custom = setting('chrome_path', '');
  const candidates = [
    custom,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens the render page in headless Chrome and waits for the page to POST its
 * JPEGs back. We poll the row rather than trusting Chrome's exit code: the
 * browser is a renderer here, not a workflow step, and killing it once the
 * images have landed is the most reliable way to end the run.
 */
async function renderJob(row, log = () => {}) {
  const exe = chromePath();
  if (!exe) throw new Error('کروم پیدا نشد — مسیرش را در تنظیمات chrome_path بگذار');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'promptaria-ig-'));
  const url = `${LOCAL}/ig/auto/${row.job_token}`;
  const child = spawn(
    exe,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--window-size=1100,1400',
      `--user-data-dir=${profile}`,
      url,
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  const deadline = Date.now() + 120e3;
  let done = null;
  try {
    while (Date.now() < deadline) {
      await wait(700);
      const cur = db.prepare('SELECT status, image_urls, error FROM ig_queue WHERE id = ?').get(row.id);
      if (cur.status === 'ready' || cur.status === 'failed') {
        done = cur;
        break;
      }
    }
  } finally {
    try {
      child.kill();
    } catch {}
    setTimeout(() => fs.rm(profile, { recursive: true, force: true }, () => {}), 2000);
  }

  if (!done) throw new Error('رندر در مهلت ۱۲۰ ثانیه تمام نشد');
  if (done.status === 'failed') throw new Error(done.error || 'رندر ناموفق بود');
  log(`رندر شد: ${JSON.parse(done.image_urls).length} اسلاید`);
  return JSON.parse(done.image_urls);
}

/** Called by the render page when it has drawn everything. */
function acceptRender(token, dataUrls) {
  const row = db.prepare("SELECT * FROM ig_queue WHERE job_token = ? AND status = 'pending'").get(token);
  if (!row) throw new Error('کار رندر پیدا نشد');
  const urls = ig.saveSlides(row.prompt_uid, dataUrls);
  db.prepare(
    `UPDATE ig_queue SET image_urls = ?, status = 'ready', rendered_at = datetime('now'), error = NULL
     WHERE id = ?`
  ).run(JSON.stringify(urls), row.id);
  return urls;
}

function failRender(token, message) {
  db.prepare("UPDATE ig_queue SET status = 'failed', error = ? WHERE job_token = ? AND status = 'pending'").run(
    String(message).slice(0, 400),
    token
  );
}

function jobByToken(token) {
  return db.prepare('SELECT * FROM ig_queue WHERE job_token = ?').get(token);
}

/**
 * Builds the phone page for a rendered post and remembers its address.
 *
 * Without a Graph token the carousel still has to reach Instagram somehow, and
 * the kit is that route: open it on the phone, save six images, copy the
 * caption. It outlives neither its own 72h expiry nor the media prune, so the
 * tick re-makes it when either lapses.
 */
function makeKit(row, log = () => {}) {
  const p = db
    .prepare(
      `SELECT p.*, c.slug AS cat_slug, COALESCE(p.title_fa, p.title) AS title, p.title AS title_en FROM prompts p
       LEFT JOIN categories c ON c.id = p.category_id WHERE p.uid = ?`
    )
    .get(row.prompt_uid);
  const kit = postkit.createKit({
    uid: row.prompt_uid,
    title: row.title,
    caption: row.caption,
    hashtags: ig.hashtags((p && p.cat_slug) || 'general', 30).join(' '),
    images: JSON.parse(row.image_urls),
  });
  db.prepare(
    `UPDATE ig_queue SET kit_url = ?, kit_expires = datetime('now', '+${postkit.KIT_HOURS} hours')
     WHERE id = ?`
  ).run(kit.url, row.id);
  log(`کیت ساخته شد: ${kit.url}`);
  return kit.url;
}

/* ------------------------------------------------------------------ *
 * Publishing
 * ------------------------------------------------------------------ */
/**
 * One tick of the whole machine. Safe to call as often as you like: it only
 * renders what is close to due, and only publishes what is actually due.
 */
async function tick(log = () => {}) {
  if (!enabled()) {
    log('پست خودکار خاموش است (ig_auto)');
    return { rendered: 0, published: 0 };
  }

  /* A kit and its images both die at 72h. If either lapsed before the post was
   * actually used, send the row back for a fresh render rather than leaving a
   * dead link in the queue. */
  for (const r of db.prepare("SELECT * FROM ig_queue WHERE status = 'ready'").all()) {
    const gone =
      !r.image_urls ||
      JSON.parse(r.image_urls).some(
        (u) => !fs.existsSync(path.join(__dirname, '..', 'public', 'ig', u.split('/').pop()))
      );
    const kitDead =
      r.kit_url && r.kit_expires && Date.parse(r.kit_expires.replace(' ', 'T') + 'Z') < Date.now();
    if (gone || kitDead) {
      log(`«${r.title}» کهنه شد — دوباره ساخته می‌شود`);
      db.prepare(
        `UPDATE ig_queue SET status = 'pending', image_urls = NULL, kit_url = NULL,
         kit_expires = NULL, attempts = 0, job_token = ? WHERE id = ?`
      ).run(crypto.randomBytes(16).toString('hex'), r.id);
    }
  }

  /* Retire posts that have had their turn, or the queue jams at three and no
   * new content is ever prepared.
   *
   * This used to infer "posted" from the kit having been opened, which was
   * wrong in both directions — opening a kit to look at it counted as posting,
   * and any crawler or test fetch did too. The kit list has an explicit
   * "پست شد" button now, so the only inference left is the harmless one:
   * a post three days past its slot has been overtaken by fresher material. */
  if (!ig.igConfig().connected) {
    const stale = db
      .prepare(
        `SELECT id, title FROM ig_queue
         WHERE status = 'ready' AND scheduled_at <= datetime('now', '-3 days')`
      )
      .all();
    for (const r of stale) {
      db.prepare("UPDATE ig_queue SET status = 'skipped' WHERE id = ?").run(r.id);
      log(`«${r.title}» سه روز بی‌استفاده ماند — رد شد`);
    }
  }

  topUp(3, log);

  const out = { rendered: 0, published: 0, kits: 0 };

  /* Render anything due within the next few hours, so the image is already
   * hosted when the publish moment arrives. */
  /* With a token, rendering just before the slot keeps the media fresh. Without
   * one the kit is the product, so render the next two days up front and have
   * the links waiting. Both windows stay inside the 72h media prune. */
  const connected = ig.igConfig().connected;
  const horizon = connected ? '+6 hours' : '+48 hours';
  const toRender = db
    .prepare(
      `SELECT * FROM ig_queue
       WHERE status = 'pending' AND attempts < 3
         AND scheduled_at <= datetime('now', ?)
       ORDER BY scheduled_at LIMIT 3`
    )
    .all(horizon);
  for (const row of toRender) {
    db.prepare('UPDATE ig_queue SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    try {
      log(`رندر «${row.title}»…`);
      await renderJob(row, log);
      out.rendered++;
      if (!connected) {
        const fresh = db.prepare('SELECT * FROM ig_queue WHERE id = ?').get(row.id);
        makeKit(fresh, log);
        out.kits = (out.kits || 0) + 1;
      }
    } catch (e) {
      log('رندر شکست خورد: ' + e.message);
      db.prepare('UPDATE ig_queue SET error = ? WHERE id = ?').run(String(e.message).slice(0, 400), row.id);
    }
  }

  /* Publish at most one per tick — a burst looks like a bot and Instagram
   * rate-limits content publishing to 50 posts per rolling 24h anyway. */
  const due = db
    .prepare(
      `SELECT * FROM ig_queue
       WHERE status = 'ready' AND scheduled_at <= datetime('now')
       ORDER BY scheduled_at LIMIT 1`
    )
    .get();
  if (!due) return out;

  /* Housekeeping prunes /ig after 72h, so a post that sat in the queue waiting
   * for a token can lose its images. Send it back for a re-render rather than
   * handing Meta a set of dead URLs. */
  const missing = JSON.parse(due.image_urls).some(
    (u) => !fs.existsSync(path.join(__dirname, '..', 'public', 'ig', u.split('/').pop()))
  );
  if (missing) {
    log(`تصاویر «${due.title}» پاک شده بود — دوباره رندر می‌شود`);
    db.prepare(
      `UPDATE ig_queue SET status = 'pending', image_urls = NULL, attempts = 0,
       job_token = ? WHERE id = ?`
    ).run(crypto.randomBytes(16).toString('hex'), due.id);
    return out;
  }

  /* A hard floor between automated posts, on top of the once-a-day slots. Even
   * if several rows come due at once (a backlog, a clock jump), nothing posts
   * closer together than this — a burst is exactly what gets an account
   * flagged. */
  const minGapH = Math.max(1, Number(setting('ig_min_gap_hours', '6')) || 6);
  const last = setting('ig_last_post', null);
  if (last) {
    const sinceH = (Date.now() - Date.parse(last)) / 3600e3;
    if (sinceH < minGapH) {
      log(`فاصله‌ی انتشار: ${sinceH.toFixed(1)} ساعت از آخرین پست — کمتر از ${minGapH}، صبر می‌کنم`);
      return out;
    }
  }

  const graph = ig.igConfig().connected;
  const browserAuto = setting('ig_auto_browser', '0') === '1';

  if (!graph && !browserAuto) {
    const waiting = db
      .prepare("SELECT COUNT(*) n FROM ig_queue WHERE status = 'ready' AND scheduled_at <= datetime('now')")
      .get().n;
    log(`${waiting} پست آماده است — نه توکن گراف، نه انتشار خودکار مرورگر؛ در صف می‌ماند`);
    return out;
  }

  try {
    let mediaId = 'browser';
    if (graph) {
      log(`انتشار «${due.title}» با API…`);
      const r = await ig.publishCarousel({
        imageUrls: JSON.parse(due.image_urls),
        caption: due.caption,
        log: (l) => log('  ' + l),
      });
      mediaId = String((r && (r.id || r.media_id)) || '');
    } else {
      // Browser route: only if the persistent window is up and holds a live
      // session. If not, leave the row ready and fall back to the kit — never
      // spawn a browser here, that is what invalidates the session.
      const state = await igBrowser.loginState((l) => log('  ' + l));
      if (!state.running || !state.loggedIn) {
        log(`انتشار خودکار مرورگر ممکن نیست (${state.reason || 'لاگین نیست'}) — از کیت استفاده کن`);
        return out;
      }
      log(`انتشار «${due.title}» با مرورگر…`);
      await igBrowser.publish(
        { imagePaths: igBrowser.pathsFor(due.image_urls), caption: due.caption },
        (l) => log('  ' + l)
      );
    }
    db.prepare(
      `UPDATE ig_queue SET status = 'published', published_at = datetime('now'), media_id = ?, error = NULL
       WHERE id = ?`
    ).run(mediaId, due.id);
    putSetting('ig_last_post', new Date().toISOString());
    out.published++;
    log('منتشر شد ✔');
  } catch (e) {
    log('انتشار شکست خورد: ' + e.message);
    db.prepare('UPDATE ig_queue SET attempts = attempts + 1, error = ? WHERE id = ?').run(
      String(e.message).slice(0, 400),
      due.id
    );
    if (due.attempts + 1 >= 3) {
      db.prepare("UPDATE ig_queue SET status = 'failed' WHERE id = ?").run(due.id);
    }
  }
  return out;
}

function queue(limit = 30) {
  return db
    .prepare(
      `SELECT id, prompt_uid, title, status, scheduled_at, published_at, attempts, error,
              kit_url, kit_expires, length(caption) caption_length
       FROM ig_queue ORDER BY
         CASE status WHEN 'ready' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
         scheduled_at LIMIT ?`
    )
    .all(limit);
}

function stats() {
  const by = {};
  for (const r of db.prepare('SELECT status, COUNT(*) n FROM ig_queue GROUP BY status').all()) by[r.status] = r.n;
  const next = db
    .prepare("SELECT title, scheduled_at FROM ig_queue WHERE status IN ('pending','ready') ORDER BY scheduled_at LIMIT 1")
    .get();
  return {
    enabled: enabled(),
    per_day: perDay(),
    slots: slots().slice(0, perDay()),
    connected: ig.igConfig().connected,
    browser_auto: setting('ig_auto_browser', '0') === '1',
    min_gap_hours: Math.max(1, Number(setting('ig_min_gap_hours', '6')) || 6),
    counts: by,
    next: next || null,
    last_post: setting('ig_last_post', null),
  };
}

module.exports = {
  enqueue,
  makeKit,
  topUp,
  tick,
  renderJob,
  queue,
  stats,
  pickPrompt,
  acceptRender,
  failRender,
  jobByToken,
  chromePath,
  enabled,
};
