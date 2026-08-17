import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNimiRuntimeConfigConnectorDraft,
  normalizeNimiRuntimeConfigConnectorProjection,
  normalizeNimiRuntimeConfigLocalNodeMatrixEntryProjection,
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

test('Runtime local config projection normalizes nodes without ranking', () => {
  const node = normalizeNimiRuntimeConfigLocalNodeMatrixEntryProjection({
    nodeId: 'tester-chat.runtime-native',
    capability: 'chat',
    serviceId: 'tester-runtime-local',
    provider: 'Runtime-Local',
    adapter: 'media_native_adapter',
    available: true,
  });
  assert.equal(node.provider, 'runtime-local');
  assert.equal(node.adapter, 'media_native_adapter');
  assert.equal(node.available, true);
});
