import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('read acknowledgement waits for a visible message in a foreground document and resumes on return', async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  let observe: IntersectionObserverCallback = () => {};
  let disconnected = false;
  class Observer {
    constructor(callback: IntersectionObserverCallback) { observe = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  }
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, React, IntersectionObserver: Observer, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { HumanReadMarker } = await import('../src/shell/renderer/features/chat/chat-human-canonical-components.js');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const acknowledgements: string[] = [];
  const intersect = (value: boolean) => observe([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver);
  try {
    await act(async () => root.render(<HumanReadMarker messageId="message-2" onVisible={async id => { acknowledgements.push(id); }} />));
    intersect(false);
    assert.deepEqual(acknowledgements, []);
    Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'hidden' });
    intersect(true);
    assert.deepEqual(acknowledgements, []);
    Object.defineProperty(dom.window.document, 'visibilityState', { configurable: true, value: 'visible' });
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.deepEqual(acknowledgements, ['message-2']);
    await act(async () => root.unmount());
    assert.equal(disconnected, true);
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    assert.deepEqual(acknowledgements, ['message-2']);
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});
