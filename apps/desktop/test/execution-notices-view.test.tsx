import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createDesktopExecutionNoticesHost } from '../src-electron/execution-notices-host.js';

test('interruption drawer preserves failed removals, retries, updates counts, and keeps empty state open', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const host = createDesktopExecutionNoticesHost({ readAdmission: async () => ({ generation: 'current-generation', state: 'ready' }), supported: () => false, notify: () => undefined });
  const nimiDayIconUrl = 'data:image/png;base64,bmltaWRheQ==';
  for (const key of ['a', 'b', 'c']) {
    const displayName = key === 'c' ? 'NimiDay' : `App ${key}`;
    host.observe({ key, displayName, state: 'running', executionScopeRef: 'scope-a' });
    host.observe({ key, displayName, state: 'stopped', intentional: true });
  }
  host.observe({ key: 'a', displayName: 'App a', state: 'running', executionScopeRef: 'scope-b' });
  host.observe({ key: 'b', displayName: 'App b', state: 'scope-unknown' });
  let failDismiss = true;
  let malformedDismiss = false;
  const calls: string[] = [];
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
    __NIMI_ELECTRON_TEST__: { invoke: async (command: string, payload: unknown) => {
      if (command === 'desktop_execution_notices_dismiss') {
        calls.push(command);
        if (failDismiss) throw new Error('Removal unavailable');
        if (malformedDismiss) return {};
      }
      const handler = host.commandHandlers[command as keyof typeof host.commandHandlers];
      return handler ? handler({ payload }) : undefined;
    }, listen: () => () => undefined },
  };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { HomeExecutionNotices } = await import('../src/shell/renderer/features/home/execution-notices.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { initI18n, changeLocale, productionDesktopI18n } = await import('../src/shell/renderer/i18n');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  await initI18n(); await changeLocale('en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  const click = async (element: Element | null) => {
    assert.ok(element);
    await act(async () => { (element as HTMLElement).click(); });
    await settle();
  };
  const button = (text: string) => [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === text) ?? null;
  const rows = () => dom.window.document.querySelectorAll('[data-testid="execution-notice-row"]');
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><DesktopI18nResourceProvider resource={productionDesktopI18n}><DesktopMotionProvider><HomeExecutionNotices appArtworkFor={displayName => displayName === 'NimiDay' ? { appId: 'nimi.day', iconUrl: nimiDayIconUrl } : null} /></DesktopMotionProvider></DesktopI18nResourceProvider></QueryClientProvider>); });
    await settle();
    const trigger = dom.window.document.querySelector('[aria-haspopup="dialog"]');
    assert.match(trigger?.textContent ?? '', /3 records/);
    assert.equal(rows().length, 0);
    (trigger as HTMLElement).focus();
    await click(trigger);
    assert.equal(rows().length, 3);
    const titleIcon = dom.window.document.querySelector('[data-testid="execution-notices-title-icon"] svg');
    assert.ok(titleIcon?.classList.contains('lucide-bell-ring'));
    const nimiDayRow = [...rows()].find(row => row.querySelector('h3')?.textContent === 'NimiDay');
    assert.ok(nimiDayRow);
    assert.equal(nimiDayRow.querySelector('.execution-notice-app-icon img')?.getAttribute('src'), nimiDayIconUrl);
    assert.equal(nimiDayRow.querySelector('.lucide-circle-stop'), null);
    assert.equal(nimiDayRow.querySelectorAll('.nimi-status-badge--warning').length, 1);
    const availability = nimiDayRow.querySelector('[data-testid="execution-notice-availability"]');
    assert.ok(availability?.className.includes('text-[var(--nimi-text-secondary)]'));
    assert.equal(availability?.className.includes('nimi-status-warning'), false);
    assert.match(dom.window.document.body.textContent ?? '', /have been restored/);
    assert.match(dom.window.document.body.textContent ?? '', /Cannot confirm whether execution conditions/);
    assert.match(dom.window.document.body.textContent ?? '', /remain unavailable/);
    assert.equal(dom.window.document.querySelector('details')?.open, false);
    await click(button('Remove record'));
    assert.match(dom.window.document.querySelector('[role="alert"]')?.textContent ?? '', /Could not remove/);
    assert.equal(rows().length, 3);
    failDismiss = false; malformedDismiss = true;
    await click(button('Retry'));
    assert.equal(rows().length, 3, 'invalid owner response must not remove a record');
    assert.ok(dom.window.document.querySelector('[role="alert"]'));
    malformedDismiss = false;
    await click(button('Retry'));
    assert.equal(rows().length, 2);
    assert.equal(dom.window.document.querySelector('[role="alert"]'), null);
    assert.match(trigger?.textContent ?? '', /2 records/);
    await click(button('Close'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)); });
    await settle();
    assert.ok(dom.window.document.activeElement === trigger, 'closing returns keyboard focus to the entry');
    await click(trigger);
    assert.equal(rows().length, 2, 'opening or closing must not clear records');
    await click(button('Remove record'));
    await click(button('Remove record'));
    assert.match(dom.window.document.querySelector('[role="dialog"]')?.textContent ?? '', /No app interruption records/);
    assert.equal(dom.window.document.querySelector('[data-testid="execution-notices-summary"]'), null);
    assert.equal(host.commandHandlers.desktop_execution_notices_list({ payload: {} }).notices.length, 0);
    assert.equal(calls.length, 5);
  } finally {
    await act(async () => { root.unmount(); });
    // Radix releases its focus scope on the next task, before restoring DOM globals.
    await settle();
    client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});
