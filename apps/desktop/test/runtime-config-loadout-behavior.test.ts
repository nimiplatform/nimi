import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type {
  NimiLoadoutRecipe,
  NimiMachineLoadout,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { createNimiError } from '@nimiplatform/sdk/types';
import { runtimeConfigLoadoutCatalogBadge } from '../src/shell/renderer/features/runtime-config/runtime-config-loadout-catalog-badge.js';
import {
  installAndBindRuntimeConfigRecommendedLoadout,
  loadoutAssetLabel,
  loadoutCapabilityLabelKey,
  partitionRuntimeConfigRecipeTemplates,
  recommendedInstallItems,
  recommendedInstallMessage,
  runtimeConfigLoadoutCandidateAssets,
  summarizeRuntimeConfigRecipeDownloads,
  runtimeConfigLoadoutUpdateModelAxes,
  runtimeConfigLoadoutErrorMessage,
  runtimeConfigTextBehaviorPresentationState,
} from '../src/shell/renderer/features/runtime-config/runtime-config-page-loadouts.js';
import {
  createRuntimeConfigLoadoutImpactState,
  type RuntimeConfigLoadoutPendingImpact,
} from '../src/shell/renderer/features/runtime-config/runtime-config-loadout-impact-state.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(testDir, '..', 'src', 'shell', 'renderer');
const localePath = (locale: 'en' | 'zh') => path.join(rendererDir, 'locales', locale, '46-runtimeConfig.json');

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
      ...(totalSizeBytes ? { totalSizeBytes } : {}),
    },
    applicability,
    reasons: [],
    ...(installedModelAssetId ? { installedModelAssetId } : {}),
  } as const;
}

test('Loadout mutations invalidate App effective projections and one-click selection reads', async () => {
  const source = await readFile(path.join(
    rendererDir,
    'features',
    'runtime-config',
    'runtime-config-page-loadouts.tsx',
  ), 'utf8');
  assert.match(source, /invalidateQueries\(\{ queryKey: \['app-ai-config'\] \}\)/u);
  assert.match(source, /invalidateQueries\(\{ queryKey: \['desktop', 'machine-local-ai-config-selections'\] \}\)/u);
  assert.match(source, /await refresh\(\);\s*refreshAIConfigProjections\(\);/u);
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

  const source = await readFile(path.join(
    rendererDir,
    'features',
    'runtime-config',
    'runtime-config-page-loadouts.tsx',
  ), 'utf8');
  assert.equal((source.match(/<RuntimeConfigLoadoutTextBehaviors/gu) ?? []).length, 2);
  assert.match(source, /behavior\.reasons\.join\(' · '\)/u);
  assert.doesNotMatch(source, /adapter(?:Id|Count)|releaseVerified|releaseVerification/u);

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
      'unavailable',
    ]);
    assert.ok(document.loadouts.textBehaviors.typedReasons);
  }
});

test('Desktop only presents bounded Runtime-projected per-slot candidates', () => {
  const recommendedContentId = `sha256:${'a'.repeat(64)}`;
  const customContentId = `sha256:${'b'.repeat(64)}`;
  const unrelatedContentId = `sha256:${'c'.repeat(64)}`;
  const recommended = { modelAssetId: 'recommended', contentId: recommendedContentId } as NimiRuntimeModelAssetRecord;
  const currentCustom = { modelAssetId: 'current-custom', contentId: customContentId } as NimiRuntimeModelAssetRecord;
  const unrelated = { modelAssetId: 'unrelated', contentId: unrelatedContentId } as NimiRuntimeModelAssetRecord;
  const slot = { recommendedContentIds: [recommendedContentId] };

  assert.deepEqual(
    runtimeConfigLoadoutCandidateAssets(slot, [recommended, currentCustom, unrelated]).map((asset) => asset.modelAssetId),
    ['recommended'],
  );
  assert.deepEqual(
    runtimeConfigLoadoutCandidateAssets(slot, [recommended, currentCustom, unrelated], {
      modelAssetId: currentCustom.modelAssetId,
      recipeCompatible: true,
    }).map((asset) => asset.modelAssetId),
    ['recommended', 'current-custom'],
  );
  assert.deepEqual(
    runtimeConfigLoadoutCandidateAssets(undefined, [recommended, currentCustom, unrelated], {
      modelAssetId: currentCustom.modelAssetId,
      recipeCompatible: false,
    }),
    [],
  );
});

test('Recipe template grouping preserves multiple image plans in canonical order', () => {
  const recipe = (recipeId: string, applicability: NimiLoadoutRecipe['applicability']) => ({
    recipeId,
    revision: '1',
    title: recipeId,
    capabilityContract: 'image.generate',
    implementation: { implementationId: 'local.image', driverId: 'driver.image', driverDialect: 'image/v1' },
    defaultOptions: {},
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
  const candidate = (offerRef: string, totalSizeBytes?: number) => ({
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
    assert.equal(document.loadouts.catalogBadge.catalog_not_matched, 'catalog_not_matched');
  }
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

test('Loadout axis update preserves unresolved and inventory-missing sibling intent', () => {
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

  assert.deepEqual(
    runtimeConfigLoadoutUpdateModelAxes(loadout, {}, assets, 'main', 'asset-next'),
    [
      { slotId: 'main', modelAssetId: 'asset-next', expectedContentId: nextContentId },
      { slotId: 'companion', expectedContentId: unresolvedContentId },
      { slotId: 'custom', modelAssetId: 'asset-stale', expectedContentId: staleContentId },
    ],
  );
});
