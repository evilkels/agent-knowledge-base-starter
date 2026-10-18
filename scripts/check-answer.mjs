#!/usr/bin/env node
// Checks which files an answer cites. Usage: node scripts/check-answer.mjs <question-id> <answer-file>
// It compares citations only. A person still judges whether the answer is right.

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

  const cited = citedPaths(readFileSync(answerFile, 'utf8'));
  const { missing, extra } = compare(question.expect_sources, cited);

  const lines = [
    `question ${question.id}: ${question.question}`,
    `notes: ${question.notes}`,
    ...section('cited', cited),
    ...section('missing', missing),
    ...section('extra', extra),
    missing.length === 0
      ? 'check-answer: pass'
      : `check-answer: fail (${missing.length} expected ${missing.length === 1 ? 'source' : 'sources'} missing)`,
  ];
  console.log(lines.join('\n'));
  process.exit(missing.length === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
