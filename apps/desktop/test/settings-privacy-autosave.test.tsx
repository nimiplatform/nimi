import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

// A failed save must not be retried every autosave cycle for the same edit;
// an explicit retry or a new edit saves again and the form is kept meanwhile.
test('privacy autosave pauses after a failed save until an explicit retry or a new edit', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, Element: dom.window.Element, Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.ts');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { PrivacyPage } = await import('../src/shell/renderer/features/settings/settings-privacy-page.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  await initI18n();
  await changeLocale('en');

  const settings = { profileVisibility: 'PUBLIC', onlineStatusVisibility: 'PUBLIC', defaultPostVisibility: 'PUBLIC', dmVisibility: 'PUBLIC', allowFriendRequests: true, allowMentions: true };
  const updates: unknown[] = [];
  let failUpdates = true;
  const realm = { account: {
    getMySettings: async () => ({ ...settings }),
    updateMySettings: async (input: { body: unknown }) => {
      updates.push(input.body);
      if (failUpdates) throw new Error('realm-unavailable');
      return { ...settings };
    },
  } };
  const timers = new Set<(result: { ok: true }) => void>();
  const bindings = {
    sdk: { realm: () => realm },
    clock: {
      now: () => 0,
      schedule: (_delay: number, listener: (result: { ok: true }) => void) => { timers.add(listener); return () => { timers.delete(listener); }; },
      animationFrame: () => () => {},
    },
  } as never;
  const flushAutosave = async () => {
    for (const listener of [...timers]) { timers.delete(listener); listener({ ok: true }); }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };
  const radio = (label: string) => [...dom.window.document.querySelectorAll('[role="radio"]')]
    .find((element) => element.textContent === label) as HTMLButtonElement | undefined;

  const root = createRoot(dom.window.document.getElementById('root')!);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <DesktopRendererBindingProvider bindings={bindings}>
            <DesktopMotionProvider><PrivacyPage /></DesktopMotionProvider>
          </DesktopRendererBindingProvider>
        </QueryClientProvider>,
      );
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const strict = radio('Strict');
    assert.ok(strict, 'visibility mode control rendered');
    await act(async () => { strict.click(); });
    await flushAutosave();
    assert.equal(updates.length, 1);
    for (let cycle = 0; cycle < 5; cycle += 1) await flushAutosave();
    assert.equal(updates.length, 1, 'the same failed edit was retried automatically');
    assert.equal(radio('Strict')?.getAttribute('aria-checked'), 'true', 'unsaved choice was discarded');

    const retry = [...dom.window.document.querySelectorAll('button')].find((button) => button.textContent === 'Retry');
    assert.ok(retry, 'explicit retry offered');
    await act(async () => { retry.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(updates.length, 2);
    for (let cycle = 0; cycle < 3; cycle += 1) await flushAutosave();
    assert.equal(updates.length, 2);

    failUpdates = false;
    await act(async () => { radio('Smarter Filter')!.click(); });
    await flushAutosave();
    assert.equal(updates.length, 3, 'a new edit schedules a new save');
  } finally {
    await act(async () => { root.unmount(); });
    client.clear();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  }
});
