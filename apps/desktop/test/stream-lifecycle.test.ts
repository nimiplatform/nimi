import assert from 'node:assert/strict';
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

import {
  startStream,
  feedStreamEvent,
  cancelStream,
  getStreamState,
  clearStream,
  subscribeStream,
  STREAM_FIRST_PACKET_TIMEOUT_MS,
} from '../src/shell/renderer/features/turns/stream-controller';

const TEST_CHAT = 'test-chat-stream';

test.afterEach(() => {
  clearStream(TEST_CHAT);
});

test('D-STRM-001: startStream sets phase to waiting', () => {
  startStream(TEST_CHAT);
  const state = getStreamState(TEST_CHAT);
  assert.equal(state.phase, 'waiting');
  assert.equal(state.partialText, '');
  cancelStream(TEST_CHAT);
});

test('D-STRM-001: text_delta transitions to streaming phase', () => {
  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'Hello' });
  const state = getStreamState(TEST_CHAT);
  assert.equal(state.phase, 'streaming');
  assert.equal(state.partialText, 'Hello');
  cancelStream(TEST_CHAT);
});

test('D-STRM-001: done event transitions to done phase', () => {
  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'Hi' });
  feedStreamEvent(TEST_CHAT, { type: 'done' });
  const state = getStreamState(TEST_CHAT);
  assert.equal(state.phase, 'done');
  assert.equal(state.partialText, 'Hi');
});

test('D-STRM-003: error preserves partial text and sets interrupted', () => {
  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'Partial' });
  feedStreamEvent(TEST_CHAT, { type: 'error', message: 'connection lost' });
  const state = getStreamState(TEST_CHAT);
  assert.equal(state.phase, 'error');
  assert.equal(state.partialText, 'Partial');
  assert.equal(state.interrupted, true);
  assert.equal(state.errorMessage, 'connection lost');
});

test('D-STRM-004: concurrent protection — new stream cancels existing', () => {
  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'First' });
  // Start new stream for same chat
  startStream(TEST_CHAT);
  const state = getStreamState(TEST_CHAT);
  assert.equal(state.phase, 'waiting');
  assert.equal(state.partialText, '');
  cancelStream(TEST_CHAT);
});

test('D-STRM-004: cancelStream sets cancelled phase', () => {
  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'Part' });
  cancelStream(TEST_CHAT);
  const state = getStreamState(TEST_CHAT);
  assert.equal(state.phase, 'cancelled');
  assert.equal(state.interrupted, true);
});

test('D-STRM-004: cancelStream returns abort signal', () => {
  const controller = startStream(TEST_CHAT);
  assert.ok(controller instanceof AbortController);
  cancelStream(TEST_CHAT);
  assert.equal(controller.signal.aborted, true);
});

test('D-STRM: subscribeStream receives state updates', () => {
  const updates: string[] = [];
  const unsub = subscribeStream((state) => {
    updates.push(state.phase);
  });

  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'x' });
  feedStreamEvent(TEST_CHAT, { type: 'done' });

  assert.deepEqual(updates, ['waiting', 'streaming', 'done']);
  unsub();
});

test('D-STRM: events after done are ignored', () => {
  startStream(TEST_CHAT);
  feedStreamEvent(TEST_CHAT, { type: 'done' });
  feedStreamEvent(TEST_CHAT, { type: 'text_delta', textDelta: 'late' });
  const state = getStreamState(TEST_CHAT);
  assert.equal(state.phase, 'done');
  assert.equal(state.partialText, '');
});

test('D-STRM: idle state for unknown chatId', () => {
  const state = getStreamState('unknown-chat');
  assert.equal(state.phase, 'idle');
});
