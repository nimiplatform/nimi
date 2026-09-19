import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ModelAssetCatalogVerification,
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

test('catalog search preserves local rows and HF unavailability across pages', async () => {
  const pageTokens: string[] = [];
  const row = (id: string) => ({
    modelLocator: id, sourceLabel: 'verified', title: id, description: '',
    categories: ['chat'], modelType: 'chat', author: '', license: '', tags: [],
    downloads: 0, likes: 0, lastModified: '', verified: true,
  });
  const local = {
    async searchCatalogModels(request: { pageToken: string }) {
      pageTokens.push(request.pageToken);
      return request.pageToken
        ? { items: [row('local-1'), row('local-2')], nextPageToken: '', huggingFaceUnavailable: false }
        : { items: [row('local-1')], nextPageToken: 'next', huggingFaceUnavailable: true };
    },
  } as unknown as NimiRuntimeLocalEnvironmentRpc;
  const client = createNimiRuntimeLocalEnvironmentClient({ local });
  const result = await client.searchCatalog({ query: 'local' });
  assert.deepEqual(pageTokens, ['', 'next']);
  assert.deepEqual(result.items.map((item) => item.modelLocator), ['local-1', 'local-2']);
  assert.equal(result.huggingFaceUnavailable, true);
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

test('environment plan resolution forwards the saved candidate selector and projects candidate identity', async () => {
  const requests: Record<string, unknown>[] = [];
  const local = {
    async resolveLocalEnvironmentPlan(request: Record<string, unknown>) {
      requests.push(request);
      return {
        plan: {
          planId: 'plan_env_1', packId: 'pack_1', productLabel: '', hostProfileId: 'host_1',
          platformTuple: 'windows/amd64', runtimeDataRoot: '', consumerScope: '', cloudOnlyImpact: '',
          state: 'ready', reasonCode: '', dependencies: [], requiredDependencyFamilies: [],
          aggregateSizeKnown: false, aggregateSizeBytes: '0', storageCategories: [], sourceOwners: [],
          noSystemMutation: true,
          candidateLoadoutId: typeof request.candidateLoadoutId === 'string' ? request.candidateLoadoutId : '',
          candidateRevision: request.candidateLoadoutId ? 'rev_loadout_1' : '',
        },
      };
    },
  } as unknown as NimiRuntimeLocalEnvironmentRpc;
  const client = createNimiRuntimeLocalEnvironmentClient({ local });

  const candidatePlan = await client.resolveEnvironmentPlan({
    capabilityContract: 'text.generate',
    candidateLoadoutId: 'loadout_1',
  });
  assert.equal(requests[0]?.candidateLoadoutId, 'loadout_1');
  assert.equal(candidatePlan.candidateLoadoutId, 'loadout_1');
  assert.equal(candidatePlan.candidateRevision, 'rev_loadout_1');

  const machinePlan = await client.resolveEnvironmentPlan({ capabilityContract: 'text.generate' });
  assert.equal(requests[1]?.candidateLoadoutId, '');
  assert.equal(machinePlan.candidateLoadoutId, undefined);
  assert.equal(machinePlan.candidateRevision, undefined);
});

test('transfer projections carry plan identity and install returns its transfer session', async () => {
  const summary = {
    installSessionId: 'session_1', assetId: 'model_01', sessionKind: 'download', phase: 'downloading',
    state: 'running', bytesReceived: '10', bytesTotal: '42', speedBytesPerSec: '5', etaSeconds: '6',
    message: '', reasonCode: '', retryable: false,
    createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:01:00Z',
    planId: 'plan_1',
  };
  const modelAsset = {
    modelAssetId: 'model_01', contentId: `sha256:${'a'.repeat(64)}`, displayName: 'Model', entry: 'model.gguf',
    files: [], totalSizeBytes: '42', contentVerified: true,
    catalogVerification: ModelAssetCatalogVerification.MATCHED, unclassified: false,
    boundedFingerprint: undefined, provenance: undefined,
    createdAt: '2026-08-15T00:00:00Z', updatedAt: '2026-08-15T00:00:00Z',
    latestIntegrityCheckedAt: '2026-08-15T00:00:00Z', duplicateContent: false, containsNonExecutableCode: false,
  };
  const local = {
    async listLocalTransfers() {
      return { transfers: [summary, { ...summary, installSessionId: 'session_2', planId: '' }] };
    },
    async watchLocalTransfers() {
      return (async function* () {
        yield { ...summary, done: false, success: false };
      })();
    },
    async installModelFromPlan() {
      return { modelAsset, installSessionId: 'session_install_1' };
    },
  } as unknown as NimiRuntimeLocalEnvironmentRpc;
  const client = createNimiRuntimeLocalEnvironmentClient({ local });

  const transfers = await client.listTransfers();
  assert.equal(transfers[0]?.planId, 'plan_1');
  assert.equal(transfers[1]?.planId, undefined);

  const events: Array<{ installSessionId: string; planId?: string }> = [];
  const stop = await client.watchTransferProgress((event) => { events.push(event); });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  stop();
  assert.equal(events[0]?.installSessionId, 'session_1');
  assert.equal(events[0]?.planId, 'plan_1');

  const installed = await client.install('plan_1', { caller: 'core' });
  assert.equal(installed.modelAsset.modelAssetId, 'model_01');
  assert.equal(installed.installSessionId, 'session_install_1');
});
