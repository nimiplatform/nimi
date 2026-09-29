import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('Check & Sync keeps polling a running projection and refreshes on return to the window', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost', pretendToBeVisual: true,
  });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let tick: (() => void) | undefined;
  let cleared = false;
  dom.window.setInterval = ((callback: TimerHandler, delay?: number) => {
    assert.equal(delay, 1_000);
    tick = callback as () => void;
    return 42;
  }) as typeof dom.window.setInterval;
  dom.window.clearInterval = ((id: number) => {
    assert.equal(id, 42);
    cleared = true;
  }) as typeof dom.window.clearInterval;
  const { createRoot } = await import('react-dom/client');
  const { useCheckSyncPolling } = await import('../src/shell/renderer/features/settings/check-sync-polling.js');
  let calls = 0;
  let finishFirst!: () => void;
  const refresh = () => {
    calls += 1;
    return calls === 1 ? new Promise<void>((resolve) => { finishFirst = resolve; }) : Promise.resolve();
  };
  function Harness({ running }: { running: boolean }) {
    useCheckSyncPolling(running, refresh);
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => { root.render(<Harness running />); });
    assert.ok(tick);
    await act(async () => { tick?.(); tick?.(); });
    assert.equal(calls, 1, 'overlapping owner reads must be coalesced');
    await act(async () => { finishFirst(); await Promise.resolve(); });
    await act(async () => { tick?.(); await Promise.resolve(); });
    assert.equal(calls, 2, 'a still-running projection must be read again');
    await act(async () => { dom.window.dispatchEvent(new dom.window.Event('focus')); await Promise.resolve(); });
    assert.equal(calls, 3, 'returning to the window refreshes without remounting');
    await act(async () => { root.render(<Harness running={false} />); });
    assert.equal(cleared, true);
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    assert.equal(calls, 3, 'terminal state stops polling and focus refresh');
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
