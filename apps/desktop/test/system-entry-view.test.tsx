import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { SystemEntryApp, SystemEntryUsageView } from '../src/shell/renderer/system-entry/system-entry-app.js';
import type { SystemEntryBridge, SystemEntrySnapshot } from '../src/shell/shared/system-entry-types.js';

test('scope or coverage notes never hide the partial usage marker', () => {
  const html = renderToStaticMarkup(<SystemEntryUsageView locale="en" usage={{ status: 'partial', observedAt: null, periodLabel: 'Today',
    attempts: '2', localAttempts: '1', cloudAttempts: '1', costs: [], partial: true, note: 'Current account · Recorded since 00:00' }} />);
  assert.match(html, /Partial data/);
  assert.match(html, /Recorded since 00:00/);
});

test('overview shows zero only when all recorded executions have a confirmed local route', () => {
  const usage = { status: 'partial' as const, observedAt: null, periodLabel: 'Today', attempts: '3',
    localAttempts: '3', cloudAttempts: '0', costs: [], partial: true, note: 'Recorded since 00:00' };
  for (const locale of ['zh', 'en'] as const) {
    const document = JSDOM.fragment(renderToStaticMarkup(<SystemEntryUsageView locale={locale} usage={usage} />));
    assert.match(document.querySelector('.se-usage-cost')!.textContent!, / 0$/);
    assert.match(document.textContent!, /Recorded since 00:00/);
  }
  for (const counts of [{ localAttempts: null, cloudAttempts: null }, { localAttempts: '2', cloudAttempts: '1' }, { localAttempts: '2', cloudAttempts: '0' }]) {
    const document = JSDOM.fragment(renderToStaticMarkup(<SystemEntryUsageView locale="en" usage={{ ...usage, ...counts }} />));
    assert.equal(document.querySelector('.se-usage-cost')!.textContent, 'Cost estimate unavailable');
  }
});

test('a delayed initial popup read cannot replace a newer account invalidation', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/system-entry.html' });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  let resolve!: (snapshot: SystemEntrySnapshot) => void;
  let receive!: (snapshot: SystemEntrySnapshot) => void;
  const bridge: SystemEntryBridge = {
    getSnapshot: () => new Promise(done => { resolve = done; }),
    onSnapshot: listener => { receive = listener; return () => {}; },
    act: async () => {}, close: async () => {}, openMenu: async () => {},
  };
  Object.assign(dom.window, { nimiSystemEntry: bridge });
  const oldSection = { status: 'available' as const, observedAt: '2026-10-23T00:00:00Z', total: 0, items: [] };
  const old: SystemEntrySnapshot = {
    admission: { state: 'ready', generation: 'old-account' }, observation: 'current', revision: 1, locale: 'en', colorScheme: 'light', homeVisible: true, actionError: null,
    projection: { generation: 'old-account', revision: 1, locale: 'en', colorScheme: 'light', observedAt: oldSection.observedAt, service: 'running',
      attention: { ...oldSection, total: 1, items: [{ id: 'old-item', title: 'Former account private task', detail: '', action: null }] },
      work: oldSection, recent: oldSection, apps: oldSection, downloads: oldSection,
      usage: { status: 'unavailable', observedAt: null, periodLabel: 'Today', attempts: null, localAttempts: null, cloudAttempts: null, costs: [], partial: true, note: '' },
      notificationsEnabled: true, notificationsPausedUntil: 0 },
  };
  try {
    await act(async () => { root.render(<SystemEntryApp />); });
    await act(async () => { receive({ ...old, admission: { state: 'login-required', generation: 'new-account' }, projection: null }); });
    await act(async () => { resolve(old); });
    assert.match(dom.window.document.body.textContent ?? '', /Sign in to see your activity/);
    assert.doesNotMatch(dom.window.document.body.textContent ?? '', /Former account private task/);
    await act(async () => { receive({ ...old, observation: 'unavailable' }); });
    assert.match(dom.window.document.body.textContent ?? '', /Activity is not updating/);
    assert.doesNotMatch(dom.window.document.body.textContent ?? '', /Former account private task/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

async function withUnavailableOverview(run: (document: Document, push: (snapshot: SystemEntrySnapshot) => Promise<void>, initial: SystemEntrySnapshot) => Promise<void>) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/system-entry.html' });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const initial: SystemEntrySnapshot = {
    admission: { state: 'login-required', generation: 'gate' }, observation: 'unavailable', revision: 0,
    locale: 'en', colorScheme: null, homeVisible: true, actionError: null, projection: null,
  };
  let receive!: (snapshot: SystemEntrySnapshot) => void;
  const bridge: SystemEntryBridge = {
    getSnapshot: async () => initial, onSnapshot: listener => { receive = listener; return () => {}; },
    act: async () => {}, close: async () => {}, openMenu: async () => {},
  };
  Object.assign(dom.window, { nimiSystemEntry: bridge });
  try {
    await act(async () => { root.render(<SystemEntryApp />); });
    await run(dom.window.document, next => act(async () => { receive(next); }), initial);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('keyboard traversal wraps between visible actions when gate or unavailable state hides Downloads', async () => {
  await withUnavailableOverview(async (document, push, initial) => {
    for (const snapshot of [initial, { ...initial, admission: { state: 'ready' as const, generation: 'ready' } }]) {
      await push(snapshot);
      const more = document.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!;
      const home = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Open Home')!;
      const download = document.querySelector<HTMLButtonElement>('[aria-label="Downloads"]')!;
      assert.equal(download.hidden, true);
      more.focus();
      const reverse = new document.defaultView!.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      more.dispatchEvent(reverse);
      assert.equal(reverse.defaultPrevented, true);
      assert.equal(document.activeElement, home);
      const forward = new document.defaultView!.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      home.dispatchEvent(forward);
      assert.equal(forward.defaultPrevented, true);
      assert.equal(document.activeElement, more);
    }
  });
});

test('overview applies the Home resolved scheme while retaining safe system fallback before its first projection', async () => {
  await withUnavailableOverview(async (document, push, initial) => {
    assert.equal(document.documentElement.style.colorScheme, 'light dark');
    await push({ ...initial, colorScheme: 'dark' });
    assert.equal(document.documentElement.style.colorScheme, 'dark');
    await push({ ...initial, colorScheme: 'light' });
    assert.equal(document.documentElement.style.colorScheme, 'light');
    await push({ ...initial, colorScheme: 'dark', admission: { state: 'locked', generation: 'locked' } });
    assert.equal(document.documentElement.style.colorScheme, 'dark');
    assert.match(document.body.textContent ?? '', /Your device is locked/);
  });
});
