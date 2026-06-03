import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeStoredStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-normalize.js';

test('runtime config storage normalization drops stale local runtime endpoint and inventory', () => {
  const normalized = normalizeStoredStateV11({
    version: 12,
    initializedByV11: true,
    activePage: 'advanced',
    diagnosticsCollapsed: false,
    uiMode: 'advanced',
    selectedSource: 'local',
    activeCapability: 'chat',
    local: {
      endpoint: 'http://127.0.0.1:11434',
      models: [{
        localModelId: 'stale-local-model',
        model: 'stale-local-model',
        status: 'active',
        capabilities: ['chat'],
      }],
      nodeMatrix: [{
        nodeId: 'stale-node',
        capability: 'chat',
        available: true,
      }],
    } as never,
  });

  assert.equal(normalized.local.endpoint, '');
  assert.deepEqual(normalized.local.models, []);
  assert.deepEqual(normalized.local.nodeMatrix, []);
  assert.deepEqual(normalized.connectors, []);
});
