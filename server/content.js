'use strict';
/**
 * Articles, collections and the prompt builder — the pages that are not the
 * catalogue itself.
 *
 * They exist for two reasons: a visitor who does not yet know what to search
 * for needs somewhere to land, and search engines need pages that answer
 * questions rather than list prompts. Everything is server-rendered like the
 * rest of the site, so each is a real indexable page.
 */
const db = require('./db');
const articles = require('../content/articles');
const collections = require('../content/collections');

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------------ *
 * The article markup subset
 * ------------------------------------------------------------------ */
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

/** Blocks are separated by blank lines; only what the articles actually use. */
function renderBody(md) {
  const blocks = String(md || '').trim().split(/\n{2,}/);
  const out = [];

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    const h3 = block.match(/^###\s+(.+)$/);
    if (h3) {
      out.push(`<h3>${inline(h3[1])}</h3>`);
      continue;
    }
    const h2 = block.match(/^##\s+(.+)$/);
    if (h2) {
      out.push(`<h2>${inline(h2[1])}</h2>`);
      continue;
    }

    const lines = block.split('\n');

    if (lines.every((l) => l.trim().startsWith('|'))) {
      out.push(renderTable(lines));
      continue;
    }
    if (lines.every((l) => /^\s*-\s+/.test(l))) {
      out.push('<ul>' + lines.map((l) => `<li>${inline(l.replace(/^\s*-\s+/, ''))}</li>`).join('') + '</ul>');
      continue;
    }
    out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

/** Markdown tables need a horizontal scroll container on phones. */
function renderTable(lines) {
  const rows = lines
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^-{2,}$/.test(c) || c === ''));
  if (!rows.length) return '';
  const [head, ...body] = rows;
  return (
    '<div class="table-wrap"><table class="cmp"><thead><tr>' +
    head.map((c) => `<th>${inline(c)}</th>`).join('') +
    '</tr></thead><tbody>' +
    body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
    '</tbody></table></div>'
  );
}

/* ------------------------------------------------------------------ *
 * Collections resolve against the live catalogue
 * ------------------------------------------------------------------ */
const SEL = `
  SELECT p.uid, p.slug, COALESCE(p.title_fa, p.title) AS title, p.title AS title_en, p.summary, p.difficulty, p.quality, p.copies, p.views,
         p.featured, p.lang, c.slug AS cat_slug, c.name_fa AS cat_name, c.icon
  FROM prompts p LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.status = 'published'`;

function collectionItems(col) {
  const picked = [];
  const seen = new Set();

  // hand-picked titles first, in the order the collection lists them
  for (const needle of col.pin || []) {
    const row = db
      .prepare(`${SEL} AND p.title LIKE ? ORDER BY p.lang='fa' DESC, p.quality DESC LIMIT 1`)
      .get('%' + needle + '%');
    if (row && !seen.has(row.uid)) {
      seen.add(row.uid);
      picked.push(row);
    }
  }

  // then fill from the rules
  // A Persian-only collection is already narrow enough; restricting it by
  // category as well leaves too few prompts to be worth a page.
  const cats = col.faOnly ? [] : col.cats || [];
  const catClause = cats.length ? ` AND c.slug IN (${cats.map(() => '?').join(',')})` : '';
  const langClause = col.faOnly ? " AND p.lang='fa'" : '';
  const pool = db
    .prepare(`${SEL}${catClause}${langClause} ORDER BY p.lang='fa' DESC, p.quality DESC LIMIT 400`)
    .all(...cats);

  const terms = (col.terms || []).map((t) => t.toLowerCase());
  const scored = pool
    .filter((r) => !seen.has(r.uid))
    .map((r) => {
      const hay = (r.title + ' ' + r.summary).toLowerCase();
      let score = r.quality / 10;
      for (const t of terms) if (hay.includes(t)) score += 10;
      if (r.lang === 'fa') score += 25;
      if (r.featured) score += 3;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);

  for (const { r } of scored) {
    if (picked.length >= (col.limit || 10)) break;
    if (seen.has(r.uid)) continue;
    seen.add(r.uid);
    picked.push(r);
  }
  return picked;
}

const collectionBySlug = (slug) => collections.find((c) => c.slug === slug) || null;
const articleBySlug = (slug) => articles.find((a) => a.slug === slug) || null;

module.exports = {
  articles,
  collections,
  articleBySlug,
  collectionBySlug,
  collectionItems,
  renderBody,
  esc,
  inline,
};
