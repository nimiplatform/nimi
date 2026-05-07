import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiUlid } from '../src/index.js';
import { createAISnapshotExecutionId } from '../src/mod/index.js';

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

test('createNimiUlid returns a canonical Crockford ULID', () => {
  const id = createNimiUlid(0);
  assert.match(id, ULID_PATTERN);
  assert.equal(id.slice(0, 10), '0000000000');
});

test('createAISnapshotExecutionId uses the canonical Nimi ULID generator', () => {
  const id = createAISnapshotExecutionId(1);
  assert.match(id, ULID_PATTERN);
  assert.equal(id.slice(0, 10), '0000000001');
});

test('createNimiUlid fails closed for invalid timestamps', () => {
  assert.throws(() => createNimiUlid(Number.NaN), /timestamp must be finite/);
});
