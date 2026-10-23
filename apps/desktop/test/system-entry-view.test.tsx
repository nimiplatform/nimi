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
    admission: { state: 'ready', generation: 'old-account' }, observation: 'current', revision: 1, locale: 'en', homeVisible: true, actionError: null,
    projection: { generation: 'old-account', revision: 1, locale: 'en', observedAt: oldSection.observedAt, service: 'running',
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
