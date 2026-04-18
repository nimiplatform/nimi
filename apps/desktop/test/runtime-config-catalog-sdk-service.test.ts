import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogModelSource, ModelCatalogProviderSource, type CatalogModelDetail, type ModelCatalogProviderEntry } from '@nimiplatform/sdk/runtime';
import { jsonToProtoStruct, normalizeModelDetail, normalizeProviderEntry, protoStructToJson } from '../src/shell/renderer/features/runtime-config/runtime-config-catalog-sdk-service';

test('normalizeProviderEntry maps overlay metadata and overridden source', () => {
  const entry: ModelCatalogProviderEntry = {
    provider: 'openai',
    version: 1,
    catalogVersion: '2026-03-15',
    source: ModelCatalogProviderSource.OVERRIDDEN,
    inventoryMode: 'static_source',
    modelCount: 12,
    voiceCount: 4,
    yaml: 'provider: openai',
    defaultTextModel: 'gpt-5.2',
    capabilities: ['text.generate', 'audio.synthesize'],
    hasOverlay: true,
    customModelCount: 1,
    overriddenModelCount: 2,
    overlayUpdatedAt: '2026-03-15T12:00:00Z',
    effectiveYaml: 'effective: true',
    defaultEndpoint: 'https://api.openai.com/v1',
    requiresExplicitEndpoint: false,
    runtimePlane: 'remote',
    executionModule: 'nimillm',
    managedSupported: true,
  };

  const normalized = normalizeProviderEntry(entry);
  assert.equal(normalized.source, 'overridden');
  assert.equal(normalized.customModelCount, 1);
  assert.equal(normalized.overriddenModelCount, 2);
  assert.equal(normalized.effectiveYaml, 'effective: true');
});

test('protoStructToJson and jsonToProtoStruct round-trip nested data', () => {
  const input = {
    duration_sec: { min: 1, max: 8 },
    service_tier: ['standard'],
    watermark: false,
  };
  assert.deepEqual(protoStructToJson(jsonToProtoStruct(input)), input);
});

test('normalizeModelDetail maps video generation and warnings', () => {
  const detail: CatalogModelDetail = {
    provider: 'openai',
    modelId: 'sora-2',
    modelType: 'video',
    updatedAt: '2026-03-15',
    capabilities: ['video.generate'],
    pricing: { unit: 'request', input: 'unknown', output: 'unknown', currency: 'USD', asOf: '2026-03-15', notes: 'unknown' },
    voiceSetId: '',
    voiceDiscoveryMode: '',
    voiceRefKinds: [],
    videoGeneration: {
      modes: ['t2v'],
      inputRoles: [{ key: 't2v', values: ['prompt'] }],
      limits: jsonToProtoStruct({ duration_sec: { min: 1, max: 8 } }),
      optionSupports: ['duration_sec'],
      optionConstraints: jsonToProtoStruct({}),
      outputs: { videoUrl: true, lastFrameUrl: false },
    },
    sourceRef: { url: 'https://example.com', retrievedAt: '2026-03-15', note: 'docs' },
    source: CatalogModelSource.CUSTOM,
    userScoped: true,
    warnings: [{ code: 'user_custom_model', message: 'Visible only to current user.' }],
    voices: [],
    voiceWorkflowModels: [],
    modelWorkflowBinding: undefined,
  };

  const normalized = normalizeModelDetail(detail);
  assert.equal(normalized.source, 'custom');
  assert.equal(normalized.videoGeneration?.outputs.videoUrl, true);
  assert.deepEqual(normalized.videoGeneration?.limits, { duration_sec: { min: 1, max: 8 } });
  assert.equal(normalized.warnings[0]?.code, 'user_custom_model');
});
