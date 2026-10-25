import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import { GlobalDownloadsProvider, useGlobalDownloads } from '../src/shell/renderer/features/runtime-config/global-downloads-context.js';
import { CAPABILITY_INVENTORY_KEY } from '../src/shell/renderer/features/runtime-config/runtime-capability-inventory.js';
import { LOADOUT_ENVIRONMENT_KEY } from '../src/shell/renderer/features/runtime-config/runtime-local-model-status.js';
import { RUNTIME_MODEL_LIBRARY_KEY } from '../src/shell/renderer/features/runtime-config/use-runtime-model-library.js';

test('Downloads invalidates confirmed phase changes, not order or failed observations', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let timer: { callback: () => void; delay: number } | undefined;
  dom.window.setTimeout = ((callback: () => void, delay: number) => { timer = { callback, delay }; return 1; }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = () => { timer = undefined; };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  let activation = 'root-a';
  let transferFailure = true;
  let environmentFailure = false;
  let duringRead: (() => void) | undefined;
  let transfers = [{ installSessionId: 'transfer-a', state: 'running' }, { installSessionId: 'transfer-b', state: 'running' }];
  let jobs = [{ jobId: 'job-a', state: 'installing' }, { jobId: 'job-b', state: 'installing' }];
  const bindings = {
    sdk: { localEnvironmentRpc: () => ({
      listLocalTransfers: async () => {
        duringRead?.();
        if (transferFailure) throw Error('transfer observation failed');
        return { transfers };
      },
      listLocalEnvironmentDependencyJobs: async () => {
        if (environmentFailure) throw Error('environment observation failed');
        return { jobs };
      },
    }) },
    app: { commands: { firstRun: { getRecord: async () => ({ record: { dataRoot: { rootActivationId: activation } } }) } } },
  } as unknown as DesktopCanonicalRendererBindings;
  let downloads!: NonNullable<ReturnType<typeof useGlobalDownloads>>;
  function Consumer() { downloads = useGlobalDownloads()!; return null; }
  const keys = [CAPABILITY_INVENTORY_KEY, LOADOUT_ENVIRONMENT_KEY, RUNTIME_MODEL_LIBRARY_KEY, ['desktop', 'apps-overview']];
  const invalidations: string[] = [];
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.type === 'updated' && event.action.type === 'invalidate') invalidations.push(JSON.stringify(event.query.queryKey));
  });
  const settle = async () => {
    await new Promise<void>(resolve => setImmediate(resolve));
    if (timer?.delay === 0) { timer.callback(); await new Promise<void>(resolve => setImmediate(resolve)); }
  };
  const poll = async () => {
    for (const key of keys) client.setQueryData(key, {});
    invalidations.length = 0;
    await act(async () => { await downloads.refresh(); await settle(); });
  };
  const changedOnce = () => assert.deepEqual(invalidations.slice().sort(), keys.map(key => JSON.stringify(key)).sort());
  try {
    await act(async () => {
      root.render(<QueryClientProvider client={client}><DesktopRendererBindingProvider bindings={bindings}>
        <GlobalDownloadsProvider><Consumer /></GlobalDownloadsProvider>
      </DesktopRendererBindingProvider></QueryClientProvider>);
    });
    await act(settle);
    assert.match(downloads.errors.join(' '), /transfer observation failed/);
    transfers = transfers.map(item => ({ ...item, state: 'completed' }));
    transferFailure = false;
    await poll();
    changedOnce();
    transfers = transfers.slice().reverse();
    jobs = jobs.slice().reverse();
    await poll();
    assert.deepEqual(invalidations, [], 'progress/heartbeat ordering is not a phase change');
    assert.deepEqual(downloads.transfers.map(item => item.installSessionId), transfers.map(item => item.installSessionId), 'display order still follows Runtime');

    transferFailure = true;
    await poll();
    assert.deepEqual(invalidations, []);
    assert.match(downloads.errors.join(' '), /transfer observation failed/);
    assert.equal(downloads.transfers.length, 2, 'failed source keeps its last confirmed display');
    jobs = jobs.map(job => ({ ...job, state: 'ready_managed' }));
    await poll();
    changedOnce();
    transferFailure = false;
    await poll();
    assert.deepEqual(invalidations, [], 'same facts after failure must not invalidate again');
    assert.deepEqual(downloads.errors, []);

    activation = 'root-b';
    transferFailure = true;
    await poll();
    changedOnce();
    transferFailure = false;
    await poll();
    changedOnce();
    await poll();
    assert.deepEqual(invalidations, [], 'the new activation has its own baseline');
    duringRead = () => { activation = 'root-c'; duringRead = undefined; };
    await poll();
    assert.deepEqual(invalidations, [], 'a cross-activation read must not become a confirmed snapshot');
    assert.match(downloads.errors.join(' '), /Data location changed/);
    await poll();
    changedOnce();

    environmentFailure = true;
    transfers = [...transfers, { installSessionId: 'transfer-c', state: 'running' }];
    await poll();
    changedOnce();
    assert.match(downloads.errors.join(' '), /environment observation failed/);
  } finally {
    unsubscribe();
    await act(async () => root.unmount());
    client.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
