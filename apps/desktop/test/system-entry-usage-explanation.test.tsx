import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { Root } from 'react-dom/client';

test('usage explanations open from the title info button without a bottom module', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
  const values: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    ResizeObserver: (globalThis as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const name of Object.getOwnPropertyNames(dom.window)) {
    if (/^(?:HTML|SVG)\w*Element$|Event$/u.test(name) && !(name in values)) values[name] = (dom.window as unknown as Record<string, unknown>)[name];
  }
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let root: Root | null = null;
  try {
    const { createRoot } = await import('react-dom/client');
    const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
    const { SystemEntryDetailsView } = await import('../src/shell/renderer/features/system-entry/system-entry-details.js');
    await initI18n();
    await changeLocale('zh');
    const document = dom.window.document;
    root = createRoot(document.getElementById('root')!);
    await act(async () => root!.render(<SystemEntryDetailsView ai={null} onBack={() => {}} onRefresh={() => {}} />));
    const title = document.querySelector('h1')!;
    assert.equal(title.textContent, 'AI 活动与用量');
    assert.doesNotMatch(document.body.textContent ?? '', /当前账户 · 此设备/);
    const trigger = title.nextElementSibling as HTMLButtonElement;
    assert.equal(trigger.getAttribute('data-testid'), 'home-usage-explanation-trigger');
    assert.equal(trigger.getAttribute('aria-label'), '用量说明');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelector('[data-testid="home-usage-data-details"]'), null);
    await act(async () => trigger.click());
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    const details = document.querySelector('[data-testid="home-usage-data-details"]');
    assert.ok(details);
    assert.equal(details.querySelectorAll('section').length, 2);
    assert.match(details.textContent ?? '', /每次实际 AI 执行计一次/);
    assert.match(details.textContent ?? '', /实际收费以供应商账单为准/);
  } finally {
    if (root) await act(async () => root!.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
