import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@nimiplatform/kit/ui';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { AppStoreProvider } from '../src/shell/renderer/app-shell/providers/app-store.js';
import { createAppStore } from '../src/shell/renderer/app-shell/providers/app-store-factory.js';

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
    dependencies: [{ dependencyFamily: 'llama', dependencyId: 'llama.cpp', consumerScope: '', required: true, state: dependencyState, sourceKind: '', confirmationRequired: false, environmentKey: 'k', selectedSourceRecordId: '', canonicalRoot: '', reasonCode: '', detail: '' }],
    requiredDependencyFamilies: [], aggregateSizeKnown: true, aggregateSizeBytes: 0, storageCategories: [], sourceOwners: [], noSystemMutation: true,
    candidateLoadoutId, candidateRevision: '',
  };
}

function loadout(loadoutId: string, displayName: string, modelAssetId = 'gemma-q4') {
  return {
    loadoutId, capabilityContract: 'text.generate', displayName, validationState: 'configured', recipeId: 'r-text', recipeRevision: '1',
    implementation: { implementationId: 'impl', driverId: 'd', driverDialect: 'x' }, options: {},
    modelAxes: [{ slotId: 'main.gguf', displayLabel: 'Model', modelAssetId, expectedContentId: 'c1', recipeCompatible: true, reasons: [], presence: 'required', conditionalFeatures: [], resolution: 'configured' }],
    recipeCustody: [], implementationSupportedFeatures: [], configuredFeatures: [], textBehaviors: [], reasons: [], provenance: {},
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

function createFakeSdk() {
  const calls: { loadoutWrites: string[]; rpc: string[]; environmentPlans: string[] } = { loadoutWrites: [], rpc: [], environmentPlans: [] };
  const failedChecks = new Set(['L-failing']);
  const aggregate = {
    loadouts: [loadout('L-default', 'Default'), loadout('L-custom', 'Custom'), loadout('L-failing', 'Failing')],
    selections: [{ capabilityContract: 'text.generate', loadoutId: 'L-default', effectiveDefaults: {} }],
    selectionRevisions: {},
  };
  const loadouts = new Proxy({
    get: async () => aggregate,
    listRecipes: async (capability?: string) => (capability && capability !== 'text.generate' ? [] : [recipe]),
  }, {
    get(target, key) {
      if (typeof key === 'string' && LOADOUT_WRITES.includes(key)) {
        return async () => { calls.loadoutWrites.push(key); throw new Error(`unexpected Loadout write ${key}`); };
      }
      return Reflect.get(target, key);
    },
  });
  const rpc = new Proxy({
    listModelAssets: async () => ({ assets: [wireAsset('gemma-q4', 'c1', 'gemma-4-e2b-it-Q4_K_M.gguf'), wireAsset('mystery', 'c-mystery', 'mystery.safetensors')], nextPageToken: '' }),
    listVerifiedAssets: async () => ({ assets: [], nextPageToken: '' }),
    resolveLocalEnvironmentPlan: async (request: { capabilityContract: string; candidateLoadoutId: string }) => {
      calls.environmentPlans.push(request.candidateLoadoutId);
      if (failedChecks.has(request.candidateLoadoutId)) throw new Error('runtime unavailable');
      return { plan: wirePlan(request.candidateLoadoutId, request.candidateLoadoutId === 'L-custom' ? 'needs_confirmation' : 'ready_managed') };
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
  return { sdk, calls, failedChecks };
}

async function withHome(run: (ui: {
  document: Document;
  calls: ReturnType<typeof createFakeSdk>['calls'];
  failCheck: (loadoutId: string) => void;
  recheck: (loadoutId: string) => Promise<void>;
  click: (selector: string) => Promise<void>;
  waitFor: (selector: string, predicate?: (element: HTMLElement) => boolean) => Promise<HTMLElement>;
}) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
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
  const { DesktopRendererBindingProvider } = await import('../src/shell/renderer/renderer/binding-context.js');
  const { AiSettingsPage } = await import('../src/shell/renderer/features/runtime-config/runtime-config-page-ai-settings.js');
  const testI18n = createInstance();
  await testI18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const store = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => undefined });
  const { sdk, calls, failedChecks } = createFakeSdk();
  const bindings = { app: { commands: {} }, sdk } as unknown as DesktopCanonicalRendererBindings;
  const root = createRoot(dom.window.document.getElementById('root')!);
  const noop = () => undefined;
  const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); });
  const waitFor = async (selector: string, predicate: (element: HTMLElement) => boolean = () => true) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const element = dom.window.document.querySelector<HTMLElement>(selector);
      if (element && predicate(element)) return element;
      await tick();
    }
    throw new Error(`timed out waiting for ${selector}`);
  };
  try {
    await act(async () =>
      root.render(
        <I18nextProvider i18n={testI18n}>
          <QueryClientProvider client={queryClient}>
            <AppStoreProvider store={store}>
              <DesktopRendererBindingProvider bindings={bindings}>
                <TooltipProvider>
                <AiSettingsPage
                  runtimeWritesDisabled={false}
                  focusedTaskId={null}
                  actionFocus={undefined}
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
              </DesktopRendererBindingProvider>
            </AppStoreProvider>
          </QueryClientProvider>
        </I18nextProvider>,
      ),
    );
    await run({
      document: dom.window.document,
      calls,
      failCheck: (loadoutId) => { failedChecks.add(loadoutId); },
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

test('the home lists on-device models, expands with read-only candidate checks, refreshes and opens setup without any Loadout write', async () => {
  await withHome(async (ui) => {
    // Render: the default configuration reuses the inventory plan; the unidentified file says so.
    const defaultBadge = await ui.waitFor('[data-testid="local-model-configuration-badge:L-default"]');
    assert.equal(defaultBadge.querySelector('[data-state]')?.getAttribute('data-state'), 'ready');
    assert.ok(ui.document.querySelector('[data-testid="local-model-variant:c-mystery"] [data-testid="local-model-use-not-identified"]'));
    assert.deepEqual(ui.calls.environmentPlans.filter(Boolean), [], 'nothing resolves a candidate plan before a row is expanded');
    assert.ok(!ui.document.querySelector('[data-testid="local-model-configuration:L-custom"]'), 'non-default configurations stay collapsed');

    // Expand: the non-default configurations resolve their own candidate plans; a failed check stays unknown.
    await ui.click('[data-testid="local-model-variant-toggle:c1"]');
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

    // Entering setup is a navigation the person starts; it opens the capability, not a task.
    await ui.click('[data-testid="local-model-view:c1"]');
    const rail = await ui.waitFor('[data-testid="ai-capability:text.generate"]', (element) => element.getAttribute('aria-current') === 'page');
    assert.ok(rail);

    assert.deepEqual(ui.calls.loadoutWrites, []);
    const rpcMethods = [...new Set(ui.calls.rpc)].sort();
    assert.deepEqual(rpcMethods.filter((name) => !['listModelAssets', 'listVerifiedAssets', 'resolveLocalEnvironmentPlan', 'then'].includes(name)), [], `only read RPCs are allowed, saw ${rpcMethods.join(', ')}`);
  });
});

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
