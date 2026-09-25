'use strict';
/**
 * Loads Persian titles into prompts.title_fa from TSV files of `id<TAB>title`.
 *
 *   node scripts/import-title-fa.js <dir-or-file> [...]
 *
 * Only fills rows that have no Persian title yet unless --force is given, so
 * re-running a batch never clobbers a title that was later corrected by hand.
 */
const fs = require('fs');
const path = require('path');
const db = require('../server/db');

const force = process.argv.includes('--force');
const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!targets.length) {
  console.error('usage: node scripts/import-title-fa.js <dir-or-file> [...] [--force]');
  process.exit(1);
}

const files = targets.flatMap((t) =>
  fs.statSync(t).isDirectory()
    ? fs
        .readdirSync(t)
        .filter((f) => /^out_.*\.tsv$/.test(f))
        .sort()
        .map((f) => path.join(t, f))
    : [t]
);

const upd = db.prepare(
  force
    ? 'UPDATE prompts SET title_fa = ? WHERE id = ?'
    : 'UPDATE prompts SET title_fa = ? WHERE id = ? AND (title_fa IS NULL OR title_fa = \'\')'
);

let set = 0;
let skipped = 0;
db.exec('BEGIN');
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const tab = line.indexOf('\t');
    if (tab < 1) continue;
    const id = Number(line.slice(0, tab));
    const fa = line.slice(tab + 1).trim();
    if (!id || !fa) continue;
    if (upd.run(fa, id).changes) set++;
    else skipped++;
  }
}
db.exec('COMMIT');

const left = db
  .prepare(
    "SELECT COUNT(*) n FROM prompts WHERE status='published' AND (title_fa IS NULL OR title_fa='') AND title NOT GLOB '*[؀-ۿ]*'"
  )
  .get().n;
console.log(`files ${files.length} · set ${set} · skipped ${skipped} · still English-only ${left}`);
