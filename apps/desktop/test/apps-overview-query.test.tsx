import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { AppPackageSourceClass, type ApprovedAppCatalogTarget, type AppPackageInfo } from '@nimiplatform/sdk/runtime/wire-types';
import type { DesktopAppsProjectionSource } from '../src/shell/renderer/features/apps/apps-panel-projection.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function mountOverview(source: DesktopAppsProjectionSource, online = true) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider, onlineManager } = await import('@tanstack/react-query');
  const { useAppsOverviewQuery } = await import('../src/shell/renderer/features/apps/use-apps-overview.js');
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  onlineManager.setOnline(online);
  let state!: ReturnType<typeof useAppsOverviewQuery>;
  function Harness() { state = useAppsOverviewQuery(source); return <output>{state.isPending ? 'loading' : 'loaded'}</output>; }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const settle = async () => {
    for (let i = 0; i < 4; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };
  await act(async () => { root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
  await settle();
  return {
    state: () => state,
    loaded: () => {
      const data = state.data;
      assert.equal(data?.status, 'loaded');
      if (data?.status !== 'loaded') throw Error('Inventory not loaded');
      return data;
    },
    settle,
    cleanup: async () => {
      await act(async () => { root.unmount(); });
      client.clear(); onlineManager.setOnline(true); dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

function localSource(): DesktopAppsProjectionSource {
  return {
    listRegistrations: async () => [],
    listRuns: async () => [],
    listPackageJobs: async () => [],
    listCommittedReleases: async () => [{
      appId: 'example.installed', displayName: 'Installed', sourceClass: AppPackageSourceClass.VERIFIED,
      version: '1.0.0', releaseRef: 'release:1', launchSelector: new Uint8Array([1]), appAccess: [],
    }],
  };
}

test('local inventory appears while catalog and artwork are pending; remote-only metadata is never read', async () => {
  const catalog = deferred<readonly ApprovedAppCatalogTarget[]>();
  const info = deferred<AppPackageInfo>();
  const reads: string[] = [];
  const view = await mountOverview({
    ...localSource(),
    listApprovedCatalogTargets: () => catalog.promise,
    readPackageInfo: async (request) => { reads.push(request.installedReleaseRef); return info.promise; },
  });
  try {
    assert.equal(view.state().isPending, false);
    assert.equal(view.loaded().catalogStatus, 'loading');
    assert.equal(view.loaded().entries[0]?.identity.displayName, 'Installed');
    assert.equal(view.loaded().entries[0]?.iconUrl, null);
    await act(async () => {
      catalog.resolve([
        { appId: 'example.installed', version: '2.0.0' } as ApprovedAppCatalogTarget,
        { appId: 'example.remote', version: '1.0.0' } as ApprovedAppCatalogTarget,
      ]);
    });
    await view.settle();
    assert.equal(view.loaded().entries.length, 1);
    assert.equal(view.loaded().entries[0]?.catalogTarget?.version, '2.0.0');
    assert.deepEqual(reads, ['release:1']);
    await act(async () => { info.resolve({ appId: 'example.installed', version: '1.0.0', iconPngBase64: 'artwork' } as AppPackageInfo); });
    await view.settle();
    assert.equal(view.loaded().entries[0]?.iconUrl, 'data:image/png;base64,artwork');
    assert.equal(view.loaded().entries[0]?.catalogTarget?.version, '2.0.0');
    await act(async () => { await view.state().refetch(); });
    await view.settle();
    assert.deepEqual(reads, ['release:1'], 'unchanged installed metadata is reused on refresh');
  } finally { await view.cleanup(); }
});

test('catalog failure preserves imported local apps', async () => {
  const catalog = deferred<readonly ApprovedAppCatalogTarget[]>();
  const base = localSource();
  const view = await mountOverview({
    ...base,
    listCommittedReleases: async () => (await base.listCommittedReleases()).map((row) => ({ ...row, sourceClass: AppPackageSourceClass.USER_IMPORTED })),
    listApprovedCatalogTargets: () => catalog.promise,
  });
  try {
    assert.equal(view.state().isPending, false);
    await act(async () => { catalog.reject(Error('Registry offline')); });
    await view.settle();
    assert.equal(view.loaded().catalogStatus, 'unavailable');
    assert.equal(view.loaded().runtimeError, null);
    assert.equal(view.loaded().entries[0]?.identity.sourceClass, 'user_imported');
  } finally { await view.cleanup(); }
});

test('catalog updates cannot attach verified targets to an imported release', async () => {
  const base = localSource();
  const view = await mountOverview({
    ...base,
    listCommittedReleases: async () => (await base.listCommittedReleases()).map((row) => ({ ...row, sourceClass: AppPackageSourceClass.USER_IMPORTED })),
    listApprovedCatalogTargets: async () => [{ appId: 'example.installed', version: '2.0.0' } as ApprovedAppCatalogTarget],
  });
  try {
    assert.equal(view.loaded().catalogStatus, 'loaded');
    assert.equal(view.loaded().entries[0]?.catalogTarget, null);
    assert.equal(view.loaded().entries[0]?.committedRelease?.version, '1.0.0');
  } finally { await view.cleanup(); }
});

test('conflicting catalog rows fail only the remote projection', async () => {
  const target = { appId: 'example.installed', version: '2.0.0' } as ApprovedAppCatalogTarget;
  const view = await mountOverview({ ...localSource(), listApprovedCatalogTargets: async () => [target, target] });
  try {
    assert.equal(view.loaded().catalogStatus, 'unavailable');
    assert.equal(view.loaded().entries[0]?.identity.displayName, 'Installed');
    assert.equal(view.loaded().entries[0]?.catalogTarget, null);
  } finally { await view.cleanup(); }
});

test('offline browser state does not pause local Runtime inventory', async () => {
  let catalogReads = 0;
  const view = await mountOverview({ ...localSource(), listApprovedCatalogTargets: async () => { catalogReads += 1; return []; } }, false);
  try {
    assert.equal(view.state().isPending, false);
    assert.equal(view.loaded().entries.length, 1);
    assert.equal(view.loaded().catalogStatus, 'unavailable');
    assert.equal(catalogReads, 0);
  } finally { await view.cleanup(); }
});
