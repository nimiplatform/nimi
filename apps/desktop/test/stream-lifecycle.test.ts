import assert from 'node:assert/strict';
import test from 'node:test';

function installBrowserGlobals(): () => void {
  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  const previousSessionStorage = globalThis.sessionStorage;
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
  Object.defineProperty(globalThis, 'window', {
    value: {},
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: storage,
    configurable: true,
  });
  return () => {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: previousLocalStorage,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: previousSessionStorage,
      configurable: true,
    });
  };
}

function installFakeTimers(): {
  restore: () => void;
  runTimer: (id: number) => void;
  getTimerIds: () => number[];
} {
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  let nextId = 1;
  const timers = new Map<number, () => void>();

  Object.defineProperty(globalThis, 'setTimeout', {
    value: ((callback: TimerHandler) => {
      const id = nextId++;
      timers.set(id, () => {
        if (typeof callback === 'function') {
          callback();
        }
      });
      return id;
    }) as typeof setTimeout,
    configurable: true,
  });

  Object.defineProperty(globalThis, 'clearTimeout', {
    value: ((id: ReturnType<typeof setTimeout>) => {
      timers.delete(Number(id));
    }) as typeof clearTimeout,
    configurable: true,
  });

  return {
    restore: () => {
      Object.defineProperty(globalThis, 'setTimeout', {
        value: previousSetTimeout,
        configurable: true,
      });
      Object.defineProperty(globalThis, 'clearTimeout', {
        value: previousClearTimeout,
        configurable: true,
      });
    },
    runTimer: (id: number) => {
      const callback = timers.get(id);
      if (!callback) {
        return;
      }
      timers.delete(id);
      callback();
    },
    getTimerIds: () => [...timers.keys()],
  };
}

import {
    startStream,
    feedStreamEvent,
    cancelStream,
    getStreamState,
    clearStream,
    clearAllStreams,
    subscribeStream,
} from '../src/shell/renderer/features/turns/stream-controller';

const TEST_CHAT = 'test-chat-stream';
let restoreBrowserGlobals: () => void = () => {};

test.beforeEach(() => {
  restoreBrowserGlobals = installBrowserGlobals();
});

test.afterEach(() => {
  clearStream(TEST_CHAT);
  clearAllStreams();
  restoreBrowserGlobals();
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

test('D-STRM: late terminal completion recovers a first-packet timeout', () => {
  const fakeTimers = installFakeTimers();
  try {
    startStream(TEST_CHAT);
    const [firstPacketTimerId] = fakeTimers.getTimerIds();
    assert.ok(firstPacketTimerId, 'expected first-packet timer to be registered');

    fakeTimers.runTimer(firstPacketTimerId);

    let state = getStreamState(TEST_CHAT);
    assert.equal(state.phase, 'error');
    assert.equal(state.cancelSource, 'timeout');
    assert.equal(state.errorMessage, 'No response within 30s');

    feedStreamEvent(TEST_CHAT, {
      type: 'done',
      finalText: 'late final answer',
      finalReasoningText: 'late reasoning',
    });

    state = getStreamState(TEST_CHAT);
    assert.equal(state.phase, 'done');
    assert.equal(state.partialText, 'late final answer');
    assert.equal(state.partialReasoningText, 'late reasoning');
    assert.equal(state.errorMessage, null);
    assert.equal(state.cancelSource, null);
    assert.equal(state.interrupted, false);
  } finally {
    fakeTimers.restore();
  }
});

test('D-STRM: idle state for unknown chatId', () => {
  const state = getStreamState('unknown-chat');
  assert.equal(state.phase, 'idle');
});

test('D-STRM: clearAllStreams clears cached states across chats', () => {
  startStream(TEST_CHAT);
  startStream('second-chat');
  clearAllStreams();

  assert.equal(getStreamState(TEST_CHAT).phase, 'idle');
  assert.equal(getStreamState('second-chat').phase, 'idle');
});
