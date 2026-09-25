'use strict';
/**
 * Makes the small pictures shown on image-prompt cards and pages.
 *
 *   node scripts/thumbs.js          only rows that have no thumbnail yet
 *   node scripts/thumbs.js --all    redo every one
 *
 * The gallery originals average a megabyte each — too heavy for a card grid on
 * an Iranian mobile connection, and GitHub is not always reachable from there.
 * A headless Chrome (its own port and profile, never the Instagram window on
 * 9222) downsizes each one to a 720px JPEG in data/thumbs/<uid>.jpg, which
 * /img/<uid>.jpg serves with a long cache. The scraper calls make() after a run.
 */
const fs = require('fs');
const path = require('path');
const db = require('../server/db');
const cdp = require('../server/cdp');

const DIR = path.join(__dirname, '..', 'data', 'thumbs');
const PORT = 9333;
const PROFILE = path.join(process.env.ProgramData || 'C:\\ProgramData', 'promptaria', 'thumbs-profile');
const WIDTH = 720;

const fileFor = (uid) => path.join(DIR, uid + '.jpg');

async function make({ all = false, log = console.log } = {}) {
  fs.mkdirSync(DIR, { recursive: true });
  const rows = db
    .prepare("SELECT uid, image_url FROM prompts WHERE image_url IS NOT NULL AND image_url != '' AND status = 'published'")
    .all()
    .filter((r) => all || !fs.existsSync(fileFor(r.uid)));
  if (!rows.length) return { made: 0, failed: 0 };

  await cdp.launch({ port: PORT, profileDir: PROFILE, headless: true });
  const s = await cdp.attach(PORT);
  let made = 0;
  let failed = 0;
  try {
    for (const r of rows) {
      try {
        // raw.githubusercontent.com answers with Access-Control-Allow-Origin: *,
        // so the page can fetch and decode the bytes without tainting a canvas.
        const b64 = await s.eval(
          `(async () => {
             const res = await fetch(${JSON.stringify(r.image_url)});
             if (!res.ok) throw new Error('HTTP ' + res.status);
             const bmp = await createImageBitmap(await res.blob());
             const w = Math.min(${WIDTH}, bmp.width);
             const h = Math.round(bmp.height * (w / bmp.width));
             const c = new OffscreenCanvas(w, h);
             const g = c.getContext('2d');
             g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);   // PNGs with alpha
             g.drawImage(bmp, 0, 0, w, h);
             const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
             const buf = new Uint8Array(await blob.arrayBuffer());
             let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
             return btoa(s);
           })()`,
          { awaitPromise: true }
        );
        fs.writeFileSync(fileFor(r.uid), Buffer.from(b64, 'base64'));
        made++;
      } catch (e) {
        failed++;
        log(`  ! ${r.uid}: ${e.message}`);
      }
    }
  } finally {
    await cdp.closeBrowser(PORT);
  }
  log(`thumbnails: ${made} made, ${failed} failed`);
  return { made, failed };
}

module.exports = { make, fileFor, DIR };

if (require.main === module) {
  make({ all: process.argv.includes('--all') }).catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
