'use strict';
/**
 * Regenerates the Persian documentation (summary / how-to / tips / example /
 * expected output / variables) for every stored prompt, straight from the body
 * that is already in the database. No network access, no re-scrape.
 *
 *   npm run reenrich
 */
const db = require('./db');
const { enrich } = require('./lib');
const { ensureCategories } = require('./categories');
const { imageGuide } = require('./image-guide');
const SOURCES = require('../scraper/sources');

ensureCategories();

const cats = new Map(db.prepare('SELECT id, slug FROM categories').all().map((c) => [c.slug, c.id]));
const trustBySource = new Map(db.prepare('SELECT id, trust FROM sources').all().map((s) => [s.id, s.trust]));

// Prompts we wrote ourselves carry a hand-picked category from content/fa-prompts.js.
// Keyword detection is a guess; the author's choice is not, so it is kept.
const authored = new Set(
  db
    .prepare("SELECT p.id FROM prompts p JOIN sources s ON s.id = p.source_id WHERE s.key = 'promptaria-original'")
    .all()
    .map((r) => r.id)
);

// Their card summary is hand-written too (seed-fa owns it), so it is kept for the
// same reason — regenerating it would put the structural template back every run.
// Sources that pin a category (the image gallery) keep it: the keyword guess
// is exactly what the pin exists to overrule.
const pinned = new Set(
  db
    .prepare('SELECT id, key FROM sources')
    .all()
    .filter((s) => SOURCES.some((x) => x.key === s.key && x.category))
    .map((s) => s.id)
);

const rows = db
  .prepare('SELECT id, title, title_fa, body, tags, source_id, category_id, summary, image_url, input_note FROM prompts')
  .all();
const upd = db.prepare(
  `UPDATE prompts SET summary=?, how_to=?, tips=?, variables=?, example_use=?, expected_out=?,
     best_models=?, difficulty=?, lang=?, quality=?, category_id=? WHERE id=?`
);

let n = 0;
db.exec('BEGIN');
for (const r of rows) {
  let tags = [];
  try {
    tags = JSON.parse(r.tags) || [];
  } catch {}
  const e = enrich({ title: r.title, body: r.body, tags }, trustBySource.get(r.source_id) || 70);
  // image prompts get their own guide (server/image-guide.js), not the chat one
  if (r.image_url) Object.assign(e, imageGuide({ title: r.title_fa || r.title, inputNote: r.input_note }));
  upd.run(
    authored.has(r.id) && r.summary ? r.summary : e.summary, e.how_to, JSON.stringify(e.tips), JSON.stringify(e.variables), e.example_use,
    e.expected_out, JSON.stringify(e.best_models), e.difficulty, e.lang, e.quality,
    authored.has(r.id) || pinned.has(r.source_id) ? r.category_id : cats.get(e.categorySlug) || cats.get('general'),
    r.id
  );
  n++;
}
db.exec('COMMIT');
console.log(`re-enriched ${n} prompts`);
