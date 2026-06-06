import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiRuntimeConfigConnectorDraft,
  normalizeNimiRuntimeConfigConnectorProjection,
  normalizeNimiRuntimeConfigLocalModelProjection,
  normalizeNimiRuntimeConfigLocalNodeMatrixEntryProjection,
  pickPreferredNimiRuntimeConfigLocalModel,
  projectNimiRuntimeRouteCapabilityCoverage,
  projectNimiRuntimeRouteCapabilityCoverageList,
  runtimeConnectorProjectionToNimiRuntimeConfigConnector,
} from './index';

test('Runtime config connector projection normalizes draft and connector evidence', () => {
  const draft = createNimiRuntimeConfigConnectorDraft({
    id: 'connector-draft',
    vendor: 'openai_compatible',
  });
  assert.equal(draft.id, 'connector-draft');
  assert.equal(draft.label, 'Openai Compatible Connector');
  assert.equal(draft.status, 'idle');

  const connector = runtimeConnectorProjectionToNimiRuntimeConfigConnector({
    id: 'connector-1',
    label: 'Connector 1',
    vendor: 'tester',
    provider: 'tester',
    authMode: 'api_key',
    endpoint: 'https://tester.invalid/v1///',
    scope: 'user',
    hasCredential: true,
    isSystemOwned: false,
    models: ['tester-text', ' tester-text ', 'tester-image'],
  });

  const normalized = normalizeNimiRuntimeConfigConnectorProjection({
    ...connector,
    status: 'healthy',
    modelCapabilities: {
      'tester-text': ['text.generate', 'text.generate'],
      'tester-image': ['image.generate'],
      empty: [],
    },
  });

  assert.equal(normalized.endpoint, 'https://tester.invalid/v1');
  assert.deepEqual(normalized.models, ['tester-text', 'tester-image']);
  assert.deepEqual(normalized.modelCapabilities, {
    'tester-text': ['text.generate'],
    'tester-image': ['image.generate'],
  });
  assert.equal(normalized.status, 'healthy');
});

test('Runtime local config projection selects the active supported local model', () => {
  const models = [
    normalizeNimiRuntimeConfigLocalModelProjection({
      localModelId: 'removed',
      model: 'tester/removed',
      capabilities: ['chat'],
      status: 'removed',
    }),
    normalizeNimiRuntimeConfigLocalModelProjection({
      localModelId: 'active',
      model: 'tester/active',
      engine: 'runtime-native',
      endpoint: 'http://127.0.0.1:11434/v1///',
      capabilities: ['chat', 'image'],
      status: 'active',
    }),
  ];
  const node = normalizeNimiRuntimeConfigLocalNodeMatrixEntryProjection({
    nodeId: 'tester-chat.runtime-native',
    capability: 'chat',
    serviceId: 'tester-runtime-local',
    provider: 'Runtime-Local',
    adapter: 'media_native_adapter',
    available: true,
  });
  const preferred = pickPreferredNimiRuntimeConfigLocalModel({ models, capability: 'chat' });

  assert.equal(models[1]?.endpoint, 'http://127.0.0.1:11434/v1');
  assert.equal(preferred?.localModelId, 'active');
  assert.equal(node.provider, 'runtime-local');
  assert.equal(node.adapter, 'media_native_adapter');
  assert.equal(node.available, true);
});

test('Runtime route capability coverage projects local and cloud availability', () => {
  const imageCoverage = projectNimiRuntimeRouteCapabilityCoverage({
    capability: 'image',
    localNodes: [
      {
        capability: 'image',
        provider: 'runtime-local',
        available: true,
      },
    ],
    localModels: [
      {
        status: 'installed',
        capabilities: ['image.generate'],
      },
    ],
    connectors: [
      {
        status: 'healthy',
        models: ['cloud-image'],
        modelCapabilities: {
          'cloud-image': ['image.generate'],
        },
      },
    ],
  });

  assert.deepEqual(imageCoverage, {
    capability: 'image',
    localAvailable: true,
    cloudAvailable: true,
    localProvider: 'runtime-local',
    errorReason: undefined,
  });

  const embeddingCoverage = projectNimiRuntimeRouteCapabilityCoverage({
    capability: 'embedding',
    localModels: [
      {
        status: 'active',
        capabilities: ['text.embed'],
      },
    ],
    connectors: [
      {
        status: 'unreachable',
        models: ['embedder'],
        modelCapabilities: {
          embedder: ['text.embed'],
        },
      },
    ],
  });

  assert.equal(embeddingCoverage.localAvailable, true);
  assert.equal(embeddingCoverage.cloudAvailable, false);
});

test('Runtime route capability coverage preserves local error reason when no route exists', () => {
  const coverage = projectNimiRuntimeRouteCapabilityCoverage({
    capability: 'stt',
    localNodes: [
      {
        capability: 'stt',
        available: false,
        reasonCode: 'LOCAL_SPEECH_ATTACHED_ENDPOINT_REQUIRED',
      },
    ],
    localModels: [],
    connectors: [],
  });

  assert.deepEqual(coverage, {
    capability: 'stt',
    localAvailable: false,
    cloudAvailable: false,
    localProvider: undefined,
    errorReason: 'LOCAL_SPEECH_ATTACHED_ENDPOINT_REQUIRED',
  });
});

test('Runtime route capability coverage list defaults to runnable local asset kinds', () => {
  const coverage = projectNimiRuntimeRouteCapabilityCoverageList({
    localModels: [
      {
        status: 'active',
        capabilities: ['chat'],
      },
    ],
  });

  assert.deepEqual(coverage.map((item) => item.capability), [
    'chat',
    'image',
    'video',
    'tts',
    'stt',
    'embedding',
  ]);
  assert.equal(coverage.find((item) => item.capability === 'chat')?.localAvailable, true);
});
