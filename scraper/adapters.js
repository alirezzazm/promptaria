'use strict';
/**
 * Adapters turn a remote source into a list of raw prompts:
 *   { title, body, tags[], sourceUrl, author }
 * `sourceUrl` is admin-only data — the public API never returns it.
 */
const cheerio = require('cheerio');
const { get, sleep } = require('./http');

const MIN_LEN = 90;
const MAX_LEN = 9000;

const okBody = (b) => typeof b === 'string' && b.trim().length >= MIN_LEN && b.trim().length <= MAX_LEN;

const titleFromPath = (p) =>
  p
    .split('/')
    .pop()
    .replace(/\.[a-z]+$/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* ------------------------------------------------------------------ *
 * 1. CSV (act,prompt,...)
 * ------------------------------------------------------------------ */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function adapterCsv(src) {
  const text = await get(src.fetchUrl);
  const rows = parseCsv(text);
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  const iTitle = head.indexOf(src.csv.title);
  const iBody = head.indexOf(src.csv.body);
  const iDev = head.indexOf('for_devs');
  const out = [];
  for (const r of rows) {
    const title = (r[iTitle] || '').trim();
    const body = (r[iBody] || '').trim();
    if (!title || !okBody(body)) continue;
    out.push({
      title,
      body,
      tags: iDev >= 0 && /true/i.test(r[iDev] || '') ? ['developers'] : [],
      sourceUrl: src.itemUrlBase || src.home_url,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 2. GitHub repo files (one prompt per file)
 * ------------------------------------------------------------------ */
async function adapterGithubFiles(src) {
  const tree = await get(
    `https://api.github.com/repos/${src.repo}/git/trees/${src.branch || 'main'}?recursive=1`,
    { json: true }
  );
  if (!tree.tree) throw new Error('github tree unavailable (rate limit?)');

  const re = new RegExp(src.pathPattern);
  const files = tree.tree
    .filter((t) => t.type === 'blob' && re.test(t.path) && t.size > MIN_LEN && t.size < MAX_LEN * 2)
    .filter((t) => !/README|INDEX|CONTRIBUTING|LICENSE|AGENTS/i.test(t.path.split('/').pop()))
    .slice(0, src.limit || 90);

  const out = [];
  for (const f of files) {
    try {
      const raw = await get(
        `https://raw.githubusercontent.com/${src.repo}/${src.branch || 'main'}/${f.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`
      );
      let body = raw
        .replace(/^---\n[\s\S]*?\n---\n/, '')            // yaml front-matter
        .replace(/^#{1,3}\s.*\n/, '')                     // leading title heading
        .replace(/^!\[.*?\]\(.*?\)\s*$/gm, '')            // images
        .trim();
      // Some repos give every file the same boilerplate heading (fabric's are all
      // "IDENTITY and PURPOSE"), so a generic one loses to the folder name.
      const mdTitle = raw.match(/^#{1,3}\s+(.{3,120})$/m);
      const heading = mdTitle ? mdTitle[1].replace(/[#*`]/g, '').trim() : '';
      const generic = /^(identity|purpose|identity and purpose|overview|instructions?|system|prompt|role|about|steps|output|introduction)$/i;
      const folder = f.path.split('/').slice(-2, -1)[0] || '';
      const fromPath = src.titleFromFolder && folder ? titleFromPath(folder) : titleFromPath(f.path);
      const title = !heading || generic.test(heading) ? fromPath : heading;
      if (!okBody(body)) continue;
      out.push({
        title,
        body,
        tags: folder && folder !== 'prompts' ? [folder] : [],
        sourceUrl: `https://github.com/${src.repo}/blob/${src.branch || 'main'}/${f.path}`,
      });
      await sleep(60);
    } catch {
      /* skip individual file failures */
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 3. Markdown README: heading -> prompt (code fence, blockquote, or text)
 * ------------------------------------------------------------------ */
/** Headings in the wild carry markdown links, emoji and numbering — strip all of it. */
function cleanTitle(raw) {
  return String(raw)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')      // [text](url) -> text
    .replace(/\(https?:\/\/[^)]*\)/g, '')          // bare (url)
    .replace(/https?:\/\/\S+/g, '')                 // bare url
    .replace(/[`*_~]|\[|\]/g, '')
    .replace(/^[\d.)\s\-–—>#]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function splitSections(md) {
  const lines = md.split('\n');
  const sections = [];
  let cur = null;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^(#{2,4})\s+(.+?)\s*#*$/);
    if (h) {
      if (cur) sections.push(cur);
      cur = { title: cleanTitle(h[2]), lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  if (cur) sections.push(cur);
  return sections;
}

function extractFromSection(text) {
  const fence = text.match(/```[a-z]*\n([\s\S]*?)```/);
  if (fence && fence[1].trim().length >= MIN_LEN) return fence[1].trim();

  const quoted = text
    .split('\n')
    .filter((l) => /^\s*>/.test(l))
    .map((l) => l.replace(/^\s*>\s?/, ''))
    .join('\n')
    .replace(/^\s*(Prompt|prompt)\s*:\s*/, '')
    .trim();
  if (quoted.length >= MIN_LEN) return quoted;

  const plain = text
    .split('\n')
    .filter((l) => !/^\s*[-*]\s*\[.*\]\(.*\)/.test(l) && !/^\s*\|/.test(l) && !/^\s*<|^\s*!\[/.test(l))
    .join('\n')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
  const looksLikePrompt = /you (are|will|should)|act as|i want you|your task|write|generate|analy|explain|create/i.test(plain);
  if (plain.length >= 150 && looksLikePrompt && (plain.match(/https?:\/\//g) || []).length < 3) {
    return plain.slice(0, MAX_LEN);
  }
  return null;
}

async function adapterMarkdown(src) {
  const md = await get(src.fetchUrl);
  const out = [];
  const anchorBase = src.anchorBase || src.home_url;
  for (const sec of splitSections(md)) {
    if (!sec.title || sec.title.length < 3 || sec.title.length > 120) continue;
    if (/table of contents|contributing|license|contents|credits|star history|acknowledg/i.test(sec.title)) continue;
    const body = extractFromSection(sec.lines.join('\n'));
    if (!okBody(body)) continue;
    const anchor = sec.title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
    out.push({ title: sec.title, body, tags: src.defaultTags || [], sourceUrl: `${anchorBase}#${anchor}` });
    if (out.length >= (src.limit || 120)) break;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 4. JSON card data
 * ------------------------------------------------------------------ */
async function adapterJsonCards(src) {
  const data = await get(src.fetchUrl, { json: true });
  const arr = Array.isArray(data) ? data : data[src.json.arrayKey] || [];
  const out = [];
  for (const row of arr) {
    const item = src.json.nestedKey ? row[src.json.nestedKey] || {} : row;
    const title = String(item[src.json.title] || '').trim();
    const body = String(item[src.json.body] || '').trim();
    if (!title || !okBody(body)) continue;
    out.push({
      title,
      body,
      tags: Array.isArray(row[src.json.tags]) ? row[src.json.tags] : [],
      sourceUrl: src.itemUrlBase || src.home_url,
    });
    if (out.length >= (src.limit || 200)) break;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 5. Single-file prompt
 * ------------------------------------------------------------------ */
async function adapterSingle(src) {
  const body = (await get(src.fetchUrl)).trim().slice(0, MAX_LEN);
  if (body.length < MIN_LEN) return [];
  return [{ title: src.singleTitle || src.name, body, tags: src.defaultTags || [], sourceUrl: src.home_url }];
}

/* ------------------------------------------------------------------ *
 * 6. Generic HTML page (cheerio)
 * ------------------------------------------------------------------ */
async function adapterHtml(src) {
  const html = await get(src.fetchUrl);
  const $ = cheerio.load(html);
  const out = [];
  $(src.selectors.item).each((_, el) => {
    if (out.length >= (src.limit || 120)) return false;
    const node = $(el);
    const title = node.find(src.selectors.title).first().text().trim();
    let body = node.find(src.selectors.body).first().text().trim();
    if (!body) body = node.text().replace(title, '').trim();
    if (!title || !okBody(body)) return;
    out.push({ title, body, tags: src.defaultTags || [], sourceUrl: src.home_url });
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * 7. Article-style HTML page -> pseudo-markdown -> section extraction
 *    (works for blog/doc sites that render headings server-side)
 * ------------------------------------------------------------------ */
async function adapterHtmlArticle(src) {
  const pages = src.pages && src.pages.length ? src.pages : [src.fetchUrl];
  const out = [];
  for (const page of pages) {
    let html;
    try {
      html = await get(page);
    } catch {
      continue;
    }
    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, aside, form, noscript').remove();
    const root = $(src.container || 'main, article, .entry-content, #content').first();
    const scope = root.length ? root : $('body');

    const buf = [];
    scope.find('h2, h3, h4, p, li, pre, blockquote').each((_, el) => {
      const tag = el.tagName.toLowerCase();
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (!t) return;
      if (tag === 'pre') buf.push('```\n' + $(el).text().trim() + '\n```');
      else if (tag === 'blockquote') buf.push(t.split('\n').map((l) => '> ' + l).join('\n'));
      else if (/^h/.test(tag)) buf.push('\n## ' + t);
      else buf.push(t);
    });

    const md = buf.join('\n\n');
    for (const sec of splitSections(md)) {
      if (!sec.title || sec.title.length < 5 || sec.title.length > 120) continue;
      if (/related|share|comment|newsletter|subscribe|about the author|faq|conclusion|table of contents/i.test(sec.title)) continue;
      const body = extractFromSection(sec.lines.join('\n'));
      if (!okBody(body)) continue;
      out.push({ title: sec.title, body, tags: src.defaultTags || [], sourceUrl: page });
      if (out.length >= (src.limit || 60)) break;
    }
    await sleep(400);
    if (out.length >= (src.limit || 60)) break;
  }
  return out;
}

const ADAPTERS = {
  csv: adapterCsv,
  'html-article': adapterHtmlArticle,
  'github-files': adapterGithubFiles,
  markdown: adapterMarkdown,
  'json-cards': adapterJsonCards,
  single: adapterSingle,
  html: adapterHtml,
};

module.exports = { ADAPTERS };
