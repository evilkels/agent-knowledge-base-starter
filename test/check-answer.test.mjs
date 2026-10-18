import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citedPaths, compare, verdict } from '../scripts/check-answer.mjs';

const q1 = { expect_sources: ['wiki/resources/pricing-arguments.md', 'sources/2026-10-09-pricing-email.md'] };
const q5 = { expect_sources: [] };

function check(question, text) {
  const cited = citedPaths(text);
  return verdict(question, text, cited, compare(question.expect_sources, cited).missing);
}

test('passes when every expected source is cited', () => {
  assert.equal(check(q1, 'Up to 5 %. See wiki/resources/pricing-arguments.md and sources/2026-10-09-pricing-email.md.'), null);
});

test('fails when an expected source is missing', () => {
  assert.equal(check(q1, 'Up to 5 %. See wiki/resources/pricing-arguments.md.'), '1 expected source missing');
});

test('a no-source question passes only when the answer says "not in the vault"', () => {
  assert.equal(check(q5, 'Not in the vault: no page or source names a supplier.'), null);
  assert.equal(check(q5, 'They use Nordic Glass.'), 'answer does not say "not in the vault"');
});

test('a no-source question fails when the answer cites vault pages as evidence', () => {
  assert.equal(
    check(q5, 'Not in the vault, but wiki/projects/northern-build-pilot.md suggests Nordic Glass.'),
    'answer cites vault pages for a question the vault cannot answer',
  );
});
