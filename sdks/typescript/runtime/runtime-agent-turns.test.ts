import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNimiRuntimeAgentTurnPayload } from './index';

test('Runtime Agent turn payload never carries request execution bindings', () => {
  const payload = buildNimiRuntimeAgentTurnPayload({
    ownerUserId: 'owner',
    runtimeSourceRef: 'agent',
    localAgentRef: 'local-agent:owner:agent',
    conversationAnchorId: 'anchor',
    requestId: 'request',
    messages: [{ role: 'user', content: 'hello' }],
    execution_bindings: {
      'text.generate': {
        route: 'local',
        modelId: 'app-local-model',
      },
    },
    executionBindings: {
      'text.generate': {
        route: 'cloud',
        modelId: 'app-local-cloud-model',
      },
    },
  } as Parameters<typeof buildNimiRuntimeAgentTurnPayload>[0] & Record<string, unknown>);

  assert.equal('execution_bindings' in payload, false);
  assert.equal('executionBindings' in payload, false);
});
