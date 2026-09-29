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
  NimiRuntimeModelAssetMarketCandidate,
} from '@nimiplatform/sdk/runtime';
import {
  buildNimiCollection,
  communityFeedCategories,
  initialModelLibraryCategory,
  mergeCommunityFeeds,
  nimiCollectionForCategory,
  nimiCollectionPreview,
  type ModelLibraryCategory,
  type NimiCollection,
  type NimiCollectionItem,
} from '../src/shell/renderer/features/runtime-config/runtime-config-model-library-collection';
import {
  formatByteRange,
  NimiCollectionDetail,
  NimiCollectionList,
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
    /** Whether a setup needs the slot; required unless stated. */
    readonly presence?: 'required' | 'optional-conditional';
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
      presence: slot.presence ?? 'required',
      conditionalFeatures: slot.presence === 'optional-conditional' ? ['input.image'] : [],
    })),
  } as unknown as NimiLoadoutRecipe;
}

const catalog = [
  descriptor({ templateId: 'chat.gemma-e2b.q4', title: 'gemma-4-e2b-it-local (Q4_K_M)', contentId: 'sha256:e2b-q4', capabilities: ['text.generate'], logicalModelId: 'gemma-4-e2b-it-local', size: 2.9 * GB }),
  descriptor({ templateId: 'chat.gemma-e2b.q8', title: 'gemma-4-e2b-it-local (Q8_0)', contentId: 'sha256:e2b-q8', capabilities: ['text.generate'], logicalModelId: 'gemma-4-e2b-it-local', size: 4.7 * GB }),
  descriptor({ templateId: 'chat.gemma-26b.q4', title: 'gemma-4-26b-a4b-it-local (Q4_K_M)', contentId: 'sha256:26b-q4', capabilities: ['text.generate'], logicalModelId: 'gemma-4-26b-a4b-it-local', size: 15.8 * GB }),
  descriptor({ templateId: 'image.z.q4.cuda', title: 'z-image-turbo-local (Q4_0)', contentId: 'sha256:z-q4', capabilities: ['image.generate'], logicalModelId: 'z-image-turbo-local', size: 3.4 * GB }),
  descriptor({ templateId: 'image.z.q4.metal', title: 'z-image-turbo-local (Q4_0)', contentId: 'sha256:z-q4', capabilities: ['image.generate'], logicalModelId: 'z-image-turbo-local', size: 3.4 * GB }),
  descriptor({ templateId: 'image-vae.z.cuda', title: 'asset-image-vae-z-image-ae (F16)', contentId: 'sha256:z-vae', size: 0.3 * GB }),
  descriptor({ templateId: 'image-vae.z.metal', title: 'asset-image-vae-z-image-ae (F16)', contentId: 'sha256:z-vae', size: 0.3 * GB }),
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
  const unlinkedEncoder = descriptor({ templateId: 'image-textenc.q8', title: 'asset-image-textenc-qwen3-4b-instruct-2507 (Q8_0)', entry: 'Qwen3-4B-Instruct-2507-Q8_0.gguf', contentId: 'sha256:textenc-q8', artifactRoles: ['text_encoder'] });
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
  assert.equal(encoder?.versions[0]?.quantLabel, 'Q8');
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

test('the preview takes each category in turn, recommended models first', () => {
  const collection = buildNimiCollection({ catalog, recipes });
  // Whisper is recommended and the 1.7B Qwen3 ASR is not, so Whisper leads transcription.
  assert.deepEqual(
    collection.models.filter((item) => item.capability === 'audio.transcribe').map((item) => item.title),
    ['Whisper Large V3 Turbo', 'Qwen3 Asr Transformers 1.7B'],
  );
  assert.deepEqual(nimiCollectionPreview(collection.models, 'all', 6).map((item) => item.title), [
    'Gemma 4 2B', 'Ideogram4', 'Chatterbox audio.cpp', 'Gemma 4 26B', 'Z-Image Turbo', 'Whisper Large V3 Turbo',
  ]);
  // Inside one category the preview alternates capabilities instead.
  const voice = nimiCollectionForCategory(collection, 'voice').models;
  assert.deepEqual(nimiCollectionPreview(voice, 'voice', 2).map((item) => item.title), ['Chatterbox audio.cpp', 'Whisper Large V3 Turbo']);
  assert.equal(nimiCollectionPreview(voice, 'voice', 10).length, voice.length);
});

test('a model lists what setting up its capability also prepares', () => {
  const { models, parts } = buildNimiCollection({ catalog, recipes });
  const byTitle = new Map(models.map((item) => [item.title, item]));
  const zImage = byTitle.get('Z-Image Turbo')!;
  assert.deepEqual(zImage.requirements.map((requirement) => requirement.capability), ['image.generate']);
  assert.deepEqual(zImage.requirements[0]!.items.map((item) => item.key), ['part:sha256:z-vae']);
  // The CUDA and Metal templates of the VAE carry one content, so one version.
  assert.equal(zImage.requirements[0]!.items[0]!.versions.length, 1);
  assert.deepEqual(byTitle.get('Ideogram4')!.requirements[0]!.items.map((item) => item.key), ['part:sha256:encoder']);
  assert.deepEqual(byTitle.get('Whisper Large V3 Turbo')!.requirements[0]!.items.map((item) => item.key), ['part:sha256:silero']);
  assert.deepEqual(byTitle.get('Chatterbox audio.cpp')!.requirements, []);
  assert.ok(parts.every((item) => item.requirements.length === 0));
});

test('optional slots, disagreeing recipes and slots without one named item claim nothing', () => {
  const byTemplate = new Map(catalog.map((item) => [item.templateId, item]));
  const gemma = byTemplate.get('chat.gemma-e2b.q4')!;
  const asr = byTemplate.get('stt.qwen3-asr-1.7b')!;
  const zImage = byTemplate.get('image.z.q4.cuda')!;
  const ideogram = byTemplate.get('image.ideogram4')!;
  const mmproj = descriptor({ templateId: 'aux.gemma.mmproj', title: 'gemma-4-e2b-it-mmproj-local (F16)', contentId: 'sha256:mmproj', artifactRoles: ['mmproj'] });
  const aligner = descriptor({ templateId: 'aux.aligner', title: 'asset-forced-aligner (F16)', contentId: 'sha256:aligner' });
  const vaeA = descriptor({ templateId: 'vae.a', title: 'asset-image-vae-a (F16)', contentId: 'sha256:vae-a' });
  const vaeB = descriptor({ templateId: 'vae.b', title: 'asset-image-vae-b (F16)', contentId: 'sha256:vae-b' });
  const { models } = buildNimiCollection({
    catalog: [gemma, mmproj, asr, aligner, zImage, vaeA, vaeB, ideogram],
    recipes: [
      // Only image input needs the projector.
      recipe({ recipeId: 'gemma', title: 'Gemma 4 text generation', capabilityContract: 'text.generate', slots: [
        { slotId: 'main.gguf', variants: [gemma.templateId] },
        { slotId: 'companion.mmproj', variants: [mmproj.templateId], presence: 'optional-conditional' },
      ] }),
      // One transcription recipe needs the aligner and the other does not.
      recipe({ recipeId: 'asr', title: 'Qwen3 ASR transcription', capabilityContract: 'audio.transcribe', slots: [
        { slotId: 'stt.model', variants: [asr.templateId] },
      ] }),
      recipe({ recipeId: 'asr-aligned', title: 'Qwen3 ASR with word alignment', capabilityContract: 'audio.transcribe', slots: [
        { slotId: 'stt.model', variants: [asr.templateId] },
        { slotId: 'stt.aligner', variants: [aligner.templateId] },
      ] }),
      // The VAE slot offers two different files.
      recipe({ recipeId: 'z-image', title: 'Z-Image Turbo generation', capabilityContract: 'image.generate', slots: [
        { slotId: 'main.diffusion', variants: [zImage.templateId] },
        { slotId: 'companion.vae', variants: [vaeA.templateId, vaeB.templateId] },
      ] }),
      // The encoder slot recommends a template the catalog does not list.
      recipe({ recipeId: 'ideogram', title: 'Ideogram4 generation', capabilityContract: 'image.generate', slots: [
        { slotId: 'main.diffusion', variants: [ideogram.templateId] },
        { slotId: 'companion.text-encoder', variants: ['image-textenc.missing'] },
      ] }),
    ],
  });
  assert.equal(models.length, 4);
  for (const model of models) assert.deepEqual(model.requirements, [], model.title);
});

test('a setup that needs two models lists each on the other', () => {
  const fl2va = descriptor({ templateId: 'video.fl2va', title: 'minimax-h3-fl2va-local (Q4_K_M)', contentId: 'sha256:fl2va', capabilities: ['video.generate'], logicalModelId: 'minimax-h3-fl2va-local', entry: 'fl2va.gguf' });
  const ref2va = descriptor({ templateId: 'video.ref2va', title: 'minimax-h3-ref2va-local (Q4_K_M)', contentId: 'sha256:ref2va', capabilities: ['video.generate'], logicalModelId: 'minimax-h3-ref2va-local', entry: 'ref2va.gguf' });
  const vae = descriptor({ templateId: 'video.vae', title: 'minimax-h3-video-vae-local (F16)', contentId: 'sha256:h3-vae', entry: 'vae.safetensors' });
  const { models } = buildNimiCollection({
    catalog: [fl2va, ref2va, vae],
    recipes: [recipe({ recipeId: 'h3', title: 'MiniMax-H3 video generation', capabilityContract: 'video.generate', slots: [
      { slotId: 'diffusion.fl2va', variants: [], offers: [fl2va] },
      { slotId: 'diffusion.ref2va', variants: [], offers: [ref2va] },
      { slotId: 'vae.video', variants: [], offers: [vae], label: 'MiniMax-H3 video VAE' },
    ] })],
  });
  const needs = (key: string) => models.find((item) => item.key === key)!.requirements[0]!.items.map((item) => item.key);
  assert.deepEqual(needs('model:minimax-h3-fl2va-local'), ['model:minimax-h3-ref2va-local', 'part:sha256:h3-vae']);
  assert.deepEqual(needs('model:minimax-h3-ref2va-local'), ['model:minimax-h3-fl2va-local', 'part:sha256:h3-vae']);
});

test('the collection preview shows two rows, View all and one quiet companion files entry', async () => {
  const collection = buildNimiCollection({ catalog, recipes });
  const section = (value: NimiCollection, category: ModelLibraryCategory, failed = false) => render(
    <NimiCollectionSection collection={value} category={category} loading={false} failed={failed} onOpen={() => {}} onViewAll={() => {}} onViewParts={() => {}} />,
  );
  const markup = await section(collection, 'all');
  assert.match(markup, /data-testid="model-library-nimi-collection"/);
  // Without a viewport the grid assumes three columns, so two rows hold six of the seven models.
  assert.equal((markup.match(/data-collection-item="model:/g) ?? []).length, 6);
  assert.doesNotMatch(markup, /data-collection-item="model:qwen3-asr-transformers-1.7b-local"/);
  assert.match(markup, /data-testid="model-library-nimi-view-all"/);
  assert.match(markup, /runtimeConfig\.modelLibrary\.viewAll/);
  assert.match(markup, /data-testid="model-library-nimi-parts"/);
  assert.match(markup, /runtimeConfig\.modelLibrary\.collection\.partsEntry/);
  assert.doesNotMatch(markup, /data-collection-item="part:/);
  // Makers with a bundled mark show their brand logo instead of a monogram.
  assert.match(markup, /data-model-family-logo="google-color"/);

  const chat = await section(nimiCollectionForCategory(collection, 'chat'), 'chat');
  assert.equal((chat.match(/data-collection-item="model:/g) ?? []).length, 2);
  assert.doesNotMatch(chat, /model-library-nimi-view-all/);
  assert.doesNotMatch(chat, /model-library-nimi-parts/);

  const failed = await section({ models: [], parts: [] }, 'all', true);
  assert.match(failed, /runtimeConfig\.modelLibrary\.collection\.loadFailed/);
  assert.doesNotMatch(failed, /runtimeConfig\.modelLibrary\.collection\.empty/);
  assert.doesNotMatch(failed, /model-library-nimi-view-all/);
});

test('the full list groups All under category headings and the companion list explains itself', async () => {
  const collection = buildNimiCollection({ catalog, recipes });
  const models = await render(
    <NimiCollectionList kind="models" items={collection.models} category="all" loading={false} failed={false} onOpen={() => {}} onBack={() => {}} />,
  );
  assert.equal((models.match(/data-collection-item="model:/g) ?? []).length, collection.models.length);
  assert.deepEqual([...models.matchAll(/data-collection-group="(\w+)"/g)].map((match) => match[1]), ['chat', 'image', 'voice']);
  assert.match(models, /runtimeConfig\.recommend\.category\.voice/);
  assert.match(models, /data-testid="model-library-list-back"/);
  const image = nimiCollectionForCategory(collection, 'image');
  const parts = await render(
    <NimiCollectionList kind="parts" items={image.parts} category="image" loading={false} failed={false} onOpen={() => {}} onBack={() => {}} />,
  );
  assert.match(parts, /data-testid="model-library-nimi-parts-list"/);
  assert.match(parts, /runtimeConfig\.modelLibrary\.collection\.partsHint/);
  assert.equal((parts.match(/data-collection-item="part:/g) ?? []).length, image.parts.length);
  // One category needs no headings.
  assert.doesNotMatch(parts, /<h4/);
});

/** Renders into jsdom inside React's act environment and restores the globals afterwards. */
async function withDom(run: (document: Document, mount: (node: React.ReactElement) => Promise<void>) => Promise<void>) {
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
    const root = createRoot(dom.window.document.getElementById('root')!);
    await run(dom.window.document, async (node) => {
      await act(async () => root.render(node));
    });
    await act(async () => root.unmount());
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

async function click(element: Element | null | undefined) {
  assert.ok(element, 'element to click');
  await act(async () => (element as HTMLElement).click());
}

function discoveryTree(context: RuntimeConfigModelMarketContext | null, queryClient: QueryClient) {
  const refuse = () => { throw new Error('rendering must not call Runtime'); };
  const bindings = {
    app: { commands: {}, events: { subscribeDocumentMouseDown: () => () => undefined } },
    sdk: { localEnvironmentRpc: refuse, machineProduct: refuse },
  } as unknown as DesktopCanonicalRendererBindings;
  const model = {
    runtimeWritesDisabled: false,
    installResolvedModelPlan: async () => { throw new Error('rendering must not install'); },
  } as unknown as RuntimeConfigPanelControllerModel;
  return (
    <QueryClientProvider client={queryClient}>
      <DesktopI18nResourceProvider resource={{ instance: { t: (key: string) => key } } as never}>
        <DesktopRendererBindingProvider bindings={bindings}>
          <RecommendPage model={model} context={context} onModelInstalled={async () => {}} onReturnToLoadout={() => {}} onOpenDownloaded={() => {}} />
        </DesktopRendererBindingProvider>
      </DesktopI18nResourceProvider>
    </QueryClientProvider>
  );
}

async function renderDiscovery(context: RuntimeConfigModelMarketContext | null, prepare?: (client: QueryClient) => void) {
  const queryClient = new QueryClient();
  prepare?.(queryClient);
  return render(discoveryTree(context, queryClient));
}

function communityCandidate(offerRef: string, category: string): NimiRuntimeModelAssetMarketCandidate {
  return {
    offerRef,
    title: `community/${offerRef}`,
    variantLabel: `${offerRef}-Q4_K_M.gguf`,
    author: 'community',
    tags: [],
    categories: [category],
    license: 'apache-2.0',
    downloads: 1,
    likes: 1,
    totalSizeBytes: GB,
    sourceLabel: 'Hugging Face',
  } as unknown as NimiRuntimeModelAssetMarketCandidate;
}

/** The collection plus five chat picks, with nothing left for discovery to fetch. */
function seededDiscoveryClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const feed = (items: NimiRuntimeModelAssetMarketCandidate[]) => ({ source: { availability: 'available', freshness: 'fresh' }, items });
  queryClient.setQueryData(['model-market', 'collection-catalog'], catalog);
  queryClient.setQueryData(['model-market', 'collection-recipes'], recipes);
  queryClient.setQueryData(['model-market', 'collection-assets'], []);
  queryClient.setQueryData(['model-market', 'featured', 'all'], feed(['a', 'b', 'c', 'd', 'e'].map((offerRef) => communityCandidate(offerRef, 'chat'))));
  queryClient.setQueryData(['model-market', 'featured', 'image'], feed([]));
  return queryClient;
}

async function mountDiscovery(run: (document: Document) => Promise<void>) {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {} } } });
  await withDom(async (document, mount) => {
    await mount(<I18nextProvider i18n={i18n}>{discoveryTree(null, seededDiscoveryClient())}</I18nextProvider>);
    await run(document);
  });
}

test('View all opens the collection list, and back returns to the preview above every community pick', async () => {
  await mountDiscovery(async (document) => {
    const count = (selector: string) => document.querySelectorAll(selector).length;
    const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`);
    const buttonNamed = (name: string) => [...document.querySelectorAll('button')].find((button) => button.textContent === name);
    // Two rows of three collection tiles without a viewport; every community pick lies below.
    assert.equal(count('[data-collection-item^="model:"]'), 6);
    assert.equal(count('[data-community-candidate]'), 5);
    assert.equal(count('[data-testid="model-library-community"] [data-testid="model-library-list-back"]'), 0);
    assert.equal(byTestId('model-library-community-view-all'), null);

    await click(byTestId('model-library-nimi-view-all'));
    assert.ok(byTestId('model-library-nimi-list'));
    assert.equal(count('[data-collection-item^="model:"]'), 7);
    assert.equal(byTestId('model-library-community'), null);
    // Filter and sort only act on community rows, so the collection list leaves them out.
    assert.equal(buttonNamed('Filter'), undefined);

    // A requirement row opens that item, and back retraces each step.
    await click(document.querySelector('[data-collection-item="model:z-image-turbo-local"]'));
    const heading = () => document.querySelector('[data-testid="model-library-nimi-detail"] h1')?.textContent;
    assert.equal(heading(), 'Z-Image Turbo');
    await click(document.querySelector('[data-requirement-item="part:sha256:z-vae"]'));
    assert.equal(heading(), 'VAE');
    await click(buttonNamed('Back'));
    assert.equal(heading(), 'Z-Image Turbo');
    await click(buttonNamed('Back'));
    assert.ok(byTestId('model-library-nimi-list'));
    await click(byTestId('model-library-list-back'));
    assert.ok(byTestId('model-library-nimi-collection'));
    assert.ok(buttonNamed('Filter'));

    await click(byTestId('model-library-nimi-parts'));
    assert.ok(byTestId('model-library-nimi-parts-list'));
    assert.equal(count('[data-collection-item^="part:"]'), 3);
    assert.equal(byTestId('model-library-community'), null);
    await click(byTestId('model-library-list-back'));
    assert.equal(count('[data-community-candidate]'), 5);
  });
});

test('the model total counts only the selected category', async () => {
  await mountDiscovery(async (document) => {
    const total = () => [...document.querySelectorAll('span')].find((span) => /^\d+ models$/u.test(span.textContent ?? ''))?.textContent;
    // Seven collection models and five community picks.
    assert.equal(total(), '12 models');
    await click([...document.querySelectorAll('button[aria-pressed]')].find((button) => button.textContent === 'Image'));
    assert.equal(total(), '2 models');
  });
});

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
      resolveItem={() => undefined}
      onBack={() => {}}
      onOpenItem={() => {}}
      onInstall={async () => { throw new Error('render must not install'); }}
    />,
  );
  assert.match(markup, /data-collection-version="chat.gemma-e2b.q4"/);
  assert.match(markup, /data-collection-version="chat.gemma-e2b.q8"/);
  assert.equal((markup.match(/runtimeConfig\.modelLibrary\.collection\.download/g) ?? []).length, 1);
  assert.equal((markup.match(/runtimeConfig\.modelLibrary\.collection\.onDevice/g) ?? []).length, 1);
});

test('the detail page lists what its setup also prepares, and hides the list when an item is unknown', async () => {
  const collection = buildNimiCollection({ catalog, recipes });
  const items = new Map([...collection.models, ...collection.parts].map((item) => [item.key, item]));
  const zImage = collection.models.find((item) => item.title === 'Z-Image Turbo')!;
  const detail = (resolveItem: (key: string) => NimiCollectionItem | undefined) => render(
    <NimiCollectionDetail
      item={zImage}
      onDevice={new Set()}
      runtimeWritesDisabled={false}
      resolveItem={resolveItem}
      onBack={() => {}}
      onOpenItem={() => {}}
      onInstall={async () => { throw new Error('render must not install'); }}
    />,
  );
  const markup = await detail((key) => items.get(key));
  assert.match(markup, /data-testid="model-library-nimi-requirements"/);
  assert.match(markup, /data-capability="image.generate"/);
  assert.match(markup, /data-requirement-item="part:sha256:z-vae"/);
  assert.match(markup, /runtimeConfig\.modelLibrary\.collection\.alsoPrepared/);
  // The 0.3 GB VAE shows its own size.
  assert.match(markup, /307\.2 MB/);
  // A partial list would understate the setup.
  assert.doesNotMatch(await detail(() => undefined), /model-library-nimi-requirements/);
});
