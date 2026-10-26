import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('compact Settings reopens an unchanged page, preserves focus and flushes appearance edits before leaving', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const observers: { callback: ResizeObserverCallback; target?: Element }[] = [];
  class Observer {
    entry: typeof observers[number];
    constructor(callback: ResizeObserverCallback) { this.entry = { callback }; observers.push(this.entry); }
    observe(target: Element) { this.entry.target = target; }
    unobserve() {}
    disconnect() { this.entry.target = undefined; }
  }
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLFormElement: dom.window.HTMLFormElement, HTMLSelectElement: dom.window.HTMLSelectElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement,
    DocumentFragment: dom.window.DocumentFragment, Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    ResizeObserver: Observer, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { initI18n, changeLocale, productionDesktopI18n } = await import('../src/shell/renderer/i18n/index.js');
  const { SettingsPanelBody } = await import('../src/shell/renderer/features/settings/settings-panel-body.js');
  const { openHomeSettings } = await import('../src/shell/renderer/features/settings/settings-entry.js');
  await initI18n(); await changeLocale('en');
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  await openHomeSettings(store.navigation);
  const writes: unknown[] = [];
  const timers = new Set<unknown>();
  const bindings = { app: { commands: { settings: {
    loadAppearancePreferences: () => ({ theme: 'system', reduceMotion: false }),
    persistAppearancePreferences: (value: unknown) => { writes.push(value); },
  }, supportLogs: { loadStorageDirs: async () => ({ logsDir: '/test/logs' }) } } }, clock: { schedule: (_delay: number, callback: unknown) => { timers.add(callback); return () => timers.delete(callback); } } } as never;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const paint = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  try {
    await act(async () => { root.render(<AppStoreProvider store={store}><DesktopRendererBindingProvider bindings={bindings}>
      <DesktopI18nResourceProvider resource={productionDesktopI18n}><DesktopMotionProvider><SettingsPanelBody /></DesktopMotionProvider></DesktopI18nResourceProvider>
    </DesktopRendererBindingProvider></AppStoreProvider>); });
    const doc = dom.window.document;
    const resize = (width: number) => {
      const observer = observers.find(item => item.target?.getAttribute('data-testid') === 'panel:settings-body')!;
      observer.callback([{ target: observer.target!, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    };
    await act(async () => resize(500)); await paint();
    const back = doc.querySelector<HTMLButtonElement>('[data-testid="settings-compact-back"]')!;
    assert.ok(back);
    await act(async () => back.click()); await paint();
    const appearance = doc.querySelector<HTMLButtonElement>('[data-testid="settings-nav:appearance"]')!;
    assert.equal(doc.activeElement, appearance);
    assert.equal(appearance.tabIndex, 0);
    const historyKey = store.navigation.getSnapshot().current.key;
    await act(async () => { assert.equal((await openHomeSettings(store.navigation)).status, 'unchanged'); }); await paint();
    assert.equal(store.navigation.getSnapshot().current.key, historyKey);
    assert.equal(doc.activeElement?.tagName, 'H2');
    assert.equal(doc.querySelector('[data-testid="settings-detail"]')!.parentElement!.classList.contains('hidden'), false);
    const motion = doc.querySelector<HTMLButtonElement>('[role="switch"]')!;
    await act(async () => motion.click());
    assert.equal(writes.length, 0, 'debounce has not elapsed');
    await act(async () => { await openHomeSettings(store.navigation, 'logs'); });
    assert.deepEqual(writes, [{ theme: 'system', reduceMotion: true }]);
    assert.equal(timers.size, 0);
    assert.equal(store.navigation.getSnapshot().current.destination.settingsSection, 'logs');
  } finally {
    await act(async () => root.unmount()); store.navigation.dispose(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
  }
});
