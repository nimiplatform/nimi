import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useEffect } from 'react';
import { JSDOM } from 'jsdom';

test('storage read failures stay unknown and prepared version maintenance does not depend on Check for updates', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    Element: dom.window.Element, Node: dom.window.Node, NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver, CustomEvent: dom.window.CustomEvent, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { ProductUpdateProvider, useProductUpdate } = await import('../src/shell/renderer/features/home/product-update-context.js');
  const { DataManagementPage } = await import('../src/shell/renderer/features/settings/settings-data-management-page.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  await initI18n(); await changeLocale('en');
  let failEstimate = true, checks = 0, installs = 0;
  const status = { phase: 'prepared', currentVersion: '0.2.0', channel: 'beta', target: 'windows-amd64', candidateVersion: '0.3.0', releaseId: 'test-release',
    downloadedBytes: 1, totalBytes: 1, checkedAt: null, reason: null, installationAvailable: true, checkAvailable: false,
    recoveryAction: 'none', recoveryError: null, maintenanceAvailable: true };
  const bindings = { app: { commands: { settings: {
    estimateStorageUsage: async () => { if (failEstimate) throw new Error('estimate-unavailable'); return { localStorageBytes: 0, estimatedUsageBytes: 0, estimatedQuotaBytes: 0 }; },
    loadStorageDirs: async () => { throw new Error('dirs-unavailable'); },
    loadCheckSync: async () => { throw new Error('sync-unavailable'); },
  }, supportRepair: {}, productUpdate: {
    status: async () => status, homeReady: async () => status,
    check: async () => { checks++; return status; }, install: async () => { installs++; return status; },
  } } } } as never;
  function Page() { const update = useProductUpdate(); useEffect(update.homeReady, [update.homeReady]); return <DataManagementPage />; }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => { root.render(<QueryClientProvider client={client}><DesktopRendererBindingProvider bindings={bindings}>
      <DesktopMotionProvider><ProductUpdateProvider><Page /></ProductUpdateProvider></DesktopMotionProvider>
    </DesktopRendererBindingProvider></QueryClientProvider>); await new Promise(resolve => setTimeout(resolve, 0)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const doc = dom.window.document;
    assert.match(doc.body.textContent!, /Storage estimates could not be read/);
    assert.match(doc.body.textContent!, /current data location could not be read/);
    assert.match(doc.body.textContent!, /Check and Sync status could not be read/);
    assert.doesNotMatch(doc.querySelector('#root')!.textContent!, /0 B/);
    failEstimate = false;
    const retry = [...doc.querySelectorAll('button')].find(button => button.textContent === 'Retry')!;
    await act(async () => { retry.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.match(doc.body.textContent!, /0 B/);
    assert.match(doc.body.textContent!, /current data location could not be read/);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    const maintenance = [...doc.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Review old versions')!;
    assert.ok(maintenance && !maintenance.disabled, doc.body.innerHTML.slice(-4500));
    await act(async () => { maintenance.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.ok(doc.querySelector('[data-testid="product-update-dialog"]'));
    assert.match(doc.querySelector('[data-testid="product-update-dialog"]')!.textContent!, /Review old versions/);
    assert.equal(checks, 0);
    assert.equal(installs, 0);
  } finally {
    await act(async () => root.unmount()); client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; }
  }
});
