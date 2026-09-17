import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';

import type {
  NimiLoadoutRecipe,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import {
  groupLoadoutModelPresentations,
  loadoutCandidatePresentation,
  loadoutModelPresentation,
  loadoutQuantPresentation,
  loadoutSlotLabelKey,
  partitionLoadoutSlotOffers,
} from '../src/shell/renderer/features/runtime-config/runtime-config-loadout-model-display.js';
import {
  LoadoutSelectedModelCard,
} from '../src/shell/renderer/features/runtime-config/runtime-config-loadout-model-picker.js';
import {
  resolveLoadoutReturnedDraftAxes,
} from '../src/shell/renderer/features/runtime-config/runtime-config-page-loadouts.js';
import { initI18n } from '../src/shell/renderer/i18n/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.join(testDir, '..', 'src', 'shell', 'renderer');
const localePath = (locale: 'en' | 'zh') => path.join(rendererDir, 'locales', locale, '46-runtimeConfig.json');

(globalThis as { React?: typeof React }).React = React;

type TestOffer = NimiLoadoutRecipe['slots'][number]['offers'][number];

function marketOffer(
  offerRef: string,
  title: string,
  variantLabel: string,
  options: {
    applicability?: 'supported' | 'unknown' | 'unsupported';
    installedModelAssetId?: string;
    installable?: boolean;
    totalSizeBytes?: number;
  } = {},
): TestOffer {
  return {
    candidate: {
      offerRef,
      sourceLabel: 'model-index',
      title,
      description: '',
      categories: ['chat'],
      variantLabel,
      tags: [],
      verified: true,
      installed: Boolean(options.installedModelAssetId),
      installable: options.installable ?? true,
      ...(options.totalSizeBytes ? { totalSizeBytes: options.totalSizeBytes } : {}),
    },
    applicability: options.applicability ?? 'supported',
    reasons: [],
    ...(options.installedModelAssetId ? { installedModelAssetId: options.installedModelAssetId } : {}),
  };
}

test('quant presentation maps technical names to short labels and semantics', () => {
  assert.deepEqual(loadoutQuantPresentation('Q3_K_M'), {
    technical: 'Q3_K_M', short: 'Q3', tier: 3, semantic: 'spaceSaving',
  });
  assert.deepEqual(loadoutQuantPresentation('Q4_K_M'), {
    technical: 'Q4_K_M', short: 'Q4', tier: 4, semantic: 'lightweight',
  });
  assert.deepEqual(loadoutQuantPresentation('Q5_K_M'), {
    technical: 'Q5_K_M', short: 'Q5', tier: 5, semantic: 'balanced',
  });
  assert.deepEqual(loadoutQuantPresentation('Q6_K'), {
    technical: 'Q6_K', short: 'Q6', tier: 6, semantic: 'highQuality',
  });
  assert.deepEqual(loadoutQuantPresentation('Q8_0'), {
    technical: 'Q8_0', short: 'Q8', tier: 8, semantic: 'maxQuality',
  });
  assert.deepEqual(loadoutQuantPresentation('F16'), {
    technical: 'F16', short: 'F16', tier: 16, semantic: null,
  });
  assert.deepEqual(loadoutQuantPresentation('not-a-quant'), {
    technical: '', short: '', tier: 0, semantic: null,
  });
});

test('model presentation uses product naming instead of runtime ids and file names', () => {
  const q8 = loadoutCandidatePresentation({
    title: 'gemma-4-e2b-it-local (Q8_0)',
    variantLabel: 'gemma-4-E2B-it-Q8_0.gguf',
  });
  assert.equal(q8.family, 'Gemma 4');
  assert.equal(q8.sizeLabel, '2B');
  assert.equal(q8.headline, 'Gemma 4 2B · Q8');
  assert.equal(q8.quant.technical, 'Q8_0');
  assert.equal(q8.rawLabel, 'gemma-4-e2b-it-local (Q8_0)');
  assert.equal(q8.rawBase, 'gemma-4-e2b-it-local');

  const large = loadoutCandidatePresentation({
    title: 'gemma-4-26b-a4b-it-local (Q4_K_M)',
    variantLabel: 'gemma-4-26B-A4B-it-UD-Q4_K_M.gguf',
  });
  assert.equal(large.headline, 'Gemma 4 26B · Q4');
  assert.equal(large.sizeSort, 26);

  const fromFilename = loadoutModelPresentation({
    title: 'gemma-4-e2b-it-local',
    variantLabel: 'gemma-4-E2B-it-Q3_K_M.gguf',
  });
  assert.equal(fromFilename.headline, 'Gemma 4 2B · Q3');
  assert.equal(fromFilename.quant.technical, 'Q3_K_M');

  const projector = loadoutCandidatePresentation({
    title: 'gemma-4-e2b-it-mmproj-local (F16)',
    variantLabel: 'mmproj-F16.gguf',
  });
  assert.equal(projector.headline, 'Gemma 4 2B · F16');

  const noQuant = loadoutModelPresentation({ title: 'some-model-7b-local', variantLabel: '' });
  assert.equal(noQuant.headline, 'Some Model 7B');
});

test('model presentation preserves non-quantization catalog annotations', () => {
  const presentation = loadoutModelPresentation({ title: 'Example model (Preview)' });
  assert.equal(presentation.headline, 'Example Model (Preview)');
  assert.equal(presentation.rawBase, 'Example model (Preview)');
  assert.equal(presentation.quant.technical, '');
});

test('installable offers group by model scale and order quant variants within a scale', () => {
  const offers = [
    marketOffer('offer:26b-q8', 'gemma-4-26b-a4b-it-local (Q8_0)', 'gemma-4-26B-A4B-it-Q8_0.gguf'),
    marketOffer('offer:2b-q8', 'gemma-4-e2b-it-local (Q8_0)', 'gemma-4-E2B-it-Q8_0.gguf'),
    marketOffer('offer:2b-q3', 'gemma-4-e2b-it-local (Q3_K_M)', 'gemma-4-E2B-it-Q3_K_M.gguf'),
    marketOffer('offer:26b-q4', 'gemma-4-26b-a4b-it-local (Q4_K_M)', 'gemma-4-26B-A4B-it-UD-Q4_K_M.gguf'),
    marketOffer('offer:2b-q5', 'gemma-4-e2b-it-local (Q5_K_M)', 'gemma-4-E2B-it-Q5_K_M.gguf'),
  ];
  const groups = groupLoadoutModelPresentations(offers, (offer) => loadoutCandidatePresentation(offer.candidate));
  assert.deepEqual(groups.map((group) => group.title), ['Gemma 4 2B', 'Gemma 4 26B']);
  assert.deepEqual(
    groups[0]!.items.map((offer) => offer.candidate.offerRef),
    ['offer:2b-q3', 'offer:2b-q5', 'offer:2b-q8'],
  );
  assert.deepEqual(
    groups[1]!.items.map((offer) => offer.candidate.offerRef),
    ['offer:26b-q4', 'offer:26b-q8'],
  );
});

test('offer partition keeps installed offers out and separates installable from incompatible', () => {
  const partition = partitionLoadoutSlotOffers([
    marketOffer('offer:installed', 'a (Q4_K_M)', 'a-q4.gguf', { installedModelAssetId: 'asset-1' }),
    marketOffer('offer:installable', 'b (Q5_K_M)', 'b-q5.gguf'),
    marketOffer('offer:unknown', 'c (Q6_K)', 'c-q6.gguf', { applicability: 'unknown' }),
    marketOffer('offer:unsupported', 'd (Q8_0)', 'd-q8.gguf', { applicability: 'unsupported' }),
    marketOffer('offer:not-installable', 'e (F16)', 'e-f16.gguf', { installable: false }),
  ]);
  assert.deepEqual(partition.installable.map((offer) => offer.candidate.offerRef), [
    'offer:installable',
    'offer:unknown',
  ]);
  assert.deepEqual(partition.incompatible.map((offer) => offer.candidate.offerRef), [
    'offer:unsupported',
    'offer:not-installable',
  ]);
});

test('slot labels localize known runtime slot ids and fall back otherwise', () => {
  assert.equal(loadoutSlotLabelKey('main.gguf'), 'runtimeConfig.loadouts.slotLabels.mainModel');
  assert.equal(loadoutSlotLabelKey('companion.mmproj'), 'runtimeConfig.loadouts.slotLabels.visionProjector');
  assert.equal(loadoutSlotLabelKey('future.slot'), null);
});

test('returned draft auto-selects the offer installed during the market detour', () => {
  const recipe = {
    slots: [{
      slotId: 'main.gguf',
      offers: [
        marketOffer('offer:q8', 'gemma-4-e2b-it-local (Q8_0)', 'gemma-4-E2B-it-Q8_0.gguf', { installedModelAssetId: 'asset-q8' }),
        marketOffer('offer:q6', 'gemma-4-e2b-it-local (Q6_K)', 'gemma-4-E2B-it-Q6_K.gguf', { installedModelAssetId: 'asset-q6' }),
      ],
    }],
  } as unknown as NimiLoadoutRecipe;

  const axes = resolveLoadoutReturnedDraftAxes(recipe, {
    slotId: 'main.gguf',
    autoSelectOfferRef: 'offer:q6',
    draft: { displayName: 'Setup', modelAssetIds: { 'main.gguf': 'asset-q8', 'companion.mmproj': 'asset-mm' } },
  });
  assert.equal(axes['main.gguf'], 'asset-q6');
  assert.equal(axes['companion.mmproj'], 'asset-mm');

  const noInstallRecipe = {
    slots: [{
      slotId: 'main.gguf',
      offers: [marketOffer('offer:q6', 'gemma-4-e2b-it-local (Q6_K)', 'gemma-4-E2B-it-Q6_K.gguf')],
    }],
  } as unknown as NimiLoadoutRecipe;
  const kept = resolveLoadoutReturnedDraftAxes(noInstallRecipe, {
    slotId: 'main.gguf',
    autoSelectOfferRef: 'offer:q6',
    draft: { displayName: 'Setup', modelAssetIds: { 'main.gguf': 'asset-q8' } },
  });
  assert.equal(kept['main.gguf'], 'asset-q8');

  const withoutOfferRef = resolveLoadoutReturnedDraftAxes(recipe, {
    draft: { displayName: 'Setup', modelAssetIds: { 'main.gguf': 'asset-q8' } },
  });
  assert.equal(withoutOfferRef['main.gguf'], 'asset-q8');
});

test('selected model card presents product naming with technical detail secondary', async () => {
  await initI18n();
  const slot = {
    slotId: 'main.gguf',
    displayLabel: 'Main model',
    offers: [marketOffer('offer:q8', 'gemma-4-e2b-it-local (Q8_0)', 'gemma-4-E2B-it-Q8_0.gguf', {
      installedModelAssetId: 'asset-q8',
      totalSizeBytes: 5048350848,
    })],
  } as unknown as NimiLoadoutRecipe['slots'][number];
  const asset = {
    modelAssetId: 'asset-q8',
    contentId: `sha256:${'0a'.repeat(32)}`,
    displayName: 'gemma-4-e2b-it-local (Q8_0)',
    entry: 'gemma-4-E2B-it-Q8_0.gguf',
    totalSizeBytes: 5048350848,
  } as NimiRuntimeModelAssetRecord;

  const selected = renderToStaticMarkup(React.createElement(LoadoutSelectedModelCard, {
    slot,
    asset,
    verifiedAssets: [],
    onOpenPicker: () => {},
  }));
  assert.match(selected, /data-state="selected"/u);
  assert.ok(selected.includes('Gemma 4 2B · Q8'));
  assert.ok(selected.includes('Q8_0'));
  assert.ok(selected.includes('Installed'));
  assert.ok(selected.includes('Change'));

  const empty = renderToStaticMarkup(React.createElement(LoadoutSelectedModelCard, {
    slot,
    asset: null,
    verifiedAssets: [],
    onOpenPicker: () => {},
  }));
  assert.match(empty, /data-state="empty"/u);
  assert.ok(empty.includes('No model selected'));
  assert.ok(empty.includes('Choose model'));
});

test('model picker locale keys stay in parity and drop the market-task CTA', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const document = JSON.parse(await readFile(localePath(locale), 'utf8')) as {
      loadouts: Record<string, unknown> & {
        slotLabels: Record<string, string>;
        quantSemantic: Record<string, string>;
        picker: Record<string, string>;
      };
    };
    assert.deepEqual(Object.keys(document.loadouts.slotLabels).sort(), [
      'embeddingModel',
      'mainModel',
      'sttModel',
      'textEncoder',
      'ttsModel',
      'vae',
      'visionModel',
      'visionProjector',
      'voiceModel',
    ]);
    assert.deepEqual(Object.keys(document.loadouts.quantSemantic).sort(), [
      'balanced',
      'highQuality',
      'lightweight',
      'maxQuality',
      'spaceSaving',
    ]);
    assert.deepEqual(Object.keys(document.loadouts.picker).sort(), [
      'change',
      'choose',
      'current',
      'inspect',
      'installAndUse',
      'installableSection',
      'installedSection',
      'title',
      'unsupportedToggle',
    ]);
    assert.equal('openMarketOffer' in document.loadouts, false);
  }

  const zh = JSON.parse(await readFile(localePath('zh'), 'utf8')) as {
    loadouts: { slotLabels: Record<string, string>; quantSemantic: Record<string, string>; picker: Record<string, string> };
  };
  assert.equal(zh.loadouts.slotLabels.mainModel, '主模型');
  assert.equal(zh.loadouts.slotLabels.visionProjector, '视觉模型');
  assert.equal(zh.loadouts.quantSemantic.balanced, '均衡');
  assert.equal(zh.loadouts.picker.installAndUse, '安装并使用');
});
