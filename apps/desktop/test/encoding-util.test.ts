import assert from 'node:assert/strict';
import test from 'node:test';

import { toBase64, fromBase64, concatChunks } from '../src/runtime/util/encoding';

test('toBase64 encodes bytes correctly', () => {
  const input = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
  const result = toBase64(input);
  assert.equal(result, 'SGVsbG8=');
});

test('toBase64 handles empty input', () => {
  const input = new Uint8Array(0);
  const result = toBase64(input);
  assert.equal(result, '');
});

test('fromBase64 decodes correctly', () => {
  const result = fromBase64('SGVsbG8=');
  assert.deepEqual(result, new Uint8Array([72, 101, 108, 108, 111]));
});

test('fromBase64 returns empty array for empty string', () => {
  const result = fromBase64('');
  assert.equal(result.length, 0);
});

test('fromBase64 returns empty array for whitespace-only string', () => {
  const result = fromBase64('   ');
  assert.equal(result.length, 0);
});

test('toBase64 and fromBase64 roundtrip', () => {
  const original = new Uint8Array([0, 1, 2, 128, 255, 42, 99]);
  const encoded = toBase64(original);
  const decoded = fromBase64(encoded);
  assert.deepEqual(decoded, original);
});

test('toBase64 and fromBase64 roundtrip with large input', () => {
  const original = new Uint8Array(1024);
  for (let i = 0; i < original.length; i++) {
    original[i] = i % 256;
  }
  const encoded = toBase64(original);
  const decoded = fromBase64(encoded);
  assert.deepEqual(decoded, original);
});

test('concatChunks concatenates multiple chunks', () => {
  const chunks = [
    new Uint8Array([1, 2, 3]),
    new Uint8Array([4, 5]),
    new Uint8Array([6]),
  ];
  const result = concatChunks(chunks);
  assert.deepEqual(result, new Uint8Array([1, 2, 3, 4, 5, 6]));
});

test('concatChunks handles empty chunks array', () => {
  const result = concatChunks([]);
  assert.equal(result.length, 0);
});

test('concatChunks handles single chunk', () => {
  const chunk = new Uint8Array([10, 20, 30]);
  const result = concatChunks([chunk]);
  assert.deepEqual(result, chunk);
});

test('concatChunks handles empty chunks in the middle', () => {
  const chunks = [
    new Uint8Array([1]),
    new Uint8Array(0),
    new Uint8Array([2]),
  ];
  const result = concatChunks(chunks);
  assert.deepEqual(result, new Uint8Array([1, 2]));
});
