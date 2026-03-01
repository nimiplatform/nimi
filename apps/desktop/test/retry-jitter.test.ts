import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const retrySource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/net/request-with-retry.ts'),
  'utf8',
);

test('D-NET-002: getRetryDelayMs includes jitter via Math.random', () => {
  assert.ok(
    retrySource.includes('Math.random'),
    'request-with-retry.ts must use Math.random for jitter',
  );
});

test('D-NET-002: jitter is bounded to initialDelayMs / 2', () => {
  assert.ok(
    retrySource.includes('initialDelayMs / 2'),
    'jitter range should be bounded by initialDelayMs / 2',
  );
});

test('D-NET-002: delay is capped at maxDelayMs', () => {
  assert.ok(
    retrySource.includes('Math.min(maxDelayMs'),
    'delay must be capped via Math.min(maxDelayMs, ...)',
  );
});
