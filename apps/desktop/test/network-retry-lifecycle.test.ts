import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { requestWithRetry, type RetryEvent } from '../src/runtime/net/request-with-retry';

/* ---------- source scan target ---------- */

const retrySource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/net/request-with-retry.ts'),
  'utf8',
);

/* ---------- D-NET-002: retry delay formula uses exponential backoff ---------- */

test('D-NET-002: backoff formula uses Math.pow(2, attempt - 1)', () => {
  assert.match(
    retrySource,
    /Math\.pow\(2,\s*attempt\s*-\s*1\)/,
    'exponential backoff must use Math.pow(2, attempt - 1)',
  );
});

test('D-NET-002: backoff multiplies initialDelayMs by the exponent', () => {
  assert.match(
    retrySource,
    /initialDelayMs\s*\*\s*Math\.pow/,
    'base delay must be initialDelayMs * Math.pow(...)',
  );
});

test('D-NET-002: backoff is capped by maxDelayMs via Math.min', () => {
  assert.ok(
    retrySource.includes('Math.min(maxDelayMs'),
    'delay must be capped via Math.min(maxDelayMs, ...)',
  );
});

/* ---------- D-NET-003: retry events include retrying state ---------- */

test('D-NET-003: RetryEvent type includes retrying state', () => {
  assert.ok(
    retrySource.includes("type: 'retrying'"),
    'RetryEvent must include a retrying state discriminant',
  );
});

test('D-NET-003: retrying event carries delayMs and reasonKind', () => {
  assert.match(
    retrySource,
    /type:\s*'retrying'[\s\S]*?delayMs/,
    'retrying event must include delayMs field',
  );
  assert.match(
    retrySource,
    /type:\s*'retrying'[\s\S]*?reasonKind/,
    'retrying event must include reasonKind field',
  );
});

/* ---------- D-NET-003: retry events include recovered state ---------- */

test('D-NET-003: RetryEvent type includes recovered state', () => {
  assert.ok(
    retrySource.includes("type: 'recovered'"),
    'RetryEvent must include a recovered state discriminant',
  );
});

test('D-NET-003: recovered event is emitted after successful retry (behavioral)', async () => {
  const events: RetryEvent[] = [];
  let callCount = 0;

  await requestWithRetry({
    executor: async () => {
      callCount += 1;
      if (callCount === 1) {
        throw { status: 503, message: 'Service Unavailable' };
      }
      return 'ok';
    },
    options: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 },
    sleepImpl: async () => {},
    onRetryEvent: (event) => events.push(event),
  });

  const retryingEvents = events.filter((e) => e.type === 'retrying');
  const recoveredEvents = events.filter((e) => e.type === 'recovered');
  assert.equal(retryingEvents.length, 1, 'should emit exactly one retrying event');
  assert.equal(recoveredEvents.length, 1, 'should emit exactly one recovered event');
  assert.equal(recoveredEvents[0].retryCount, 1, 'recovered retryCount should be 1');
});

/* ---------- D-NET-003: retry events include exhausted state ---------- */

test('D-NET-003: RetryEvent type includes retry_exhausted state', () => {
  assert.ok(
    retrySource.includes("type: 'retry_exhausted'"),
    'RetryEvent must include a retry_exhausted state discriminant',
  );
});

test('D-NET-003: exhausted event is emitted when retries are exceeded (behavioral)', async () => {
  const events: RetryEvent[] = [];

  await assert.rejects(
    () =>
      requestWithRetry({
        executor: async () => {
          throw { status: 502, message: 'Bad Gateway' };
        },
        options: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2 },
        sleepImpl: async () => {},
        onRetryEvent: (event) => events.push(event),
      }),
  );

  const retryingEvents = events.filter((e) => e.type === 'retrying');
  const exhaustedEvents = events.filter((e) => e.type === 'retry_exhausted');
  assert.equal(retryingEvents.length, 1, 'should emit retrying event for intermediate attempt');
  assert.equal(exhaustedEvents.length, 1, 'should emit exactly one retry_exhausted event');
  assert.equal(exhaustedEvents[0].type, 'retry_exhausted');
});

/* ---------- D-NET-001: retryable codes include 408, 429, 500, 502, 503, 504 ---------- */

test('D-NET-001: RETRYABLE_STATUS_CODES includes 408', () => {
  assert.match(retrySource, /408/, 'retryable codes must include 408 (Request Timeout)');
});

test('D-NET-001: RETRYABLE_STATUS_CODES includes 429', () => {
  assert.match(retrySource, /429/, 'retryable codes must include 429 (Too Many Requests)');
});

test('D-NET-001: RETRYABLE_STATUS_CODES includes 500', () => {
  assert.match(retrySource, /500/, 'retryable codes must include 500 (Internal Server Error)');
});

test('D-NET-001: RETRYABLE_STATUS_CODES includes 502', () => {
  assert.match(retrySource, /502/, 'retryable codes must include 502 (Bad Gateway)');
});

test('D-NET-001: RETRYABLE_STATUS_CODES includes 503', () => {
  assert.match(retrySource, /503/, 'retryable codes must include 503 (Service Unavailable)');
});

test('D-NET-001: RETRYABLE_STATUS_CODES includes 504', () => {
  assert.match(retrySource, /504/, 'retryable codes must include 504 (Gateway Timeout)');
});

test('D-NET-001: retryable status codes are stored in a Set for O(1) lookup', () => {
  assert.match(
    retrySource,
    /RETRYABLE_STATUS_CODES\s*=\s*new\s+Set\(\[/,
    'retryable codes should be stored in a Set',
  );
});

test('D-NET-001: non-retryable status throws immediately without retry events (behavioral)', async () => {
  const events: RetryEvent[] = [];

  await assert.rejects(
    () =>
      requestWithRetry({
        executor: async () => {
          throw { status: 404, message: 'Not Found' };
        },
        options: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 },
        sleepImpl: async () => {},
        onRetryEvent: (event) => events.push(event),
      }),
  );

  assert.equal(events.length, 0, 'non-retryable status should produce no retry events');
});
