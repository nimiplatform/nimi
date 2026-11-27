import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { TooltipProvider } from '@nimiplatform/kit/ui';

(globalThis as { React?: typeof React }).React = React;

import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';
import { changeLocale, initI18n } from '../src/shell/renderer/i18n/index.js';
import {
  actionPlanForEntry,
  canRequestCatalogInstall,
  canRequestCatalogUpdate,
  hasAvailableCatalogUpdate,
} from '../src/shell/renderer/features/apps/apps-card-actions.js';
import {
  AppsPresentationCache,
  type AppsPresentationStorage,
} from '../src/shell/renderer/features/apps/apps-presentation-cache.js';
import {
  createAppsPanelProjectionReloader,
  useAppsPanelController,
  type AppsPanelController,
  type AppsPanelControllerDeps,
} from '../src/shell/renderer/features/apps/apps-panel-controller.js';
import {
  projectAppsPanel,
  type DesktopAppsCatalogReadOptions,
  type DesktopAppsEntry,
  type DesktopAppsPanelProjection,
  type DesktopAppsProjectionSource,
} from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import {
  AppsPanelView,
  type AppsPanelViewProps,
} from '../src/shell/renderer/features/apps/apps-panel-view.js';
import {
  AppPackageSourceClass,
  type AppPackageInfo,
  type ApprovedAppCatalogTarget,
  type CommittedAppRelease,
} from '@nimiplatform/sdk/runtime/wire-types';

function makeCatalogTarget(overrides: Partial<ApprovedAppCatalogTarget> = {}): ApprovedAppCatalogTarget {
  return {
    appId: 'publisher.offline-catalog',
    displayName: 'Offline Catalog App',
    version: '2.0.0',
    approvedTargetSelector: new Uint8Array([1, 2, 3]),
    appAccess: ['runtime.consume'],
    capabilityContractRefs: ['text.generate'],
    requiredStandardizedFeatureRefs: [],
    osStorageDisclosures: [],
    observedRegistryRevision: 'a'.repeat(40),
    descriptorId: 'publisher.offline-catalog@2.0.0',
    publisherGithubNamespace: 'publisher',
    sourceRepository: 'https://github.com/publisher/offline-catalog',
    sourceLicenseSpdxExpression: 'MIT',
    storagePolicyKind: 'nimi-mediated-default',
    targetId: 'windows-x86_64',
    os: 'windows',
    arch: 'x86_64',
    assetName: 'offline-catalog.nimiapp',
    assetSize: '4096',
    executionProfileRef: 'windows-user-mode-as-invoker-v1',
    windowsCodeSigning: 'unsigned',
    macosNotarization: 'not-applicable',
    policyBlocked: false,
    policyRevision: '0',
    ...overrides,
  };
}

function makeCommittedRelease(overrides: Partial<CommittedAppRelease> = {}): CommittedAppRelease {
  return {
    appId: 'publisher.offline-catalog',
    displayName: 'Offline Catalog App',
    sourceClass: AppPackageSourceClass.VERIFIED,
    version: '1.0.0',
    releaseRef: 'nats_v1_installed_release',
    launchSelector: new Uint8Array([9, 8, 7]),
    executionProfileRef: 'windows-user-mode-as-invoker-v1',
    appAccess: ['runtime.consume'],
    committedAt: { seconds: '1795651200', nanos: 0 },
    ...overrides,
  };
}

function makeAppInfo(appId = 'publisher.offline-catalog', version = '2.0.0'): AppPackageInfo {
  return {
    appId,
    version,
    targetId: 'windows-x86_64',
    displayName: 'Offline Catalog App',
    summary: 'Persisted storefront summary for offline browsing.',
    iconPngBase64: 'cGVyc2lzdGVkLWljb24=',
    readmeMarkdown: '# Offline Catalog App',
    releaseNotesMarkdown: 'Release notes',
    licenseIdentifier: 'MIT',
    licenseText: 'MIT',
    author: 'publisher',
    homepageUrl: 'https://example.com',
    supportUrl: 'https://example.com/support',
    appAccess: ['runtime.consume'],
    capabilityContractRefs: ['text.generate'],
    requiredStandardizedFeatureRefs: [],
    storagePolicyKind: 'nimi-mediated-default',
    osStorageDisclosure: [],
  };
}

test('stale catalog display records never grant install or update authority while preserving installed launch', () => {
  const staleTarget = makeCatalogTarget({ approvedTargetSelector: new Uint8Array(0) });
  const catalogOnlyEntry = {
    catalogTarget: staleTarget,
    catalogStale: true,
    committedRelease: null,
    localDevelopment: null,
    packageJob: null,
    run: null,
  };
  assert.equal(canRequestCatalogInstall(catalogOnlyEntry), false);
  assert.equal(hasAvailableCatalogUpdate(catalogOnlyEntry), false);
  assert.equal(canRequestCatalogUpdate(catalogOnlyEntry), false);

  const installedWithStaleUpdate = {
    catalogTarget: staleTarget,
    catalogStale: true,
    committedRelease: makeCommittedRelease({ version: '1.0.0' }),
    localDevelopment: null,
    packageJob: null,
    run: null,
  };
  assert.equal(hasAvailableCatalogUpdate(installedWithStaleUpdate), false);
  assert.equal(canRequestCatalogUpdate(installedWithStaleUpdate), false);
  assert.equal(actionPlanForEntry(installedWithStaleUpdate).primary?.id, 'launch');

  const installedWithKnownKillSwitch = {
    ...installedWithStaleUpdate,
    catalogTarget: makeCatalogTarget({ approvedTargetSelector: new Uint8Array(0), policyBlocked: true }),
  };
  assert.equal(actionPlanForEntry(installedWithKnownKillSwitch).primary, null);
});

test('stale catalog browse projection surfaces updatedAtUnixMs and reuses persisted display metadata without remote fetches', async () => {
  const rows = new Map<string, { key: string; value: unknown; savedAt: number }>();
  const storage: AppsPresentationStorage = {
    read: async (key) => rows.get(key),
    write: async (row) => { rows.set(row.key, row); },
  };
  const updatedAtUnixMs = Date.UTC(2026, 10, 27, 4, 30, 0);
  let infoReads = 0;

  const onlineCache = new AppsPresentationCache({ scope: 'test', storage });
  const onlineTarget = makeCatalogTarget();
  const onlineProjection = await projectAppsPanel({
    presentationCache: onlineCache,
    listCommittedReleases: async () => [],
    listPackageJobs: async () => [],
    listRegistrations: async () => [],
    listRuns: async () => [],
    readPackageInfo: async () => {
      infoReads += 1;
      return makeAppInfo();
    },
  }, {
    catalog: { status: 'loaded', targets: [onlineTarget], updatedAtUnixMs },
  });
  assert.equal(onlineProjection.status, 'loaded');
  assert.equal(infoReads, 1);
  assert.equal(rows.size, 1);

  // Fresh cache instance backed by the same persisted storage (simulating restart + offline).
  const offlineCache = new AppsPresentationCache({ scope: 'test', storage });
  const staleTarget = makeCatalogTarget({ approvedTargetSelector: new Uint8Array(0) });
  let latest: DesktopAppsPanelProjection | null = null;
  const source: DesktopAppsProjectionSource = {
    presentationCache: offlineCache,
    listApprovedCatalogTargets: async () => ({
      targets: [staleTarget],
      stale: true,
      updatedAtUnixMs,
    }),
    listCommittedReleases: async () => [],
    listPackageJobs: async () => [],
    listRegistrations: async () => [],
    listRuns: async () => [],
    readPackageInfo: async () => {
      infoReads += 1;
      throw new Error('stale browse must not request remote package info');
    },
  };
  const reloader = createAppsPanelProjectionReloader({
    source,
    getCurrent: () => latest,
    commit: (next) => { latest = next; },
  });
  await reloader.refreshCatalog();
  await new Promise((resolve) => setTimeout(resolve, 20));
  reloader.dispose();

  assert.ok(latest && latest.status === 'loaded');
  assert.equal(latest.catalogStatus, 'stale');
  assert.equal(latest.catalogUpdatedAtUnixMs, updatedAtUnixMs);
  assert.equal(latest.entries.length, 1);
  const entry = latest.entries[0]!;
  assert.equal(entry.catalogStale, true);
  assert.equal(entry.catalogTarget?.approvedTargetSelector.length, 0);
  assert.equal(canRequestCatalogInstall(entry), false);
  assert.equal(entry.summary, 'Persisted storefront summary for offline browsing.');
  assert.equal(entry.iconUrl, 'data:image/png;base64,cGVyc2lzdGVkLWljb24=');
  assert.equal(infoReads, 1, 'stale catalog entry must not call readPackageInfo');
});

test('AppsPanelView renders stale catalog banner with updated_at timestamp and hides install action in en and zh', async () => {
  await initI18n();
  const updatedAtUnixMs = Date.UTC(2026, 10, 27, 4, 30, 0);
  const staleTarget = makeCatalogTarget({ approvedTargetSelector: new Uint8Array(0) });
  const staleEntry: DesktopAppsEntry = {
    identity: {
      entryKey: 'verified:publisher.offline-catalog',
      appId: staleTarget.appId,
      sourceClass: 'verified',
      displayName: staleTarget.displayName,
      updatedAtUnixMs: 0,
    },
    catalogTarget: staleTarget,
    catalogStale: true,
    localDevelopment: null,
    committedRelease: null,
    packageJob: null,
    run: null,
    aiConfigSummary: null,
    iconUrl: null,
    summary: 'Persisted storefront summary for offline browsing.',
  };
  const baseProps: AppsPanelViewProps = {
    projection: {
      status: 'loaded',
      entries: [staleEntry],
      catalogStatus: 'stale',
      catalogUpdatedAtUnixMs: updatedAtUnixMs,
      runtimeError: null,
    },
    searchQuery: '',
    onSearchChange: () => undefined,
    selectedEntryKey: null,
    requestedDetailSection: null,
    navigationEntryKey: 'nav-1',
    onCardAction: () => undefined,
    onBack: () => undefined,
    onOpenDeveloperMode: () => undefined,
    onImportLocal: () => undefined,
    onRetry: () => undefined,
    onAIConfigChanged: () => undefined,
    actionError: null,
    pendingActions: [],
    installConfirmation: null,
    onConfirmInstall: () => undefined,
    onCancelInstall: () => undefined,
  };
  const store = createAppStore({
    initialChatThinkingPreference: 'off',
    persistChatThinkingPreference: () => undefined,
  });

  for (const locale of ['en', 'zh'] as const) {
    await changeLocale(locale);
    const expectedTime = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(updatedAtUnixMs));

    const homeHtml = renderToStaticMarkup(
      <AppStoreProvider store={store}>
        <TooltipProvider>
          <AppsPanelView {...baseProps} />
        </TooltipProvider>
      </AppStoreProvider>,
    );
    assert.match(homeHtml, /data-testid="apps-catalog-stale"/);
    assert.match(homeHtml, /data-testid="apps-catalog-stale-retry"/);
    assert.doesNotMatch(homeHtml, /data-refreshing="true"/);
    assert.ok(homeHtml.includes(expectedTime), `expected formatted timestamp ${expectedTime} in ${locale} home view`);
    assert.ok(homeHtml.includes('Offline Catalog App'), 'stale app list must still be rendered');
    if (locale === 'en') {
      assert.ok(homeHtml.includes('Installing or updating apps requires reconnecting to the Registry.'));
      assert.ok(!homeHtml.includes('Checking for updates'));
    } else {
      assert.ok(homeHtml.includes('安装或更新应用需要重新连接官方目录。'));
      assert.ok(!homeHtml.includes('正在检查更新'));
    }

    const detailHtml = renderToStaticMarkup(
      <AppStoreProvider store={store}>
        <TooltipProvider>
          <AppsPanelView {...baseProps} selectedEntryKey={staleEntry.identity.entryKey} />
        </TooltipProvider>
      </AppStoreProvider>,
    );
    assert.match(detailHtml, /data-testid="apps-detail-catalog-stale"/);
    assert.doesNotMatch(detailHtml, /data-testid="apps-detail-install"/);
    assert.doesNotMatch(detailHtml, /data-refreshing="true"/);
    if (locale === 'en') {
      assert.ok(detailHtml.includes('Installing or updating apps requires reconnecting to the Registry.'));
      assert.ok(!detailHtml.includes('Checking for updates'));
    } else {
      assert.ok(detailHtml.includes('安装或更新应用需要重新连接官方目录。'));
      assert.ok(!detailHtml.includes('正在检查更新'));
    }

    // While background refresh is actively in progress, show checking-for-updates copy
    // (info + spinner) instead of warning reconnect copy in both store and detail views.
    const refreshingProps: AppsPanelViewProps = {
      ...baseProps,
      projection: {
        ...baseProps.projection!,
        status: 'loaded',
        entries: [staleEntry],
        catalogStatus: 'stale',
        catalogUpdatedAtUnixMs: updatedAtUnixMs,
        catalogRefreshInProgress: true,
        runtimeError: null,
      },
    };
    const refreshingHomeHtml = renderToStaticMarkup(
      <AppStoreProvider store={store}>
        <TooltipProvider>
          <AppsPanelView {...refreshingProps} />
        </TooltipProvider>
      </AppStoreProvider>,
    );
    assert.match(refreshingHomeHtml, /data-testid="apps-catalog-stale"/);
    assert.match(refreshingHomeHtml, /data-refreshing="true"/);
    assert.doesNotMatch(refreshingHomeHtml, /data-testid="apps-catalog-stale-retry"/);
    assert.ok(refreshingHomeHtml.includes(expectedTime), `expected formatted timestamp ${expectedTime} in ${locale} refreshing home view`);
    assert.ok(refreshingHomeHtml.includes('Offline Catalog App'), 'cached app list stays visible while refreshing');
    if (locale === 'en') {
      assert.ok(refreshingHomeHtml.includes('Checking for updates'));
      assert.ok(!refreshingHomeHtml.includes('reconnecting to the Registry'));
    } else {
      assert.ok(refreshingHomeHtml.includes('正在检查更新'));
      assert.ok(!refreshingHomeHtml.includes('重新连接官方目录'));
    }

    const refreshingDetailHtml = renderToStaticMarkup(
      <AppStoreProvider store={store}>
        <TooltipProvider>
          <AppsPanelView {...refreshingProps} selectedEntryKey={staleEntry.identity.entryKey} />
        </TooltipProvider>
      </AppStoreProvider>,
    );
    assert.match(refreshingDetailHtml, /data-testid="apps-detail-catalog-stale"/);
    assert.match(refreshingDetailHtml, /data-refreshing="true"/);
    assert.doesNotMatch(refreshingDetailHtml, /data-testid="apps-detail-install"/);
    assert.ok(refreshingDetailHtml.includes(expectedTime), `expected formatted timestamp ${expectedTime} in ${locale} refreshing detail view`);
    if (locale === 'en') {
      assert.ok(refreshingDetailHtml.includes('Checking for updates'));
      assert.ok(!refreshingDetailHtml.includes('reconnecting to the Registry'));
    } else {
      assert.ok(refreshingDetailHtml.includes('正在检查更新'));
      assert.ok(!refreshingDetailHtml.includes('重新连接官方目录'));
    }
  }
  await changeLocale('en');
});

test('useAppsOverviewQuery treats stale catalog snapshot as updates unavailable while preserving stale flag', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, v] of Object.entries(globals)) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  }
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { useAppsOverviewQuery } = await import('../src/shell/renderer/features/apps/use-apps-overview.js');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const updatedAtUnixMs = Date.UTC(2026, 10, 27, 4, 30, 0);
  const liveUpdatedAtUnixMs = Date.UTC(2026, 10, 27, 5, 0, 0);
  const staleTarget = makeCatalogTarget({ approvedTargetSelector: new Uint8Array(0), version: '2.0.0' });
  const liveTarget = makeCatalogTarget({ approvedTargetSelector: new Uint8Array([7, 8, 9]), version: '2.0.0' });
  const installed = makeCommittedRelease({ version: '1.0.0' });

  let latestResult: ReturnType<typeof useAppsOverviewQuery> | null = null;
  let releaseOverviewAwait!: () => void;
  const overviewAwaitGate = new Promise<void>((resolve) => { releaseOverviewAwait = resolve; });
  const overviewCalls: (DesktopAppsCatalogReadOptions | undefined)[] = [];
  const source: DesktopAppsProjectionSource = {
    listRegistrations: async () => [],
    listRuns: async () => [],
    listCommittedReleases: async () => [installed],
    listPackageJobs: async () => [],
    listApprovedCatalogTargets: async (options?: DesktopAppsCatalogReadOptions) => {
      overviewCalls.push(options ? { ...options } : undefined);
      if (options?.forceRefresh) {
        return { targets: [liveTarget], stale: false, updatedAtUnixMs: liveUpdatedAtUnixMs, refreshInProgress: false };
      }
      if (options?.awaitRefresh) {
        await overviewAwaitGate;
        return { targets: [liveTarget], stale: false, updatedAtUnixMs: liveUpdatedAtUnixMs, refreshInProgress: false };
      }
      return {
        targets: [staleTarget],
        stale: true,
        updatedAtUnixMs,
        refreshInProgress: true,
      };
    },
  };
  function Harness() {
    latestResult = useAppsOverviewQuery(source);
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
    assert.ok(latestResult && latestResult.data?.status === 'loaded');
    assert.equal(latestResult.data.catalogStatus, 'stale');
    assert.equal(latestResult.data.catalogUpdatedAtUnixMs, updatedAtUnixMs);
    assert.equal(latestResult.data.catalogRefreshInProgress, true);
    assert.equal(latestResult.updatesStatus, 'unavailable');
    assert.equal(latestResult.data.entries[0]?.catalogStale, true);
    assert.equal(hasAvailableCatalogUpdate(latestResult.data.entries[0]!), false);
    assert.equal(overviewCalls.length, 2);
    assert.deepEqual(overviewCalls[1], { awaitRefresh: true });

    // Once background refresh resolves, overview transitions to live updates-ready state.
    releaseOverviewAwait();
    for (let i = 0; i < 6; i++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
    assert.equal(latestResult.data.catalogStatus, 'loaded');
    assert.equal(latestResult.data.catalogUpdatedAtUnixMs, liveUpdatedAtUnixMs);
    assert.equal(latestResult.updatesStatus, 'ready');
    assert.equal(latestResult.data.entries[0]?.catalogStale, false);
    assert.equal(hasAvailableCatalogUpdate(latestResult.data.entries[0]!), true);

    await act(async () => { await latestResult!.refreshUpdates(); });
    assert.deepEqual(overviewCalls.at(-1), { forceRefresh: true });
  } finally {
    await act(async () => { root.unmount(); });
    client.clear();
    dom.window.close();
    for (const [k, desc] of previous) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete (globalThis as Record<string, unknown>)[k];
    }
  }
});

test('cold-open mount renders persisted catalog before slow network resolves, singleflights refresh, and swaps in live installable targets', async () => {
  await initI18n();
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, v] of Object.entries(globals)) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  }
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const store = createAppStore({
    initialChatThinkingPreference: 'off',
    persistChatThinkingPreference: () => undefined,
  });

  const persistedUpdatedAtMs = Date.UTC(2026, 10, 27, 4, 30, 0);
  const liveUpdatedAtMs = Date.UTC(2026, 10, 27, 6, 45, 0);
  const staleV1Target = makeCatalogTarget({
    version: '1.5.0',
    descriptorId: 'publisher.offline-catalog@1.5.0',
    approvedTargetSelector: new Uint8Array(0),
  });
  const liveV2Target = makeCatalogTarget({
    version: '2.0.0',
    descriptorId: 'publisher.offline-catalog@2.0.0',
    approvedTargetSelector: new Uint8Array([4, 5, 6]),
  });

  const rpcCalls: (DesktopAppsCatalogReadOptions | undefined)[] = [];
  let liveFetchCount = 0;
  let releaseSlowFetch!: () => void;
  let activeFlight: Promise<void> | null = null;
  let offlineOnAwait = false;

  const deps: AppsPanelControllerDeps = {
    buildLiveBridge: () => ({
      listRegistrations: async () => [],
      listRuns: async () => [],
      readProjectIcon: async () => ({ iconDataUrl: null }),
      readProjectReadme: async () => ({ content: null, summary: null, truncated: false, fileName: null }),
      startRegistration: async () => { throw new Error('unexpected'); },
      stopRun: async () => undefined,
      removeRegistration: async () => undefined,
    }),
    listCommittedReleases: async () => [],
    listPackageJobs: async () => [],
    cancelPackageJob: async () => undefined,
    listApprovedCatalogTargets: async (options?: DesktopAppsCatalogReadOptions) => {
      rpcCalls.push(options ? { ...options } : undefined);
      if (options?.forceRefresh) {
        liveFetchCount += 1;
        return {
          targets: [liveV2Target],
          stale: false,
          updatedAtUnixMs: liveUpdatedAtMs,
          refreshInProgress: false,
        };
      }
      if (options?.awaitRefresh) {
        if (activeFlight) await activeFlight;
        if (offlineOnAwait) {
          return {
            targets: [staleV1Target],
            stale: true,
            updatedAtUnixMs: persistedUpdatedAtMs,
            refreshInProgress: false,
          };
        }
        return {
          targets: [liveV2Target],
          stale: false,
          updatedAtUnixMs: liveUpdatedAtMs,
          refreshInProgress: false,
        };
      }
      // Default cold-open cache-first call: return persisted display snapshot immediately
      // while ONE singleflight slow Registry fetch runs in the background.
      if (!activeFlight) {
        liveFetchCount += 1;
        activeFlight = new Promise<void>((resolve) => {
          releaseSlowFetch = resolve;
        });
      }
      return {
        targets: [staleV1Target],
        stale: true,
        updatedAtUnixMs: persistedUpdatedAtMs,
        refreshInProgress: true,
      };
    },
  };

  let controller!: AppsPanelController;
  function Harness() {
    controller = useAppsPanelController(deps);
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
  };
  try {
    await act(async () => {
      root.render(
        <AppStoreProvider store={store}>
          <QueryClientProvider client={client}>
            <Harness />
          </QueryClientProvider>
        </AppStoreProvider>,
      );
    });
    await settle();

    // BEFORE the slow network resolves: persisted catalog + updated_at MUST already be on screen,
    // with install authority disabled, and only ONE background Registry fetch running.
    assert.equal(liveFetchCount, 1, 'cold-open must start exactly one background Registry fetch');
    assert.equal(rpcCalls.length, 2, 'cold-open should send cache-first default call followed by one awaitRefresh call');
    assert.equal(rpcCalls[0]?.forceRefresh, undefined);
    assert.equal(rpcCalls[0]?.awaitRefresh, undefined);
    assert.deepEqual(rpcCalls[1], { awaitRefresh: true });
    assert.ok(controller.projection && controller.projection.status === 'loaded');
    assert.equal(controller.projection.catalogStatus, 'stale');
    assert.equal(controller.projection.catalogUpdatedAtUnixMs, persistedUpdatedAtMs);
    assert.equal(controller.projection.catalogRefreshInProgress, true);
    assert.equal(controller.projection.entries.length, 1);
    const staleEntry = controller.projection.entries[0]!;
    assert.equal(staleEntry.catalogTarget?.version, '1.5.0');
    assert.equal(staleEntry.catalogStale, true);
    assert.equal(staleEntry.catalogTarget?.approvedTargetSelector.length, 0);
    assert.equal(canRequestCatalogInstall(staleEntry), false);

    // Resolve slow network: live installable catalog replaces stale view with 0 extra Registry fetches.
    releaseSlowFetch();
    await settle();
    assert.equal(liveFetchCount, 1, 'awaitRefresh completion must not trigger a duplicate Registry fetch');
    assert.ok(controller.projection && controller.projection.status === 'loaded');
    assert.equal(controller.projection.catalogStatus, 'loaded');
    assert.equal(controller.projection.catalogUpdatedAtUnixMs, liveUpdatedAtMs);
    assert.equal(controller.projection.catalogRefreshInProgress ?? false, false);
    const liveEntry = controller.projection.entries[0]!;
    assert.equal(liveEntry.catalogTarget?.version, '2.0.0');
    assert.equal(liveEntry.catalogStale, false);
    assert.ok((liveEntry.catalogTarget?.approvedTargetSelector.length ?? 0) > 0);
    assert.equal(canRequestCatalogInstall(liveEntry), true);

    // Explicit Retry uses forceRefresh=true.
    await act(async () => { controller.retryProjection(); });
    await settle();
    assert.deepEqual(rpcCalls.at(-1), { forceRefresh: true });
    assert.equal(liveFetchCount, 2);

    // Offline cold-open: settles cleanly on stale banner with persisted targets and install disabled.
    await act(async () => { root.render(null); });
    client.clear();
    activeFlight = null;
    offlineOnAwait = true;
    await act(async () => {
      root.render(
        <AppStoreProvider store={store}>
          <QueryClientProvider client={client}>
            <Harness />
          </QueryClientProvider>
        </AppStoreProvider>,
      );
    });
    await settle();
    assert.ok(controller.projection && controller.projection.status === 'loaded');
    assert.equal(controller.projection.catalogStatus, 'stale');
    assert.equal(controller.projection.catalogRefreshInProgress, true);
    releaseSlowFetch();
    await settle();
    assert.ok(controller.projection && controller.projection.status === 'loaded');
    assert.equal(controller.projection.catalogStatus, 'stale');
    assert.equal(controller.projection.catalogRefreshInProgress ?? false, false);
    assert.equal(controller.projection.entries[0]?.catalogTarget?.version, '1.5.0');
    assert.equal(canRequestCatalogInstall(controller.projection.entries[0]!), false);
  } finally {
    await act(async () => { root.unmount(); });
    client.clear();
    dom.window.close();
    for (const [k, desc] of previous) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete (globalThis as Record<string, unknown>)[k];
    }
  }
});

test('createAppsPanelProjectionReloader starts awaitRefresh immediately while local lifecycle is slow and commits live installable v2', async () => {
  const persistedUpdatedAtMs = Date.UTC(2026, 10, 27, 4, 30, 0);
  const liveUpdatedAtMs = Date.UTC(2026, 10, 27, 6, 45, 0);
  const staleV1 = makeCatalogTarget({
    version: '1.0.0',
    descriptorId: 'publisher.offline-catalog@1.0.0',
    approvedTargetSelector: new Uint8Array(0),
  });
  const liveV2 = makeCatalogTarget({
    version: '2.0.0',
    descriptorId: 'publisher.offline-catalog@2.0.0',
    approvedTargetSelector: new Uint8Array([4, 5, 6]),
  });

  let releaseRegistrations!: () => void;
  let registrationsCalls = 0;
  const slowRegistrationsGate = new Promise<void>((resolve) => {
    releaseRegistrations = resolve;
  });

  let markAwaitStarted!: () => void;
  const awaitStarted = new Promise<void>((resolve) => {
    markAwaitStarted = resolve;
  });
  const catalogCalls: (DesktopAppsCatalogReadOptions | undefined)[] = [];

  let latest: DesktopAppsPanelProjection | null = null;
  const source: DesktopAppsProjectionSource = {
    listCommittedReleases: async () => [],
    listPackageJobs: async () => [],
    listRuns: async () => [],
    listRegistrations: async () => {
      registrationsCalls += 1;
      if (registrationsCalls === 1) {
        await slowRegistrationsGate;
      }
      return [];
    },
    listApprovedCatalogTargets: async (options?: DesktopAppsCatalogReadOptions) => {
      catalogCalls.push(options ? { ...options } : undefined);
      if (options?.awaitRefresh) {
        markAwaitStarted();
        return {
          targets: [liveV2],
          stale: false,
          updatedAtUnixMs: liveUpdatedAtMs,
          refreshInProgress: false,
        };
      }
      return {
        targets: [staleV1],
        stale: true,
        updatedAtUnixMs: persistedUpdatedAtMs,
        refreshInProgress: true,
      };
    },
  };

  const reloader = createAppsPanelProjectionReloader({
    source,
    getCurrent: () => latest,
    commit: (next) => { latest = next; },
  });

  try {
    const lifecycleTask = reloader.reload(false);
    const catalogTask = reloader.refreshCatalog();

    // Even while initial local lifecycle (listRegistrations) is still blocked,
    // awaitRefresh MUST start immediately once the cache-first response returns.
    await Promise.race([
      awaitStarted,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('awaitRefresh waited behind slow local lifecycle')), 500)),
    ]);
    assert.equal(catalogCalls.length, 2);
    assert.equal(catalogCalls[0], undefined);
    assert.deepEqual(catalogCalls[1], { awaitRefresh: true });

    // Unblock slow local lifecycle and let both reload and follow-up settle.
    releaseRegistrations();
    await Promise.all([lifecycleTask, catalogTask]);
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.ok(latest && latest.status === 'loaded');
    assert.equal(latest.catalogStatus, 'loaded');
    assert.equal(latest.catalogUpdatedAtUnixMs, liveUpdatedAtMs);
    assert.equal(latest.catalogRefreshInProgress ?? false, false);
    assert.equal(latest.entries.length, 1);
    const entry = latest.entries[0]!;
    assert.equal(entry.catalogTarget?.version, '2.0.0');
    assert.equal(entry.catalogStale, false);
    assert.ok((entry.catalogTarget?.approvedTargetSelector.length ?? 0) > 0);
    assert.equal(canRequestCatalogInstall(entry), true);
  } finally {
    reloader.dispose();
  }
});
