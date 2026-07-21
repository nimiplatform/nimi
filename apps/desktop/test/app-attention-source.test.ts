import assert from 'node:assert/strict';
import test from 'node:test';

import { createBrowserAppAttentionSource } from '../src/shell/renderer/app-shell/providers/production-app-attention-source.js';

test('browser attention source attaches once and releases every host effect', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const windowListeners = new Map<string, EventListener>();
  const documentListeners = new Map<string, EventListener>();
  const rootListeners = new Map<string, EventListener>();
  const removed: string[] = [];
  const cancelledFrames: number[] = [];
  const fakeWindow = {
    innerWidth: 100,
    innerHeight: 100,
    addEventListener(type: string, listener: EventListener) {
      windowListeners.set(type, listener);
    },
    removeEventListener(type: string) {
      removed.push(`window:${type}`);
      windowListeners.delete(type);
    },
    requestAnimationFrame() {
      return 41;
    },
    cancelAnimationFrame(frame: number) {
      cancelledFrames.push(frame);
    },
  };
  const fakeDocument = {
    visibilityState: 'visible',
    documentElement: {
      addEventListener(type: string, listener: EventListener) {
        rootListeners.set(type, listener);
      },
      removeEventListener(type: string) {
        removed.push(`root:${type}`);
        rootListeners.delete(type);
      },
    },
    addEventListener(type: string, listener: EventListener) {
      documentListeners.set(type, listener);
    },
    removeEventListener(type: string) {
      removed.push(`document:${type}`);
      documentListeners.delete(type);
    },
  };

  Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: fakeDocument, configurable: true });
  try {
    const source = createBrowserAppAttentionSource();
    let notifications = 0;
    const unsubscribe = source.subscribe(() => {
      notifications += 1;
    });

    assert.deepEqual([...windowListeners.keys()].sort(), ['blur', 'pointermove']);
    assert.deepEqual([...documentListeners.keys()], ['visibilitychange']);
    assert.deepEqual([...rootListeners.keys()], ['mouseleave']);
    windowListeners.get('pointermove')?.({ clientX: 75, clientY: 25 } as PointerEvent);
    assert.equal(source.getSnapshot().active, true);
    assert.equal(source.getSnapshot().normalizedX, 0.5);
    assert.equal(source.getSnapshot().normalizedY, -0.5);
    assert.equal(notifications, 1);

    unsubscribe();
    assert.deepEqual(removed.sort(), [
      'document:visibilitychange',
      'root:mouseleave',
      'window:blur',
      'window:pointermove',
    ]);
    assert.deepEqual(cancelledFrames, [41]);
  } finally {
    Object.defineProperty(globalThis, 'window', { value: previousWindow, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: previousDocument, configurable: true });
  }
});
