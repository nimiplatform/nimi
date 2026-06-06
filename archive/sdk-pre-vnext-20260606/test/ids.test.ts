import assert from 'node:assert/strict';
import test from 'node:test';

import { createAISnapshotExecutionId } from '../src/ai/index.js';
import { createNimiClientId, createNimiUlid } from '../src/index.js';

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

test('createNimiClientId prefixes canonical Nimi ULIDs', () => {
  const id = createNimiClientId('tester-run', 2);
  assert.match(id, /^tester-run-[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(id.slice('tester-run-'.length, 'tester-run-'.length + 10), '0000000002');
});

test('createNimiUlid fails closed for invalid timestamps', () => {
  assert.throws(() => createNimiUlid(Number.NaN), /timestamp must be finite/);
});

test('createNimiClientId fails closed for unsafe prefixes', () => {
  assert.throws(() => createNimiClientId(''), /prefix is invalid/);
  assert.throws(() => createNimiClientId('../bad'), /prefix is invalid/);
});
