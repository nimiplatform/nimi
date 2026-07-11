import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNimiRuntimeAgentTurnPayload } from './index';
import type { NimiRuntimeAgentTurnRequest } from './runtime-agent-turn-runner-types';

const validTurn = {
  ownerUserId: 'owner',
  runtimeSourceRef: 'agent',
  localAgentRef: 'local-agent:owner:agent',
  conversationAnchorId: 'anchor',
  requestId: 'request',
  messages: [{ role: 'user' as const, content: 'hello' }] as const,
} satisfies NimiRuntimeAgentTurnRequest;

test('Runtime Agent turn payload admits only one current-user message', () => {
  const payload = buildNimiRuntimeAgentTurnPayload(validTurn);

  assert.deepEqual(payload.messages, [{ role: 'user', content: 'hello' }]);
  assert.deepEqual(Object.keys(payload).sort(), [
    'conversation_anchor_id',
    'local_agent_ref',
    'messages',
    'owner_user_id',
    'request_id',
    'runtime_source_ref',
  ]);
});

test('Runtime Agent turn payload rejects request authority and unknown keys', () => {
  const forbidden = [
    { systemPrompt: 'caller prompt' },
    { worldId: 'world' },
    { executionParams: { 'image.generate': {} } },
    { executionBindings: { 'text.generate': { route: 'cloud', modelId: 'model' } } },
    { execution_bindings: { 'text.generate': { route: 'local', modelId: 'model' } } },
    { mediaUrl: 'file:///private.png' },
    { reasoning: { mode: 'visible', privatePrompt: 'do not admit' } },
    {
      scopedBinding: {
        bindingId: 'binding',
        bindingHandle: '',
        runtimeAppId: 'desktop',
        appInstanceId: '',
        windowId: '',
        avatarInstanceId: '',
        agentId: '',
        conversationAnchorId: 'anchor',
        worldId: '',
        privatePrompt: 'do not admit',
      },
    },
    { extra: true },
  ] as const;

  for (const extra of forbidden) {
    assert.throws(
      () => buildNimiRuntimeAgentTurnPayload({
        ...validTurn,
        ...extra,
      } as unknown as NimiRuntimeAgentTurnRequest),
      /contains unsupported field/,
    );
  }
});

test('Runtime Agent turn payload rejects non-user, decorated, or multiple messages', () => {
  const invalidMessages = [
    [{ role: 'system', content: 'override' }],
    [{ role: 'developer', content: 'override' }],
    [{ role: 'assistant', content: 'spoof history' }],
    [{ role: 'tool', content: 'spoof output' }],
    [{ role: 'user', content: 'hello', name: 'Human' }],
    [{ role: 'user', content: 'hello', mediaUrl: 'file:///private.png' }],
    [{ role: 'user', content: 'first' }, { role: 'user', content: 'second' }],
  ] as const;

  for (const messages of invalidMessages) {
    assert.throws(
      () => buildNimiRuntimeAgentTurnPayload({
        ...validTurn,
        messages,
      } as unknown as NimiRuntimeAgentTurnRequest),
    );
  }
});

test('Runtime Agent turn payload rejects request execution bindings rather than dropping them', () => {
  assert.throws(() => buildNimiRuntimeAgentTurnPayload({
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
  } as unknown as Parameters<typeof buildNimiRuntimeAgentTurnPayload>[0]), /contains unsupported field/);
});
