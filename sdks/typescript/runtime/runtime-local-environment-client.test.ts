import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ModelAssetSourceAvailability,
  ModelAssetSourceFreshness,
  ReasonCode,
} from '../core-generated/runtime-typed-client.js';
import { createNimiRuntimeLocalEnvironmentClient } from './runtime-local-environment-client.js';
import type { NimiRuntimeLocalEnvironmentRpc } from './runtime-local-environment-client.js';
import { projectNimiRuntimeLocalInstallPlanDescriptor } from './runtime-local-environment-client-projections.js';
import {
  projectNimiRuntimeFeaturedModelAssets,
  projectNimiRuntimeModelAssetMarketCandidate,
  projectNimiRuntimeModelAssetSearchResult,
} from './runtime-local-recommendation.js';

test('Runtime local environment client hard-cuts aggregate and legacy recommendation methods', () => {
  const client = createNimiRuntimeLocalEnvironmentClient({ local: {} as NimiRuntimeLocalEnvironmentRpc });
  for (const method of ['listAssets', 'applyProfile', 'getRecommendationFeed', 'installAndBind']) {
    assert.equal(method in client, false);
  }
  for (const method of [
    'searchCatalog',
    'listCatalogVariants',
    'listFeaturedModelAssets',
    'listFactoryProfileRecommendations',
    'resolveInstallPlan',
    'resolveOfferInstallPlan',
  ]) {
    assert.equal(method in client, true);
  }
});

test('Market projections separate browse locators, exact offers, and server-held plans', () => {
  const browse = projectNimiRuntimeModelAssetSearchResult({
    modelLocator: 'model_ref',
    sourceLabel: 'huggingface',
    title: 'Model',
    description: '',
    categories: ['chat'],
    modelType: 'chat',
    license: 'apache-2.0',
    tags: [],
    downloads: 4,
    likes: 1,
    lastModified: '',
    verified: false,
  });
  assert.equal(browse.modelLocator, 'model_ref');
  assert.equal('offerRef' in browse, false);

  const offer = projectNimiRuntimeModelAssetMarketCandidate({
    offerRef: 'offer_ref',
    sourceLabel: 'huggingface',
    title: 'Model',
    description: '',
    categories: ['chat'],
    modelType: 'chat',
    variantLabel: 'model.gguf',
    format: 'gguf',
    totalSizeBytes: '123',
    license: 'apache-2.0',
    tags: [],
    downloads: 4,
    likes: 1,
    lastModified: '',
    verified: false,
    installed: false,
    installable: true,
    editorialReason: '',
  } as never);
  assert.equal(offer.offerRef, 'offer_ref');
  assert.equal(offer.totalSizeBytes, 123);
  assert.equal('files' in offer, false);
  assert.equal('hashes' in offer, false);

  const plan = projectNimiRuntimeLocalInstallPlanDescriptor({
    planId: 'plan_ref',
    itemId: 'catalog_model',
    source: 'huggingface',
    modelId: 'owner/model',
    repo: 'owner/model',
    revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    capabilities: ['text.generate'],
    installKind: 'download',
    installAvailable: true,
    entry: 'model.gguf',
    files: ['model.gguf'],
    hashes: { 'model.gguf': 'a'.repeat(64) },
    warnings: ['WARN_GPU_REQUIRED'],
    totalSizeBytes: '123',
    offerRef: 'offer_ref',
  } as never);
  assert.equal(plan.planId, 'plan_ref');
  assert.equal(plan.offerRef, 'offer_ref');
  assert.equal(plan.totalSizeBytes, 123);
  assert.equal(plan.installAvailable, true);
  assert.deepEqual(plan.warnings, ['WARN_GPU_REQUIRED']);
});

test('Market offer resolution is additive to the existing install-plan input', async () => {
  const requests: Record<string, unknown>[] = [];
  const local = {
    async resolveModelInstallPlan(request: Record<string, unknown>) {
      requests.push(request);
      return { plan: { planId: `plan_${requests.length}` } };
    },
  } as unknown as NimiRuntimeLocalEnvironmentRpc;
  const client = createNimiRuntimeLocalEnvironmentClient({ local });

  await client.resolveInstallPlan({ templateId: 'template_existing' });
  await client.resolveOfferInstallPlan('offer_exact');

  assert.equal(requests[0]?.templateId, 'template_existing');
  assert.equal(requests[0]?.offerRef, '');
  assert.equal(requests[1]?.offerRef, 'offer_exact');
  assert.equal(requests[1]?.templateId, '');
});

test('Featured source projection distinguishes stale LKG from unavailable', () => {
  const stale = projectNimiRuntimeFeaturedModelAssets({
    source: {
      availability: ModelAssetSourceAvailability.AVAILABLE,
      freshness: ModelAssetSourceFreshness.STALE,
      generation: 'generation-1',
      reasonCode: ReasonCode.AI_REMOTE_MODEL_CATALOG_STALE,
    },
    items: [],
  });
  assert.deepEqual(stale.source, {
    availability: 'available',
    freshness: 'stale',
    generation: 'generation-1',
    reasonCode: 'AI_REMOTE_MODEL_CATALOG_STALE',
  });
  const unavailable = projectNimiRuntimeFeaturedModelAssets({
    source: {
      availability: ModelAssetSourceAvailability.UNAVAILABLE,
      freshness: ModelAssetSourceFreshness.UNSPECIFIED,
      generation: '',
      reasonCode: ReasonCode.AI_LOCAL_MODEL_UNAVAILABLE,
    },
    items: [],
  });
  assert.deepEqual(unavailable.source, {
    availability: 'unavailable',
    reasonCode: 'AI_LOCAL_MODEL_UNAVAILABLE',
  });
});

test('model card reads preserve Runtime content and propagate read failures', async () => {
  const calls: unknown[] = [];
  const response = { markdown: '# Model\n![Architecture](./architecture.png)', sourceUrl: 'https://huggingface.co/org/model/blob/revision/README.md', baseUrl: 'https://huggingface.co/org/model/resolve/revision/' };
  const client = createNimiRuntimeLocalEnvironmentClient({ local: {
    getCatalogModelCard: async (input: unknown) => { calls.push(input); return response; },
  } as unknown as NimiRuntimeLocalEnvironmentRpc });
  assert.deepEqual(await client.getCatalogModelCard({ offerRef: 'offer_ref' }), response);
  assert.deepEqual(calls, [{ modelLocator: '', offerRef: 'offer_ref' }]);
  const failure = new Error('upstream unavailable');
  const failed = createNimiRuntimeLocalEnvironmentClient({ local: {
    getCatalogModelCard: async () => { throw failure; },
  } as unknown as NimiRuntimeLocalEnvironmentRpc });
  await assert.rejects(failed.getCatalogModelCard({ modelLocator: 'model_ref' }), failure);
});
