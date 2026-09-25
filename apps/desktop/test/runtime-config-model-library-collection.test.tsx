import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import { DesktopI18nResourceProvider } from '../src/shell/renderer/i18n/i18n-context';
import { RecommendPage } from '../src/shell/renderer/features/runtime-config/runtime-config-page-recommend';
import type {
  RuntimeConfigModelMarketContext,
  RuntimeConfigPanelControllerModel,
} from '../src/shell/renderer/features/runtime-config/runtime-config-panel-types';
import type {
  NimiLoadoutRecipe,
  NimiRuntimeFeaturedModelAssets,
  NimiRuntimeLocalVerifiedAssetDescriptor,
} from '@nimiplatform/sdk/runtime';
import {
  buildNimiCollection,
  communityFeedCategories,
  initialModelLibraryCategory,
  mergeCommunityFeeds,
  nimiCollectionForCategory,
} from '../src/shell/renderer/features/runtime-config/runtime-config-model-library-collection';
import {
  formatByteRange,
  NimiCollectionDetail,
  NimiCollectionSection,
} from '../src/shell/renderer/features/runtime-config/runtime-config-model-library-collection-view';
import { modelFamilyLogoKey } from '../src/shell/renderer/components/provider-logo-tile';

const GB = 1024 ** 3;

function descriptor(input: {
  readonly templateId: string;
  readonly title: string;
  readonly contentId: string;
  readonly capabilities?: readonly string[];
  readonly logicalModelId?: string;
  readonly entry?: string;
  readonly size?: number;
  readonly artifactRoles?: readonly string[];
}): NimiRuntimeLocalVerifiedAssetDescriptor {
  return {
    artifactRoles: input.artifactRoles ?? [],
    templateId: input.templateId,
    assetId: input.templateId,
    title: input.title,
    description: '',
    kind: 'chat',
    logicalModelId: input.logicalModelId,
    repo: 'example/repo',
    revision: 'rev',
    capabilities: input.capabilities ?? [],
    engine: '',
    entry: input.entry ?? 'model.gguf',
    files: [input.entry ?? 'model.gguf'],
    license: '',
    hashes: {},
    fileCount: 1,
    totalSizeBytes: input.size ?? GB,
    contentId: input.contentId,
    tags: [],
  };
}

function recipe(input: {
  readonly recipeId: string;
  readonly title: string;
  readonly capabilityContract: string;
  readonly slots: readonly {
    readonly slotId: string;
    /** This host's recommended variants. */
    readonly variants: readonly string[];
    /** Every catalog variant the slot offers, projected the way Runtime does. */
    readonly offers?: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
    readonly label?: string;
  }[];
}): NimiLoadoutRecipe {
  return {
    recipeId: input.recipeId,
    revision: '1',
    title: input.title,
    capabilityContract: input.capabilityContract,
    applicability: 'supported',
    reasons: [],
    slots: input.slots.map((slot) => ({
      slotId: slot.slotId,
      displayLabel: slot.label ?? slot.slotId,
      recommendedContentIds: [],
      recommendedVariantIds: slot.variants,
      offers: (slot.offers ?? []).map((offered) => ({
        candidate: { offerRef: `offer:${offered.templateId}`, title: offered.title, variantLabel: offered.entry },
        applicability: 'supported',
        reasons: [],
      })),
      applicability: 'supported',
      reasons: [],
    })),
  } as unknown as NimiLoadoutRecipe;
}

const catalog = [
  descriptor({ templateId: 'chat.gemma-e2b.q4', title: 'gemma-4-e2b-it-local (Q4_K_M)', contentId: 'sha256:e2b-q4', capabilities: ['text.generate'], logicalModelId: 'gemma-4-e2b-it-local', size: 2.9 * GB }),
  descriptor({ templateId: 'chat.gemma-e2b.q8', title: 'gemma-4-e2b-it-local (Q8_0)', contentId: 'sha256:e2b-q8', capabilities: ['text.generate'], logicalModelId: 'gemma-4-e2b-it-local', size: 4.7 * GB }),
  descriptor({ templateId: 'chat.gemma-26b.q4', title: 'gemma-4-26b-a4b-it-local (Q4_K_M)', contentId: 'sha256:26b-q4', capabilities: ['text.generate'], logicalModelId: 'gemma-4-26b-a4b-it-local', size: 15.8 * GB }),
  descriptor({ templateId: 'image.z.q4.cuda', title: 'z-image-turbo-local (Q4_0)', contentId: 'sha256:z-q4', capabilities: ['image.generate'], logicalModelId: 'z-image-turbo-local', size: 3.4 * GB }),
  descriptor({ templateId: 'image.z.q4.metal', title: 'z-image-turbo-local (Q4_0)', contentId: 'sha256:z-q4', capabilities: ['image.generate'], logicalModelId: 'z-image-turbo-local', size: 3.4 * GB }),
  descriptor({ templateId: 'image-vae.z.cuda', title: 'asset-image-vae-z-image-ae-f16-cuda (F16)', contentId: 'sha256:z-vae', size: 0.3 * GB }),
  descriptor({ templateId: 'image-vae.z.metal', title: 'asset-image-vae-z-image-ae-f16-cuda (F16)', contentId: 'sha256:z-vae', size: 0.3 * GB }),
  descriptor({ templateId: 'image.ideogram4', title: 'ideogram4-local (Q4_0)', contentId: 'sha256:ideogram', capabilities: ['image.generate'], logicalModelId: 'ideogram4-local', size: 5.3 * GB }),
  descriptor({ templateId: 'image-textenc.qwen3-vl-8b', title: 'ideogram4-qwen3-vl-8b-encoder-local (Q8_0)', contentId: 'sha256:encoder', capabilities: ['text.generate'], logicalModelId: 'ideogram4-qwen3-vl-8b-encoder-local', size: 8.7 * GB }),
  descriptor({ templateId: 'tts.chatterbox', title: 'chatterbox-audio-cpp-local (Q8_0)', contentId: 'sha256:chatterbox', capabilities: ['audio.synthesize', 'voice.create'], logicalModelId: 'chatterbox-audio-cpp-local', size: 1.9 * GB }),
  descriptor({ templateId: 'stt.whisper', title: 'whisper-large-v3-turbo-local (F16)', contentId: 'sha256:whisper', capabilities: ['audio.transcribe'], logicalModelId: 'whisper-large-v3-turbo-local', size: 1.5 * GB }),
  descriptor({ templateId: 'aux.silero', title: 'asset-silero-vad-onnx (F32)', contentId: 'sha256:silero', size: 2_000_000 }),
  descriptor({ templateId: 'stt.qwen3-asr-1.7b', title: 'qwen3-asr-transformers-1.7b-local (F16)', contentId: 'sha256:asr-17', capabilities: ['audio.transcribe'], logicalModelId: 'qwen3-asr-transformers-1.7b-local', size: 4.1 * GB }),
];

const recipes = [
  recipe({ recipeId: 'gemma', title: 'Gemma 4 text generation', capabilityContract: 'text.generate', slots: [{ slotId: 'main.gguf', variants: ['chat.gemma-e2b.q4', 'chat.gemma-e2b.q8', 'chat.gemma-26b.q4'] }] }),
  recipe({ recipeId: 'z-image', title: 'Z-Image Turbo generation', capabilityContract: 'image.generate', slots: [
    { slotId: 'main.diffusion', variants: ['image.z.q4.cuda', 'image.z.q4.metal'] },
    { slotId: 'companion.vae', variants: ['image-vae.z.cuda', 'image-vae.z.metal'], label: 'VAE' },
  ] }),
  recipe({ recipeId: 'ideogram', title: 'Ideogram4 generation', capabilityContract: 'image.generate', slots: [
    { slotId: 'main.diffusion', variants: ['image.ideogram4'] },
    { slotId: 'companion.text-encoder', variants: ['image-textenc.qwen3-vl-8b'], label: 'Text encoder' },
  ] }),
  recipe({ recipeId: 'chatterbox', title: 'Chatterbox audio.cpp synthesis', capabilityContract: 'audio.synthesize', slots: [{ slotId: 'tts.model', variants: ['tts.chatterbox'] }] }),
  recipe({ recipeId: 'whisper', title: 'Whisper transcription with voice activity detection', capabilityContract: 'audio.transcribe', slots: [
    { slotId: 'stt.model', variants: ['stt.whisper'] },
    { slotId: 'stt.vad', variants: ['aux.silero'], label: 'Voice activity detection model' },
  ] }),
];

test('Nimi collection groups versions by catalog model and collapses equal content', () => {
  const { models } = buildNimiCollection({ catalog, recipes });
  const byTitle = new Map(models.map((item) => [item.title, item]));
  // Both Gemma sizes share one recipe, so each keeps its catalog-derived name.
  assert.deepEqual(byTitle.get('Gemma 4 2B')?.versions.map((version) => version.quantLabel), ['Q4', 'Q8']);
  assert.equal(byTitle.get('Gemma 4 26B')?.versions.length, 1);
  // CUDA and Metal templates with one content are one version that keeps both templates.
  const zImage = byTitle.get('Z-Image Turbo');
  assert.equal(zImage?.versions.length, 1);
  assert.deepEqual(zImage?.versions[0]?.templateIds, ['image.z.q4.cuda', 'image.z.q4.metal']);
  assert.equal(byTitle.get('Chatterbox audio.cpp')?.category, 'voice');
  // A recipe title that is not "<model> <capability noun>" does not name the model.
  assert.equal(byTitle.get('Whisper Large V3 Turbo')?.capability, 'audio.transcribe');
  // A model no recipe recommends still appears under its capability.
  assert.equal(byTitle.get('Qwen3 Asr Transformers 1.7B')?.category, 'voice');
});

test('parts are passive assets or assets recipes use only as companions or for another capability', () => {
  const { models, parts } = buildNimiCollection({ catalog, recipes });
  assert.equal(models.some((item) => item.title.includes('Encoder') || item.title.includes('Vae')), false);
  const vae = parts.find((item) => item.roleLabel === 'VAE');
  assert.equal(vae?.usedBy, 'Z-Image Turbo');
  assert.equal(vae?.category, 'image');
  assert.equal(vae?.roleLabelKey, 'runtimeConfig.loadouts.slotLabels.vae');
  assert.deepEqual(vae?.versions[0]?.templateIds, ['image-vae.z.cuda', 'image-vae.z.metal']);
  // Declares text.generate, but only an image recipe uses it, as its text encoder.
  const encoder = parts.find((item) => item.versions[0]?.contentId === 'sha256:encoder');
  assert.equal(encoder?.usedBy, 'Ideogram4');
  assert.equal(encoder?.category, 'image');
  const vad = parts.find((item) => item.versions[0]?.contentId === 'sha256:silero');
  assert.equal(vad?.roleLabel, 'Voice activity detection model');
  assert.equal(vad?.roleLabelKey, 'runtimeConfig.modelLibrary.collection.roles.voiceActivity');
  assert.equal(vad?.category, 'voice');
});

test('parts name the exact model they serve and fall back to their catalog role', () => {
  const mmproj = descriptor({ templateId: 'aux.gemma-26b.mmproj', title: 'gemma-4-26b-a4b-it-mmproj-local (F16)', contentId: 'sha256:mmproj-26b', entry: 'mmproj-F16.gguf', artifactRoles: ['mmproj'] });
  const unlinkedEncoder = descriptor({ templateId: 'image-textenc.q8', title: 'asset-image-textenc-qwen3-4b-instruct-2507-q4-k-m-cuda (Q8_0)', contentId: 'sha256:textenc-q8', artifactRoles: ['text_encoder'] });
  const gemma = recipe({ recipeId: 'gemma', title: 'Gemma 4 text generation', capabilityContract: 'text.generate', slots: [
    { slotId: 'main.gguf', variants: [], offers: [catalog[0]!, catalog[2]!] },
    { slotId: 'companion.mmproj', variants: [], offers: [mmproj], label: 'Vision projector' },
  ] });
  const { parts } = buildNimiCollection({ catalog: [catalog[0]!, catalog[2]!, mmproj, unlinkedEncoder], recipes: [gemma] });
  const projector = parts.find((item) => item.versions[0]?.contentId === 'sha256:mmproj-26b');
  assert.equal(projector?.usedBy, 'Gemma 4 26B');
  assert.equal(projector?.roleLabelKey, 'runtimeConfig.loadouts.slotLabels.visionProjector');
  const encoder = parts.find((item) => item.versions[0]?.contentId === 'sha256:textenc-q8');
  assert.equal(encoder?.usedBy, '');
  assert.equal(encoder?.roleLabelKey, 'runtimeConfig.loadouts.slotLabels.textEncoder');
  assert.equal(encoder?.category, 'other');
});

test('slot offers link every catalog variant when the host recommends only some', () => {
  const byTemplate = new Map(catalog.map((item) => [item.templateId, item]));
  const pick = (...ids: string[]) => ids.map((id) => byTemplate.get(id)!);
  const video = descriptor({
    templateId: 'video.h3', title: 'minimax-h3-fl2va-local (Q4_K_M)', contentId: 'sha256:h3', capabilities: ['video.generate'], logicalModelId: 'minimax-h3-fl2va-local', entry: 'h3.gguf',
  });
  const videoEncoder = descriptor({
    templateId: 'video-encoder.h3', title: 'minimax-h3-qwen3-vl-32b-encoder-local (Q4_K_M)', contentId: 'sha256:h3-encoder', capabilities: ['text.generate'], logicalModelId: 'minimax-h3-qwen3-vl-32b-encoder-local', entry: 'encoder.gguf',
  });
  const music = descriptor({
    templateId: 'music.yue2', title: 'yue2-audio-cpp-local (Q8_0/F16)', contentId: 'sha256:yue2', capabilities: ['music.generate'], logicalModelId: 'yue2-audio-cpp-local', entry: 'yue2.gguf',
  });
  const hostRecipes = [
    recipe({ recipeId: 'gemma', title: 'Gemma 4 text generation', capabilityContract: 'text.generate', slots: [
      { slotId: 'main.gguf', variants: ['chat.gemma-e2b.q8'], offers: pick('chat.gemma-e2b.q4', 'chat.gemma-e2b.q8', 'chat.gemma-26b.q4') },
    ] }),
    recipe({ recipeId: 'h3', title: 'MiniMax-H3 video generation', capabilityContract: 'video.generate', slots: [
      { slotId: 'diffusion.fl2va', variants: [], offers: [video] },
      { slotId: 'encoder.h3-combined', variants: [], offers: [videoEncoder], label: 'MiniMax-H3 combined Qwen3-VL encoder' },
    ] }),
  ];
  const { models, parts } = buildNimiCollection({ catalog: [...catalog.slice(0, 3), video, videoEncoder, music], recipes: hostRecipes });
  // One recipe offers both Gemma sizes, so neither takes the recipe's name.
  assert.deepEqual(models.filter((item) => item.category === 'chat').map((item) => item.title), ['Gemma 4 2B', 'Gemma 4 26B']);
  assert.equal(models.find((item) => item.category === 'video')?.title, 'MiniMax-H3');
  // The encoder declares text.generate but only the video recipe offers it.
  assert.equal(parts.find((item) => item.versions[0]?.contentId === 'sha256:h3-encoder')?.usedBy, 'MiniMax-H3');
  // Without a recipe the name comes from the catalog id, without its variant annotation.
  assert.equal(models.find((item) => item.category === 'music')?.title, 'Yue2 audio.cpp');
});

test('All lists every model in category order; a category narrows models and parts', () => {
  const collection = buildNimiCollection({ catalog, recipes });
  assert.deepEqual(collection.models.map((item) => item.category), ['chat', 'chat', 'image', 'image', 'voice', 'voice', 'voice']);
  const chat = nimiCollectionForCategory(collection, 'chat');
  assert.deepEqual(chat.models.map((item) => item.title), ['Gemma 4 2B', 'Gemma 4 26B']);
  assert.equal(chat.parts.length, 0);
  assert.equal(nimiCollectionForCategory(collection, 'image').parts.length, 2);
  assert.equal(nimiCollectionForCategory(collection, 'all'), collection);
});

test('categories: capability deep links open their category and only chat, image and video have community picks', () => {
  assert.equal(initialModelLibraryCategory(undefined), 'all');
  assert.equal(initialModelLibraryCategory('text.generate'), 'chat');
  assert.equal(initialModelLibraryCategory('audio.synthesize'), 'voice');
  assert.equal(initialModelLibraryCategory('audio.separate'), 'music');
  assert.equal(initialModelLibraryCategory('text.embed'), 'other');
  assert.deepEqual(communityFeedCategories('all'), ['chat', 'image', 'video']);
  assert.deepEqual(communityFeedCategories('image'), ['image']);
  assert.deepEqual(communityFeedCategories('voice'), []);
});

test('community feeds merge in order, drop repeated offers and keep the weakest source state', () => {
  const candidate = (offerRef: string) => ({ offerRef, title: offerRef }) as NimiRuntimeFeaturedModelAssets['items'][number];
  const merged = mergeCommunityFeeds([
    { source: { availability: 'available', freshness: 'fresh' }, items: [candidate('a'), candidate('b')] },
    { source: { availability: 'available', freshness: 'stale' }, items: [candidate('b'), candidate('c')] },
    { source: { availability: 'unavailable' }, items: [] },
  ]);
  assert.deepEqual(merged.items.map((item) => item.offerRef), ['a', 'b', 'c']);
  assert.equal(merged.source.availability, 'available');
  assert.equal(merged.source.freshness, 'stale');
  assert.equal(mergeCommunityFeeds([{ source: { availability: 'unavailable' }, items: [] }]).source.availability, 'unavailable');
});

test('size ranges share one unit when they can', () => {
  assert.equal(formatByteRange(2.36 * GB, 4.7 * GB), '2.36–4.70 GB');
  assert.equal(formatByteRange(4.7 * GB, 4.7 * GB), '4.70 GB');
  assert.equal(formatByteRange(500 * 1024 * 1024, 2 * GB), '500.0 MB – 2.00 GB');
  assert.equal(formatByteRange(0, 0), '');
});

async function render(node: React.ReactElement) {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

test('model family logos credit the maker named by the model, not the repackaged repo', () => {
  assert.equal(modelFamilyLogoKey('Gemma 4 2B'), 'google-color');
  assert.equal(modelFamilyLogoKey('Qwen3 TTS Base'), 'qwen-color');
  assert.equal(modelFamilyLogoKey('Qwen Image Edit 2511'), 'qwen-color');
  assert.equal(modelFamilyLogoKey('Z-Image Turbo'), 'alibabacloud-color');
  assert.equal(modelFamilyLogoKey('MiniMax-H3'), 'minimax-color');
  assert.equal(modelFamilyLogoKey('GLM-TTS audio.cpp'), 'zhipu-color');
  assert.equal(modelFamilyLogoKey('Fish Audio S2 Pro audio.cpp'), 'fishaudio');
  assert.equal(modelFamilyLogoKey('IndexTTS2 audio.cpp'), 'bilibiliindex');
  assert.equal(modelFamilyLogoKey('VibeVoice audio.cpp'), 'microsoft-color');
  assert.equal(modelFamilyLogoKey('Voxtral Realtime audio.cpp'), 'mistral-color');
  assert.equal(modelFamilyLogoKey('Whisper Large V3 Turbo'), 'openai');
  assert.equal(modelFamilyLogoKey('Parakeet-TDT 0.6B v3 audio.cpp'), 'nvidia-color');
  assert.equal(modelFamilyLogoKey('HTDemucs native source separation'), 'meta-color');
  assert.equal(modelFamilyLogoKey('SenseVoice Small audio.cpp'), 'alibabacloud-color');
  // Families without a bundled mark keep their monogram tile.
  assert.equal(modelFamilyLogoKey('Llama-OuteTTS 1.0 audio.cpp'), null);
  assert.equal(modelFamilyLogoKey('Chatterbox audio.cpp'), null);
  assert.equal(modelFamilyLogoKey('MOSS-TTS-Local audio.cpp'), null);
});

test('the collection section lists model tiles and keeps companion files folded', async () => {
  const collection = buildNimiCollection({ catalog, recipes });
  const markup = await render(<NimiCollectionSection collection={collection} loading={false} failed={false} onOpen={() => {}} />);
  assert.match(markup, /data-testid="model-library-nimi-collection"/);
  // The grid folds to its first row: three tiles when no viewport reports the column count.
  assert.equal((markup.match(/data-collection-item="model:/g) ?? []).length, 3);
  assert.match(markup, /Gemma 4 2B/);
  assert.match(markup, /data-testid="model-library-nimi-parts"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.doesNotMatch(markup, /data-collection-item="part:/);
  // Makers with a bundled mark show their brand logo instead of a monogram.
  assert.match(markup, /data-model-family-logo="google-color"/);
  const failed = await render(<NimiCollectionSection collection={{ models: [], parts: [] }} loading={false} failed onOpen={() => {}} />);
  assert.match(failed, /runtimeConfig\.modelLibrary\.collection\.loadFailed/);
  assert.doesNotMatch(failed, /runtimeConfig\.modelLibrary\.collection\.empty/);
});

test('the collection section folds the rows past the first behind a toggle', async () => {
  const collection = buildNimiCollection({ catalog, recipes });
  // Without a viewport the grid assumes the widest layout of three columns.
  assert.ok(collection.models.length > 3);
  const markup = await render(<NimiCollectionSection collection={collection} loading={false} failed={false} onOpen={() => {}} />);
  assert.equal((markup.match(/data-collection-item="model:/g) ?? []).length, 3);
  assert.match(markup, /data-collection-item="model:gemma-4-e2b-it-local"/);
  // The fourth model waits behind the toggle.
  assert.doesNotMatch(markup, /data-collection-item="model:z-image-turbo-local"/);
  assert.match(markup, /data-testid="model-library-nimi-collection-toggle"/);
  assert.match(markup, /runtimeConfig\.modelLibrary\.collection\.expandAll/);
});

test('a collection that fits the first row has no expand toggle', async () => {
  const chat = nimiCollectionForCategory(buildNimiCollection({ catalog, recipes }), 'chat');
  assert.ok(chat.models.length > 0 && chat.models.length <= 3);
  const markup = await render(<NimiCollectionSection collection={chat} loading={false} failed={false} onOpen={() => {}} />);
  assert.equal((markup.match(/data-collection-item="model:/g) ?? []).length, chat.models.length);
  assert.doesNotMatch(markup, /model-library-nimi-collection-toggle/);
});

test('the expand toggle reveals every model and folds back to the first row', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  const values: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Element: dom.window.Element, Node: dom.window.Node,
    getComputedStyle: dom.window.getComputedStyle,
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const name of Object.getOwnPropertyNames(dom.window)) {
    if (/^(?:HTML|SVG)\w*Element$|Event$/u.test(name) && !(name in values)) {
      values[name] = (dom.window as unknown as Record<string, unknown>)[name];
    }
  }
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  try {
    const { createRoot } = await import('react-dom/client');
    const i18n = createInstance();
    await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } } });
    const collection = buildNimiCollection({ catalog, recipes });
    const root = createRoot(dom.window.document.getElementById('root')!);
    await act(async () => root.render(
      <I18nextProvider i18n={i18n}>
        <NimiCollectionSection collection={collection} loading={false} failed={false} onOpen={() => {}} />
      </I18nextProvider>,
    ));
    const document = dom.window.document;
    // jsdom has no matchMedia, so the grid keeps its three-column fallback.
    const tileCount = () => document.querySelectorAll('[data-collection-item^="model:"]').length;
    const toggle = () => document.querySelector<HTMLElement>('[data-testid="model-library-nimi-collection-toggle"]')!;
    assert.equal(tileCount(), 3);
    assert.ok(toggle().textContent?.includes('runtimeConfig.modelLibrary.collection.expandAll'));
    await act(async () => toggle().click());
    assert.equal(tileCount(), collection.models.length);
    assert.ok(toggle().textContent?.includes('runtimeConfig.modelLibrary.collection.collapse'));
    // Folded rows render their brand logos once expanded.
    assert.ok(document.querySelector('[data-model-family-logo="alibabacloud-color"]'));
    assert.ok(document.querySelector('[data-model-family-logo="qwen-color"]'));
    await act(async () => toggle().click());
    assert.equal(tileCount(), 3);
    await act(async () => root.unmount());
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

async function renderDiscovery(context: RuntimeConfigModelMarketContext | null, prepare?: (client: QueryClient) => void) {
  const refuse = () => { throw new Error('rendering must not call Runtime'); };
  const queryClient = new QueryClient();
  prepare?.(queryClient);
  const bindings = {
    app: { commands: {}, events: { subscribeDocumentMouseDown: () => () => undefined } },
    sdk: { localEnvironmentRpc: refuse, machineProduct: refuse },
  } as unknown as DesktopCanonicalRendererBindings;
  const model = {
    runtimeWritesDisabled: false,
    installResolvedModelPlan: async () => { throw new Error('rendering must not install'); },
  } as unknown as RuntimeConfigPanelControllerModel;
  return render(
    <QueryClientProvider client={queryClient}>
      <DesktopI18nResourceProvider resource={{ instance: { t: (key: string) => key } } as never}>
        <DesktopRendererBindingProvider bindings={bindings}>
          <RecommendPage model={model} context={context} onModelInstalled={async () => {}} onReturnToLoadout={() => {}} onOpenDownloaded={() => {}} />
        </DesktopRendererBindingProvider>
      </DesktopI18nResourceProvider>
    </QueryClientProvider>,
  );
}

function pressedCategoryHtml(markup: string) {
  return /<button[^>]*aria-pressed="true"[^>]*>([\s\S]*?)<\/button>/u.exec(markup)?.[1] ?? '';
}

test('discovery opens on All with the Nimi collection above community picks', async () => {
  const markup = await renderDiscovery(null);
  assert.match(pressedCategoryHtml(markup), /All/);
  assert.equal((markup.match(/aria-pressed=/g) ?? []).length, 7);
  const collection = markup.indexOf('data-testid="model-library-nimi-collection"');
  const community = markup.indexOf('data-testid="model-library-community"');
  assert.ok(collection >= 0 && community > collection);
});

test('a failed installed-files read does not hide the Nimi collection', async () => {
  const markup = await renderDiscovery(null, (client) => {
    client.setQueryData(['model-market', 'collection-catalog'], catalog);
    client.setQueryData(['model-market', 'collection-recipes'], recipes);
    client.getQueryCache().build(client, { queryKey: ['model-market', 'collection-assets'] }).setState({
      status: 'error',
      error: new Error('AI_LOCAL_MODEL_STATE_OFFLINE_CONVERSION_REQUIRED'),
    });
  });
  assert.match(markup, /data-collection-item="model:gemma-4-e2b-it-local"/);
  assert.doesNotMatch(markup, /runtimeConfig\.modelLibrary\.collection\.loadFailed/);
});

test('a speech capability link opens Voice, which has no community picks', async () => {
  const markup = await renderDiscovery({ kind: 'browse', capabilityContract: 'audio.synthesize' });
  assert.match(pressedCategoryHtml(markup), /Voice/);
  assert.match(markup, /data-testid="model-library-nimi-collection"/);
  assert.doesNotMatch(markup, /data-testid="model-library-community"/);
  assert.match(markup, /runtimeConfig\.modelLibrary\.community\.notInCategory/);
});

test('the detail page offers one download per version and marks versions already on this device', async () => {
  const gemma = buildNimiCollection({ catalog, recipes }).models.find((item) => item.title === 'Gemma 4 2B')!;
  const markup = await render(
    <NimiCollectionDetail
      item={gemma}
      onDevice={new Set(['sha256:e2b-q8'])}
      runtimeWritesDisabled={false}
      onBack={() => {}}
      onInstall={async () => { throw new Error('render must not install'); }}
    />,
  );
  assert.match(markup, /data-collection-version="chat.gemma-e2b.q4"/);
  assert.match(markup, /data-collection-version="chat.gemma-e2b.q8"/);
  assert.equal((markup.match(/runtimeConfig\.modelLibrary\.collection\.download/g) ?? []).length, 1);
  assert.equal((markup.match(/runtimeConfig\.modelLibrary\.collection\.onDevice/g) ?? []).length, 1);
});
