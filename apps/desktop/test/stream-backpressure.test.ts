import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Stub browser globals for Node.js test environment
if (typeof globalThis.window === 'undefined') {
  (globalThis as Record<string, unknown>).window = {};
}
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
}
if (typeof globalThis.sessionStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
}

import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  startStream,
  feedStreamEvent,
  cancelStream,
  getStreamState,
  clearStream,
} from '../src/shell/renderer/features/turns/stream-controller';

const TEST_CHAT = 'test-chat-backpressure';

const streamControllerSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/turns/stream-controller.ts'),
  'utf8',
);

test.afterEach(() => {
  clearStream(TEST_CHAT);
});

// ---------------------------------------------------------------------------
// D-STRM-009: backpressure handling
// ---------------------------------------------------------------------------

test('D-STRM-009: RESOURCE_EXHAUSTED sets cancelSource=backpressure and preserves partialText', () => {
  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'Partial content' });
  feedStreamEvent(TEST_CHAT, {
    type: 'error',
    message: 'server overloaded',
    reasonCode: ReasonCode.RESOURCE_EXHAUSTED,
  });
  const state = getStreamState(TEST_CHAT);
  assert.equal(state.phase, 'cancelled');
  assert.equal(state.cancelSource, 'backpressure');
  assert.equal(state.partialText, 'Partial content');
  assert.equal(state.interrupted, true);
  assert.equal(state.reasonCode, ReasonCode.RESOURCE_EXHAUSTED);
});

test('D-STRM-009: CANCELLED from backpressure sets interrupted=true', () => {
  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'Some text' });
  feedStreamEvent(TEST_CHAT, {
    type: 'error',
    message: 'cancelled by server',
    reasonCode: ReasonCode.RUNTIME_GRPC_CANCELLED,
  });
  const state = getStreamState(TEST_CHAT);
  assert.equal(state.phase, 'cancelled');
  assert.equal(state.cancelSource, 'backpressure');
  assert.equal(state.interrupted, true);
  assert.equal(state.partialText, 'Some text');
});

test('D-STRM-009: backpressure error preserves existing reasonCode', () => {
  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'data' });
  feedStreamEvent(TEST_CHAT, {
    type: 'error',
    message: 'resource limit',
    reasonCode: ReasonCode.RESOURCE_EXHAUSTED,
    traceId: 'trace-bp-001',
  });
  const state = getStreamState(TEST_CHAT);
  // reasonCode from the event should be preserved in state, not overwritten
  assert.equal(state.reasonCode, ReasonCode.RESOURCE_EXHAUSTED);
  assert.equal(state.traceId, 'trace-bp-001');
});

// ---------------------------------------------------------------------------
// D-STRM-004: cancel source tracking
// ---------------------------------------------------------------------------

test('D-STRM-004: user cancel sets cancelSource=user', () => {
  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'typing' });
  cancelStream(TEST_CHAT);
  const state = getStreamState(TEST_CHAT);
  assert.equal(state.phase, 'cancelled');
  assert.equal(state.cancelSource, 'user');
  assert.equal(state.interrupted, true);
});

test('D-STRM-004: timeout sets cancelSource=timeout', () => {
  // Use a very short total timeout to trigger the timeout path
  startStream(TEST_CHAT, 1);
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      const state = getStreamState(TEST_CHAT);
      assert.equal(state.cancelSource, 'timeout');
      assert.equal(state.interrupted, true);
      // Phase is 'error' for timeouts (not 'cancelled')
      assert.equal(state.phase, 'error');
      resolve();
    }, 50);
  });
});

// ---------------------------------------------------------------------------
// D-STRM-001: reasonCode and traceId propagation
// ---------------------------------------------------------------------------

test('D-STRM-001: reasonCode captured in stream state on error', () => {
  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'partial' });
  feedStreamEvent(TEST_CHAT, {
    type: 'error',
    message: 'rate limited',
    reasonCode: ReasonCode.AI_PROVIDER_RATE_LIMITED,
  });
  const state = getStreamState(TEST_CHAT);
  assert.equal(state.phase, 'error');
  assert.equal(state.reasonCode, ReasonCode.AI_PROVIDER_RATE_LIMITED);
  assert.equal(state.errorMessage, 'rate limited');
});

test('D-STRM-001: traceId propagated to stream state', () => {
  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'hello' });
  feedStreamEvent(TEST_CHAT, {
    type: 'error',
    message: 'internal error',
    reasonCode: ReasonCode.AI_PROVIDER_INTERNAL,
    traceId: 'trace-abc-123',
  });
  const state = getStreamState(TEST_CHAT);
  assert.equal(state.traceId, 'trace-abc-123');
  assert.equal(state.reasonCode, ReasonCode.AI_PROVIDER_INTERNAL);
});

// ---------------------------------------------------------------------------
// D-STRM-009: source scan — type declarations
// ---------------------------------------------------------------------------

test('D-STRM-009: StreamState type includes cancelSource field', () => {
  assert.ok(
    streamControllerSource.includes('cancelSource: StreamCancelSource | null'),
    'StreamState must declare cancelSource field typed as StreamCancelSource | null',
  );
});

test('D-STRM-009: StreamEvent error variant includes reasonCode field', () => {
  assert.ok(
    streamControllerSource.includes('reasonCode?:'),
    'StreamEvent error variant must include optional reasonCode field',
  );
});

test('D-STRM-009: terminal stream states are bounded and scheduled for cleanup', () => {
  assert.match(streamControllerSource, /STREAM_TERMINAL_STATE_TTL_MS = 60_000/);
  assert.match(streamControllerSource, /STREAM_MAX_CACHED_STATES = 50/);
  assert.match(streamControllerSource, /scheduleTerminalCleanup/);
  assert.match(streamControllerSource, /clearAllStreams/);
});
