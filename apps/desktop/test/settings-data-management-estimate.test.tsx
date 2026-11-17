import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { ProductUpdateProvider } from '../src/shell/renderer/features/home/product-update-context.js';
import { DataManagementPage } from '../src/shell/renderer/features/settings/settings-data-management-page.js';
import { DesktopMotionProvider } from '../src/shell/renderer/ui/motion/desktop-motion-context.js';
import { initI18n } from '../src/shell/renderer/i18n/index.js';

test('storage page reads browser usage on entry and traverses cached content only on request', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  let browserReads = 0, serialized = 0;
  queryClient.setQueryData(['sample'], { toJSON() { serialized++; return 'ok'; } });
  queryClient.setQueryData(['unserializable'], { toJSON() { throw Error('unserializable'); } });
  const bindings = { app: { commands: {
    productUpdate: {},
    supportRepair: {},
    settings: {
      loadStorageDirs: async () => ({ dataRoot: '/selected' }),
      loadCheckSync: async () => ({ run: null }),
      estimateStorageUsage: async () => { browserReads++; throw Error('Browser storage unavailable'); },
    },
  } } } as unknown as DesktopCanonicalRendererBindings;
  try {
    await initI18n();
    await act(async () => root.render(
      <QueryClientProvider client={queryClient}>
        <DesktopRendererBindingProvider bindings={bindings}><DesktopMotionProvider><ProductUpdateProvider><DataManagementPage /></ProductUpdateProvider></DesktopMotionProvider></DesktopRendererBindingProvider>
      </QueryClientProvider>,
    ));
    assert.equal(browserReads, 1);
    assert.equal(serialized, 0);
    assert.equal(dom.window.document.querySelector('[data-testid="data-management-query-cache-result"]'), null);
    assert.ok(dom.window.document.querySelector('[role="alert"]'));
    const estimate = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="data-management-estimate-query-cache"]');
    assert.ok(estimate);
    await act(async () => estimate.click());
    assert.equal(browserReads, 1, 'an explicit query-cache estimate does not retry a separate owner');
    assert.equal(serialized, 1);
    assert.match(dom.window.document.querySelector('[data-testid="data-management-query-cache-result"]')!.textContent!, /8 B/);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
