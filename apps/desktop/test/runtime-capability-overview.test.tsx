import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { NimiPortableAIProfile } from '@nimiplatform/sdk/ai';
import type {
  NimiLoadoutRecipe,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import {
  RuntimeProfileQuickStart,
  selectStarterCapabilities,
  type RuntimeOverviewCapability,
} from '../src/shell/renderer/features/runtime-config/runtime-profile-quick-start.js';

(globalThis as { React?: typeof React }).React = React;

// Rendering fixtures exercise summary composition only, not Runtime readiness.
const text: RuntimeOverviewCapability = { id: 'text.generate', model: 'Gemma 4', state: { state: 'ready', replacement: false } };
const image: RuntimeOverviewCapability = { id: 'image.generate', model: 'Z-Image Turbo', state: { state: 'ready', replacement: false } };
const speech: RuntimeOverviewCapability = { id: 'audio.synthesize', model: 'VoxCPM2 audio.cpp', state: { state: 'ready', replacement: false } };

const unset = (id: string): RuntimeOverviewCapability => ({
  id,
  model: '',
  state: { state: 'unset', replacement: false },
});

function makeRecipe(input: {
  recipeId: string;
  capability: string;
  title: string;
  applicability?: 'supported' | 'unsupported' | 'unknown';
  variantId?: string;
  contentId?: string;
  installedModelAssetId?: string;
  downloadSizeBytes?: number;
  contextFit?: { authoredContextSize: number; recommendedContextSize: number; recommendedOptions: Record<string, unknown> };
  pinRecommendation?: boolean;
}): NimiLoadoutRecipe {
  const pinned = input.pinRecommendation !== false;
  return {
    recipeId: input.recipeId,
    revision: 'rev-1',
    capabilityContract: input.capability,
    title: input.title,
    applicability: input.applicability ?? 'supported',
    implementation: { implementationId: `impl.${input.recipeId}`, driverId: 'llama.cpp', driverDialect: 'llama.v1' },
    implementationSupportedFeatures: [],
    recommendedOptions: input.contextFit?.recommendedOptions ?? {},
    slots: [
      {
        slotId: 'main.model',
        displayLabel: 'Main model',
        presence: 'required',
        recommendedVariantIds: pinned && input.variantId ? [input.variantId] : [],
        recommendedContentIds: pinned && input.contentId ? [input.contentId] : [],
        ...(input.contextFit ? { recommendedContextFit: input.contextFit } : {}),
        offers: [
          {
            applicability: input.applicability ?? 'supported',
            reasons: [],
            ...(input.installedModelAssetId ? { installedModelAssetId: input.installedModelAssetId } : {}),
            candidate: {
              offerRef: `offer-${input.recipeId}`,
              title: `Model ${input.variantId ?? input.recipeId}`,
              variantLabel: `${input.variantId ?? input.recipeId}.gguf`,
              installable: true,
              totalSizeBytes: input.downloadSizeBytes ?? 4_294_967_296,
              downloadSizeBytes: input.downloadSizeBytes ?? 4_294_967_296,
            },
          },
        ],
      },
    ],
  } as unknown as NimiLoadoutRecipe;
}

const SHA_QWEN = `sha256:${'a'.repeat(64)}`;
const SHA_GEMMA = `sha256:${'b'.repeat(64)}`;
const SHA_ZIMAGE = `sha256:${'c'.repeat(64)}`;

function makeCatalogAsset(templateId: string, contentId: string, totalSizeBytes: number): NimiRuntimeLocalVerifiedAssetDescriptor {
  return {
    templateId,
    title: `Model ${templateId}`,
    contentId,
    repo: 'nimi/test-models',
    revision: 'main',
    entry: `${templateId}.gguf`,
    totalSizeBytes,
    hashes: { [`${templateId}.gguf`]: contentId },
  } as unknown as NimiRuntimeLocalVerifiedAssetDescriptor;
}

async function createTestI18n(language = 'zh') {
  const i18n = createInstance();
  const resources = JSON.parse(
    readFileSync(new URL(`../src/shell/renderer/locales/${language}/46-runtimeConfig.json`, import.meta.url), 'utf8'),
  );
  await i18n.init({ lng: language, resources: { [language]: { translation: { runtimeConfig: resources } } } });
  return i18n;
}

async function renderOverview(
  capabilities: readonly RuntimeOverviewCapability[],
  options: {
    language?: string;
    pending?: boolean;
    unavailable?: boolean;
    recipes?: readonly NimiLoadoutRecipe[];
    catalog?: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
    assets?: readonly NimiRuntimeModelAssetRecord[];
    withCloud?: boolean;
  } = {},
) {
  const i18n = await createTestI18n(options.language ?? 'zh');
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <RuntimeProfileQuickStart
        disabled={false}
        pending={options.pending ?? false}
        unavailable={options.unavailable}
        capabilities={capabilities}
        recipes={options.recipes}
        catalog={options.catalog}
        assets={options.assets}
        onRetry={() => {}}
        onOpenCapability={() => {}}
        onOpenTask={() => {}}
        onOpenCloudServices={options.withCloud ? () => {} : undefined}
        onUse={() => {}}
      />
    </I18nextProvider>,
  );
}

test('overview lists every ready capability and its model, while surfacing active tasks separately', async () => {
  const html = await renderOverview([
    text,
    image,
    { id: 'video.generate', model: 'Unready model', state: { state: 'preparing', replacement: false } },
  ]);
  assert.match(html, /可用能力 · 2/);
  assert.doesNotMatch(html, /项能力在这台设备上本地运行/);
  assert.match(html, /文本生成/);
  assert.match(html, /Gemma 4/);
  assert.match(html, /Z-Image Turbo/);
  assert.match(html, /aria-label="查看文本生成"/);
  assert.match(html, /aria-label="查看图像生成"/);
  assert.equal((html.match(/data-ready-capability=/g) ?? []).length, 2);
  assert.match(html, /data-testid="ai-overview-activity"/);
  assert.match(html, /data-activity-capability="video.generate"/);
  assert.doesNotMatch(html, /本机对话已就绪|开始聊天|Nimi 聊天|本机默认/);
  assert.equal((html.match(/可用能力/g) ?? []).length, 1, 'the summary states the scope of readiness once');
});

test('image readiness remains visible without ready text generation, in both locales', async () => {
  for (const language of ['zh', 'en']) {
    const html = await renderOverview([image], { language });
    assert.match(html, language === 'zh' ? /可用能力 · 1/ : /Ready capabilities · 1/);
    assert.doesNotMatch(html, language === 'zh' ? /项能力在这台设备上本地运行/ : /capability runs on this device/);
    assert.match(html, /Z-Image Turbo/);
    assert.doesNotMatch(html, /data-ready-capability="text.generate"|Gemma 4|runtimeConfig\./);
  }
});

test('pending and unknown inventory never produce a ready summary', async () => {
  assert.match(await renderOverview([image], { pending: true }), /data-quick-start-state="pending"/);
  const html = await renderOverview([]);
  assert.match(html, /data-quick-start-state="unknown"/);
  assert.match(html, /nimi-surface--card/);
  assert.doesNotMatch(html, /data-ready-capability=/);
  assert.doesNotMatch(html, /设置你的第一个本机对话/);
});

test('cold-start overview presents multi-modal starters with pre-selected recipes, on-device files, context reduction, and cloud escape', async () => {
  const recipes = [
    makeRecipe({
      recipeId: 'r-qwen',
      capability: 'text.generate',
      title: 'Qwen 3 8B text generation',
      variantId: 'v-qwen',
      contentId: SHA_QWEN,
      downloadSizeBytes: 5 * 1024 ** 3,
      contextFit: { authoredContextSize: 262144, recommendedContextSize: 65536, recommendedOptions: { contextSize: 65536 } },
    }),
    makeRecipe({
      recipeId: 'r-gemma',
      capability: 'text.generate',
      title: 'Gemma 4 text generation',
      variantId: 'v-gemma',
      contentId: SHA_GEMMA,
      downloadSizeBytes: 3 * 1024 ** 3,
    }),
    makeRecipe({
      recipeId: 'r-zimage',
      capability: 'image.generate',
      title: 'Z-Image Turbo image generation',
      variantId: 'v-zimage',
      contentId: SHA_ZIMAGE,
      installedModelAssetId: 'asset-zimage',
    }),
  ];
  const catalog = [
    makeCatalogAsset('v-qwen', SHA_QWEN, 5 * 1024 ** 3),
    makeCatalogAsset('v-gemma', SHA_GEMMA, 3 * 1024 ** 3),
    makeCatalogAsset('v-zimage', SHA_ZIMAGE, 6 * 1024 ** 3),
  ];
  const assets = [
    { modelAssetId: 'asset-zimage', contentId: SHA_ZIMAGE, contentVerified: true, entry: 'v-zimage.gguf' } as unknown as NimiRuntimeModelAssetRecord,
  ];
  const capabilities = [unset('text.generate'), unset('text.embed'), unset('image.generate'), unset('audio.synthesize')];
  const picked = selectStarterCapabilities(capabilities, recipes);
  assert.deepEqual(picked.map((entry) => entry.id), ['text.generate', 'image.generate', 'audio.synthesize']);

  const html = await renderOverview(capabilities, { recipes, catalog, assets, withCloud: true });
  assert.match(html, /data-quick-start-state="unset"/);
  assert.match(html, /从常用能力开始/);
  assert.doesNotMatch(html, /设置你的第一个本机对话/);
  // Text card pre-selects the first supported recipe (never blank) and shows reduced context + reason.
  assert.match(html, /data-starter-capability="text.generate"/);
  assert.match(html, /Model V Qwen/i);
  assert.match(html, /data-testid="ai-starter-context:text.generate"/);
  assert.match(html, /64K/);
  assert.match(html, /256K/);
  assert.match(html, /查看推荐 · 5\.00 GB/);
  // Image card reports on-device files without claiming readiness.
  assert.match(html, /data-starter-capability="image.generate"/);
  assert.match(html, /Model V Zimage/i);
  assert.match(html, /配置并启用/);
  assert.doesNotMatch(html, /data-ready-capability=/);
  // Unsupported audio card explains limitation honestly and offers Cloud Services escape.
  assert.match(html, /data-starter-capability="audio.synthesize"/);
  assert.match(html, /前往云端服务/);
  assert.match(html, /data-testid="ai-starter-cloud:audio.synthesize"/);
});

test('non-conversation preparing and attention states surface in the activity strip when no capability is ready', async () => {
  const html = await renderOverview([
    unset('text.generate'),
    {
      id: 'image.generate',
      model: '',
      taskModel: 'Z-Image Turbo',
      state: { state: 'preparing', replacement: false },
    },
    {
      id: 'audio.synthesize',
      model: 'Kokoro',
      state: { state: 'attention', replacement: false, reason: 'environment' },
    },
  ]);
  assert.match(html, /data-quick-start-state="preparing"/);
  assert.match(html, /data-activity-capability="image.generate"/);
  assert.match(html, /正在准备图像生成/);
  assert.match(html, /Z-Image Turbo/);
  assert.match(html, /data-activity-capability="audio.synthesize"/);
  assert.match(html, /语音合成需要处理/);
  assert.match(html, /所需运行组件尚未准备好/);
});

test('ready overview uses neutral card surface, groups by domain, and filters via category tabs', async () => {
  const html = await renderOverview([text, image, speech], { language: 'zh' });
  assert.match(html, /nimi-surface--card/);
  assert.doesNotMatch(html, /nimi-surface--hero/);
  assert.match(html, /data-ready-capability-group="text"/);
  assert.match(html, /data-ready-capability-group="visual"/);
  assert.match(html, /data-ready-capability-group="audio"/);
  assert.match(html, /data-testid="ai-ready-capability-groups"/);

  // Single-group ready overview omits the category filter bar.
  const singleGroupHtml = await renderOverview([image], { language: 'zh' });
  assert.doesNotMatch(singleGroupHtml, /data-testid="ai-ready-capability-groups"/);

  // Interactive category filtering narrows visible capabilities and restores all.
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const prevWindow = globalThis.window;
  const prevDocument = globalThis.document;
  const prevHTMLElement = globalThis.HTMLElement;
  const prevActEnv = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const i18n = await createTestI18n('zh');
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const opened: string[] = [];
  const usedProfiles: NimiPortableAIProfile[] = [];
  const openedDrafts: unknown[] = [];
  try {
    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <RuntimeProfileQuickStart
            disabled={false}
            pending={false}
            capabilities={[text, image, speech]}
            onRetry={() => {}}
            onOpenCapability={(id) => opened.push(id)}
            onOpenTask={() => {}}
            onUse={(profile) => usedProfiles.push(profile)}
          />
        </I18nextProvider>,
      );
    });
    assert.equal(container.querySelectorAll('[data-ready-capability]').length, 3);
    const tabs = Array.from(container.querySelectorAll('[data-testid="ai-ready-capability-groups"] [role="radio"]'));
    assert.equal(tabs.length, 4);
    const audioTab = tabs.find((tab) => tab.textContent?.includes('语音与音乐')) as HTMLElement | undefined;
    assert.ok(audioTab);
    await act(async () => {
      audioTab.click();
    });
    assert.equal(container.querySelectorAll('[data-ready-capability]').length, 1);
    assert.ok(container.querySelector('[data-ready-capability="audio.synthesize"]'));
    assert.equal(container.querySelector('[data-ready-capability="text.generate"]'), null);

    // Clicking the filtered capability opens its detail view.
    await act(async () => {
      (container.querySelector('[data-ready-capability="audio.synthesize"]') as HTMLElement).click();
    });
    assert.deepEqual(opened, ['audio.synthesize']);

    // Returning to "All" restores every capability group.
    const allTab = tabs[0] as HTMLElement;
    await act(async () => {
      allTab.click();
    });
    assert.equal(container.querySelectorAll('[data-ready-capability]').length, 3);

    // Cold-start starter actions: pinned recipe uses portable profile; unpinned recipe opens direct recipe setup.
    const pinnedText = makeRecipe({
      recipeId: 'r-qwen',
      capability: 'text.generate',
      title: 'Qwen 3 8B text generation',
      variantId: 'v-qwen',
      contentId: SHA_QWEN,
    });
    const unpinnedImage = makeRecipe({
      recipeId: 'r-flux',
      capability: 'image.generate',
      title: 'Flux image generation',
      pinRecommendation: false,
    });
    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <RuntimeProfileQuickStart
            disabled={false}
            pending={false}
            capabilities={[unset('text.generate'), unset('image.generate')]}
            recipes={[pinnedText, unpinnedImage]}
            catalog={[makeCatalogAsset('v-qwen', SHA_QWEN, 4_000_000_000)]}
            assets={[]}
            onRetry={() => {}}
            onOpenCapability={(id) => opened.push(id)}
            onOpenTask={() => {}}
            onOpenSavedConfigs={context => openedDrafts.push(context)}
            onUse={(profile) => usedProfiles.push(profile)}
          />
        </I18nextProvider>,
      );
    });
    const textBtn = container.querySelector<HTMLButtonElement>('[data-testid="ai-starter-use:text.generate"]');
    assert.ok(textBtn && !textBtn.disabled, 'pre-selected starter CTA must be immediately actionable');
    await act(async () => {
      textBtn.click();
    });
    assert.equal(usedProfiles.length, 1);
    assert.ok('text.generate' in usedProfiles[0]!.capabilities);

    const imageBtn = container.querySelector<HTMLButtonElement>('[data-testid="ai-starter-use:image.generate"]');
    assert.ok(imageBtn && !imageBtn.disabled);
    await act(async () => {
      imageBtn.click();
    });
    assert.deepEqual(openedDrafts, [{ capabilityContract: 'image.generate', recipeId: 'r-flux', recipeRevision: 'rev-1' }]);
    assert.equal(usedProfiles.length, 1);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
    Object.assign(globalThis, {
      window: prevWindow,
      document: prevDocument,
      HTMLElement: prevHTMLElement,
      IS_REACT_ACT_ENVIRONMENT: prevActEnv,
    });
  }
});
