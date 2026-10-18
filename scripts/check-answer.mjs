#!/usr/bin/env node
// Checks which files an answer cites. Usage: node scripts/check-answer.mjs <question-id> <answer-file>
// It compares cited paths (and, for a question with no expected sources, the phrase "not in the vault").
// A person still judges whether the answer is right.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CITED_PATH = /(?<![A-Za-z0-9._/:-])(?:\.{1,2}\/)*((?:(?:wiki|sources|inbox|evals)\/[A-Za-z0-9._/-]*[A-Za-z0-9_-]|log|schema|AGENTS|README)\.md)/g;

export function citedPaths(text) {
  return [...new Set([...text.matchAll(CITED_PATH)].map((match) => match[1]))].sort();
}

export function compare(expected, cited) {
  const expectedSet = new Set(expected);
  const citedSet = new Set(cited);
  return {
    missing: [...expectedSet].filter((file) => !citedSet.has(file)).sort(),
    extra: cited.filter((file) => !expectedSet.has(file)).sort(),
  };
}

// A question with no expected sources is one the vault cannot answer: the answer
// must say "not in the vault" and must not cite wiki pages or sources as evidence.
export function verdict(question, text, cited, missing) {
  if (missing.length > 0) {
    return `${missing.length} expected ${missing.length === 1 ? 'source' : 'sources'} missing`;
  }
  if (question.expect_sources.length === 0) {
    if (!/not in the vault/i.test(text)) return 'answer does not say "not in the vault"';
    if (cited.some((file) => file.startsWith('wiki/') || file.startsWith('sources/'))) {
      return 'answer cites vault pages for a question the vault cannot answer';
    }
  }
  return null;
}

function section(name, files) {
  return [`${name} (${files.length}):`, ...files.map((file) => `  ${file}`)];
}

function main() {
  const [id, answerFile, ...rest] = process.argv.slice(2);
  if (!id || !answerFile || rest.length > 0) {
    console.error('usage: node scripts/check-answer.mjs <question-id> <answer-file>');
    process.exit(2);
  }

  const questions = JSON.parse(readFileSync(path.join(ROOT, 'evals', 'questions.json'), 'utf8'));
  const question = questions.find((entry) => entry.id === id);
  if (!question) {
    console.error(`unknown question id "${id}". Known ids: ${questions.map((entry) => entry.id).join(', ')}`);
    process.exit(2);
  }

  const text = readFileSync(answerFile, 'utf8');
  const cited = citedPaths(text);
  const { missing, extra } = compare(question.expect_sources, cited);
  const failure = verdict(question, text, cited, missing);

  const lines = [
    `question ${question.id}: ${question.question}`,
    `notes: ${question.notes}`,
    ...section('cited', cited),
    ...section('missing', missing),
    ...section('extra', extra),
    failure ? `check-answer: fail (${failure})` : 'check-answer: pass',
  ];
  console.log(lines.join('\n'));
  process.exit(failure ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
