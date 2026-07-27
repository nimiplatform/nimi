import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiRuntimeExternalAgentAccessSurface } from '@nimiplatform/sdk/runtime';
import { isExternalAgentTokenActionPlaneAvailable } from '../src/shell/renderer/features/runtime-config/runtime-config-external-agent-access-model';

test('D-AUTH-010: external principal token SDK Runtime surface stays available', () => {
  assert.equal(typeof createNimiRuntimeExternalAgentAccessSurface, 'function');
});

test('D-AUTH-010: external principal token action plane fails closed for busy or unavailable capability states', () => {
  assert.equal(isExternalAgentTokenActionPlaneAvailable({
    busy: false,
    enabled: true,
    loading: false,
    actionCount: 1,
  }), true);

  for (const state of [
    { busy: true, enabled: true, loading: false, actionCount: 1 },
    { busy: false, enabled: false, loading: false, actionCount: 1 },
    { busy: false, enabled: true, loading: true, actionCount: 1 },
    { busy: false, enabled: true, loading: false, actionCount: 0 },
    { busy: false, enabled: true, loading: false, actionCount: null },
  ]) {
    assert.equal(isExternalAgentTokenActionPlaneAvailable(state), false);
  }
});
