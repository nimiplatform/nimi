import assert from 'node:assert/strict';
import test from 'node:test';

import { projectConversationReportRuntimeEnvironment } from './runtime-env.mjs';
import {
  catalogModelRevisionFingerprint,
  parseConversationRouteRef,
  rankCatalogTextModels,
  selectRuntimeManagedConnector,
} from './route.mjs';

test('provider credentials project into Runtime custody across the one declared restart', () => {
  assert.deepEqual(projectConversationReportRuntimeEnvironment({
    NIMI_LIVE_DASHSCOPE_API_KEY: 'live-key',
    NIMI_LIVE_DASHSCOPE_BASE_URL: 'https://catalog.example/v1',
  }), {
    NIMI_LIVE_DASHSCOPE_API_KEY: 'live-key',
    NIMI_LIVE_DASHSCOPE_BASE_URL: 'https://catalog.example/v1',
    NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY: 'live-key',
    NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL: 'https://catalog.example/v1',
  });
  assert.equal(projectConversationReportRuntimeEnvironment({
    NIMI_LIVE_DASHSCOPE_API_KEY: 'live-key',
    NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY: 'operator-key',
  }).NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY, 'operator-key');
});

test('route selection consumes Runtime catalog order without app/test provider or model constants', () => {
  const models = [
    { modelId: 'catalog-old', updatedAt: '2026-01-01' },
    { modelId: 'catalog-recent', updatedAt: '2026-06-01' },
    { modelId: 'catalog-default', updatedAt: '2026-05-01' },
  ];
  assert.deepEqual(rankCatalogTextModels({ models, defaultModelId: 'catalog-default' }).map((model) => model.modelId), [
    'catalog-default', 'catalog-recent', 'catalog-old',
  ]);
  assert.deepEqual(rankCatalogTextModels({
    models,
    explicitModelId: 'catalog-old',
    defaultModelId: 'catalog-default',
  }).map((model) => model.modelId), ['catalog-old', 'catalog-default', 'catalog-recent']);
  assert.deepEqual(parseConversationRouteRef('provider-a::model-a'), { provider: 'provider-a', modelId: 'model-a' });
  assert.throws(() => parseConversationRouteRef('provider-a'), /<provider>::<model-id>/u);
});

test('route selection uses the Runtime-owned credential-bearing system connector', () => {
  assert.equal(selectRuntimeManagedConnector([
    { connectorId: 'user-connector', provider: 'provider-a', ownerType: 2, hasCredential: true },
    { connectorId: 'sys-missing', provider: 'provider-a', ownerType: 1, hasCredential: false },
    { connectorId: 'sys-ready', provider: 'provider-a', ownerType: 1, hasCredential: true },
  ], 'provider-a')?.connectorId, 'sys-ready');
});

test('catalog revision fingerprint is stable and excludes Runtime-instance custody IDs', () => {
  const provider = { provider: 'provider-a', version: 3, catalogVersion: 'catalog-v7', source: 'builtin' };
  const model = {
    modelId: 'model-a',
    capabilities: ['text.generate.vision', 'text.generate'],
    updatedAt: '2026-07-12T00:00:00Z',
    sourceRef: { remoteModelCatalogId: 'runtime-instance-a' },
  };
  const baseline = catalogModelRevisionFingerprint(provider, model);
  assert.equal(catalogModelRevisionFingerprint(
    { ...provider, source: 'custom' },
    { ...model, capabilities: [...model.capabilities].reverse(), sourceRef: { remoteModelCatalogId: 'runtime-instance-b' } },
  ), baseline);
  assert.notEqual(catalogModelRevisionFingerprint({ ...provider, catalogVersion: 'catalog-v8' }, model), baseline);
});
