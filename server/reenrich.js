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

const rows = db.prepare('SELECT id, title, body, tags, source_id, category_id FROM prompts').all();
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
  upd.run(
    e.summary, e.how_to, JSON.stringify(e.tips), JSON.stringify(e.variables), e.example_use,
    e.expected_out, JSON.stringify(e.best_models), e.difficulty, e.lang, e.quality,
    authored.has(r.id) ? r.category_id : cats.get(e.categorySlug) || cats.get('general'),
    r.id
  );
  n++;
}
db.exec('COMMIT');
console.log(`re-enriched ${n} prompts`);
