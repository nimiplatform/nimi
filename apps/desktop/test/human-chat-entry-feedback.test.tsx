import assert from 'node:assert/strict';
import test from 'node:test';

test('blocked and cancelled entry results expose localized visible feedback', async () => {
  const { JSDOM } = await import('jsdom');
  const React = await import('react');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, SVGElement: dom.window.SVGElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { NimiToaster, nimiToast } = await import('@nimiplatform/kit/ui');
  const { createDesktopI18n } = await import('../src/shell/renderer/i18n/desktop-i18n.js');
  const resource = createDesktopI18n({ initialLocale: 'en', development: false, now: Date.now });
  const { reportHumanChatOpenResult } = await import('../src/shell/renderer/features/relationship/human-chat-entry.js');
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await resource.init();
    await React.act(async () => { root.render(React.createElement(NimiToaster)); });
    await React.act(async () => { reportHumanChatOpenResult({ status: 'busy' }, key => resource.instance.t(key)); });
    assert.match(dom.window.document.body.textContent ?? '', /Could not open Friends & chat/);
    await React.act(async () => { reportHumanChatOpenResult({ status: 'cancelled' }, key => resource.instance.t(key)); });
    assert.match(dom.window.document.body.textContent ?? '', /Opening Friends & chat was cancelled/);
  } finally {
    await React.act(async () => { nimiToast.clear(); root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
