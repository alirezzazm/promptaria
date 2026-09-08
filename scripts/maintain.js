'use strict';
/**
 * Everything the site needs done on a schedule, in one command.
 *
 * The app already runs its own 12-hour timer, but that only fires while the
 * process is alive. This script is the belt to that braces: a Windows task
 * runs it independently, so the catalogue stays fresh even if the app is down,
 * mid-deploy, or was restarted so often its in-process timer never elapsed.
 *
 * Safe to run at any time and as often as you like — every step is idempotent.
 *
 *   npm run maintain            full run
 *   npm run maintain -- --quick skip the scrape, just housekeeping
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'maintain.log');

const quick = process.argv.includes('--quick');
const started = Date.now();
const lines = [];

function log(msg) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `${stamp}  ${msg}`;
  console.log(line);
  lines.push(line);
}

function flush() {
  try {
    // keep the log from growing without bound
    let existing = '';
    if (fs.existsSync(LOG_FILE)) {
      existing = fs.readFileSync(LOG_FILE, 'utf8');
      const kept = existing.split('\n').slice(-4000).join('\n');
      existing = kept;
    }
    fs.writeFileSync(LOG_FILE, existing + '\n' + lines.join('\n') + '\n');
  } catch (e) {
    console.error('could not write log:', e.message);
  }
}

async function main() {
  log('=== maintenance run start ===');

  const db = require('../server/db');
  const before = db.prepare("SELECT COUNT(*) n FROM prompts WHERE status='published'").get().n;

  /* --- 1. scrape every enabled source ------------------------------- */
  if (quick) {
    log('[1/5] scrape skipped (--quick)');
  } else {
    log('[1/5] scraping all enabled sources…');
    const { runAll } = require('../scraper/run');
    try {
      const { total } = await runAll({ log: (l) => log('      ' + l) });
      log(`      found ${total.found}, added ${total.added}, updated ${total.updated}`);
    } catch (e) {
      log('      scrape failed: ' + e.message);
    }
  }

  /* --- 2. authored Persian prompts ---------------------------------- */
  log('[2/5] syncing authored Persian prompts…');
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'server', 'seed-fa.js')], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    log('      ' + out.trim().split('\n').pop());
  } catch (e) {
    log('      seed failed: ' + e.message);
  }

  /* --- 3. regenerate the Persian documentation ----------------------- */
  // Cheap, and it keeps every prompt's how-to consistent with the current
  // generator after any change to server/lib.js.
  log('[3/5] regenerating Persian docs…');
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'server', 'reenrich.js')], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    log('      ' + out.trim().split('\n').pop());
  } catch (e) {
    log('      reenrich failed: ' + e.message);
  }

  /* --- 4. housekeeping ---------------------------------------------- */
  log('[4/5] housekeeping…');
  try {
    const ig = require('../server/instagram');
    const removed = ig.pruneMedia(72);
    log(`      removed ${removed} expired carousel image(s)`);
  } catch (e) {
    log('      media prune skipped: ' + e.message);
  }
  try {
    const gone = db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run().changes;
    const kits = db.prepare("DELETE FROM post_kits WHERE expires_at <= datetime('now')").run().changes;
    log(`      cleared ${gone} expired session(s), ${kits} expired post kit(s)`);
  } catch (e) {
    log('      cleanup skipped: ' + e.message);
  }
  try {
    const runs = db
      .prepare('DELETE FROM scrape_runs WHERE id NOT IN (SELECT id FROM scrape_runs ORDER BY id DESC LIMIT 400)')
      .run().changes;
    if (runs) log(`      trimmed ${runs} old scrape-run record(s)`);
  } catch {}

  /* --- 5. report ----------------------------------------------------- */
  const after = db.prepare("SELECT COUNT(*) n FROM prompts WHERE status='published'").get().n;
  const srcOk = db.prepare("SELECT COUNT(*) n FROM sources WHERE last_status='ok'").get().n;
  const srcAll = db.prepare('SELECT COUNT(*) n FROM sources WHERE enabled=1').get().n;
  const broken = db
    .prepare("SELECT key, last_error FROM sources WHERE enabled=1 AND last_status='error'")
    .all();

  log(`[5/5] prompts ${before} → ${after} (+${after - before}) · sources ok ${srcOk}/${srcAll}`);
  for (const b of broken) log(`      BROKEN ${b.key}: ${String(b.last_error).slice(0, 120)}`);

  log(`=== done in ${Math.round((Date.now() - started) / 1000)}s ===`);
}

main()
  .catch((e) => {
    log('FATAL: ' + (e && e.stack ? e.stack.split('\n')[0] : e));
    process.exitCode = 1;
  })
  .finally(flush);
