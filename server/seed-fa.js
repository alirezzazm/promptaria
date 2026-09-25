'use strict';
/**
 * Seeds the Persian-native prompts from content/fa-prompts.js.
 *
 * They go in under their own source so the admin panel shows where they came
 * from, and they skip the scraper's category guesser — these are hand-filed,
 * and the guesser is tuned for English text anyway.
 *
 *   npm run seed:fa
 */
const db = require('./db');
const { enrich, uid, bodyHash } = require('./lib');
const { ensureCategories } = require('./categories');
const items = require('../content/fa-prompts');

const SOURCE_KEY = 'promptaria-original';

ensureCategories();

db.prepare(
  `INSERT INTO sources (key, name, home_url, kind, trust, license, enabled)
   VALUES (?, ?, ?, 'original', 99, 'Promptaria', 1)
   ON CONFLICT(key) DO UPDATE SET name = excluded.name, trust = excluded.trust`
).run(SOURCE_KEY, 'Promptaria — تألیف اختصاصی', 'https://promptaria.ir');

const src = db.prepare('SELECT * FROM sources WHERE key = ?').get(SOURCE_KEY);
const catId = (slug) => {
  const r = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
  return r ? r.id : null;
};

let added = 0;
let updated = 0;
let skipped = 0;

for (const item of items) {
  // category is authored, not guessed — pass it through so enrich() keeps it
  const e = enrich({ title: item.title, body: item.body, tags: item.tags, category: item.category }, 99);
  // A hand-written card summary says what the reader gets; the generated one can
  // only describe how the prompt is built, so the authored one wins when present.
  const summary = item.summary || e.summary;
  const id = uid(SOURCE_KEY, e.title, e.body);
  const hash = bodyHash(e.body);

  const dupe = db.prepare('SELECT uid FROM prompts WHERE body_hash = ?').get(hash);
  if (dupe && dupe.uid !== id) {
    skipped++;
    continue;
  }

  const existing = db.prepare('SELECT id, body_hash, summary FROM prompts WHERE uid = ?').get(id);
  if (existing) {
    if (existing.body_hash === hash) {
      // Body untouched, but a summary can be written or reworded on its own.
      if (existing.summary !== summary) {
        db.prepare(`UPDATE prompts SET summary=?, updated_at=datetime('now') WHERE id=?`).run(summary, existing.id);
        updated++;
      } else {
        skipped++;
      }
      continue;
    }
    // featured=1 is a ranking boost here (assistant, collections, "best" sort), not
    // the card label — seo.js labels originals "تألیف اختصاصی" instead of "منتخب".
    db.prepare(
      `UPDATE prompts SET title=?, body=?, summary=?, how_to=?, tips=?, variables=?, example_use=?,
       expected_out=?, best_models=?, tags=?, category_id=?, difficulty=?, lang='fa', quality=?,
       body_hash=?, featured=1, updated_at=datetime('now') WHERE id=?`
    ).run(
      e.title, e.body, summary, e.how_to, JSON.stringify(e.tips), JSON.stringify(e.variables),
      e.example_use, e.expected_out, JSON.stringify(e.best_models), JSON.stringify(e.tags),
      catId(item.category), e.difficulty, e.quality, hash, existing.id
    );
    updated++;
    continue;
  }

  db.prepare(
    `INSERT INTO prompts (uid, title, slug, body, summary, how_to, tips, variables, example_use,
      expected_out, best_models, tags, category_id, difficulty, lang, quality, status, featured,
      source_id, source_url, source_author, body_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'fa',?,'published',1,?,?,?,?)`
  ).run(
    id, e.title, e.slug, e.body, summary, e.how_to, JSON.stringify(e.tips), JSON.stringify(e.variables),
    e.example_use, e.expected_out, JSON.stringify(e.best_models), JSON.stringify(e.tags),
    catId(item.category), e.difficulty, e.quality, src.id, 'https://promptaria.ir', 'Promptaria', hash
  );
  added++;
}

console.log(`Persian prompts — added ${added}, updated ${updated}, skipped ${skipped}`);
