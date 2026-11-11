import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHashTargetId, scrollHashIntoView } from '../src/landing/hooks/use-hash-scroll.js';

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

test('hash scrolling uses a visible delegated target and falls back when it is hidden', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const calls: string[] = [];
  let copyVisible = true;
  const copy = {
    getClientRects: () => copyVisible ? [{}] : [],
    scrollIntoView: (options: { block: string }) => calls.push(`copy:${options.block}`),
  };
  const panel = {
    dataset: { hashTarget: 'ownership-memory-copy' },
    scrollIntoView: (options: { block: string }) => calls.push(`panel:${options.block}`),
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      getElementById: (id: string) => id === 'ownership-memory' ? panel : id === 'ownership-memory-copy' ? copy : null,
    },
  });
  try {
    assert.equal(scrollHashIntoView('#ownership-memory'), true);
    copyVisible = false;
    assert.equal(scrollHashIntoView('#ownership-memory'), true);
    assert.deepEqual(calls, ['copy:center', 'panel:start']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
