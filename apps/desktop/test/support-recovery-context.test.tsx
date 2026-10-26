import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';

async function setup(failedRecord = false, entry = false) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement, NodeFilter: dom.window.NodeFilter, getComputedStyle: dom.window.getComputedStyle, MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), Element: dom.window.Element, Node: dom.window.Node, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { SupportTroubleshooting } = await import('../src/shell/renderer/features/support/support-troubleshooting.js');
  const { SupportDegradedEntry } = await import('../src/shell/renderer/features/support/support-degraded-entry.js');
  await initI18n(); await changeLocale('en');
  let retried = 0, plans = 0;
  const bindings = { app: { commands: {
    supportRepair: {
      loadProductControlRecord: async () => { if (failedRecord) throw new Error('record-unavailable'); return { state: 'ready_for_use', error: 'owner-record-detail', record: { repair: { required: false } } }; },
      loadStorageDirs: async () => { throw new Error('dirs-unavailable'); },
      planAppHostCacheCleanup: async () => { plans++; return { hostsRunning: true, profileCount: 1, totalBytes: 1234, fileCount: 2 }; },
    },
    runtimeDaemon: { status: async () => ({ running: true, launchMode: 'SOURCE', grpcAddr: 'protected', version: '' }) },
    systemResources: { load: async () => { throw new Error('resources-unavailable'); } },
  } } } as never;
  function Gate() {
    const [result, setResult] = useState('');
    return <><p data-testid="parent-gate-result">{result}</p><SupportDegradedEntry recovery={{ title: 'Runtime maintenance is blocking Home', actionLabel: 'Return to recovery', onAction: () => { retried++; setResult('Owner rejected the selected directory'); } }} /></>;
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => {
    root.render(<DesktopRendererBindingProvider bindings={bindings}>
      {entry ? <Gate /> : <SupportTroubleshooting recovery={{ title: 'Runtime maintenance is blocking Home', detail: 'owner-data-rejected', actionLabel: 'Return to recovery', onAction: () => { retried++; } }} />}
    </DesktopRendererBindingProvider>);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return { dom, retried: () => retried, plans: () => plans,
    close: async () => { await act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
    },
  };
}

test('a stored ready record never clears the current maintenance gate, and degraded App cache remains owner-controlled', async () => {
  const f = await setup();
  try {
    const doc = f.dom.window.document;
    assert.match(doc.querySelector('[data-testid="support-current-gate"]')!.textContent!, /Runtime maintenance is blocking Home/);
    assert.equal(doc.querySelector('[data-testid="support-control-state"]'), null);
    assert.ok(doc.querySelector('[data-testid="support-stored-record"]'));
    assert.match(doc.querySelector('[data-testid="support-record-reason"]')!.textContent!, /owner-record-detail/);
    const action = [...doc.querySelectorAll('button')].find(e => e.textContent === 'Return to recovery')!;
    await act(async () => action.click());
    assert.equal(f.retried(), 1);
    const plan = doc.querySelector<HTMLButtonElement>('[data-testid="support-repair-app-cache-plan-button"]')!;
    await act(async () => { plan.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(f.plans(), 1);
    assert.ok(doc.querySelector('[data-testid="support-repair-app-cache-hosts-running"]'));
    assert.equal(doc.querySelector('[data-testid="support-repair-app-cache-clear-button"]'), null);
  } finally { await f.close(); }
});

test('a failed record and storage read do not hide the actual recovery cause or its callback', async () => {
  const f = await setup(true);
  try {
    const doc = f.dom.window.document;
    assert.ok(doc.querySelector('[data-testid="support-control-failed"]'));
    assert.equal(doc.querySelector('[data-testid="support-control-state"]'), null);
    assert.ok(doc.querySelector('[data-testid="support-current-gate"]'));
    assert.ok(doc.querySelector('[data-testid="support-repair-app-cache-plan-button"]'));
    const action = [...doc.querySelectorAll('button')].find(e => e.textContent === 'Return to recovery')!;
    await act(async () => action.click());
    assert.equal(f.retried(), 1);
  } finally { await f.close(); }
});


test('a recovery action closes the support overlay before handing results back to the original gate', async () => {
  const f = await setup(false, true);
  try {
    const doc = f.dom.window.document;
    await act(async () => { doc.querySelector<HTMLButtonElement>('[data-testid="support-degraded-entry-trigger"]')!.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    const action = [...doc.querySelectorAll('button')].find(e => e.textContent === 'Return to recovery');
    assert.ok(action);
    await act(async () => { action.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
    assert.equal(f.retried(), 1);
    assert.match(doc.querySelector('[data-testid="parent-gate-result"]')!.textContent!, /Owner rejected/);
    assert.equal(doc.querySelector('[data-testid="support-degraded-overlay"][data-state="open"]'), null);
  } finally { await f.close(); }
});
