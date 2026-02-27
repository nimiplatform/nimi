import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveRuntimeCapabilityConfigFromStateV11,
} from '../src/shell/renderer/features/runtime-config/state/runtime-route-resolver-v11';
import { RuntimeRouteResolutionError } from '../src/shell/renderer/features/runtime-config/state/routing/errors';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/state/v11/storage/defaults';
import { createConnectorV11 } from '../src/shell/renderer/features/runtime-config/state/v11/types';

const seed = {
  provider: 'local-runtime',
  runtimeModelType: 'chat',
  localProviderEndpoint: 'http://127.0.0.1:1234/v1',
  localProviderModel: 'local-model',
  localOpenAiEndpoint: 'https://openrouter.ai/api/v1',
  credentialRefId: '',
};

test('token-api route resolution fails close when connector token is missing', () => {
  const state = createDefaultStateV11(seed);
  const connector = createConnectorV11('gemini', 'Gemini');
  connector.endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai';
  connector.models = ['gemini-2.5-flash'];
  connector.tokenApiKey = '';

  state.selectedSource = 'token-api';
  state.connectors = [connector];
  state.selectedConnectorId = connector.id;

  assert.throws(
    () => {
      resolveRuntimeCapabilityConfigFromStateV11(state, seed, 'chat', {
        routeOverride: {
          source: 'token-api',
          connectorId: connector.id,
        },
      });
    },
    (error) => {
      assert(error instanceof RuntimeRouteResolutionError);
      assert.equal(error.code, 'RUNTIME_ROUTE_CONNECTOR_TOKEN_MISSING');
      return true;
    },
  );
});
