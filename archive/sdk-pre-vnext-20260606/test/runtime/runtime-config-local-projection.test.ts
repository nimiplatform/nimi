import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT,
  normalizeRuntimeConfigLocalModelProjection,
  normalizeRuntimeConfigLocalNodeMatrixEntryProjection,
  pickPreferredRuntimeConfigLocalModel,
} from '../../src/runtime/index.js';

test('runtime config local model projection normalizes persisted app snapshots without owning truth', () => {
  const model = normalizeRuntimeConfigLocalModelProjection({
    localModelId: ' local/qwen ',
    model: ' qwen3:4b ',
    engine: ' llama ',
    endpoint: 'http://127.0.0.1:11434/v1///',
    capabilities: ['chat', 'unknown'] as never,
    status: 'active',
    integrityMode: 'local_unverified',
    hash: ' sha256:abc ',
  });

  assert.deepEqual(model, {
    localModelId: 'local/qwen',
    engine: 'llama',
    model: 'qwen3:4b',
    endpoint: 'http://127.0.0.1:11434/v1',
    capabilities: ['chat'],
    status: 'active',
    integrityMode: 'local_unverified',
    hash: 'sha256:abc',
    installedAt: undefined,
    updatedAt: undefined,
    recommendation: undefined,
  });
});

test('runtime config local model projection keeps blank endpoint when Runtime does not project one', () => {
  const model = normalizeRuntimeConfigLocalModelProjection({
    localModelId: 'local/embed-default',
    model: 'llama/embed',
    capabilities: ['embedding'],
  });

  assert.equal(model.endpoint, RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT);
  assert.equal(model.status, 'installed');
  assert.deepEqual(model.capabilities, ['embedding']);
});

test('runtime config local node projection preserves provider hint evidence', () => {
  const node = normalizeRuntimeConfigLocalNodeMatrixEntryProjection({
    nodeId: '',
    capability: 'diarize',
    serviceId: ' svc-speech ',
    provider: ' SPEECH ',
    adapter: 'speech_native_adapter',
    available: true,
    providerHints: {
      speech: {
        preferredAdapter: 'speech_native_adapter',
      },
      extra: {
        runtime_support_class: 'attached_only',
      },
    },
  });

  assert.match(node.nodeId, /^node-/);
  assert.equal(node.capability, 'diarize');
  assert.equal(node.serviceId, 'svc-speech');
  assert.equal(node.provider, 'speech');
  assert.equal(node.adapter, 'speech_native_adapter');
  assert.equal(node.providerHints?.speech?.preferredAdapter, 'speech_native_adapter');
  assert.equal(node.providerHints?.extra?.runtime_support_class, 'attached_only');
});

test('runtime config local model preference is a reusable app projection', () => {
  const preferred = pickPreferredRuntimeConfigLocalModel({
    models: [
      normalizeRuntimeConfigLocalModelProjection({
        localModelId: 'removed',
        model: 'aaa',
        capabilities: ['chat'],
        status: 'removed',
      }),
      normalizeRuntimeConfigLocalModelProjection({
        localModelId: 'installed',
        model: 'bbb',
        capabilities: ['chat'],
        status: 'installed',
      }),
      normalizeRuntimeConfigLocalModelProjection({
        localModelId: 'active',
        model: 'ccc',
        capabilities: ['chat'],
        status: 'active',
      }),
    ],
  });

  assert.equal(preferred?.localModelId, 'active');
});
