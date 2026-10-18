import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { lint, parseFrontmatter } from '../scripts/lint.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LINT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'lint.mjs');
const TODAY = '2026-10-18';
const created = [];

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function page({ type = 'project', title = 'Page', description = 'A page.', updated = '2026-10-10', sources = ['../../sources/s.md'], status, review_after, body = '' } = {}) {
  const lines = ['---', `type: ${type}`, `title: ${title}`, `description: ${description}`, `updated: ${updated}`];
  if (Array.isArray(sources)) {
    lines.push(sources.length === 0 ? 'sources: []' : 'sources:', ...sources.map((s) => `  - ${s}`));
  }
  if (status) lines.push(`status: ${status}`);
  if (review_after) lines.push(`review_after: ${review_after}`);
  lines.push('---', '', body);
  return lines.join('\n');
}

const INDEX = [
  '---',
  'type: index',
  'title: Index',
  'description: Index.',
  'updated: 2026-10-10',
  'sources: []',
  '---',
  '',
  '- [A](projects/a.md): first',
  '- [B](areas/b.md): second',
  '',
].join('\n');

const SOURCE = ['---', 'type: source', 'title: S', 'captured: 2026-10-01', 'origin: call notes', '---', '', 'Text.', ''].join('\n');

function makeVault(overrides = {}) {
  const files = {
    'wiki/index.md': INDEX,
    'wiki/projects/a.md': page({ body: 'See [B](../areas/b.md).\n' }),
    'wiki/areas/b.md': page({ type: 'area', body: 'See [A](../projects/a.md).\n' }),
    'sources/s.md': SOURCE,
    ...overrides,
  };
  const root = mkdtempSync(path.join(tmpdir(), 'akb-lint-'));
  created.push(root);
  for (const [file, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

function run(root, today = TODAY) {
  return lint({ root, today });
}

function git(root, ...args) {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd: root,
    stdio: 'pipe',
  });
}

describe('clean vault', () => {
  test('prints 0 errors, 0 warnings', () => {
    const result = run(makeVault());
    assert.equal(result.errors, 0);
    assert.equal(result.warnings, 0);
    assert.equal(result.lines.at(-1), 'lint: 0 errors, 0 warnings');
  });

  test('the sample vault in this repository is clean', () => {
    const result = run(REPO_ROOT);
    assert.deepEqual(result.lines.filter((line) => /^(ERROR|WARN) /.test(line)), []);
    assert.equal(result.lines.at(-1), 'lint: 0 errors, 0 warnings');
  });
});

describe('errors', () => {
  for (const field of ['type', 'title', 'description', 'updated']) {
    test(`missing required field ${field}`, () => {
      const text = page().split('\n').filter((line) => !line.startsWith(`${field}:`)).join('\n');
      const result = run(makeVault({ 'wiki/projects/a.md': text }));
      assert.ok(result.lines.includes(`ERROR wiki/projects/a.md: missing required field "${field}"`), result.lines.join('\n'));
      assert.equal(result.errors, 1);
    });
  }

  test('missing sources field', () => {
    const text = page({ sources: null, body: 'See [B](../areas/b.md).\n' });
    const result = run(makeVault({ 'wiki/projects/a.md': text }));
    assert.ok(result.lines.includes('ERROR wiki/projects/a.md: missing required field "sources"'));
  });

  test('empty sources on a non-index page', () => {
    const text = page({ sources: [], body: 'See [B](../areas/b.md).\n' });
    const result = run(makeVault({ 'wiki/projects/a.md': text }));
    assert.ok(result.lines.includes('ERROR wiki/projects/a.md: sources must list at least one entry'));
  });

  test('empty sources on the index is allowed', () => {
    assert.equal(run(makeVault()).errors, 0);
  });

  test('page without a frontmatter block', () => {
    const result = run(makeVault({ 'wiki/projects/a.md': 'See [B](../areas/b.md).\n' }));
    assert.ok(result.lines.includes('ERROR wiki/projects/a.md: missing frontmatter block'));
  });

  test('sources entry that is neither a path nor an https URL', () => {
    const text = page({ sources: ['../../sources/missing.md', 'http://example.com/x'], body: 'See [B](../areas/b.md).\n' });
    const result = run(makeVault({ 'wiki/projects/a.md': text }));
    assert.ok(result.lines.includes('ERROR wiki/projects/a.md: sources entry "../../sources/missing.md" is neither an existing path nor an https:// URL'));
    assert.ok(result.lines.includes('ERROR wiki/projects/a.md: sources entry "http://example.com/x" is neither an existing path nor an https:// URL'));
  });

  test('sources entry that is an https URL is accepted', () => {
    const text = page({ sources: ['https://example.com/page'], body: 'See [B](../areas/b.md).\n' });
    assert.equal(run(makeVault({ 'wiki/projects/a.md': text })).errors, 0);
  });

  test('relative link whose target does not exist', () => {
    const text = page({ body: 'See [B](../areas/b.md) and [gone](../areas/gone.md#part).\n' });
    const result = run(makeVault({ 'wiki/projects/a.md': text }));
    assert.ok(result.lines.includes('ERROR wiki/projects/a.md: link target "../areas/gone.md" does not exist'));
    assert.equal(result.errors, 1);
  });

  test('links inside code, external links and anchors are ignored', () => {
    const body = [
      'See [B](../areas/b.md).',
      'Inline `[x](nope.md)` and [web](https://example.com/nope.md), [mail](mailto:a@example.invalid), [top](#top).',
      '',
      '```markdown',
      '[fenced](nope.md)',
      '```',
      '',
    ].join('\n');
    assert.equal(run(makeVault({ 'wiki/projects/a.md': page({ body }) })).errors, 0);
  });

  test('wiki page not listed in wiki/index.md', () => {
    const result = run(makeVault({
      'wiki/resources/c.md': page({ type: 'resource', body: 'See [A](../projects/a.md).\n' }),
      'wiki/projects/a.md': page({ body: 'See [B](../areas/b.md) and [C](../resources/c.md).\n' }),
    }));
    assert.ok(result.lines.includes('ERROR wiki/resources/c.md: not listed in wiki/index.md'));
    assert.equal(result.errors, 1);
  });

  test('wiki/index.md missing', () => {
    const result = run(makeVault({ 'wiki/index.md': null }));
    assert.ok(result.lines.includes('ERROR wiki/index.md: file is missing'));
  });

  test('invalid date', () => {
    const text = page({ updated: '2026-13-40', body: 'See [B](../areas/b.md).\n' });
    const result = run(makeVault({ 'wiki/projects/a.md': text }));
    assert.ok(result.lines.includes('ERROR wiki/projects/a.md: "updated" is not an ISO date (YYYY-MM-DD): "2026-13-40"'));
  });
});

describe('sources are immutable', () => {
  test('a modified file under sources/ is an error', () => {
    const root = makeVault();
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
    assert.equal(run(root).errors, 0);

    writeFileSync(path.join(root, 'sources/s.md'), `${SOURCE}Changed.\n`);
    const result = run(root);
    assert.ok(result.lines.includes('ERROR sources/s.md: modified compared with HEAD; sources are immutable'));
    assert.equal(result.errors, 1);
  });

  test('a new file under sources/ is allowed', () => {
    const root = makeVault();
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
    writeFileSync(path.join(root, 'sources/new.md'), SOURCE);
    git(root, 'add', '-A');
    assert.equal(run(root).errors, 0);
  });

  test('outside a git repository the check is skipped with a note', () => {
    const result = run(makeVault());
    assert.ok(result.lines.includes('NOTE sources/: modification check skipped (not a git repository)'));
    assert.equal(result.lines.at(-1), 'lint: 0 errors, 0 warnings');
  });
});

describe('warnings', () => {
  test('review_after in the past', () => {
    const text = page({ review_after: '2026-10-17', body: 'See [B](../areas/b.md).\n' });
    const result = run(makeVault({ 'wiki/projects/a.md': text }));
    assert.deepEqual(result.lines.filter((l) => l.startsWith('WARN ')), ['WARN wiki/projects/a.md: review_after 2026-10-17 has passed']);
    assert.equal(result.errors, 0);
  });

  test('review_after today or later is fine', () => {
    const text = page({ review_after: TODAY, body: 'See [B](../areas/b.md).\n' });
    assert.equal(run(makeVault({ 'wiki/projects/a.md': text })).warnings, 0);
  });

  test('orphan page', () => {
    const result = run(makeVault({
      'wiki/resources/c.md': page({ type: 'resource', body: 'Nothing links here.\n' }),
      'wiki/index.md': `${INDEX}- [C](resources/c.md): third\n`,
    }));
    assert.deepEqual(result.lines.filter((l) => l.startsWith('WARN ')), ['WARN wiki/resources/c.md: orphan page: no other wiki page links to it']);
    assert.equal(result.errors, 0);
  });

  test('a link from wiki/index.md alone does not count', () => {
    const result = run(makeVault({
      'wiki/projects/a.md': page({ body: 'No links.\n' }),
      'wiki/areas/b.md': page({ type: 'area', body: 'No links.\n' }),
    }));
    const orphans = result.lines.filter((l) => l.includes('orphan'));
    assert.equal(orphans.length, 2);
  });

  test('draft older than 30 days', () => {
    const text = page({ status: 'draft', updated: '2026-09-17', body: 'See [B](../areas/b.md).\n' });
    const result = run(makeVault({ 'wiki/projects/a.md': text }));
    assert.deepEqual(result.lines.filter((l) => l.startsWith('WARN ')), ['WARN wiki/projects/a.md: status is draft and last updated 31 days ago (limit 30)']);
  });

  test('draft of exactly 30 days and old reviewed pages are fine', () => {
    const draft = page({ status: 'draft', updated: '2026-09-18', body: 'See [B](../areas/b.md).\n' });
    const reviewed = page({ type: 'area', status: 'reviewed', updated: '2025-01-01', body: 'See [A](../projects/a.md).\n' });
    const result = run(makeVault({ 'wiki/projects/a.md': draft, 'wiki/areas/b.md': reviewed }));
    assert.equal(result.warnings, 0);
  });
});

describe('output', () => {
  test('messages are sorted by path, errors before warnings', () => {
    const result = run(makeVault({
      'wiki/resources/z.md': page({ type: 'resource', review_after: '2020-01-01', body: 'No links.\n' }),
      'wiki/areas/b.md': page({ type: 'area', sources: ['../../sources/none.md'], body: 'See [A](../projects/a.md).\n' }),
    }));
    const issues = result.lines.filter((l) => /^(ERROR|WARN) /.test(l));
    assert.deepEqual(issues, [
      'ERROR wiki/areas/b.md: sources entry "../../sources/none.md" is neither an existing path nor an https:// URL',
      'ERROR wiki/resources/z.md: not listed in wiki/index.md',
      'WARN wiki/resources/z.md: orphan page: no other wiki page links to it',
      'WARN wiki/resources/z.md: review_after 2020-01-01 has passed',
    ]);
    assert.equal(result.lines.at(-1), `lint: ${result.errors} errors, ${result.warnings} warnings`);
  });

  test('the same vault gives the same output twice', () => {
    const root = makeVault({ 'wiki/resources/z.md': page({ type: 'resource', review_after: '2020-01-01', body: 'No links.\n' }) });
    assert.deepEqual(run(root).lines, run(root).lines);
  });
});

describe('command line', () => {
  test('exit code 1 and the summary line when there are errors', () => {
    const root = makeVault({ 'wiki/projects/a.md': page({ body: '[gone](gone.md) [B](../areas/b.md)\n' }) });
    const result = spawnSync('node', [LINT_SCRIPT, '--root', root, '--today', TODAY], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^ERROR wiki\/projects\/a\.md: link target "gone\.md" does not exist$/m);
    assert.match(result.stdout, /^lint: 1 errors, 0 warnings\n$/m);
  });

  test('exit code 0 on a clean vault', () => {
    const result = spawnSync('node', [LINT_SCRIPT, '--root', makeVault(), '--today', TODAY], { encoding: 'utf8' });
    assert.equal(result.status, 0);
  });

  test('a bad --today value exits with 2', () => {
    const result = spawnSync('node', [LINT_SCRIPT, '--today', 'yesterday'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
  });
});

describe('parseFrontmatter', () => {
  test('reads scalars, block lists and inline lists', () => {
    const text = ['---', 'type: project', 'title: "Quoted: title"', 'tags: [a, "b c", d]', 'sources:', '  - ../x.md', '  - https://example.com/y', 'empty: []', '---', 'Body'].join('\n');
    const { data, body } = parseFrontmatter(text);
    assert.deepEqual(data, {
      type: 'project',
      title: 'Quoted: title',
      tags: ['a', 'b c', 'd'],
      sources: ['../x.md', 'https://example.com/y'],
      empty: [],
    });
    assert.equal(body, 'Body');
  });

  test('returns null without a frontmatter block', () => {
    assert.equal(parseFrontmatter('# Title\n'), null);
  });
});
