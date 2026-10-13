import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { AppStoreProvider, useHomeDestination } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { homeRuntimeDestination } from '../src/shell/renderer/app-shell/providers/home-navigation.js';
import runtimeConfigEn from '../src/shell/renderer/locales/en/46-runtimeConfig.json';
import { createDesktopI18n } from '../src/shell/renderer/i18n/desktop-i18n.js';
import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context.js';

// Renders the real AI Capabilities home against a fake SDK that records every
// Runtime call. The list must render, expand and refresh through reads only:
// no Loadout prepare / commit / select / delete and no environment apply.

const LOADOUT_WRITES = ['prepare', 'commit', 'select', 'delete'];

function wireAsset(id: string, contentId: string, entry: string) {
  return {
    modelAssetId: id, contentId, displayName: entry, entry,
    files: [{ relativePath: entry, sha256: 'x', sizeBytes: 10, nonExecutableContent: false }],
    totalSizeBytes: 10, contentVerified: true, catalogVerification: 0, unclassified: false,
    createdAt: '', updatedAt: '', latestIntegrityCheckedAt: '', duplicateContent: false, containsNonExecutableCode: false,
  };
}

function wirePlan(candidateLoadoutId: string, dependencyState: string) {
  return {
    planId: 'p', packId: '', productLabel: '', hostProfileId: '', platformTuple: '', runtimeDataRoot: '', consumerScope: '',
    cloudOnlyImpact: '', state: 'ready', reasonCode: '',
    dependencies: [dependencyState, 'ready_managed'].map((state, index) => ({ dependencyFamily: 'llama', dependencyId: index ? 'driver' : 'llama.cpp', consumerScope: '', required: true, state, sourceKind: '', confirmationRequired: false, environmentKey: 'k', selectedSourceRecordId: '', canonicalRoot: '', reasonCode: '', detail: '' })),
    requiredDependencyFamilies: [], aggregateSizeKnown: true, aggregateSizeBytes: 0, storageCategories: [], sourceOwners: [], noSystemMutation: true,
    candidateLoadoutId, candidateRevision: '',
  };
}

function loadout(loadoutId: string, displayName: string, modelAssetId = 'gemma-q4') {
  return {
    loadoutId, capabilityContract: 'text.generate', displayName, validationState: 'configured', recipeId: 'r-text', recipeRevision: '1',
    implementation: { implementationId: 'impl', driverId: 'd', driverDialect: 'x' }, options: {},
    modelAxes: [{ slotId: 'main.gguf', displayLabel: 'Model', modelAssetId, expectedContentId: 'c1', recipeCompatible: true, reasons: [] as string[], presence: 'required', conditionalFeatures: [], resolution: 'configured' }],
    recipeCustody: [], implementationSupportedFeatures: [], configuredFeatures: [], textBehaviors: [], reasons: [] as string[], provenance: {},
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: '1',
  };
}

const recipe = {
  recipeId: 'r-text', revision: '1', title: 'Gemma 4 text generation', capabilityContract: 'text.generate',
  implementation: { implementationId: 'impl', driverId: 'd', driverDialect: 'x' }, defaultOptions: {}, implementationSupportedFeatures: [],
  applicability: 'supported', reasons: [],
  slots: [{
    slotId: 'main.gguf', displayLabel: 'Model', recommendedContentIds: ['c1'], recommendedVariantIds: ['v1'], applicability: 'supported', reasons: [],
    modelContract: {}, presence: 'required', conditionalFeatures: [],
    offers: [{ candidate: { offerRef: 'o', title: 'Gemma', variantLabel: 'Q4', tags: [], categories: [], verified: true, installed: true, installable: false }, applicability: 'supported', reasons: [], installedModelAssetId: 'gemma-q4' }],
  }],
};

function createFakeSdk(incompleteExamples = false) {
  const calls: { loadoutWrites: string[]; rpc: string[]; environmentPlans: string[] } = { loadoutWrites: [], rpc: [], environmentPlans: [] };
  const failedChecks = new Set(['L-failing']);
  const dependencyStates = new Map([['L-custom', 'needs_confirmation']]);
  const imageLoadout = {
    ...loadout('L-image', 'Image setup', 'image-model'),
    capabilityContract: 'image.generate', recipeId: 'r-image',
    modelAxes: [
      { ...loadout('unused', '').modelAxes[0]!, modelAssetId: 'image-model', expectedContentId: 'c-image' },
      { ...loadout('unused', '').modelAxes[0]!, slotId: 'text_encoder', modelAssetId: 'encoder', expectedContentId: 'c-encoder' },
    ],
  };
  const imageRecipe = { ...recipe, recipeId: 'r-image', title: 'Image model', capabilityContract: 'image.generate' };
  const aggregate = {
    loadouts: [loadout('L-default', 'Default'), loadout('L-custom', 'Custom'), loadout('L-failing', 'Failing'), imageLoadout],
    selections: [{ capabilityContract: 'text.generate', loadoutId: 'L-default', effectiveDefaults: {} }],
    selectionRevisions: {},
  };
  if (incompleteExamples) {
    failedChecks.clear();
    for (const id of ['L-custom', 'L-failing']) {
      const configuration = aggregate.loadouts.find((item) => item.loadoutId === id)!;
      configuration.displayName = 'Same name';
      configuration.validationState = id === 'L-custom' ? 'unresolved' : 'blocked';
      configuration.reasons = ['UNKNOWN_VALIDATION_REASON'];
      configuration.modelAxes[0]!.recipeCompatible = false;
      configuration.modelAxes[0]!.resolution = 'unresolved';
      configuration.modelAxes[0]!.reasons = ['AI_LOADOUT_MODEL_CONTRACT_FAILED'];
      dependencyStates.set(id, 'missing');
    }
  }
  const loadouts = new Proxy({
    get: async () => aggregate,
    listRecipes: async (capability?: string) => [recipe, imageRecipe].filter((item) => !capability || item.capabilityContract === capability),
  }, {
    get(target, key) {
      if (typeof key === 'string' && LOADOUT_WRITES.includes(key)) {
        return async () => { calls.loadoutWrites.push(key); throw new Error(`unexpected Loadout write ${key}`); };
      }
      return Reflect.get(target, key);
    },
  });
  const rpc = new Proxy({
    listModelAssets: async () => ({ assets: [wireAsset('gemma-q4', 'c1', 'gemma-4-e2b-it-Q4_K_M.gguf'), wireAsset('mystery', 'c-mystery', 'mystery.safetensors'), wireAsset('image-model', 'c-image', 'image.gguf'), wireAsset('encoder', 'c-encoder', 'encoder.gguf')], nextPageToken: '' }),
    listVerifiedAssets: async () => ({ assets: [], nextPageToken: '' }),
    listLocalEnvironmentDependencyJobs: async () => ({ jobs: [] }),
    resolveLocalEnvironmentPlan: async (request: { capabilityContract: string; candidateLoadoutId: string }) => {
      calls.environmentPlans.push(request.candidateLoadoutId);
      if (failedChecks.has(request.candidateLoadoutId)) throw new Error('runtime unavailable');
      return { plan: wirePlan(request.candidateLoadoutId, dependencyStates.get(request.candidateLoadoutId) ?? 'ready_managed') };
    },
  }, {
    get(target, key) {
      if (typeof key === 'string') calls.rpc.push(key);
      const value = Reflect.get(target, key);
      if (value === undefined && typeof key === 'string') {
        return async () => { throw new Error(`unexpected local RPC ${key}`); };
      }
      return value;
    },
  });
  const sdk = {
    appId: () => 'nimi.chat',
    machineProduct: () => ({ local: { loadouts }, apps: { listApprovedAppCatalogTargets: async () => ({ reasonCode: 'ACTION_EXECUTED', targets: [] }) } }),
    localEnvironmentRpc: () => rpc,
    accountProduct: () => ({ profiles: { list: async () => [] } }),
    accountRuntime: () => ({ auth: {} }),
    withRuntimeProtectedScopes: async (_scopes: unknown, run: () => unknown) => run(),
  };
  return { sdk, calls, failedChecks, dependencyStates };
}

async function withHome(run: (ui: {
  document: Document;
  calls: ReturnType<typeof createFakeSdk>['calls'];
  failCheck: (loadoutId: string) => void;
  passCheck: (loadoutId: string) => void;
  setDependencyState: (loadoutId: string, state: string) => void;
  recheck: (loadoutId: string) => Promise<void>;
  click: (selector: string) => Promise<void>;
  waitFor: (selector: string, predicate?: (element: HTMLElement) => boolean) => Promise<HTMLElement>;
}) => Promise<void>, options: {
  incompleteExamples?: boolean;
  diagnosticsInitiallyOpen?: boolean;
  profileOwnerAppId?: string;
} = {}) {
  const { incompleteExamples = false, diagnosticsInitiallyOpen = false, profileOwnerAppId } = options;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  dom.window.HTMLElement.prototype.scrollTo = function(options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === 'number' ? y ?? 0 : options?.top ?? 0;
    this.scrollLeft = typeof options === 'number' ? options : options?.left ?? 0;
  };
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage,
    HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLSelectElement: dom.window.HTMLSelectElement, Element: dom.window.Element, Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter, DocumentFragment: dom.window.DocumentFragment, MutationObserver: dom.window.MutationObserver,
    ResizeObserver: (globalThis as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub,
    CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const domClasses = Object.getOwnPropertyNames(dom.window).filter((name) => /^(?:HTML|SVG)\w*Element$|Event$/u.test(name) && !(name in values));
  for (const name of domClasses) (values as Record<string, unknown>)[name] = (dom.window as unknown as Record<string, unknown>)[name];
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { AiSettingsPage } = await import('../src/shell/renderer/features/runtime-config/runtime-config-page-ai-settings.js');
  const testI18n = createInstance();
  const i18nResource = createDesktopI18n({ initialLocale: 'en', development: false, now: Date.now });
  await i18nResource.init();
  await testI18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: incompleteExamples ? { runtimeConfig: runtimeConfigEn } : {} } } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => undefined });
  store.navigation.reset(homeRuntimeDestination(diagnosticsInitiallyOpen ? 'advancedDiagnostics' : 'aiSettings'));
  const { sdk, calls, failedChecks, dependencyStates } = createFakeSdk(incompleteExamples);
  const bindings = { app: { commands: {} }, sdk } as unknown as DesktopCanonicalRendererBindings;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const noop = () => undefined;
  function WorkspaceHarness() {
    const diagnostics = useHomeDestination().id === 'diagnostics';
    return <AiSettingsPage
      advancedDiagnostics={diagnostics ? {
        content: <div data-testid="diagnostics-test-content" />,
        onClose: () => { void store.navigation.push(homeRuntimeDestination('aiSettings')); },
      } : undefined}
      runtimeWritesDisabled={false}
      focusedTaskId={null}
      actionFocus={undefined}
      savedConfigsContext={null}
      profileUseOwner={profileOwnerAppId ? { kind: 'app', ownerAppId: profileOwnerAppId, returnFocus: `apps:${profileOwnerAppId}` } : null}
      onOpenSetupTask={noop}
      onCloseSetupTask={noop}
      onOpenModelFiles={noop}
      onOpenSavedConfigs={noop}
      onOpenModelMarket={noop}
      onOpenAdvancedDiagnostics={() => { void store.navigation.push(homeRuntimeDestination('advancedDiagnostics')); }}
      onOpenCloudServices={noop}
      onClearActionFocus={noop}
      onCloseProfileUseOwner={noop}
      onCloseSavedConfigs={noop}
    />;
  }
  const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); });
  const waitFor = async (selector: string, predicate: (element: HTMLElement) => boolean = () => true) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const element = dom.window.document.querySelector<HTMLElement>(selector);
      if (element && predicate(element)) return element;
      await tick();
    }
    throw new Error(`timed out waiting for ${selector}: ${dom.window.document.body.textContent}`);
  };
  try {
    await act(async () =>
      root.render(
        <I18nextProvider i18n={testI18n}>
          <DesktopI18nResourceProvider resource={i18nResource}>
          <QueryClientProvider client={queryClient}>
            <AppStoreProvider store={store}>
              <DesktopRendererBindingProvider bindings={bindings}>
                <TooltipProvider>
                <WorkspaceHarness />
                </TooltipProvider>
              </DesktopRendererBindingProvider>
            </AppStoreProvider>
          </QueryClientProvider>
          </DesktopI18nResourceProvider>
        </I18nextProvider>,
      ),
    );
    await run({
      document: dom.window.document,
      calls,
      failCheck: (loadoutId) => { failedChecks.add(loadoutId); },
      passCheck: (loadoutId) => { failedChecks.delete(loadoutId); },
      setDependencyState: (loadoutId, state) => { dependencyStates.set(loadoutId, state); },
      recheck: async (loadoutId) => {
        await act(async () => {
          await queryClient.refetchQueries({ queryKey: ['runtime', 'loadout-environment', loadoutId] });
        });
      },
      waitFor,
      click: async (selector) => {
        const element = dom.window.document.querySelector<HTMLElement>(selector);
        assert.ok(element, `missing ${selector}`);
        await act(async () => element.click());
      },
    });
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test('diagnostics shares the right pane, preserves the capability rail and returns directly to details or home', async () => {
  await withHome(async (ui) => {
    await ui.waitFor('[data-testid="diagnostics-test-content"]');
    const row = await ui.waitFor('[data-testid="ai-capability:text.generate"]');
    const detailPane = ui.document.querySelector('[data-testid="ai-capabilities-detail-pane"]')!;
    assert.ok(detailPane.contains(ui.document.querySelector('[data-testid="diagnostics-test-content"]')));
    assert.equal(ui.document.querySelector('[data-testid="ai-capabilities-advanced-diagnostics"]')?.getAttribute('aria-current'), 'page');
    assert.equal(row.getAttribute('aria-current'), null);
    await ui.click('[data-testid="ai-capability:text.generate"]');
    await ui.waitFor('[data-testid="ai-capability-detail:text.generate"]');
    assert.equal(ui.document.querySelector('[data-testid="diagnostics-test-content"]'), null);
    assert.strictEqual(ui.document.querySelector('[data-testid="ai-capability:text.generate"]'), row);
    assert.equal(row.getAttribute('aria-current'), 'page');
    await ui.click('[data-testid="ai-capabilities-advanced-diagnostics"]');
    await ui.waitFor('[data-testid="diagnostics-test-content"]');
    await ui.click('[data-testid="ai-capabilities-home"]');
    await ui.waitFor('[data-testid="ai-profile-quick-start"]');
    assert.equal(ui.document.querySelector('[data-testid="diagnostics-test-content"]'), null);
    assert.strictEqual(ui.document.querySelector('[data-testid="ai-capability:text.generate"]'), row);
    assert.deepEqual(ui.calls.loadoutWrites, []);
  }, { diagnosticsInitiallyOpen: true });
});

test('an App profile entry opens the setup chooser with its owner instead of the capabilities overview', async () => {
  await withHome(async (ui) => {
    await ui.waitFor('[data-testid="runtime-ai-settings-profile-selection-empty"]');
    assert.ok(ui.document.querySelector('[data-testid="runtime-ai-settings-profile-selection"]'));
    assert.equal(ui.document.querySelector('h1')?.textContent, 'runtimeConfig.aiSettings.profileSelectionTitle');
    assert.ok(ui.document.querySelector('[data-testid="runtime-ai-settings-profile-owner-banner"]')?.textContent?.includes('test.persona'));
    assert.ok(ui.document.querySelector('[data-testid="runtime-ai-settings-profile-import"]'));
    assert.equal(ui.document.querySelector('[data-testid="ai-profile-quick-start"]'), null);
    assert.equal(ui.document.querySelector('[data-testid="local-model-list"]'), null);
    assert.deepEqual(ui.calls.loadoutWrites, []);
  }, { profileOwnerAppId: 'test.persona' });
});

test('the home lists on-device models, expands with read-only candidate checks, refreshes and opens setup without any Loadout write', async () => {
  await withHome(async (ui) => {
    // Render: the default configuration reuses the inventory plan; the unidentified file says so.
    const defaultBadge = await ui.waitFor('[data-testid="local-model-configuration-badge:L-default"]');
    assert.equal(defaultBadge.querySelector('[data-state]'), null, 'ready status stays out of the collapsed summary');
    assert.ok(!defaultBadge.textContent?.includes('runtimeConfig.localModels.defaultLabel'));
    assert.ok(ui.document.querySelector('[data-testid="local-model-variant:c-mystery"] [data-testid="local-model-use-not-identified"]'));
    // A known model family shows its brand mark; an unrecognized file keeps its monogram.
    assert.ok(await ui.waitFor('[data-testid="local-model:content:c1"] [data-model-family-logo="google-color"]'));
    assert.ok(!ui.document.querySelector('[data-testid="local-model:content:c-mystery"] [data-model-family-logo]'));
    assert.deepEqual(ui.calls.environmentPlans.filter(Boolean), [], 'nothing resolves a candidate plan before a row is expanded');
    assert.ok(!ui.document.querySelector('[data-testid="local-model-configuration:L-custom"]'), 'non-default configurations stay collapsed');

    // Expand: the non-default configurations resolve their own candidate plans; a failed check stays unknown.
    await ui.click('[data-testid="local-model-variant-toggle:c1"]');
    const defaultDetail = await ui.waitFor('[data-testid="local-model-configuration:L-default"]');
    assert.equal(defaultDetail.getAttribute('data-state'), 'ready');
    assert.ok(defaultDetail.textContent?.includes('runtimeConfig.localModels.defaultLabel'));
    assert.ok(defaultDetail.textContent?.includes('runtimeConfig.localModels.reason.ready'));
    const custom = await ui.waitFor('[data-testid="local-model-configuration:L-custom"]', (element) => element.getAttribute('data-state') !== 'unknown');
    assert.equal(custom.getAttribute('data-state'), 'attention');
    assert.equal(custom.getAttribute('data-reason'), 'environment-missing');
    assert.equal(custom.getAttribute('data-missing'), 'llama.cpp');
    const failing = await ui.waitFor('[data-testid="local-model-configuration:L-failing"]', (element) => element.getAttribute('data-reason') === 'check-failed');
    assert.equal(failing.getAttribute('data-state'), 'unknown');
    assert.ok(ui.document.querySelector('[data-testid="local-model-configuration-check:L-failing"]'), 'a failed check offers a retry');
    assert.deepEqual([...new Set(ui.calls.environmentPlans.filter(Boolean))].sort(), ['L-custom', 'L-failing']);

    // Refresh through the home button: the list is still there and still read-only.
    await ui.click('[data-testid="ai-capabilities-home"]');
    await ui.waitFor('[data-testid="local-model-configuration-badge:L-default"]');

    // Multiple configurations offer a choice in place, then open the exact non-default one.
    await ui.click('[data-testid="local-model-view:c1"]');
    await ui.waitFor('[data-testid="local-model-open-configuration:L-custom"]');
    assert.ok(ui.document.querySelector('[data-testid="local-model-list"]'));
    await ui.click('[data-testid="local-model-open-configuration:L-custom"]');
    await ui.waitFor('[data-testid="loadout-manage:L-custom"]');
    assert.equal(ui.document.querySelector('[data-testid="loadout-manage:L-default"]'), null);
    const rail = await ui.waitFor('[data-testid="ai-capability:text.generate"]', (element) => element.getAttribute('aria-current') === 'page');
    assert.ok(rail);

    assert.deepEqual(ui.calls.loadoutWrites, []);
    const rpcMethods = [...new Set(ui.calls.rpc)].sort();
    assert.deepEqual(rpcMethods.filter((name) => !['listModelAssets', 'listVerifiedAssets', 'resolveLocalEnvironmentPlan', 'listLocalEnvironmentDependencyJobs', 'then'].includes(name)), [], `only read RPCs are allowed, saw ${rpcMethods.join(', ')}`);
  });
});

for (const [contentId, buttonKey] of [
  ['c-image', 'viewConfiguration'],
  ['c-encoder', 'viewOwningConfiguration'],
] as const) {
  test(`${contentId} opens its exact linked configuration without changing the default`, async () => {
    await withHome(async (ui) => {
      const button = await ui.waitFor(`[data-testid="local-model-view:${contentId}"]`);
      assert.ok(button.textContent?.includes(`runtimeConfig.localModels.${buttonKey}`));
      if (contentId === 'c-encoder') {
        const row = ui.document.querySelector('[data-testid="local-model-variant:c-encoder"]');
        assert.ok(row?.textContent?.includes('runtimeConfig.localModels.companionFor'));
        assert.ok(row?.textContent?.includes('runtimeConfig.localModels.usedBy'));
      }
      await ui.click(`[data-testid="local-model-view:${contentId}"]`);
      await ui.waitFor('[data-testid="loadout-manage:L-image"]');
      await ui.click('[data-testid="model-configuration-back"]');
      await ui.waitFor('[data-testid="local-model-list"]');
      assert.deepEqual(ui.calls.loadoutWrites, []);
    });
  });
}

test('a failed environment recheck replaces the cached preparation status with check failed', async () => {
  await withHome(async (ui) => {
    await ui.waitFor('[data-testid="local-model-configuration-badge:L-default"]');
    await ui.click('[data-testid="local-model-variant-toggle:c1"]');
    await ui.waitFor('[data-testid="local-model-configuration:L-custom"]', (element) => element.getAttribute('data-reason') === 'environment-missing');

    ui.failCheck('L-custom');
    await ui.recheck('L-custom');
    const failed = await ui.waitFor('[data-testid="local-model-configuration:L-custom"]', (element) => element.getAttribute('data-reason') === 'check-failed');
    assert.equal(failed.getAttribute('data-state'), 'unknown');
    assert.equal(failed.getAttribute('data-missing'), '');
    assert.deepEqual(ui.calls.loadoutWrites, []);
  });
});

test('same-name incomplete configurations show distinct identities, real counts and actionable validation', async () => {
  await withHome(async (ui) => {
    await ui.waitFor('[data-testid="local-model-view:c1"]');
    await ui.click('[data-testid="local-model-view:c1"]');
    for (const id of ['L-custom', 'L-failing']) {
      const summary = await ui.waitFor(`[data-testid="local-model-environment-summary:${id}"]`, (element) => /1\s*\/\s*2/.test(element.textContent ?? ''));
      assert.doesNotMatch(summary.textContent ?? '', /2\s*\/\s*2/);
      const row = ui.document.querySelector(`[data-testid="local-model-configuration:${id}"]`)!;
      assert.match(row.textContent ?? '', /Same name/);
      assert.match(row.textContent ?? '', /Configuration /);
      assert.match(row.textContent ?? '', /incompatible with this configuration/);
      const reason = [...row.querySelectorAll('p')].find((element) => element.textContent?.includes('UNKNOWN_VALIDATION_REASON'));
      assert.ok(reason?.closest('details'), 'raw reasons belong to technical details');
    }
    const first = ui.document.querySelector('[data-testid="local-model-open-configuration:L-custom"]')!;
    const second = ui.document.querySelector('[data-testid="local-model-open-configuration:L-failing"]')!;
    assert.notEqual(first.getAttribute('aria-label'), second.getAttribute('aria-label'));
    assert.equal(ui.document.querySelector('[data-testid="local-model-configuration:L-failing"]')?.getAttribute('data-reason'), 'configuration-blocked');

    // The global refresh must resolve expanded non-default plans, even while
    // their Loadout revision stays unchanged and the cached check is fresh.
    const before = ui.calls.environmentPlans.filter((id) => id === 'L-custom').length;
    ui.setDependencyState('L-custom', 'ready_managed');
    await ui.click('[data-testid="local-model-refresh"]');
    await ui.waitFor('[data-testid="local-model-environment-summary:L-custom"]', (element) => /2\s*\/\s*2/.test(element.textContent ?? ''));
    assert.ok(ui.calls.environmentPlans.filter((id) => id === 'L-custom').length > before);
    assert.equal(ui.document.querySelector('[data-testid="local-model-configuration:L-custom"]')?.getAttribute('data-reason'), 'configuration-incomplete');
    await ui.click('[data-testid="local-model-open-configuration:L-failing"]');
    const drawer = await ui.waitFor('[data-testid="loadout-manage:L-failing"]');
    assert.match(drawer.textContent ?? '', /incompatible with this configuration/);
    await ui.click('[data-testid="model-configuration-back"]');
    await ui.waitFor('[data-testid="local-model-list"]');
    assert.deepEqual(ui.calls.loadoutWrites, []);
  }, { incompleteExamples: true });
});

test('current configuration checks its own dependencies, fails visibly and recovers without a write', async () => {
  await withHome(async ui => {
    await ui.waitFor('[data-testid="ai-capability:text.generate"]');
    await ui.click('[data-testid="ai-capability:text.generate"]');
    await ui.waitFor('[data-testid="capability-current-model"]', element => element.getAttribute('data-loadout-id') === 'L-default');
    await ui.click('[data-testid="capability-technical-details"] > summary');
    await ui.waitFor('[data-testid="configuration-environment-refresh"]', element => !element.hasAttribute('disabled'));
    assert.ok(ui.calls.environmentPlans.includes('L-default'), 'the selected configuration is checked explicitly');
    assert.equal(ui.document.querySelector('[data-testid="runtime-local-capability-environment"]'), null);
    ui.failCheck('L-default');
    await ui.click('[data-testid="configuration-environment-refresh"]');
    await ui.waitFor('[data-testid="capability-state-badge"]', element => element.textContent?.includes('state.unknown') === true);
    assert.match(ui.document.body.textContent ?? '', /configurationCheckFailed/);
    ui.passCheck('L-default');
    await ui.click('[data-testid="configuration-environment-refresh"]');
    await ui.waitFor('[data-testid="capability-state-badge"]', element => element.textContent?.includes('state.ready') === true);
    assert.doesNotMatch(ui.document.body.textContent ?? '', /configurationCheckFailed/);
    assert.deepEqual(ui.calls.loadoutWrites, []);
  });
});
