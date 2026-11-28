import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) {
      return { format: 'module', shortCircuit: true, source: 'export default {};' };
    }
    if (/\.(png|svg|webp|jpg|jpeg)$/i.test(url)) {
      return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(url)};` };
    }
    if (/\/features\/apps\/apps-panel(?:\.tsx|\.ts|\.js)?$/u.test(url)) {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'import React from "react"; export function AppsPanel() { return React.createElement("div", { "data-testid": "stub-apps-panel" }, "Apps"); }',
      };
    }
    if (/\/features\/runtime-config\/runtime-config-panel-view(?:\.tsx|\.ts|\.js)?$/u.test(url)) {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'import React from "react"; export function RuntimeConfigPanelBody() { return React.createElement("div", { "data-testid": "stub-runtime-panel" }, "Runtime"); }',
      };
    }
    return nextLoad(url, context);
  },
});

function installDomGlobals() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === 'number' ? (y ?? 0) : (options?.top ?? 0);
    this.scrollLeft = typeof options === 'number' ? options : (options?.left ?? 0);
  };
  dom.window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  })) as unknown as typeof dom.window.matchMedia;

  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLFormElement: dom.window.HTMLFormElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event,
    getComputedStyle: dom.window.getComputedStyle,
    ResizeObserver: ObserverStub,
    IntersectionObserver: ObserverStub,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const name of Object.getOwnPropertyNames(dom.window)) {
    if (/^(?:HTML|SVG)\w*Element$|Event$/u.test(name) && !(name in globals)) {
      globals[name] = (dom.window as unknown as Record<string, unknown>)[name];
    }
  }
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return {
    dom,
    cleanup() {
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
      }
    },
  };
}

test('OBS-004(a): Messages Drawer uses opaque Light and Dark surface tokens while preserving OBS-004(b) notice suppression', async () => {
  const [foundationCss, drawerSource, columnSource] = await Promise.all([
    readFile(new URL('../src/shell/renderer/foundation.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/shell/renderer/features/home/home-messages-drawer.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/shell/renderer/features/home/home-messages-column.tsx', import.meta.url), 'utf8'),
  ]);

  const lightStart = foundationCss.indexOf(':root[data-nimi-scheme="light"],');
  const darkStart = foundationCss.indexOf('.dark, :root[data-nimi-scheme="dark"], [data-nimi-scheme="dark"]');
  const mediaStart = foundationCss.indexOf('@media (prefers-reduced-transparency: reduce)');
  assert.ok(lightStart >= 0 && darkStart > lightStart && mediaStart > darkStart, 'foundation.css has light and dark token blocks');

  const lightBlock = foundationCss.slice(lightStart, darkStart);
  const darkBlock = foundationCss.slice(darkStart, mediaStart);

  assert.match(lightBlock, /--nimi-home-drawer-bg:\s*var\(--nimi-surface-card(?:\s*,\s*#[0-9a-fA-F]{6})?\);/u);
  assert.match(darkBlock, /--nimi-home-drawer-bg:\s*var\(--nimi-surface-card(?:\s*,\s*#[0-9a-fA-F]{6})?\);/u);
  assert.doesNotMatch(foundationCss, /--nimi-home-drawer-bg:\s*rgba\(/u, 'drawer background must not be translucent rgba');
  assert.doesNotMatch(foundationCss, /--nimi-home-drawer-bg:\s*var\(--nimi-surface-overlay\)/u, 'drawer background must not use translucent overlay token');

  assert.match(drawerSource, /bg-\[var\(--nimi-home-drawer-bg\)\]/u);
  assert.match(columnSource, /group-has-\[\.home-message-notices:not\(:empty\)\]\/messages:hidden/u, 'OBS-004(b) notice suppression remains intact');
});

test('OBS-008(a): AI Capabilities sidebar adds bottom scroll clearance and fade above the sticky footer without altering OBS-008(b)', async () => {
  const { dom, cleanup } = installDomGlobals();
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { initI18n, changeLocale, productionDesktopI18n } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { homeRuntimeDestination } = await import('../src/shell/renderer/app-shell/providers/home-navigation.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { AiSettingsPage } = await import('../src/shell/renderer/features/runtime-config/runtime-config-page-ai-settings.js');

  await initI18n();
  await changeLocale('en');

  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  store.navigation.reset(homeRuntimeDestination('aiSettings'));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  const sdk = {
    appId: () => 'nimi.chat',
    machineProduct: () => ({
      local: {
        loadouts: {
          get: async () => ({ loadouts: [], selections: [], selectionRevisions: {} }),
          listRecipes: async () => [
            {
              recipeId: 'r-text',
              revision: '1',
              title: 'Gemma 4',
              capabilityContract: 'text.generate',
              implementation: { implementationId: 'impl', driverId: 'd', driverDialect: 'x' },
              defaultOptions: {},
              implementationSupportedFeatures: [],
              applicability: 'supported',
              reasons: [],
              slots: [],
            },
            {
              recipeId: 'r-audio',
              revision: '1',
              title: 'Separator',
              capabilityContract: 'audio.separate',
              implementation: { implementationId: 'impl', driverId: 'd', driverDialect: 'x' },
              defaultOptions: {},
              implementationSupportedFeatures: [],
              applicability: 'supported',
              reasons: [],
              slots: [],
            },
          ],
        },
      },
      apps: { listApprovedAppCatalogTargets: async () => ({ reasonCode: 'ACTION_EXECUTED', targets: [] }) },
    }),
    localEnvironmentRpc: () => ({
      listModelAssets: async () => ({ assets: [], nextPageToken: '' }),
      listVerifiedAssets: async () => ({ assets: [], nextPageToken: '' }),
      listLocalEnvironmentDependencyJobs: async () => ({ jobs: [] }),
      collectDeviceProfile: async () => ({
        profile: {
          os: 'darwin',
          arch: 'arm64',
          totalRamBytes: '0',
          availableRamBytes: '0',
          diskFreeBytes: '0',
          ports: [],
          gpu: { available: false, vendor: '', model: '', totalVramBytes: '0', availableVramBytes: '0', memoryModel: 0 },
          python: { available: false, version: '' },
          npu: { available: false, ready: false, vendor: '', runtime: '', detail: '' },
        },
      }),
    }),
    accountProduct: () => ({ profiles: { list: async () => [] } }),
    accountRuntime: () => ({ auth: {} }),
    withRuntimeProtectedScopes: async (_scopes: string[], fn: (options: Record<string, never>) => Promise<unknown>) => fn({}),
  };
  const bindings = { app: { commands: {} }, sdk };
  const root = createRoot(dom.window.document.getElementById('root')!);
  const noop = () => undefined;

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AppStoreProvider store={store}>
            <DesktopRendererBindingProvider bindings={bindings as never}>
              <DesktopI18nResourceProvider resource={productionDesktopI18n}>
                <DesktopMotionProvider>
                  <TooltipProvider>
                    <AiSettingsPage
                      runtimeWritesDisabled={false}
                      focusedTaskId={null}
                      actionFocus={null}
                      savedConfigsContext={null}
                      profileUseOwner={null}
                      onOpenSetupTask={noop}
                      onCloseSetupTask={noop}
                      onOpenModelFiles={noop}
                      onOpenSavedConfigs={noop}
                      onOpenModelMarket={noop}
                      onOpenAdvancedDiagnostics={noop}
                      onOpenCloudServices={noop}
                      onClearActionFocus={noop}
                      onCloseProfileUseOwner={noop}
                      onCloseSavedConfigs={noop}
                    />
                  </TooltipProvider>
                </DesktopMotionProvider>
              </DesktopI18nResourceProvider>
            </DesktopRendererBindingProvider>
          </AppStoreProvider>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 35));
    });

    const homeHeaderButton = dom.window.document.querySelector('[data-testid="ai-capabilities-home"]');
    assert.ok(homeHeaderButton, 'AI Capabilities sidebar header rendered');
    const scrollRoot = homeHeaderButton.nextElementSibling as HTMLElement | null;
    const footer = dom.window.document.querySelector('.desktop-sidebar__footer');
    assert.ok(scrollRoot && footer, 'Sidebar ScrollArea and sticky footer rendered');
    assert.equal(scrollRoot.nextElementSibling, footer, 'ScrollArea sits directly above the sticky footer');
    assert.ok(scrollRoot.classList.contains('pb-3'), 'ScrollArea reserves bottom clearance padding above the sticky footer');

    const viewport = scrollRoot.querySelector('[data-fade-edges="bottom"]');
    assert.ok(viewport, 'ScrollArea viewport applies bottom fade mask so scrolled items do not slice against the divider');
    const groups = scrollRoot.querySelector('.desktop-sidebar__groups');
    assert.ok(groups?.classList.contains('pb-3'), 'Inner sidebar group stack adds extra bottom scroll clearance');

    // OBS-008(b) preserved: unset capabilities with no downloaded files keep accessible text only (no visible hollow ring).
    const textRow = dom.window.document.querySelector('[data-testid="ai-capability:text.generate"]');
    assert.ok(textRow, 'text.generate row rendered');
    assert.equal(textRow.querySelector('[data-rail-state="unset"]'), null, 'OBS-008(b): unset row without downloaded files omits hollow ring');
    assert.ok(textRow.querySelector('.sr-only'), 'OBS-008(b): unset row retains accessible screen-reader status');
  } finally {
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    queryClient.clear();
    store.navigation.dispose();
    cleanup();
  }
});

test('OBS-009: PartnerDirectory deduplicates Discover characters in worlds CTA when empty state is rendered', async () => {
  const { dom, cleanup } = installDomGlobals();
  const { createRoot } = await import('react-dom/client');
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { initI18n, changeLocale, productionDesktopI18n } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { SystemEntryProviderContext } = await import('../src/shell/renderer/features/system-entry/system-entry-context.js');
  const { PartnerDirectory } = await import('../src/shell/renderer/features/agents/partner-directory.js');

  await initI18n();
  await changeLocale('en');

  const accountId = 'account-halliday';
  let agents: Array<Record<string, unknown>> = [];
  let shouldFail = false;

  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => {} });
  store.setState({
    auth: {
      status: 'authenticated',
      sequence: '1',
      reasonCode: 0,
      accountReasonCode: 0,
      authorizationRevision: 'rev-1',
      user: { id: accountId },
    },
  });
  await store.navigation.replace({ id: 'contacts', contactView: 'partners' });

  const sdk = {
    accountProduct: () => ({
      agents: {
        listAgents: async () => {
          if (shouldFail) throw new Error('Directory temporarily unavailable');
          return { agents, nextPageToken: '' };
        },
      },
    }),
    withRuntimeProtectedScopes: async (_scopes: string[], fn: (options: Record<string, never>) => Promise<unknown>) => fn({}),
  };
  const bindings = { sdk, app: { commands: {} } };
  const emptyActivity = { status: 'ready' as const, records: [], hasMore: false, loadingMore: false, errorMessage: null };
  const systemEntry = {
    hostContext: null,
    homeVisible: true,
    projection: null,
    appActivity: {
      pending: emptyActivity,
      recent: emptyActivity,
      busy: {},
      notices: {},
      open: () => {},
      markRead: () => {},
      retry: () => {},
      loadMore: () => {},
    },
    recentPartners: [],
    ai: null,
    refresh: async () => {},
    openAIActivity: async () => {},
  };

  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  const discoverButtons = () => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')]
    .filter((button) => button.textContent?.trim() === 'Discover characters in worlds');

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AppStoreProvider store={store}>
            <DesktopRendererBindingProvider bindings={bindings as never}>
              <DesktopI18nResourceProvider resource={productionDesktopI18n}>
                <DesktopMotionProvider>
                  <TooltipProvider>
                    <SystemEntryProviderContext.Provider value={systemEntry}>
                      <PartnerDirectory />
                    </SystemEntryProviderContext.Provider>
                  </TooltipProvider>
                </DesktopMotionProvider>
              </DesktopI18nResourceProvider>
            </DesktopRendererBindingProvider>
          </AppStoreProvider>
        </QueryClientProvider>,
      );
    });
    await settle();

    // 1. Empty state renders Discover characters in worlds exactly once (inside the EmptyState card only).
    const emptyButtons = discoverButtons();
    assert.equal(emptyButtons.length, 1, 'empty Partners view renders Discover characters in worlds exactly once');
    assert.ok(emptyButtons[0]?.closest('.nimi-empty-state'), 'the single Discover CTA lives inside the empty-state card');
    await act(async () => { emptyButtons[0]?.click(); });
    assert.equal(store.navigation.getSnapshot().current.destination.id, 'explore');
    assert.equal(store.navigation.getSnapshot().current.destination.exploreSection, 'worlds');
    assert.equal(store.navigation.getSnapshot().current.destination.exploreSearchKind, 'characters');

    // 2. Populated partners list restores the top header Discover shortcut (still rendered once).
    await act(async () => { await store.navigation.replace({ id: 'contacts', contactView: 'partners' }); });
    agents = [{
      localAgentRef: 'local-agent:11111111-1111-4111-8111-111111111111',
      ownerUserId: accountId,
      runtimeSourceRef: 'source-laurent',
      displayName: 'Laurent',
      lifecycleStatus: AgentLifecycleStatus.ACTIVE,
    }];
    await act(async () => { await client.invalidateQueries(); });
    await settle();

    const populatedButtons = discoverButtons();
    assert.equal(populatedButtons.length, 1, 'populated Partners list renders header Discover CTA once');
    assert.equal(populatedButtons[0]?.closest('.nimi-empty-state'), null, 'populated Partners CTA lives in the list header');

    // 3. Error state hides EmptyState and keeps header Discover CTA available once.
    agents = [];
    shouldFail = true;
    await act(async () => { await client.invalidateQueries(); });
    await settle();

    const errorButtons = discoverButtons();
    assert.equal(errorButtons.length, 1, 'error state retains header Discover CTA once');
    assert.equal(errorButtons[0]?.closest('.nimi-empty-state'), null);
  } finally {
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    client.clear();
    store.navigation.dispose();
    cleanup();
  }
});

test('OBS-010: DESKTOP_PANEL_VARIANTS and MainLayoutPanelStack stack active keep-alive runtime above exiting panels without ghosting', async () => {
  const { DESKTOP_PANEL_VARIANTS } = await import('../src/shell/renderer/ui/motion/desktop-motion.js');
  const exitVariant = DESKTOP_PANEL_VARIANTS.exit as (reduced: boolean) => Record<string, unknown>;
  for (const reduced of [false, true]) {
    const target = exitVariant(reduced);
    assert.equal(target.position, 'absolute');
    assert.equal(target.inset, 0);
    assert.equal(target.zIndex, 0);
    assert.equal(target.pointerEvents, 'none');
    const transition = target.transition as Record<string, unknown>;
    assert.deepEqual(transition.zIndex, { duration: 0 }, 'exiting panel drops zIndex immediately without interpolating over active panel');
  }

  const { dom, cleanup } = installDomGlobals();
  const { createRoot } = await import('react-dom/client');
  const { DesktopMotionProvider } = await import('../src/shell/renderer/ui/motion/desktop-motion-context.js');
  const { MainLayoutPanelStack } = await import('../src/shell/renderer/app-shell/layouts/main-layout-panel-stack.js');

  const root = createRoot(dom.window.document.getElementById('root')!);
  const noop = () => undefined;
  const renderStack = (activeTab: 'apps' | 'runtime', runtimeActive: boolean) => (
    <DesktopMotionProvider>
      <MainLayoutPanelStack
        activeTab={activeTab}
        exploreActiveSection="worlds"
        exploreSearchText=""
        runtimeActive={runtimeActive}
        runtimeEverMounted
        onExploreSectionChange={noop}
        onExploreSearchTextChange={noop}
      />
    </DesktopMotionProvider>
  );

  try {
    // 1. Mount with Apps active and keep-alive runtime already mounted in the background.
    await act(async () => {
      root.render(renderStack('apps', false));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const runtimePanel = dom.window.document.querySelector<HTMLElement>('[data-testid="panel:runtime"]');
    const appsPanel = dom.window.document.querySelector<HTMLElement>('[data-testid="panel:apps"]');
    assert.ok(runtimePanel && appsPanel, 'both keep-alive runtime and active apps panels exist');
    assert.ok(runtimePanel.classList.contains('hidden'), 'inactive keep-alive runtime stays hidden');
    assert.equal(runtimePanel.classList.contains('z-10'), false);
    assert.equal(appsPanel.classList.contains('pointer-events-none'), false, 'active Apps panel remains interactive');

    // 2. Switch Apps -> AI Capabilities: keep-alive runtime reuses the same DOM node stacked at z-10 with opaque theme surface token above exiting Apps.
    await act(async () => {
      root.render(renderStack('runtime', true));
    });

    const activeRuntimePanel = dom.window.document.querySelector<HTMLElement>('[data-testid="panel:runtime"]');
    assert.equal(activeRuntimePanel, runtimePanel, 'keep-alive runtime preserves its mounted DOM node for instant revisits');
    assert.ok(activeRuntimePanel.classList.contains('flex'));
    assert.ok(activeRuntimePanel.classList.contains('relative'));
    assert.ok(activeRuntimePanel.classList.contains('z-10'));
    assert.ok(activeRuntimePanel.classList.contains('bg-[var(--nimi-surface-canvas)]'), 'uses theme-aware opaque canvas token for Light and Dark modes');
    assert.equal(activeRuntimePanel.classList.contains('hidden'), false);

    const exitingAppsPanel = dom.window.document.querySelector<HTMLElement>('[data-testid="panel:apps"]');
    assert.ok(exitingAppsPanel, 'Apps panel is in AnimatePresence exit phase immediately after tab switch');
    assert.ok(exitingAppsPanel.classList.contains('z-0'), 'exiting panel immediately drops to z-0 beneath panel:runtime');
    assert.ok(exitingAppsPanel.classList.contains('pointer-events-none'), 'exiting panel disables pointer events immediately');

    // 3. Switch back AI Capabilities -> Apps: runtime returns to hidden keep-alive state without unmounting.
    await act(async () => {
      root.render(renderStack('apps', false));
    });
    assert.equal(dom.window.document.querySelector('[data-testid="panel:runtime"]'), runtimePanel);
    assert.ok(runtimePanel.classList.contains('hidden'));
    assert.equal(runtimePanel.classList.contains('z-10'), false);
  } finally {
    await act(async () => {
      root.unmount();
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    cleanup();
  }
});
