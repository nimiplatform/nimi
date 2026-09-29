import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

// A slow start is not a failure: the loading screen only switches to its
// "still starting" state after the threshold, and never without one.
test('a start is marked slow only after its threshold, and never without one', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  try {
    const { createRoot } = await import('react-dom/client');
    const { useSlowStart } = await import('../src/shell/renderer/app-shell/routes/use-slow-start.js');
    const seen: Record<string, boolean[]> = { timed: [], untimed: [] };
    function Probe(props: { name: string; after?: number }) {
      seen[props.name]!.push(useSlowStart(props.after));
      return null;
    }
    const root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => { root.render(<><Probe name="timed" after={30} /><Probe name="untimed" /></>); });
    assert.equal(seen.timed!.at(-1), false);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    assert.equal(seen.timed!.at(-1), true);
    assert.equal(seen.untimed!.at(-1), false);
    await act(async () => { root.unmount(); });
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});
