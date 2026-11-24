import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';

import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { createNimiError } from '@nimiplatform/sdk/types';
import { runtimeConfigLoadoutCatalogBadge } from '../src/shell/renderer/features/runtime-config/runtime-config-loadout-catalog-badge.js';
import {
  buildLoadoutCreateOptions,
  installAndBindRuntimeConfigRecommendedLoadout,
  loadoutAssetLabel,
  loadoutCapabilityLabelKey,
  parseLoadoutCreateContextOption,
  partitionRuntimeConfigRecipeTemplates,
  recommendedInstallItems,
  recommendedInstallMessage,
  resolveLoadoutCreateContextOption,
  runtimeConfigLoadoutCandidateAssets,
  runtimeConfigRecommendedLoadoutModelAxes,
  summarizeRuntimeConfigRecipeDownloads,
  runtimeConfigLoadoutUpdateModelAxes,
  runtimeConfigLoadoutErrorMessage,
  runtimeConfigTextBehaviorPresentationState,
  RuntimeConfigLoadoutTextBehaviors,
  LoadoutSlotLabel,
} from '../src/shell/renderer/features/runtime-config/runtime-config-page-loadouts.js';
import { initI18n } from '../src/shell/renderer/i18n/index.js';
import {
  createRuntimeConfigLoadoutImpactState,
  type RuntimeConfigLoadoutPendingImpact,
} from '../src/shell/renderer/features/runtime-config/runtime-config-loadout-impact-state.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(testDir, '..', 'src', 'shell', 'renderer');
const localePath = (locale: 'en' | 'zh') => path.join(rendererDir, 'locales', locale, '46-runtimeConfig.json');

(globalThis as { React?: typeof React }).React = React;

function recipeOffer(
  offerRef: string,
  applicability: 'supported' | 'unknown' | 'unsupported' = 'supported',
  installedModelAssetId?: string,
  totalSizeBytes?: number,
) {
  return {
    candidate: {
      offerRef,
      sourceLabel: 'model-index',
      title: offerRef,
      description: '',
      categories: ['image'],
      variantLabel: 'default',
      tags: [],
      verified: true,
      installed: Boolean(installedModelAssetId),
      installable: true,
      ...(totalSizeBytes ? { totalSizeBytes, downloadSizeBytes: totalSizeBytes } : {}),
    },
    applicability,
    reasons: [],
    ...(installedModelAssetId ? { installedModelAssetId } : {}),
  } as const;
}

test('Loadout mutations invalidate App effective projections and one-click selection reads', async () => {
  const pageSource = await readFile(path.join(
    rendererDir,
    'features',
    'runtime-config',
    'runtime-config-page-loadouts.tsx',
  ), 'utf8');
  const selectSource = await readFile(path.join(
    rendererDir,
    'features',
    'runtime-config',
    'runtime-config-select-loadout.ts',
  ), 'utf8');
  assert.match(selectSource, /invalidateQueries\(\{ queryKey: \['app-ai-config'\] \}\)/u);
  assert.match(selectSource, /invalidateQueries\(\{ queryKey: \['desktop', 'machine-local-ai-config-selections'\] \}\)/u);
  assert.match(pageSource, /invalidateDesktopLoadoutQueries\(queryClient\)/u);
  assert.match(pageSource, /await refresh\(\);\s*refreshAIConfigProjections\(\);/u);
});

test('Loadout slot incompatibility preserves the Runtime typed reason', () => {
  const error = createNimiError({
    message: 'Loadout is not fully configured against current ModelAsset content',
    reasonCode: 'AI_LOADOUT_MODEL_CONTRACT_FAILED',
  });
  assert.equal(
    runtimeConfigLoadoutErrorMessage(error),
    'AI_LOADOUT_MODEL_CONTRACT_FAILED: Loadout is not fully configured against current ModelAsset content',
  );
});

test('Loadout errors do not infer a reason code from display copy', () => {
  const untyped = new Error('copied failure detail') as Error & { reasonCode?: string };
  untyped.reasonCode = 'AI_LOADOUT_MODEL_CONTRACT_FAILED';
  assert.equal(
    runtimeConfigLoadoutErrorMessage(untyped),
    'copied failure detail',
  );
});

test('Loadout presentation uses typed capability labels and Runtime catalog titles', () => {
  assert.equal(loadoutCapabilityLabelKey('text.generate'), 'runtimeConfig.loadouts.capability.textGenerate');
  assert.equal(loadoutCapabilityLabelKey('voice.create'), 'runtimeConfig.loadouts.capability.voiceCreate');
  assert.equal(loadoutCapabilityLabelKey('music.generate'), 'runtimeConfig.loadouts.capability.musicGenerate');
  assert.equal(loadoutCapabilityLabelKey('audio.voice.convert'), 'runtimeConfig.loadouts.capability.audioVoiceConvert');
  assert.equal(loadoutCapabilityLabelKey('text.decide'), 'runtimeConfig.loadouts.capability.textDecide');
  assert.equal(loadoutCapabilityLabelKey('future.capability'), 'runtimeConfig.loadouts.capability.other');

  const asset = {
    modelAssetId: 'model_internal',
    contentId: `sha256:${'f'.repeat(64)}`,
    displayName: 'local.chat.internal-id',
    entry: 'model.gguf',
  } as NimiRuntimeModelAssetRecord;
  assert.equal(loadoutAssetLabel(asset, [{
    contentId: asset.contentId,
    title: 'Gemma 4 E2B (Q5_K_M)',
  }] as never), 'Gemma 4 E2B (Q5_K_M)');
});

test('Loadout card and manage view present canonical text behavior truth without adapter or release claims', async () => {
  assert.equal(runtimeConfigTextBehaviorPresentationState({
    implementationSupported: true,
    configurationState: 'configured',
  }), 'configured');
  assert.equal(runtimeConfigTextBehaviorPresentationState({
    implementationSupported: true,
    configurationState: 'unavailable',
  }), 'implementation-supported');
  assert.equal(runtimeConfigTextBehaviorPresentationState({
    implementationSupported: true,
    configurationState: 'ambiguous',
  }), 'unavailable');
  assert.equal(runtimeConfigTextBehaviorPresentationState({
    implementationSupported: false,
    configurationState: 'configured',
  }), 'unavailable');

  await initI18n();
  for (const compact of [false, true]) {
    const markup = renderToStaticMarkup(React.createElement(RuntimeConfigLoadoutTextBehaviors, {
      loadoutId: 'loadout-test',
      compact,
      behaviors: [
        { kind: 'tool-use', implementationSupported: true, configurationState: 'configured', reasons: [] },
        { kind: 'reasoning', implementationSupported: true, configurationState: 'unavailable', reasons: ['LOCAL_TEXT_BEHAVIOR_UNAVAILABLE'] },
        { kind: 'structured-output', implementationSupported: false, configurationState: 'configured', reasons: ['LOCAL_IMPLEMENTATION_UNSUPPORTED'] },
      ],
    }));
    assert.match(markup, /data-state="configured"/u);
    assert.match(markup, /data-state="implementation-supported"/u);
    assert.match(markup, /data-state="unavailable"/u);
    assert.ok(markup.includes('LOCAL_TEXT_BEHAVIOR_UNAVAILABLE'));
    assert.ok(markup.includes('LOCAL_IMPLEMENTATION_UNSUPPORTED'));
    assert.doesNotMatch(markup, /adapterId|releaseVerified|releaseVerification/u);
  }

  for (const locale of ['en', 'zh'] as const) {
    const document = JSON.parse(await readFile(localePath(locale), 'utf8')) as {
      loadouts: {
        textBehaviors: {
          kind: Record<string, string>;
          state: Record<string, string>;
          typedReasons: string;
        };
      };
    };
    assert.deepEqual(Object.keys(document.loadouts.textBehaviors.kind).sort(), [
      'reasoning',
      'structured-output',
      'tool-use',
    ]);
    assert.deepEqual(Object.keys(document.loadouts.textBehaviors.state).sort(), [
      'configured',
      'implementation-supported',
      'model-unsupported',
      'unavailable',
    ]);
    assert.ok(document.loadouts.textBehaviors.typedReasons);
  }
});

test('Runtime recommendations order installed choices without excluding custom models', () => {
  const recommendedContentId = `sha256:${'a'.repeat(64)}`;
  const customContentId = `sha256:${'b'.repeat(64)}`;
  const unrelatedContentId = `sha256:${'c'.repeat(64)}`;
  const recommended = { modelAssetId: 'recommended', contentId: recommendedContentId } as NimiRuntimeModelAssetRecord;
  const currentCustom = { modelAssetId: 'current-custom', contentId: customContentId } as NimiRuntimeModelAssetRecord;
  const unrelated = { modelAssetId: 'unrelated', contentId: unrelatedContentId } as NimiRuntimeModelAssetRecord;
  const slot = { recommendedContentIds: [recommendedContentId], offers: [] };

  assert.deepEqual(
    runtimeConfigLoadoutCandidateAssets({ recommendedContentIds: [], offers: [
      recipeOffer('current-custom', 'unknown', currentCustom.modelAssetId),
      recipeOffer('unrelated', 'unsupported', unrelated.modelAssetId),
    ] }, [unrelated, currentCustom]).map(asset => asset.modelAssetId),
    ['current-custom', 'unrelated'],
  );

  assert.deepEqual(
    runtimeConfigLoadoutCandidateAssets(slot, [recommended, currentCustom, unrelated]).map((asset) => asset.modelAssetId),
    ['recommended', 'current-custom', 'unrelated'],
  );
  assert.deepEqual(
    runtimeConfigLoadoutCandidateAssets(slot, [recommended, currentCustom, unrelated], {
      modelAssetId: currentCustom.modelAssetId,
      recipeCompatible: true,
    }).map((asset) => asset.modelAssetId),
    ['recommended', 'current-custom', 'unrelated'],
  );
  assert.deepEqual(
    runtimeConfigLoadoutCandidateAssets(undefined, [recommended, currentCustom, unrelated], {
      modelAssetId: currentCustom.modelAssetId,
      recipeCompatible: false,
    }),
    [],
  );
});

test('Loadout candidates prioritize an installed Runtime offer without hiding other assets', () => {
  const installed = { modelAssetId: 'market-installed', contentId: `sha256:${'d'.repeat(64)}` } as NimiRuntimeModelAssetRecord;
  const unrelated = { modelAssetId: 'unrelated', contentId: `sha256:${'e'.repeat(64)}` } as NimiRuntimeModelAssetRecord;
  const slot = {
    recommendedContentIds: [`sha256:${'a'.repeat(64)}`],
    offers: [recipeOffer('offer:text-variant', 'supported', installed.modelAssetId)],
  };
  assert.deepEqual(runtimeConfigLoadoutCandidateAssets(slot, [unrelated, installed]), [installed, unrelated]);
});

test('Recipe template grouping preserves multiple image plans in canonical order', () => {
  const recipe = (recipeId: string, applicability: NimiLoadoutRecipe['applicability']) => ({
    recipeId,
    revision: '1',
    title: recipeId,
    capabilityContract: 'image.generate',
    implementation: { implementationId: 'local.image', driverId: 'driver.image', driverDialect: 'image/v1' },
    defaultOptions: {},
    recommendedOptions: {},
    implementationSupportedFeatures: [],
    applicability,
    reasons: [],
    slots: [],
  }) as NimiLoadoutRecipe;
  const first = recipe('image.plan.first', 'supported');
  const second = recipe('image.plan.second', 'supported');
  const unknown = recipe('image.plan.unknown', 'unknown');

  const grouped = partitionRuntimeConfigRecipeTemplates([first, second, unknown]);
  assert.deepEqual(grouped.supported.map((item) => item.recipeId), ['image.plan.first', 'image.plan.second']);
  assert.deepEqual(grouped.unknown.map((item) => item.recipeId), ['image.plan.unknown']);
});

test('Recipe download estimate uses the first admissible offer per missing required slot', () => {
  const candidate = (offerRef: string, totalSizeBytes?: number, downloadSizeBytes = totalSizeBytes) => ({
    candidate: {
      offerRef,
      sourceLabel: 'model-index',
      title: offerRef,
      description: '',
      categories: ['image'],
      variantLabel: 'default',
      tags: [],
      verified: true,
      installed: false,
      installable: true,
      ...(totalSizeBytes ? { totalSizeBytes } : {}),
      ...(downloadSizeBytes ? { downloadSizeBytes } : {}),
    },
    applicability: 'supported' as const,
    reasons: [],
  });
  const recipe = {
    slots: [
      { presence: 'required', offers: [candidate('main', 100)] },
      { presence: 'required', offers: [candidate('companion', 50)] },
    ],
  } as unknown as NimiLoadoutRecipe;

  assert.deepEqual(summarizeRuntimeConfigRecipeDownloads(recipe), { count: 2, totalSizeBytes: 150 });
  const unknown = {
    ...recipe,
    slots: [...recipe.slots, { presence: 'required', offers: [candidate('unknown')] }],
  } as unknown as NimiLoadoutRecipe;
  assert.deepEqual(summarizeRuntimeConfigRecipeDownloads(unknown), { count: 3, totalSizeBytes: null });
  // An archive offer downloads its archive, not its installed total.
  const archive = { slots: [{ presence: 'required', offers: [candidate('archive', 100, 60)] }] } as unknown as NimiLoadoutRecipe;
  assert.deepEqual(summarizeRuntimeConfigRecipeDownloads(archive), { count: 1, totalSizeBytes: 60 });
});

test('recommended Loadout install resolves the exact offer then updates the unresolved slot', async () => {
  const contentId = `sha256:${'e'.repeat(64)}`;
  const offer = recipeOffer('offer:text', 'supported', undefined, 1024);
  const recipe = {
    recipeId: 'text.recommended',
    revision: '1',
    title: 'Text recommended',
    capabilityContract: 'text.generate',
    implementation: { implementationId: 'local.text', driverId: 'driver.text', driverDialect: 'text/v1' },
    defaultOptions: {},
    recommendedOptions: {},
    implementationSupportedFeatures: [],
    applicability: 'supported',
    reasons: [],
    slots: [{
      slotId: 'model', displayLabel: 'Model',
      recommendedContentIds: [contentId], recommendedVariantIds: ['variant:text'],
      offers: [offer], applicability: 'supported', reasons: [],
      modelContract: {}, presence: 'required', conditionalFeatures: [],
    }],
  } as unknown as NimiLoadoutRecipe;
  const loadout = {
    loadoutId: 'loadout-text',
    capabilityContract: 'text.generate',
    recipeId: recipe.recipeId,
    options: {},
    displayName: 'Text use',
    provenance: {},
    modelAxes: [{ slotId: 'model', modelAssetId: '', expectedContentId: contentId }],
  } as unknown as NimiMachineLoadout;
  const installed = { modelAssetId: 'asset-text', contentId } as NimiRuntimeModelAssetRecord;
  const updates: unknown[] = [];
  const items = recommendedInstallItems(recipe);

  await installAndBindRuntimeConfigRecommendedLoadout({
    items,
    recipe,
    loadout,
    assets: [],
    async installOffer(offerRef) {
      assert.equal(offerRef, 'offer:text');
      return installed;
    },
    async updateLoadout(next) { updates.push(next); },
  });

  assert.deepEqual((updates[0] as { modelAxes: unknown }).modelAxes, [
    { slotId: 'model', modelAssetId: installed.modelAssetId, expectedContentId: contentId },
  ]);
  assert.match(recommendedInstallMessage(items, {
    heading: 'Download models', installed: 'installed', download: 'download', total: 'Total', unknownSize: 'unknown',
  }), /Total: 1\.0 KB/u);
});

test('optional-conditional slots stay absent until explicitly bound and can be cleared', () => {
  const mainContentId = `sha256:${'d'.repeat(64)}`;
  const projectorContentId = `sha256:${'e'.repeat(64)}`;
  const assets = [
    { modelAssetId: 'main', contentId: mainContentId },
    { modelAssetId: 'projector', contentId: projectorContentId },
  ] as NimiRuntimeModelAssetRecord[];
  const absent = {
    modelAxes: [
      { slotId: 'main.gguf', displayLabel: 'Main', modelAssetId: '', expectedContentId: mainContentId, recipeCompatible: false, reasons: [], presence: 'required', conditionalFeatures: [], resolution: 'unresolved' },
      { slotId: 'companion.mmproj', displayLabel: 'Projector', modelAssetId: '', expectedContentId: '', recipeCompatible: true, reasons: [], presence: 'optional-conditional', conditionalFeatures: ['input.image'], resolution: 'not-configured' },
    ],
  } satisfies Pick<NimiMachineLoadout, 'modelAxes'>;

  const bound = {
    modelAxes: [
      { ...absent.modelAxes[0]!, modelAssetId: 'main', recipeCompatible: true, resolution: 'configured' as const },
      { ...absent.modelAxes[1]!, modelAssetId: 'projector', expectedContentId: projectorContentId, recipeCompatible: true, resolution: 'configured' as const },
    ],
  } satisfies Pick<NimiMachineLoadout, 'modelAxes'>;
  assert.deepEqual(runtimeConfigLoadoutUpdateModelAxes(bound, {}, assets, 'companion.mmproj', ''), [
    { slotId: 'main.gguf', modelAssetId: 'main', expectedContentId: mainContentId },
  ]);
  assert.deepEqual(runtimeConfigLoadoutUpdateModelAxes(bound, {}, assets, 'main.gguf', ''), [
    { slotId: 'main.gguf', modelAssetId: 'main', expectedContentId: mainContentId },
    { slotId: 'companion.mmproj', modelAssetId: 'projector', expectedContentId: projectorContentId },
  ]);
});

test('NOT_MATCHED ModelAsset axes render catalog_not_matched and never catalog_verified', async () => {
  const asset = {
    modelAssetId: 'model_01m01hsyvsp8gdvh8waz8bn1hp',
    catalogVerification: 'not_matched' as const,
  };
  const badge = runtimeConfigLoadoutCatalogBadge(asset.catalogVerification);
  assert.deepEqual(badge, { label: 'catalog_not_matched', tone: 'warning' });
  assert.deepEqual(runtimeConfigLoadoutCatalogBadge('matched'), { label: 'catalog_verified', tone: 'success' });
  assert.notEqual(runtimeConfigLoadoutCatalogBadge('unknown').label, 'catalog_verified');
  assert.notEqual(runtimeConfigLoadoutCatalogBadge(undefined).label, 'catalog_verified');

  for (const locale of ['en', 'zh'] as const) {
    const document = JSON.parse(await readFile(localePath(locale), 'utf8')) as {
      loadouts: { catalogBadge: Record<string, string> };
    };
    const labels = document.loadouts.catalogBadge;
    assert.ok(labels.catalog_verified && labels.catalog_not_matched && labels.catalog_verification_unknown);
    assert.equal(new Set(Object.values(labels)).size, 3);
  }
});

test('model requirements expose required versus conditional use without depending on a model name', async () => {
  await initI18n();
  const required = renderToStaticMarkup(React.createElement(LoadoutSlotLabel, {
    slot: { displayLabel: 'Primary weights', presence: 'required', conditionalFeatures: [] },
  }));
  const optional = renderToStaticMarkup(React.createElement(LoadoutSlotLabel, {
    slot: { displayLabel: 'Additional input', presence: 'optional-conditional', conditionalFeatures: ['future.input'] },
  }));
  assert.match(required, /data-requirement-presence="required"/u);
  assert.match(optional, /data-requirement-presence="optional-conditional"/u);
  assert.ok(required.includes('Primary weights'));
  assert.ok(optional.includes('Additional input'));
  assert.ok(optional.includes('future.input'));
});

test('selected Loadout axis update keeps an explicit impact confirmation across refetch and dispatches once', async () => {
  let updateCount = 0;
  let refetchCount = 0;
  const impactState = createRuntimeConfigLoadoutImpactState();
  const update: RuntimeConfigLoadoutPendingImpact = {
    kind: 'update',
    title: 'Selected image edit Loadout',
    run: async () => { updateCount += 1; },
  };

  impactState.request(update);
  await Promise.resolve().then(() => { refetchCount += 1; });

  assert.equal(refetchCount, 1);
  assert.equal(impactState.current(), update);
  assert.equal(updateCount, 0);

  const confirmed = impactState.confirm();
  assert.equal(confirmed, update);
  assert.equal(impactState.confirm(), null);
  await confirmed?.run();
  assert.equal(updateCount, 1);
});

test('rapid Loadout updates use one last-write-wins impact slot for cancel and confirm', async () => {
  const impactState = createRuntimeConfigLoadoutImpactState();
  const persisted: string[] = [];
  const first: RuntimeConfigLoadoutPendingImpact = {
    kind: 'update',
    title: 'Selected image edit · first ModelAsset',
    run: async () => { persisted.push('first'); },
  };
  const last: RuntimeConfigLoadoutPendingImpact = {
    kind: 'update',
    title: 'Selected image edit · last ModelAsset',
    run: async () => { persisted.push('last'); },
  };
  const openDialogs = () => {
    const current = impactState.current();
    return current ? [current] : [];
  };

  impactState.request(first);
  impactState.request(last);
  assert.equal(openDialogs().length, 1);
  assert.equal(openDialogs()[0], last);
  assert.equal(openDialogs()[0]?.title, 'Selected image edit · last ModelAsset');

  impactState.cancel();
  assert.equal(openDialogs().length, 0);
  await impactState.confirm()?.run();
  assert.deepEqual(persisted, []);

  impactState.request(first);
  impactState.request(last);
  assert.equal(openDialogs().length, 1);
  const confirmed = impactState.confirm();
  assert.equal(openDialogs().length, 0);
  assert.equal(confirmed, last);
  await confirmed?.run();
  await impactState.confirm()?.run();
  assert.deepEqual(persisted, ['last']);
});

test('recommended installs bind only the confirmed slots and preserve other empty choices', async () => {
  const recommendedContentId = `sha256:${'f'.repeat(64)}`;
  const recipe = {
    slots: [
      { slotId: 'main', displayLabel: 'Main', recommendedContentIds: [recommendedContentId], presence: 'required' },
      { slotId: 'projector', displayLabel: 'Projector', recommendedContentIds: [], presence: 'optional-conditional' },
    ],
  } as unknown as NimiLoadoutRecipe;
  const loadout = {
    modelAxes: [
      { slotId: 'main', modelAssetId: '', expectedContentId: recommendedContentId },
    ],
  } as unknown as Pick<NimiMachineLoadout, 'modelAxes'>;

  // Keep an explicitly empty required slot even with a recommendation in inventory.
  const empty = [{ slotId: 'main', modelAssetId: '', expectedContentId: '' }];
  assert.deepEqual(runtimeConfigRecommendedLoadoutModelAxes(loadout, recipe, []), empty);

  const installed = { modelAssetId: 'asset-main', contentId: recommendedContentId } as NimiRuntimeModelAssetRecord;
  assert.deepEqual(runtimeConfigRecommendedLoadoutModelAxes(loadout, recipe, [installed]), empty);

  // Optional-conditional slots with installed static recommendations (e.g.
  // SDXL ProMax ControlNet) must NOT be auto-bound without explicit confirmation.
  const controlNetContentId = `sha256:${'e'.repeat(64)}`;
  const sdxlRecipe = {
    slots: [
      { slotId: 'main.diffusion', displayLabel: 'Checkpoint', recommendedContentIds: [recommendedContentId], presence: 'required' },
      { slotId: 'companion.controlnet', displayLabel: 'ControlNet', recommendedContentIds: [controlNetContentId], presence: 'optional-conditional' },
    ],
  } as unknown as NimiLoadoutRecipe;
  const sdxlLoadout = {
    loadoutId: 'loadout-sdxl',
    revision: 'rev-7',
    capabilityContract: 'image.generate',
    recipeId: 'sdxl',
    options: {},
    displayName: 'SDXL',
    provenance: {},
    modelAxes: [],
  } as unknown as NimiMachineLoadout;
  const installedControlNet = { modelAssetId: 'asset-promax', contentId: controlNetContentId } as NimiRuntimeModelAssetRecord;
  const installedMain = { modelAssetId: 'asset-sdxl', contentId: recommendedContentId } as NimiRuntimeModelAssetRecord;
  assert.deepEqual(
    runtimeConfigRecommendedLoadoutModelAxes(sdxlLoadout, sdxlRecipe, [installedMain, installedControlNet]),
    [{ slotId: 'main.diffusion', modelAssetId: '', expectedContentId: '' }],
  );
  const updates: Array<Record<string, unknown>> = [];
  await installAndBindRuntimeConfigRecommendedLoadout({
    items: [{
      slotId: 'main.diffusion',
      displayLabel: 'Checkpoint',
      installed: false,
      candidate: { offerRef: 'offer:sdxl', title: 'SDXL', variantLabel: 'fp16', installable: true },
    }] as never,
    recipe: sdxlRecipe,
    loadout: sdxlLoadout,
    assets: [installedControlNet],
    async installOffer() { return installedMain; },
    async updateLoadout(next) { updates.push(next as unknown as Record<string, unknown>); },
  });
  assert.equal(updates[0]?.expectedLoadoutRevision, 'rev-7');
  assert.deepEqual(updates[0]?.modelAxes, [
    { slotId: 'main.diffusion', modelAssetId: 'asset-sdxl', expectedContentId: recommendedContentId },
  ]);
});

test('manual text Loadout create draft preserves r061 catalog fits and never silently drops invalid contextSize', async () => {
  const reducedRecommendedRecipe = {
    capabilityContract: 'text.generate',
    defaultOptions: {},
    recommendedOptions: { contextSize: 90112 },
    slots: [
      {
        slotId: 'main.gguf',
        presence: 'required',
        recommendedContextFit: { authoredContextSize: 131072, recommendedContextSize: 90112, recommendedOptions: { contextSize: 90112 } },
        offers: [
          {
            installedModelAssetId: 'asset-reduced',
            contextFit: { authoredContextSize: 131072, recommendedContextSize: 16384, recommendedOptions: { contextSize: 16384 } },
          },
          {
            installedModelAssetId: 'asset-full-fit',
            contextFit: { authoredContextSize: 32768, recommendedContextSize: 32768, recommendedOptions: {} },
          },
        ],
      },
    ],
  } as unknown as NimiLoadoutRecipe;
  const fullRecommendedRecipe = {
    capabilityContract: 'text.generate',
    defaultOptions: {},
    recommendedOptions: {},
    slots: [
      {
        slotId: 'main.gguf',
        presence: 'required',
        recommendedContextFit: { authoredContextSize: 131072, recommendedContextSize: 131072, recommendedOptions: {} },
        offers: [],
      },
    ],
  } as unknown as NimiLoadoutRecipe;

  // Empty-store recommended install preserves r061 recommendedContextFit.
  const unified: NimiLoadoutRecipe = { ...reducedRecommendedRecipe,
    implementation: { ...reducedRecommendedRecipe.implementation, driverId: 'nimi.runtime.driver.llama-cpp' },
    defaultOptions: { gpuLayers: 99, contextSize: 8192 } };
  const manual = resolveLoadoutCreateContextOption(unified, { 'main.gguf': 'manual' });
  assert.deepEqual(buildLoadoutCreateOptions(unified, manual), { gpuLayers: 99, contextSize: 8192 });
  assert.deepEqual(buildLoadoutCreateOptions(unified, ''), { gpuLayers: 99 });
  assert.equal(resolveLoadoutCreateContextOption(reducedRecommendedRecipe, {}), '90112');
  assert.equal(resolveLoadoutCreateContextOption(fullRecommendedRecipe, {}), '');
  // An imported model with no offer uses its native limit, even if below 8192.
  const manualContext = resolveLoadoutCreateContextOption(reducedRecommendedRecipe, { 'main.gguf': 'asset-manual-4k' });
  assert.equal(manualContext, '');
  assert.deepEqual(buildLoadoutCreateOptions(reducedRecommendedRecipe, manualContext), {});
  // Positive integers below 256 (e.g. 128) are honored explicitly rather than silently dropped to native context.
  assert.deepEqual(parseLoadoutCreateContextOption('128'), { valid: true, contextSize: 128 });
  assert.deepEqual(buildLoadoutCreateOptions(reducedRecommendedRecipe, '128'), { contextSize: 128 });
  // Clearing the field exclusively means automatic (omit contextSize).
  assert.deepEqual(parseLoadoutCreateContextOption(''), { valid: true });
  assert.deepEqual(buildLoadoutCreateOptions(reducedRecommendedRecipe, ''), {});
  // Non-empty invalid inputs fail validation instead of silently falling back to native context.
  for (const bad of ['0', '-128', 'abc', '12.5', '08192']) {
    assert.deepEqual(parseLoadoutCreateContextOption(bad), { valid: false });
    assert.throws(() => buildLoadoutCreateOptions(reducedRecommendedRecipe, bad));
  }
  // Catalog offer with reduced r061 fit pre-fills that reduced size; full-fit offer keeps automatic (empty).
  assert.equal(resolveLoadoutCreateContextOption(reducedRecommendedRecipe, { 'main.gguf': 'asset-reduced' }), '16384');
  assert.equal(resolveLoadoutCreateContextOption(reducedRecommendedRecipe, { 'main.gguf': 'asset-full-fit' }), '');

  // Create flow must bind pending recommended install to the exact committed Loadout return value (no re-query race).
  const source = await readFile(path.join(rendererDir, 'features', 'runtime-config', 'runtime-config-page-loadouts.tsx'), 'utf8');
  assert.match(source, /const created = await loadoutsClient\.commit\(prepared\.prepareId, false\);/u);
  assert.doesNotMatch(source, /matches\[matches\.length - 1\]/u);
});

test('Loadout axis update omits unresolved axes and preserves inventory-missing sibling bindings', () => {
  const currentContentId = `sha256:${'a'.repeat(64)}`;
  const nextContentId = `sha256:${'b'.repeat(64)}`;
  const unresolvedContentId = `sha256:${'c'.repeat(64)}`;
  const staleContentId = `sha256:${'d'.repeat(64)}`;
  const loadout = {
    modelAxes: [
      { slotId: 'main', displayLabel: 'Main', modelAssetId: 'asset-current', expectedContentId: currentContentId, recipeCompatible: true, reasons: [], presence: 'required', conditionalFeatures: [], resolution: 'configured' },
      { slotId: 'companion', displayLabel: 'Companion', modelAssetId: '', expectedContentId: unresolvedContentId, recipeCompatible: false, reasons: [], presence: 'required', conditionalFeatures: [], resolution: 'unresolved' },
      { slotId: 'custom', displayLabel: 'Custom', modelAssetId: 'asset-stale', expectedContentId: staleContentId, recipeCompatible: true, reasons: [], presence: 'required', conditionalFeatures: [], resolution: 'configured' },
    ],
  } satisfies Pick<NimiMachineLoadout, 'modelAxes'>;
  const assets = [{ modelAssetId: 'asset-next', contentId: nextContentId }] as NimiRuntimeModelAssetRecord[];

  // Runtime rejects a half-bound axis (expectedContentId without
  // modelAssetId) and silently auto-fills an omitted required slot when a
  // unique recommended asset is installed (service_loadout.go:774). Send an
  // explicit empty axis so the unresolved companion slot stays unresolved.
  assert.deepEqual(
    runtimeConfigLoadoutUpdateModelAxes(loadout, {}, assets, 'main', 'asset-next'),
    [
      { slotId: 'main', modelAssetId: 'asset-next', expectedContentId: nextContentId },
      { slotId: 'companion', modelAssetId: '', expectedContentId: '' },
      { slotId: 'custom', modelAssetId: 'asset-stale', expectedContentId: staleContentId },
    ],
  );
});

test('commitExistingLoadoutSelection sends expectNoPriorSelection or expectedSelectionRevision and returns conflict on applied: false', async () => {
  const { commitExistingLoadoutSelection } = await import(
    '../src/shell/renderer/features/runtime-config/runtime-config-select-loadout.js'
  );
  const calls: Array<Record<string, unknown>> = [];
  const invalidated: unknown[] = [];
  const loadout = {
    loadoutId: 'loadout-1',
    capabilityContract: 'text.generate',
    revision: 'rev-1',
  } as NimiMachineLoadout;
  const queryClient = {
    invalidateQueries: async (filter: unknown) => { invalidated.push(filter); },
  } as never;

  const conflict = await commitExistingLoadoutSelection({
    loadout,
    aggregate: { loadouts: [loadout], selections: [], selectionRevisions: {} } as never,
    selectLoadout: async (capabilityContract, loadoutId, confirmed, options) => {
      calls.push({ capabilityContract, loadoutId, confirmed, ...(options as Record<string, unknown>) });
      return { applied: false, reasonCode: 'AI_LOADOUT_CONDITION_CONFLICT', selectionRevision: 'rev-other' } as never;
    },
    queryClient,
  });
  assert.equal(conflict.status, 'conflict');
  assert.deepEqual(calls[0], {
    capabilityContract: 'text.generate',
    loadoutId: 'loadout-1',
    confirmed: true,
    expectedCandidateRevision: 'rev-1',
    expectNoPriorSelection: true,
  });
  assert.equal(invalidated.length, 4);

  const selected = await commitExistingLoadoutSelection({
    loadout,
    aggregate: { loadouts: [loadout], selections: [], selectionRevisions: { 'text.generate': 'sel-2' } } as never,
    selectLoadout: async (capabilityContract, loadoutId, confirmed, options) => {
      calls.push({ capabilityContract, loadoutId, confirmed, ...(options as Record<string, unknown>) });
      return { applied: true, selectionRevision: 'sel-3' } as never;
    },
    queryClient,
  });
  assert.equal(selected.status, 'selected');
  assert.deepEqual(calls[1], {
    capabilityContract: 'text.generate',
    loadoutId: 'loadout-1',
    confirmed: true,
    expectedCandidateRevision: 'rev-1',
    expectedSelectionRevision: 'sel-2',
  });
});
