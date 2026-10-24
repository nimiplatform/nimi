import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { ApprovedAppCatalogTarget } from '@nimiplatform/sdk/runtime/wire-types';
import type { AppsPanelController, AppsPanelControllerDeps } from '../src/shell/renderer/features/apps/apps-panel-controller.js';
import type { DesktopAppsPanelProjection } from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import type { LocalDevelopmentRegistration } from '../src/shell/renderer/features/local-development/local-development-types.js';
import type { NimiAIConfigSnapshot } from '@nimiplatform/kit/core/sdk-contract';

test('Apps remount reuses artwork and catalog, refreshes local changes, and respects session cache clearing', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { useAppsPanelController } = await import('../src/shell/renderer/features/apps/apps-panel-controller.js');
  const { initI18n } = await import('../src/shell/renderer/i18n/index.js');
  await initI18n();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => undefined });
  const counts = { icon: 0, readme: 0, info: 0, catalog: 0, inventory: 0 };
  let revision = 1;
  let present = true;
  let inventoryGate: Promise<void> = Promise.resolve();
  let catalogGate: Promise<void> = Promise.resolve();
  let catalogFails = false;
  let catalogVersion = '1.0.0';
  let aiEligible = false;
  const aiReadSignals: AbortSignal[] = [];
  const emptyAIConfig: NimiAIConfigSnapshot = { config: { capabilities: [] }, revision: '2', effectiveSelections: [] };
  let aiRead: () => Promise<NimiAIConfigSnapshot> = async () => emptyAIConfig;
  const registration = (): LocalDevelopmentRegistration => ({
    selector: 'project-example', appId: 'example.local', displayName: 'Local app',
    canonicalProjectRoot: '/example', shell: 'electron', appAccess: aiEligible ? ['runtime.consume'] : [], aiConfigAllowedRoutes: [],
    capabilityContractRefs: [], sourceGeneration: revision, declarationGeneration: 1,
    registeredAtUnixMs: 1, updatedAtUnixMs: revision,
  });
  const deps: AppsPanelControllerDeps = {
    buildLiveBridge: () => ({
      listRegistrations: async () => { counts.inventory++; await inventoryGate; return present ? [registration()] : []; },
      listRuns: async () => [],
      readProjectIcon: async () => { counts.icon++; return { iconDataUrl: `data:image/png;base64,local${revision}` }; },
      readProjectReadme: async () => { counts.readme++; return { content: null, summary: `Local summary ${revision}`, truncated: false, fileName: null }; },
      startRegistration: async () => { throw Error('Unexpected launch'); },
      stopRun: async () => {}, removeRegistration: async () => {},
    }),
    listCommittedReleases: async () => [], listPackageJobs: async () => [], cancelPackageJob: async () => {},
    readAppAIConfig: async (_appId, options) => { aiReadSignals.push(options.signal); return aiRead(); },
    listApprovedCatalogTargets: async () => {
      counts.catalog++;
      await catalogGate;
      if (catalogFails) throw Error('Catalog unavailable');
      const target: ApprovedAppCatalogTarget = { appId: 'example.remote', displayName: 'Remote app', version: catalogVersion,
        approvedTargetSelector: new Uint8Array([Number(catalogVersion[0])]),
        appAccess: [], capabilityContractRefs: [], requiredStandardizedFeatureRefs: [], osStorageDisclosures: [],
        observedRegistryRevision: 'a'.repeat(40), descriptorId: `example.remote@${catalogVersion}`,
        publisherGithubNamespace: 'example', sourceRepository: 'https://github.com/example/remote', sourceLicenseSpdxExpression: 'MIT',
        storagePolicyKind: 'nimi-mediated-default', targetId: 'windows-x86_64', os: 'windows', arch: 'x86_64',
        assetName: 'remote.nimiapp', assetSize: '42', executionProfileRef: 'windows-user-mode-as-invoker-v1',
        windowsCodeSigning: 'unsigned', macosNotarization: 'not-applicable', policyBlocked: false, policyRevision: '0',
      };
      return [target];
    },
    readPackageInfo: async () => { counts.info++; return { appId: 'example.remote', version: catalogVersion,
      iconPngBase64: `remote${catalogVersion}`, summary: `Remote summary ${catalogVersion}`,
      targetId: 'windows-x86_64', displayName: 'Remote app', readmeMarkdown: '', releaseNotesMarkdown: '',
      licenseIdentifier: 'MIT', licenseText: '', appAccess: [], capabilityContractRefs: [],
      requiredStandardizedFeatureRefs: [], storagePolicyKind: 'nimi-mediated-default', osStorageDisclosure: [],
      author: '', homepageUrl: '', supportUrl: '',
    }; },
  };
  let state!: AppsPanelController;
  const paints: (DesktopAppsPanelProjection | null)[] = [];
  function Harness() { state = useAppsPanelController(deps); paints.push(state.projection); return null; }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const show = async (visible: boolean) => {
    await act(async () => { root.render(<AppStoreProvider store={store}><QueryClientProvider client={client}>{visible ? <Harness /> : null}</QueryClientProvider></AppStoreProvider>); });
  };
  const settle = async () => {
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  const loaded = () => {
    const data = state.projection;
    if (data?.status !== 'loaded') throw Error('Apps not loaded');
    return data;
  };
  try {
    await show(true); await settle();
    assert.equal(loaded().entries.length, 2);
    assert.equal(loaded().entries.find(e => e.localDevelopment)?.iconUrl, 'data:image/png;base64,local1');
    const first = loaded();
    const initialReads = { ...counts };
    await show(false);
    let releaseInventory!: () => void;
    inventoryGate = new Promise(resolve => { releaseInventory = resolve; });
    paints.length = 0;
    await show(true);
    assert.equal(paints[0], first, 'the first render already contains the complete cached directory');
    assert.equal(counts.catalog, initialReads.catalog, 'fresh catalog is reused across navigation');
    releaseInventory(); await settle();
    assert.equal(counts.icon, initialReads.icon);
    assert.equal(counts.readme, initialReads.readme);
    assert.equal(counts.info, initialReads.info);
    assert.ok(counts.inventory > initialReads.inventory, 'local lifecycle still refreshes');
    assert.ok(paints.every(p => p?.status === 'loaded' && p.entries.length === 2 && p.entries.every(e => e.iconUrl)));

    await show(false); revision = 2; await show(true); await settle();
    assert.equal(loaded().entries.find(e => e.localDevelopment)?.iconUrl, 'data:image/png;base64,local2');
    assert.equal(loaded().entries.find(e => e.localDevelopment)?.summary, 'Local summary 2');
    assert.ok(counts.icon > initialReads.icon, 'changed registrations invalidate artwork');

    await show(false); present = false; await show(true); await settle();
    assert.equal(loaded().entries.some(e => e.localDevelopment), false, 'removed registrations do not survive refresh');
    catalogVersion = '2.0.0';
    await act(async () => state.retryProjection()); await settle();
    assert.equal(loaded().entries[0]?.iconUrl, 'data:image/png;base64,remote2.0.0');
    assert.ok(counts.catalog > initialReads.catalog, 'explicit retry bypasses catalog freshness');

    await show(false);
    const cachedCatalog = client.getQueryCache().find({ queryKey: ['desktop', 'apps-panel-catalog'] })!;
    client.setQueryData(cachedCatalog.queryKey, cachedCatalog.state.data, { updatedAt: Date.now() - 61_000 });
    const beforeExpiryRefresh = counts.catalog;
    await show(true); await settle();
    assert.equal(counts.catalog, beforeExpiryRefresh + 1, 'an expired catalog refreshes on return');

    catalogFails = true;
    await act(async () => state.retryProjection()); await settle();
    assert.equal(loaded().catalogStatus, 'unavailable');
    assert.equal(loaded().entries.length, 0, 'a failed refresh does not keep remote install targets active');
    await show(false);
    let releaseCatalog!: () => void;
    catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
    await show(true); await settle();
    assert.equal(loaded().catalogStatus, 'unavailable', 'remount preserves the failed catalog while a retry is pending');
    assert.equal(loaded().entries.length, 0, 'last successful targets cannot return after a failed refresh');
    releaseCatalog(); await settle();
    assert.equal(loaded().catalogStatus, 'unavailable');
    catalogFails = false;
    await act(async () => state.retryProjection()); await settle();
    assert.equal(loaded().catalogStatus, 'loaded');
    assert.equal(loaded().entries.length, 1, 'a successful retry restores the catalog');

    await show(false); present = true; aiEligible = true;
    let rejectOldAI!: (error: Error) => void;
    aiRead = () => new Promise((_resolve, reject) => { rejectOldAI = reject; });
    await show(true); await settle();
    const beforeMutation = aiReadSignals.length;
    assert.equal(beforeMutation, 1);
    const localEntryKey = loaded().entries.find(entry => entry.localDevelopment)!.identity.entryKey;
    aiRead = async () => emptyAIConfig;
    await act(async () => state.acknowledgeAIConfigMutation(localEntryKey, { outcome: 'committed', config: { capabilities: [] }, revision: '2' }));
    await settle();
    assert.equal(aiReadSignals.length, beforeMutation + 1, 'saving configuration supersedes the pending read');
    assert.equal(aiReadSignals[0]?.aborted, true);
    rejectOldAI(Error('Late pre-save read failure')); await settle();
    assert.equal(loaded().entries.find(entry => entry.localDevelopment)?.aiConfigSummary?.healthPosture, 'healthy');

    aiRead = () => new Promise((_resolve, reject) => { rejectOldAI = reject; });
    await act(async () => state.retryProjection()); await settle();
    const pendingRetry = aiReadSignals.at(-1)!;
    aiRead = async () => emptyAIConfig;
    await act(async () => state.retryProjection()); await settle();
    assert.equal(pendingRetry.aborted, true, 'explicit retry supersedes the previous read instead of reusing it');
    rejectOldAI(Error('Late pre-retry read failure')); await settle();
    assert.equal(loaded().entries.find(entry => entry.localDevelopment)?.aiConfigSummary?.healthPosture, 'healthy');

    await show(false); client.clear();
    inventoryGate = new Promise(() => {});
    paints.length = 0;
    await show(true);
    assert.equal(paints[0], null, 'session cache clearing prevents reuse in the next session');
  } finally {
    await act(async () => root.unmount());
    client.clear(); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
