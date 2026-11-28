import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  NimiLoadoutRecipe,
  NimiRuntimeLocalVerifiedAssetDescriptor,
} from '@nimiplatform/sdk/runtime';

function installDomGlobals(t: test.TestContext) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    Node: dom.window.Node,
    NodeFilter: dom.window.NodeFilter,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLDetailsElement: dom.window.HTMLDetailsElement,
    SVGElement: dom.window.SVGElement,
    MutationObserver: dom.window.MutationObserver,
    ResizeObserver: ResizeObserverStub,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => (previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key)));
  }
  t.after(() => dom.window.close());
  return dom;
}

test('RuntimeCapabilityDetail resolves human model heading, collapses other-platform profiles, and disables Import on unsupported recipes', async (t) => {
  const dom = installDomGlobals(t);
  const { createRoot } = await import('react-dom/client');
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { initI18n, changeLocale } = await import('../src/shell/renderer/i18n/index.js');
  const { AppStoreProvider } = await import('../src/shell/renderer/app-shell/providers/app-store.js');
  const { createAppStore } = await import('../src/shell/renderer/app-shell/providers/app-store-factory.js');
  const { RuntimeCapabilityDetail } = await import('../src/shell/renderer/features/runtime-config/runtime-capability-detail.js');
  const { recipeDisplayTitle } = await import('../src/shell/renderer/features/runtime-config/runtime-capability-presentation.js');

  await initI18n();
  await changeLocale('en');

  const catalog: NimiRuntimeLocalVerifiedAssetDescriptor[] = [
    {
      templateId: 'tmpl-gemma-4-2b-q8',
      contentId: 'sha256:gemma-4-2b-q8',
      logicalModelId: 'google/gemma-4-e2b-it',
      title: 'gemma-4-e2b-it-local (Q8_0)',
      entry: 'gemma-4-e2b-it-Q8_0.gguf',
      repo: 'google/gemma-4',
      revision: 'main',
      totalSizeBytes: 5_048_350_848,
      hashes: {},
    } as unknown as NimiRuntimeLocalVerifiedAssetDescriptor,
  ];

  const compatibleRecipe = {
    recipeId: 'llama.cpp/text-generate/v3',
    title: 'llama.cpp GGUF text generation',
    capabilityContract: 'text.generate',
    applicability: 'supported',
    reasons: [],
    implementationSupportedFeatures: [],
    slots: [
      {
        slotId: 'main.gguf',
        displayLabel: 'Main model',
        presence: 'required',
        recommendedVariantIds: ['tmpl-gemma-4-2b-q8'],
        recommendedContentIds: ['sha256:gemma-4-2b-q8'],
        offers: [
          {
            applicability: 'supported',
            installedModelAssetId: '',
            candidate: {
              offerRef: 'tmpl-gemma-4-2b-q8',
              title: 'gemma-4-e2b-it-local (Q8_0)',
              variantLabel: 'gemma-4-e2b-it-Q8_0.gguf',
              installable: true,
              downloadSizeBytes: 5_048_350_848,
            },
          },
        ],
      },
    ],
  } as unknown as NimiLoadoutRecipe;

  const unsupportedWindowsCudaRecipe = {
    recipeId: 'gemma-4-12b-windows-cuda',
    title: 'Gemma 4 12B unified image, audio and video (Windows CUDA)',
    capabilityContract: 'text.generate',
    applicability: 'unsupported',
    reasons: ['AI_LOCAL_HOST_UNSUPPORTED'],
    implementationSupportedFeatures: [],
    slots: [
      {
        slotId: 'main.gguf',
        displayLabel: 'Main model',
        presence: 'required',
        recommendedVariantIds: [],
        recommendedContentIds: [],
        offers: [],
      },
    ],
  } as unknown as NimiLoadoutRecipe;

  // Pure helper checks: human model title for generic recipe, preserved platform title for unsupported recipe.
  assert.equal(recipeDisplayTitle(compatibleRecipe, catalog, []), 'Gemma 4 2B · Q8');
  assert.equal(
    recipeDisplayTitle(unsupportedWindowsCudaRecipe, catalog, []),
    'Gemma 4 12B unified image, audio and video (Windows CUDA)',
  );

  const appStore = createAppStore({ initialChatThinkingPreference: 'off', persistChatThinkingPreference: () => undefined });
  let importCalls = 0;
  const doc = dom.window.document;
  const root = createRoot(doc.getElementById('root')!);

  const renderView = async (extraRecipes: readonly NimiLoadoutRecipe[] = []) => {
    await act(async () => {
      root.render(
        <AppStoreProvider store={appStore}>
          <TooltipProvider>
            <RuntimeCapabilityDetail
              capability="text.generate"
              loadouts={[]}
              recipes={[compatibleRecipe, unsupportedWindowsCudaRecipe, ...extraRecipes]}
              catalog={catalog}
              assets={[]}
              libraryLoading={false}
              libraryError={false}
              status={{ state: 'unset', replacement: false }}
              taskModel=""
              section="models"
              onSection={() => {}}
              busy={false}
              disabled={false}
              navigationContext={null}
              onStart={async () => {}}
              onEnable={async () => {}}
              onSelectLoadout={async () => {}}
              onApplyCustomization={async () => {}}
              onTask={() => {}}
              onImportModelFiles={() => { importCalls += 1; }}
              onDiagnostics={() => {}}
              onModelMarket={() => {}}
            />
          </TooltipProvider>
        </AppStoreProvider>,
      );
    });
  };

  try {
    await renderView();

    // Compatible recipe renders directly with human model heading instead of raw llama.cpp GGUF.
    const compatibleCard = doc.querySelector('[data-testid="capability-model:llama.cpp/text-generate/v3"]');
    assert.ok(compatibleCard, 'compatible recipe card should render');
    assert.equal(compatibleCard.closest('[data-testid="capability-other-platform-recipes"]'), null);
    assert.equal(compatibleCard.querySelector('h4')?.textContent, 'Gemma 4 2B · Q8');

    // Unsupported Windows CUDA recipe is collapsed inside capability-other-platform-recipes disclosure.
    const otherPlatformDisclosure = doc.querySelector<HTMLDetailsElement>('[data-testid="capability-other-platform-recipes"]');
    assert.ok(otherPlatformDisclosure, 'other-platform recipes disclosure should render');
    assert.equal(otherPlatformDisclosure.open, false, 'other-platform recipes disclosure must be collapsed by default');
    assert.match(otherPlatformDisclosure.querySelector('summary')?.textContent ?? '', /Show profiles for other platforms \(1\)/);

    const unsupportedCard = otherPlatformDisclosure.querySelector('[data-testid="capability-model:gemma-4-12b-windows-cuda"]');
    assert.ok(unsupportedCard, 'unsupported recipe should live inside the disclosure');

    // Import model files button on unsupported recipe MUST be disabled.
    const importButtons = [...unsupportedCard.querySelectorAll<HTMLButtonElement>('button')].filter(
      (btn) => btn.textContent?.includes('Import model files'),
    );
    assert.equal(importButtons.length, 1, 'unsupported no-direct-download recipe should render Import model files button');
    assert.equal(importButtons[0]!.disabled, true, 'Import model files must be disabled on unsupported recipes');
    await act(async () => {
      importButtons[0]!.click();
    });
    assert.equal(importCalls, 0);

    // Header browse action uses Discover copy instead of Model Market.
    const detailText = doc.querySelector('[data-testid="ai-capability-detail:text.generate"]')?.textContent ?? '';
    assert.match(detailText, /Discover models/);
    assert.doesNotMatch(detailText, /Model Market|Explore model market/i);

    // Chinese localization for the other-platform disclosure.
    await act(async () => {
      await changeLocale('zh');
    });
    await renderView();
    const zhDisclosure = doc.querySelector<HTMLDetailsElement>('[data-testid="capability-other-platform-recipes"]');
    assert.match(zhDisclosure?.querySelector('summary')?.textContent ?? '', /显示适用于其他平台的配置方案（1）/);

    // Shortened search placeholder fits cleanly when search box is shown (> 6 recipes).
    await act(async () => {
      await changeLocale('en');
    });
    const extraRecipes = Array.from({ length: 6 }, (_, index) => ({
      recipeId: `extra-${index}`,
      title: `Extra model ${index}`,
      capabilityContract: 'text.generate',
      applicability: 'supported',
      reasons: [],
      implementationSupportedFeatures: [],
      slots: [],
    }) as unknown as NimiLoadoutRecipe);
    await renderView(extraRecipes);
    const searchInput = doc.querySelector<HTMLInputElement>('input[type="search"]');
    assert.ok(searchInput, 'search input should render when > 6 recipes exist');
    assert.equal(searchInput.placeholder, 'Search models');
  } finally {
    await act(async () => root.unmount());
  }
});

test('Terminology and search placeholders unify Ready, Discover, and concise Search copy', async (t) => {
  installDomGlobals(t);
  const { TooltipProvider } = await import('@nimiplatform/kit/ui');
  const { initI18n, changeLocale, i18n } = await import('../src/shell/renderer/i18n/index.js');
  const { DesktopI18nResourceProvider } = await import('../src/shell/renderer/i18n/i18n-context.js');
  const { LocalModelCenterInstalledAssetsSection } = await import('../src/shell/renderer/features/runtime-config/runtime-config-local-model-center-installed-section.js');
  const { localizedStatusTextV11, statusTextV11 } = await import('../src/shell/renderer/features/runtime-config/runtime-config-state-types.js');

  await initI18n();
  await changeLocale('en');

  assert.equal(statusTextV11('healthy'), 'Ready');
  assert.equal(localizedStatusTextV11('healthy', i18n.t.bind(i18n)), 'Ready');
  assert.equal(i18n.t('runtimeConfig.partners.characterSearch'), 'Search characters');
  assert.equal(i18n.t('runtimeConfig.product.searchModels'), 'Search models');

  const emptyAssetsHtml = renderToStaticMarkup(
    <TooltipProvider>
      <DesktopI18nResourceProvider resource={{ instance: i18n } as never}>
        <LocalModelCenterInstalledAssetsSection
          modelAssets={[]}
          loadingInstalledAssets={false}
          assetBusy={false}
          runtimeWritesDisabled={false}
          onRefreshAssets={() => {}}
          onInspectRemoval={async () => ({ directReferences: [], unresolvedReferences: 0 } as never)}
          onRemoveAsset={async () => {}}
          onOpenDiscover={() => {}}
          onImportFile={() => {}}
        />
      </DesktopI18nResourceProvider>
    </TooltipProvider>,
  );
  assert.match(emptyAssetsHtml, /Download models from Discover or import your own files\./);
  assert.doesNotMatch(emptyAssetsHtml, /Model Market/i);

  await changeLocale('zh');
  assert.equal(localizedStatusTextV11('healthy', i18n.t.bind(i18n)), '就绪');
  assert.equal(i18n.t('runtimeConfig.partners.characterSearch'), '搜索角色');
  assert.equal(i18n.t('runtimeConfig.product.searchModels'), '搜索模型');
});
