import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeStoredStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-normalize.js';

test('runtime config storage normalization drops retired local node state', () => {
  const normalized = normalizeStoredStateV11({
    version: 12,
    initializedByV11: true,
    activePage: 'environment',
    diagnosticsCollapsed: false,
    uiMode: 'advanced',
    selectedSource: 'local',
    activeCapability: 'chat',
    local: {
      endpoint: 'http://127.0.0.1:11434',
      nodeMatrix: [{
        nodeId: 'stale-node',
        capability: 'chat',
        available: true,
      }],
    } as never,
  });

  assert.equal('endpoint' in normalized.local, false);
  assert.equal('nodeMatrix' in normalized.local, false);
  assert.deepEqual(normalized.connectors, []);
});
