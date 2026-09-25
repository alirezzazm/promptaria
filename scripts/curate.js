'use strict';
/**
 * Hides scraped entries that should not be on a public Persian prompt library.
 *
 *   node scripts/curate.js          apply
 *   node scripts/curate.js --dry    list what would change, touch nothing
 *
 * Every entry here was read by hand while translating titles; nothing is
 * matched by keyword alone, because a keyword pass flags image prompts that
 * list "nsfw" among the things to avoid. Rows are set to status 'hidden', never
 * deleted: the admin panel lists them under «مخفی» and can publish any of them
 * again. The scraper's update path never touches status, so a re-scrape does
 * not bring them back.
 */
const db = require('../server/db');

const dry = process.argv.includes('--dry');

const GROUPS = {
  // Sexual or fetish content. 2914 also places a child-like character in a
  // sexual scene — delete it outright from the admin panel, don't just hide it.
  sexual: [2912, 2914, 1976, 1632, 1764, 2723, 1076, 1077, 1550],

  // Jailbreak prompts (DAN and its relatives) and tools for building them.
  // They exist to defeat the models' safety rules, age badly, and are the kind
  // of page that gets a site flagged. The *educational* page about jailbreaking
  // (2978) is not in this list.
  jailbreak: [
    155, 2182, 2209, 2278, 2283, 2657, 2690, 2693, 2694, 2695, 2696, 2697, 2698, 2699, 2700,
    2701, 2702, 2703, 2704, 2705, 2706, 2707, 2208, 430, 871,
    2212, // Antikythera: opens as a persona template, embeds DAN further down
  ],

  // Not prompts at all: article prose the HTML adapters cut out along with the
  // real prompts — author bios, "Keep reading", tips paragraphs, sample model
  // *outputs*, and the extraction trick 2167 in place of an actual prompt.
  // Article sections that do contain usable prompt lists stay published.
  notPrompt: [
    2835, 2841, 2842, 2843, 2844, 2861, // semrush
    2885, 2886, 2887, 2888, 2889, 2890, 2891, // writesonic
    2892, 2893, 2894, 2900, 2901, 2902, 2903, 2904, 2905, // hubspot
    2990, 2991, 2992, 2993, 2995, 2996, 2998, 2999, 3000, 3002, 3003, 3004, 3005, 3006, 3008,
    3009, 3010, 3011, 3012, 3014, 3015, 3016, 3017, 3018, 3019, 3020, 3021, 3022, // learnprompting
    2167,
  ],

  // Awesome Copilot agents that only run inside a vendor's product or an
  // editor with specific MCP tools (CAST, JFrog, LaunchDarkly, Diffblue, the
  // gem-* pipeline…). Pasted into ChatGPT they do nothing.
  toolBound: [
    3425, 3426, 3427, 3428, 3430, 3433, 3439, 3443, 3444, 3447, 3448, 3449, 3452, 3454,
    3459, 3462, 3467, 3473, 3474, 3481, 3482, 3483, 3484, 3485, 3486, 3487, 3488, 3489,
    3490, 3491, 3492, 3498, 3502, 3504, 3506, 3507, 3509, 3512, 3515, 3516, 3517,
  ],

  // Image prompts wrong for a Persian general audience: 3286 recreates the 9/11
  // attack by coordinates and minute, 3290 is a lingerie "slightly sexy" sheet,
  // 3339 stamps a politician's name over a photo.
  sensitive: [3286, 3290, 3339],
};

// Raw MDX documentation pages from the DAIR guide: their bodies start with
// `import { Callout } …`, so as "prompts" they render as source code.
const mdx = db
  .prepare(
    `SELECT p.id FROM prompts p JOIN sources s ON s.id = p.source_id
     WHERE s.key = 'dair-ai-guide' AND p.body LIKE 'import %'`
  )
  .all()
  .map((r) => r.id);
GROUPS.notPrompt.push(...mdx);

const hide = db.prepare("UPDATE prompts SET status = 'hidden' WHERE id = ? AND status = 'published'");
const peek = db.prepare('SELECT id, status, COALESCE(title_fa, title) t FROM prompts WHERE id = ?');

let changed = 0;
if (!dry) db.exec('BEGIN');
for (const [group, ids] of Object.entries(GROUPS)) {
  let n = 0;
  for (const id of ids) {
    const row = peek.get(id);
    if (!row || row.status !== 'published') continue;
    if (dry) console.log(`  [${group}] ${id} ${row.t}`);
    else n += hide.run(id).changes;
  }
  if (!dry) console.log(`${group}: hid ${n} of ${ids.length}`);
  changed += n;
}
if (!dry) db.exec('COMMIT');

const pub = db.prepare("SELECT COUNT(*) n FROM prompts WHERE status = 'published'").get().n;
console.log(dry ? '(dry run — nothing changed)' : `hidden ${changed} · published now ${pub}`);
