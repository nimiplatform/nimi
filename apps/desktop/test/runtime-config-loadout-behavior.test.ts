import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type {
  NimiLoadoutRecipe,
} from '@nimiplatform/sdk/runtime';
import { runtimeConfigLoadoutCatalogBadge } from '../src/shell/renderer/features/runtime-config/runtime-config-loadout-catalog-badge.js';
import {
  recommendedInstallMessage,
  recommendedInstallItems,
  runtimeConfigLoadoutErrorMessage,
} from '../src/shell/renderer/features/runtime-config/runtime-config-page-loadouts.js';
import {
  createRuntimeConfigLoadoutImpactState,
  type RuntimeConfigLoadoutPendingImpact,
} from '../src/shell/renderer/features/runtime-config/runtime-config-loadout-impact-state.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(testDir, '..', 'src', 'shell', 'renderer');
const localePath = (locale: 'en' | 'zh') => path.join(rendererDir, 'locales', locale, '46-runtimeConfig.json');

test('Loadout slot incompatibility preserves the Runtime typed reason', () => {
  const error = new Error('Loadout is not fully configured against current ModelAsset content');
  (error as Error & { reasonCode: string }).reasonCode = 'AI_LOADOUT_MODEL_CONTRACT_FAILED';
  assert.equal(
    runtimeConfigLoadoutErrorMessage(error),
    'AI_LOADOUT_MODEL_CONTRACT_FAILED: Loadout is not fully configured against current ModelAsset content',
  );
});

test('single-slot recipes render the recommended combination and install entry only with a recommended variant', async () => {
  const singleSlotRecipe: NimiLoadoutRecipe = {
    recipeId: 'local.audio.speech.voxcpm2',
    revision: '1',
    title: 'VoxCPM2',
    capabilityContract: 'audio.speech',
    implementation: {
      implementationId: 'local.audio.speech.voxcpm2',
      driverId: 'nimi.runtime.driver.voxcpm2',
      driverDialect: 'voxcpm2/tts/v1',
    },
    defaultOptions: {},
    supportedFeatures: [],
    slots: [{
      slotId: 'tts.model',
      displayLabel: 'TTS model',
      recommendedContentIds: [`sha256:${'a'.repeat(64)}`],
      recommendedVariantIds: ['local.audio.speech.voxcpm2'],
      modelContract: {},
    }],
  };
  const recommendations = recommendedInstallItems(singleSlotRecipe, [], []);
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0]?.variantId, 'local.audio.speech.voxcpm2');
  assert.equal(recommendations[0]?.installed, false);

  const recipeWithoutRecommendedVariant: NimiLoadoutRecipe = {
    ...singleSlotRecipe,
    recipeId: 'local.audio.speech.custom',
    slots: singleSlotRecipe.slots.map((slot) => ({
      ...slot,
      recommendedVariantIds: [],
    })),
  };
  assert.deepEqual(recommendedInstallItems(recipeWithoutRecommendedVariant, [], []), []);

  const runtimeProjectedRecipe: NimiLoadoutRecipe = {
    ...singleSlotRecipe,
    recipeId: 'local.audio.speech.runtime-projected',
    slots: singleSlotRecipe.slots.map((slot) => ({
      ...slot,
      recommendedVariantIds: ['runtime.projected.variant', 'desktop.must-not-reselect'],
    })),
  };
  assert.equal(
    recommendedInstallItems(runtimeProjectedRecipe, [], [])[0]?.variantId,
    'runtime.projected.variant',
  );

});

test('recommended install confirmation never presents a known subtotal as the total', () => {
  const message = recommendedInstallMessage([
    {
      slotId: 'known',
      displayLabel: 'Known model',
      contentId: `sha256:${'a'.repeat(64)}`,
      variantId: 'known-variant',
      descriptor: { title: 'Known', totalSizeBytes: 1024 },
      installed: false,
    },
    {
      slotId: 'unknown',
      displayLabel: 'Unknown model',
      contentId: `sha256:${'b'.repeat(64)}`,
      variantId: 'unknown-variant',
      installed: false,
    },
  ] as never, 'Install the recommended models');

  assert.match(message, /Unknown model: unknown-variant · unknown size · download/u);
  assert.match(message, /Total download: unknown size/u);
  assert.doesNotMatch(message, /Total download: 1\.0 KB/u);
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
