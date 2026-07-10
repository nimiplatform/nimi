import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHashTargetId } from '../src/landing/hooks/use-hash-scroll.js';

test('resolveHashTargetId accepts valid section hashes', () => {
  assert.equal(resolveHashTargetId('#apps'), 'apps');
  assert.equal(resolveHashTargetId('#main-content'), 'main-content');
  assert.equal(resolveHashTargetId('#section%20one'), 'section one');
});

test('resolveHashTargetId rejects empty hashes', () => {
  assert.equal(resolveHashTargetId(''), null);
  assert.equal(resolveHashTargetId('#'), null);
  assert.equal(resolveHashTargetId('apps'), null);
});
