import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { SimulatorShellView } from '../../src/shell/ui.tsx';

test('global ledger keeps the authorization tab available after the home grant tile is removed', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1/',
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  Object.defineProperty(dom.window.navigator, 'webdriver', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => null,
  });

  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <SimulatorShellView
        epoch={1}
        phase="open"
        registryDigest="sha256:test"
        replayDigest="sha256:test"
        stateRevision={0}
        moduleCount={0}
        route={{ kind: 'home' }}
        instances={[]}
        diagnostics={[]}
        modules={[]}
        onNavigate={() => {}}
        onOpen={() => {}}
        onClose={() => {}}
        onActivate={() => {}}
        onDeactivate={() => {}}
        onReset={() => {}}
      />,
    ));

    const openLedger = dom.window.document.querySelector<HTMLButtonElement>(
      'button[aria-label="打开交互账本"]',
    );
    assert.ok(openLedger);

    await act(async () => openLedger.click());
    const grantTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === '授权');
    const callTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === '调用');
    assert.ok(grantTab);
    assert.ok(callTab);
    await act(async () => grantTab.click());
    assert.equal(grantTab.getAttribute('aria-selected'), 'true');

    await act(async () => callTab.click());
    assert.equal(callTab.getAttribute('aria-selected'), 'true');

    await act(async () => grantTab.click());
    await act(async () => openLedger.click());
    assert.ok(!container.querySelector('#interaction-ledger-drawer'));
    await act(async () => openLedger.click());
    assert.ok(container.querySelector('#interaction-ledger-drawer'));
    assert.equal(grantTab.getAttribute('aria-selected'), 'true');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
