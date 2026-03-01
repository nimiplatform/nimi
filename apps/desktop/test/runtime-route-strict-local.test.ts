import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveRuntimeCapabilityConfigFromStateV11,
} from '../src/shell/renderer/features/runtime-config/state/runtime-route-resolver-v11';
import { RuntimeRouteResolutionError } from '../src/shell/renderer/features/runtime-config/state/routing/errors';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/state/v11/storage/defaults';

const seed = {
  provider: 'local-runtime',
  runtimeModelType: 'chat',
  localProviderEndpoint: 'http://127.0.0.1:1234/v1',
  localProviderModel: 'local-model',
  localOpenAiEndpoint: 'https://openrouter.ai/api/v1',
};

test('strict local-runtime route throws RUNTIME_ROUTE_MODEL_MISSING when no local models exist', () => {
  const state = createDefaultStateV11(seed);
  state.selectedSource = 'local-runtime';
  state.localRuntime.models = [];
  state.localRuntime.nodeMatrix = [];

  assert.throws(
    () => {
      resolveRuntimeCapabilityConfigFromStateV11(state, seed, 'chat', {
        routeOverride: {
          source: 'local-runtime',
        },
      });
    },
    (error) => {
      assert(error instanceof RuntimeRouteResolutionError);
      assert.equal(error.code, 'RUNTIME_ROUTE_MODEL_MISSING');
      return true;
    },
  );
});
