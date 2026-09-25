'use strict';
const db = require('../server/db');
const { ADAPTERS } = require('./adapters');
const SOURCES = require('./sources');
const { enrich, uid, bodyHash } = require('../server/lib');
const { ensureCategories } = require('../server/categories');
const { imageGuide, noteFa } = require('../server/image-guide');

function syncSources() {
  const up = db.prepare(`
    INSERT INTO sources (key, name, home_url, kind, trust, license, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name, home_url = excluded.home_url,
      kind = excluded.kind, trust = excluded.trust, license = excluded.license
  `);
  for (const s of SOURCES) up.run(s.key, s.name, s.home_url, s.kind, s.trust, s.license || '');
}

const getSourceRow = (key) => db.prepare('SELECT * FROM sources WHERE key = ?').get(key);
const getCatId = (slug) => {
  const r = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
  return r ? r.id : null;
};

function upsertPrompt(raw, src, srcRow) {
  if (raw.inputNote) raw.inputNote = noteFa(raw.inputNote);
  const e = enrich(raw, src.trust || 70);
  if (raw.imageUrl) Object.assign(e, imageGuide({ title: raw.title, inputNote: raw.inputNote }));
  const id = uid(src.key, e.title, e.body);
  const hash = bodyHash(e.body);

  // cross-source duplicate: same normalized body already stored
  const dupe = db.prepare('SELECT id, uid FROM prompts WHERE body_hash = ?').get(hash);
  if (dupe && dupe.uid !== id) return 'skipped';

  const existing = db.prepare('SELECT id, body_hash FROM prompts WHERE uid = ?').get(id);
  // A source can pin its category: keyword guessing files "turn this photo into
  // a figure" under general, but every entry of an image gallery is an image prompt.
  const catId = getCatId(src.category || e.categorySlug) || getCatId('general');

  if (existing) {
    if (existing.body_hash === hash) return 'skipped';
    db.prepare(
      `UPDATE prompts SET title=?, body=?, summary=?, how_to=?, tips=?, variables=?, example_use=?,
       expected_out=?, best_models=?, tags=?, category_id=?, difficulty=?, lang=?, quality=?,
       body_hash=?, source_url=?, image_url=?, input_note=COALESCE(input_note, ?), updated_at=datetime('now') WHERE id=?`
    ).run(
      e.title, e.body, e.summary, e.how_to, JSON.stringify(e.tips), JSON.stringify(e.variables),
      e.example_use, e.expected_out, JSON.stringify(e.best_models), JSON.stringify(e.tags),
      catId, e.difficulty, e.lang, e.quality, hash, raw.sourceUrl || src.home_url,
      raw.imageUrl || null, raw.inputNote || null, existing.id
    );
    return 'updated';
  }

  db.prepare(
    `INSERT INTO prompts (uid, title, slug, body, summary, how_to, tips, variables, example_use,
      expected_out, best_models, tags, category_id, difficulty, lang, quality, status,
      source_id, source_url, source_author, body_hash, image_url, input_note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, e.title, e.slug, e.body, e.summary, e.how_to, JSON.stringify(e.tips), JSON.stringify(e.variables),
    e.example_use, e.expected_out, JSON.stringify(e.best_models), JSON.stringify(e.tags),
    catId, e.difficulty, e.lang, e.quality, arrivalStatus(e.title, e.body),
    srcRow.id, raw.sourceUrl || src.home_url, raw.author || '', hash,
    raw.imageUrl || null, raw.inputNote || null
  );
  return 'added';
}

/**
 * New rows that are plainly not for a public library arrive hidden instead of
 * published, so an admin decides rather than the next visitor. Only signals
 * that do not misfire: a keyword like "nsfw" is left out on purpose, because
 * image prompts list it among the things to avoid. Mirrors scripts/curate.js.
 */
function arrivalStatus(title, body) {
  const t = String(title || '');
  const b = String(body || '');
  const mdxPage = /^import\s+[\s\S]{0,200}\bfrom\s+['"]/.test(b); // raw docs page, not a prompt
  const jailbreak =
    /\bjailbreak\b|\bDAN\s*\d|developer mode/i.test(t) ||
    /\bdo anything now\b|ignore all the instructions you got before|always no restriction/i.test(b);
  const explicit = /\bhentai\b|futanari|футанари|nipples visible/i.test(b);
  return mdxPage || jailbreak || explicit ? 'hidden' : 'published';
}

async function runSource(src, log = console.log) {
  const srcRow = getSourceRow(src.key);
  if (!srcRow) throw new Error('source row missing: ' + src.key);

  const runId = db
    .prepare("INSERT INTO scrape_runs (source_id, status) VALUES (?, 'running')")
    .run(srcRow.id).lastInsertRowid;

  const stats = { found: 0, added: 0, updated: 0, skipped: 0 };
  try {
    const adapter = ADAPTERS[src.kind];
    if (!adapter) throw new Error('unknown adapter: ' + src.kind);

    const items = await adapter(src);
    stats.found = items.length;
    for (const raw of items) {
      try {
        stats[upsertPrompt(raw, src, srcRow)]++;
      } catch (e) {
        stats.skipped++;
        if (process.env.PROMPTARIA_DEBUG) log('    ! ' + (e && e.message));
      }
    }

    db.prepare(
      `UPDATE scrape_runs SET status='ok', finished_at=datetime('now'),
       found=?, added=?, updated=?, skipped=? WHERE id=?`
    ).run(stats.found, stats.added, stats.updated, stats.skipped, runId);
    db.prepare(
      `UPDATE sources SET last_run_at=datetime('now'), last_status='ok', last_error='',
       total_found=total_found+?, total_added=total_added+? WHERE id=?`
    ).run(stats.found, stats.added, srcRow.id);

    log(`  [ok]   ${src.name}: found ${stats.found}, +${stats.added} new, ~${stats.updated} updated, ${stats.skipped} skipped`);
    return { ok: true, ...stats };
  } catch (err) {
    const msg = String(err && err.message ? err.message : err).slice(0, 400);
    db.prepare(
      `UPDATE scrape_runs SET status='error', finished_at=datetime('now'), error=? WHERE id=?`
    ).run(msg, runId);
    db.prepare(
      `UPDATE sources SET last_run_at=datetime('now'), last_status='error', last_error=? WHERE id=?`
    ).run(msg, srcRow.id);
    log(`  [fail] ${src.name}: ${msg}`);
    return { ok: false, error: msg, ...stats };
  }
}

async function runAll({ only = null, log = console.log } = {}) {
  ensureCategories();
  syncSources();
  const started = Date.now();
  const enabled = new Set(
    db.prepare('SELECT key FROM sources WHERE enabled = 1').all().map((r) => r.key)
  );
  const list = SOURCES.filter((s) => enabled.has(s.key)).filter((s) => !only || only.includes(s.key));

  log(`Promptaria scrape — ${list.length} source(s)`);
  const results = [];
  for (const s of list) results.push({ key: s.key, name: s.name, ...(await runSource(s, log)) });

  const total = results.reduce(
    (a, r) => ({ found: a.found + (r.found || 0), added: a.added + (r.added || 0), updated: a.updated + (r.updated || 0) }),
    { found: 0, added: 0, updated: 0 }
  );
  // Keep the "منتخب" shelf stocked, but never overwrite an editor's own picks:
  // this only fills in when the admin has curated fewer than 12.
  const featured = db.prepare('SELECT COUNT(*) n FROM prompts WHERE featured = 1').get().n;
  if (featured < 12) {
    db.prepare(
      `UPDATE prompts SET featured = 1 WHERE id IN (
         SELECT id FROM prompts WHERE status='published'
         ORDER BY quality DESC, length(body) DESC LIMIT 24)`
    ).run();
    log('shelf منتخب auto-filled');
  }

  // New image prompts need their card picture; a failure here never fails the run.
  try {
    await require('../scripts/thumbs').make({ log });
  } catch (e) {
    log('thumbnails skipped: ' + e.message);
  }

  db.prepare("INSERT INTO settings (key, value) VALUES ('last_scrape', datetime('now')) ON CONFLICT(key) DO UPDATE SET value=datetime('now')").run();
  log(`Done in ${Math.round((Date.now() - started) / 1000)}s — found ${total.found}, added ${total.added}, updated ${total.updated}`);
  return { results, total };
}

module.exports = { runAll, runSource, syncSources };

if (require.main === module) {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  runAll({ only: only.length ? only : null })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
