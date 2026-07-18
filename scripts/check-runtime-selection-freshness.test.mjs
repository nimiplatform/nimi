import assert from 'node:assert/strict';
import test from 'node:test';
import { isSelectionReviewExpired } from './check-runtime-selection-freshness.mjs';

test('selection review remains fresh for the complete SLA expiry date', () => {
  const reviewedAt = new Date('2026-06-27T00:00:00.000Z');

  assert.equal(
    isSelectionReviewExpired(reviewedAt, 21, new Date('2026-07-18T23:59:59.999Z')),
    false,
  );
});

test('selection review expires on the calendar day after the SLA expiry date', () => {
  const reviewedAt = new Date('2026-06-27T00:00:00.000Z');

  assert.equal(
    isSelectionReviewExpired(reviewedAt, 21, new Date('2026-07-19T00:00:00.000Z')),
    true,
  );
});
