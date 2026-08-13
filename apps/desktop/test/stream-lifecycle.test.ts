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
    STREAM_FIRST_CONTENT_WARNING_DELAY_MS,
    STREAM_IDLE_TIMEOUT_MS,
    createStreamController,
    startStream,
    feedStreamEvent,
    cancelStream,
    getStreamState,
    clearStream,
    clearAllStreams,
    subscribeStream,
} from './helpers/test-stream-controller.js';

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
  assert.equal(state.firstContentWarning, false);
  assert.equal(state.firstContentChunkAt, null);
  cancelStream(TEST_CHAT);
});

test('renderer clock rejection fails an active stream closed', () => {
  const controller = createStreamController({
    now: () => 10,
    schedule(_delayMs, listener) {
      listener({ ok: false, error: 'CLOCK_UNAVAILABLE' });
      return () => undefined;
    },
    animationFrame(listener) {
      listener({ ok: false, error: 'CLOCK_UNAVAILABLE' });
      return () => undefined;
    },
  });

  const abortController = controller.startStream('clock-rejected');
  const state = controller.getStreamState('clock-rejected');
  assert.equal(state.phase, 'error');
  assert.equal(state.reasonCode, 'DESKTOP_RENDERER_CLOCK_REJECTED');
  assert.match(state.errorMessage || '', /CLOCK_UNAVAILABLE/);
  assert.equal(abortController.signal.aborted, true);
  controller.dispose();
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

test('D-STRM: first-content delay warns at 10s without terminating the stream', () => {
  const fakeTimers = installFakeTimers();
  try {
    const updates: boolean[] = [];
    const unsubscribe = subscribeStream(TEST_CHAT, (state) => {
      updates.push(state.firstContentWarning);
    });
    const abortController = startStream(TEST_CHAT);
    const [warningTimerId] = fakeTimers.getTimerIds();
    assert.ok(warningTimerId, 'expected first-content warning timer to be registered');
    assert.equal(STREAM_FIRST_CONTENT_WARNING_DELAY_MS, 10_000);

    let state = getStreamState(TEST_CHAT);
    assert.equal(state.phase, 'waiting');
    assert.equal(state.firstContentWarning, false);
    assert.deepEqual(updates, [false]);

    fakeTimers.runTimer(warningTimerId);

    state = getStreamState(TEST_CHAT);
    assert.equal(state.phase, 'waiting');
    assert.equal(state.firstContentWarning, true);
    assert.equal(state.errorMessage, null);
    assert.equal(state.interrupted, false);
    assert.equal(state.cancelSource, null);
    assert.equal(state.firstContentChunkAt, null);
    assert.equal(abortController.signal.aborted, false);
    assert.deepEqual(updates, [false, true]);
    unsubscribe();

    const replacementAbortController = startStream(TEST_CHAT);
    state = getStreamState(TEST_CHAT);
    assert.equal(state.phase, 'waiting');
    assert.equal(state.firstContentWarning, false);
    assert.equal(state.firstContentChunkAt, null);
    assert.equal(abortController.signal.aborted, true);
    assert.equal(replacementAbortController.signal.aborted, false);
    cancelStream(TEST_CHAT);
  } finally {
    fakeTimers.restore();
  }
});

test('D-STRM: delayed text and reasoning deltas are consumed and clear the warning', () => {
  const fakeTimers = installFakeTimers();
  try {
    for (const event of [
      { type: 'text_delta' as const, textDelta: 'late text' },
      { type: 'reasoning_delta' as const, textDelta: 'late reasoning' },
    ]) {
      const abortController = startStream(TEST_CHAT);
      const [warningTimerId] = fakeTimers.getTimerIds();
      assert.ok(warningTimerId, 'expected first-content warning timer to be registered');
      fakeTimers.runTimer(warningTimerId);

      feedStreamEvent(TEST_CHAT, event);

      const state = getStreamState(TEST_CHAT);
      assert.equal(state.phase, 'streaming');
      assert.equal(state.firstContentWarning, false);
      assert.equal(state.firstContentChunkAt !== null, true);
      assert.equal(state.partialText, event.type === 'text_delta' ? event.textDelta : '');
      assert.equal(
        state.partialReasoningText,
        event.type === 'reasoning_delta' ? event.textDelta : '',
      );
      assert.equal(abortController.signal.aborted, false);
      feedStreamEvent(TEST_CHAT, { type: 'done' });
    }
  } finally {
    fakeTimers.restore();
  }
});

test('D-STRM: keepalive is activity but cannot suppress the first-content warning', () => {
  const fakeTimers = installFakeTimers();
  try {
    const abortController = startStream(TEST_CHAT);
    const [warningTimerId] = fakeTimers.getTimerIds();
    assert.ok(warningTimerId, 'expected first-content warning timer to be registered');

    feedStreamEvent(TEST_CHAT, { type: 'keepalive' });
    assert.deepEqual(fakeTimers.getTimerIds(), [warningTimerId]);
    fakeTimers.runTimer(warningTimerId);

    const state = getStreamState(TEST_CHAT);
    assert.equal(state.phase, 'waiting');
    assert.equal(state.firstContentWarning, true);
    assert.equal(state.errorMessage, null);
    assert.equal(state.firstContentChunkAt, null);
    assert.equal(state.lastActivityAt !== null, true);
    assert.equal(state.idleDeadlineAt, null);
    assert.equal(abortController.signal.aborted, false);
  } finally {
    fakeTimers.restore();
  }
});

test('D-STRM: Runtime done and error terminate normally after the waiting warning', () => {
  const fakeTimers = installFakeTimers();
  try {
    const doneAbortController = startStream(TEST_CHAT);
    const [doneWarningTimerId] = fakeTimers.getTimerIds();
    assert.ok(doneWarningTimerId);
    fakeTimers.runTimer(doneWarningTimerId);
    feedStreamEvent(TEST_CHAT, { type: 'done' });

    let state = getStreamState(TEST_CHAT);
    assert.equal(state.phase, 'done');
    assert.equal(state.firstContentWarning, false);
    assert.equal(state.firstContentChunkAt, null);
    assert.equal(doneAbortController.signal.aborted, false);

    clearStream(TEST_CHAT);
    const errorAbortController = startStream(TEST_CHAT);
    const [errorWarningTimerId] = fakeTimers.getTimerIds();
    assert.ok(errorWarningTimerId);
    fakeTimers.runTimer(errorWarningTimerId);
    feedStreamEvent(TEST_CHAT, { type: 'error', message: 'provider unavailable' });

    state = getStreamState(TEST_CHAT);
    assert.equal(state.phase, 'error');
    assert.equal(state.errorMessage, 'provider unavailable');
    assert.equal(state.firstContentWarning, false);
    assert.equal(state.firstContentChunkAt, null);
    assert.equal(state.cancelSource, null);
    assert.equal(errorAbortController.signal.aborted, false);
  } finally {
    fakeTimers.restore();
  }
});

test('D-STRM: waiting is not locally terminated by initial, rearmed, idle, or keepalive timers', () => {
  type ScheduledTimer = {
    active: boolean;
    delayMs: number;
    listener: (result: { ok: true }) => void;
  };
  const timers: ScheduledTimer[] = [];
  let now = 1_000;
  const controller = createStreamController({
    now: () => now,
    schedule(delayMs, listener) {
      const timer: ScheduledTimer = { active: true, delayMs, listener };
      timers.push(timer);
      return () => {
        timer.active = false;
      };
    },
    animationFrame() {
      return () => undefined;
    },
  });

  const abortController = controller.startStream('runtime-ack-rearm', 120_000);
  const warningTimer = timers.find((timer) => (
    timer.delayMs === STREAM_FIRST_CONTENT_WARNING_DELAY_MS && timer.active
  ));
  assert.ok(warningTimer);
  assert.equal(timers.some((timer) => timer.delayMs === 120_000), false);

  now += 42_251;
  assert.equal(controller.rearmTotalTimeout('runtime-ack-rearm', 45_000), true);
  controller.feedStreamEvent('runtime-ack-rearm', { type: 'keepalive' });
  assert.equal(timers.some((timer) => timer.delayMs === 120_000), false);
  assert.equal(timers.some((timer) => timer.delayMs === 45_000), false);
  assert.equal(timers.some((timer) => timer.delayMs === 30_000), false);

  warningTimer.listener({ ok: true });
  let state = controller.getStreamState('runtime-ack-rearm');
  assert.equal(state.phase, 'waiting');
  assert.equal(state.firstContentWarning, true);
  assert.equal(state.errorMessage, null);
  assert.equal(state.cancelSource, null);
  assert.equal(abortController.signal.aborted, false);

  controller.cancelStream('runtime-ack-rearm');
  state = controller.getStreamState('runtime-ack-rearm');
  assert.equal(state.phase, 'cancelled');
  assert.equal(state.cancelSource, 'user');
  assert.equal(state.firstContentWarning, false);
  assert.equal(abortController.signal.aborted, true);
  controller.dispose();
});

test('D-STRM: first real content starts a fresh completion budget', () => {
  type ScheduledTimer = {
    active: boolean;
    delayMs: number;
    listener: (result: { ok: true }) => void;
  };
  const timers: ScheduledTimer[] = [];
  const controller = createStreamController({
    now: () => 10_000,
    schedule(delayMs, listener) {
      const timer: ScheduledTimer = { active: true, delayMs, listener };
      timers.push(timer);
      return () => {
        timer.active = false;
      };
    },
    animationFrame() {
      return () => undefined;
    },
  });

  const abortController = controller.startStream('first-content-rearm', 120_000);
  assert.equal(timers.some((timer) => timer.delayMs === 120_000), false);

  controller.feedStreamEvent('first-content-rearm', { type: 'keepalive' });
  assert.equal(timers.some((timer) => timer.delayMs === STREAM_IDLE_TIMEOUT_MS), false);
  controller.feedStreamEvent('first-content-rearm', { type: 'text_delta', textDelta: 'ready' });

  const activeTotalTimers = timers.filter((timer) => timer.delayMs === 120_000 && timer.active);
  assert.equal(activeTotalTimers.length, 1);
  const activeIdleTimers = timers.filter((timer) => (
    timer.delayMs === STREAM_IDLE_TIMEOUT_MS && timer.active
  ));
  assert.equal(activeIdleTimers.length, 1);
  const streamingState = controller.getStreamState('first-content-rearm');
  assert.equal(streamingState.phase, 'streaming');
  assert.equal(streamingState.firstContentWarning, false);
  assert.equal(streamingState.firstContentChunkAt !== null, true);
  assert.equal(abortController.signal.aborted, false);

  controller.feedStreamEvent('first-content-rearm', { type: 'done', finalText: 'ready' });
  assert.equal(activeTotalTimers[0]?.active, false);
  assert.equal(activeIdleTimers[0]?.active, false);
  assert.equal(controller.getStreamState('first-content-rearm').phase, 'done');
  controller.dispose();
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
