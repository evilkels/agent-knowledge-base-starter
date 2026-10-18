#!/usr/bin/env node
// Lints the vault. Usage: node scripts/lint.mjs [--today YYYY-MM-DD] [--root DIR]
// No dependencies. Reads the small frontmatter subset described in schema.md.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FIELDS = ['type', 'title', 'description', 'updated', 'sources'];
const DRAFT_LIMIT_DAYS = 30;
const INDEX_PATH = 'wiki/index.md';
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseFrontmatter(text) {
  const src = text.replace(/\r\n/g, '\n');
  const match = /^---\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(src);
  if (!match) return null;

  const data = {};
  let listKey = null;
  for (const line of (match[1] ?? '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey !== null) {
      if (!Array.isArray(data[listKey])) data[listKey] = [];
      data[listKey].push(unquote(item[1].trim()));
      continue;
    }

    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, raw] = pair;
    const value = raw.trim();
    if (value === '') {
      data[key] = '';
      listKey = key;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      data[key] = inner === '' ? [] : inner.split(',').map((part) => unquote(part.trim()));
      listKey = null;
    } else {
      data[key] = unquote(value);
      listKey = null;
    }
  }
  return { data, body: src.slice(match[0].length) };
}

function unquote(value) {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function dayNumber(isoDate) {
  return Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS;
}

function stripCode(body) {
  const kept = [];
  let fence = null;
  for (const line of body.split('\n')) {
    const marker = /^\s*(```|~~~)/.exec(line);
    if (marker) {
      if (fence === null) fence = marker[1];
      else if (marker[1] === fence) fence = null;
      continue;
    }
    if (fence === null) kept.push(line.replace(/`[^`]*`/g, ''));
  }
  return kept.join('\n');
}

function relativeLinkTargets(body) {
  const targets = [];
  const pattern = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
  for (const match of stripCode(body).matchAll(pattern)) {
    const raw = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('/') || raw.startsWith('#')) {
      continue;
    }
    const withoutAnchor = raw.split('#')[0].split('?')[0];
    if (withoutAnchor === '') continue;
    let decoded = withoutAnchor;
    try {
      decoded = decodeURIComponent(withoutAnchor);
    } catch {
      // keep the raw text
    }
    targets.push(decoded);
  }
  return targets;
}

function listMarkdown(root, dir) {
  const found = [];
  const walk = (current) => {
    for (const name of readdirSync(path.join(root, current)).sort()) {
      const rel = `${current}/${name}`;
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.md')) found.push(rel);
    }
  };
  if (existsSync(path.join(root, dir))) walk(dir);
  return found.sort();
}

function modifiedSources(root) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'pipe' });
  } catch {
    return { skipped: 'not a git repository' };
  }
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: root, stdio: 'pipe' });
  } catch {
    return { skipped: 'no commit yet' };
  }
  const out = execFileSync(
    'git',
    ['diff', '--name-only', '--relative', '--diff-filter=M', 'HEAD', '--', 'sources/'],
    { cwd: root, encoding: 'utf8' },
  );
  return { files: out.split('\n').filter(Boolean).sort() };
}

export function lint({ root, today }) {
  const messages = [];
  const notes = [];
  const add = (level, file, message) => messages.push({ level, file, message });
  const resolveFrom = (file, target) => path.posix.normalize(path.posix.join(path.posix.dirname(file), target));

  const pages = listMarkdown(root, 'wiki');
  const parsed = new Map();

  for (const file of pages) {
    const result = parseFrontmatter(readFileSync(path.join(root, file), 'utf8'));
    if (result === null) {
      add('ERROR', file, 'missing frontmatter block');
      parsed.set(file, { data: {}, body: readFileSync(path.join(root, file), 'utf8'), links: [] });
      continue;
    }
    const links = relativeLinkTargets(result.body).map((target) => ({ target, resolved: resolveFrom(file, target) }));
    parsed.set(file, { data: result.data, body: result.body, links });

    const { data } = result;
    const isIndex = data.type === 'index';
    for (const field of REQUIRED_FIELDS) {
      const value = data[field];
      const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
      if (!empty) continue;
      if (field === 'sources' && isIndex && value !== undefined) continue;
      add('ERROR', file, field === 'sources' && Array.isArray(value)
        ? 'sources must list at least one entry'
        : `missing required field "${field}"`);
    }

    for (const field of ['updated', 'review_after']) {
      if (data[field] !== undefined && data[field] !== '' && !isIsoDate(data[field])) {
        add('ERROR', file, `"${field}" is not an ISO date (YYYY-MM-DD): "${data[field]}"`);
      }
    }

    const sources = Array.isArray(data.sources) ? data.sources : data.sources ? [data.sources] : [];
    for (const entry of sources) {
      if (entry.startsWith('https://')) continue;
      if (!existsSync(path.join(root, resolveFrom(file, entry)))) {
        add('ERROR', file, `sources entry "${entry}" is neither an existing path nor an https:// URL`);
      }
    }

    for (const { target, resolved } of links) {
      if (!existsSync(path.join(root, resolved))) add('ERROR', file, `link target "${target}" does not exist`);
    }

    if (isIsoDate(data.review_after) && isIsoDate(today) && data.review_after < today) {
      add('WARN', file, `review_after ${data.review_after} has passed`);
    }
    if (data.status === 'draft' && isIsoDate(data.updated)) {
      const age = dayNumber(today) - dayNumber(data.updated);
      if (age > DRAFT_LIMIT_DAYS) {
        add('WARN', file, `status is draft and last updated ${age} days ago (limit ${DRAFT_LIMIT_DAYS})`);
      }
    }
  }

  if (!parsed.has(INDEX_PATH)) {
    add('ERROR', INDEX_PATH, 'file is missing');
  } else {
    const listed = new Set(parsed.get(INDEX_PATH).links.map((link) => link.resolved));
    for (const file of pages) {
      if (file !== INDEX_PATH && !listed.has(file)) add('ERROR', file, `not listed in ${INDEX_PATH}`);
    }
  }

  const linkedFrom = new Map(pages.map((file) => [file, new Set()]));
  for (const file of pages) {
    if (file === INDEX_PATH) continue;
    for (const { resolved } of parsed.get(file).links) {
      if (resolved !== file && linkedFrom.has(resolved)) linkedFrom.get(resolved).add(file);
    }
  }
  for (const file of pages) {
    if (file !== INDEX_PATH && linkedFrom.get(file).size === 0) {
      add('WARN', file, 'orphan page: no other wiki page links to it');
    }
  }

  const sourcesCheck = modifiedSources(root);
  if (sourcesCheck.skipped) {
    notes.push(`NOTE sources/: modification check skipped (${sourcesCheck.skipped})`);
  } else {
    for (const file of sourcesCheck.files) {
      add('ERROR', file, 'modified compared with HEAD; sources are immutable');
    }
  }

  const order = { ERROR: 0, WARN: 1 };
  messages.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
    || order[a.level] - order[b.level]
    || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));

  const errors = messages.filter((m) => m.level === 'ERROR').length;
  const warnings = messages.length - errors;
  const lines = [
    ...messages.map((m) => `${m.level} ${m.file}: ${m.message}`),
    ...notes,
    `lint: ${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`,
  ];
  return { errors, warnings, lines };
}

function parseArgs(argv) {
  const options = {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    today: new Date().toISOString().slice(0, 10),
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--today' && argv[i + 1] !== undefined) options.today = argv[++i];
    else if (argv[i] === '--root' && argv[i + 1] !== undefined) options.root = path.resolve(argv[++i]);
    else throw new Error(`unknown or incomplete argument: ${argv[i]}`);
  }
  if (!isIsoDate(options.today)) throw new Error(`--today must be an ISO date (YYYY-MM-DD): ${options.today}`);
  return options;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\nusage: node scripts/lint.mjs [--today YYYY-MM-DD] [--root DIR]`);
    process.exit(2);
  }
  const result = lint(options);
  console.log(result.lines.join('\n'));
  process.exit(result.errors > 0 ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
