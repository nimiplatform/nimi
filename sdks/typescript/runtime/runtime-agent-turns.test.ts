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
    { mediaUrl: 'file:///private.png' },
    { reasoning: { mode: 'visible', privatePrompt: 'do not admit' } },
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

test('Runtime Agent turn payload projects message attachments as snake_case artifact refs', () => {
  const payload = buildNimiRuntimeAgentTurnPayload({
    ...validTurn,
    messages: [{
      role: 'user' as const,
      content: '',
      attachments: [{ artifactId: ' artifact-1 ', displayName: ' photo.png ' }],
    }],
  });

  assert.deepEqual(payload.messages, [{
    role: 'user',
    content: '',
    attachments: [{ artifact_id: 'artifact-1', display_name: 'photo.png' }],
  }]);
});

test('Runtime Agent turn payload omits empty attachment display_name', () => {
  const payload = buildNimiRuntimeAgentTurnPayload({
    ...validTurn,
    messages: [{
      role: 'user' as const,
      content: 'look at this',
      attachments: [{ artifactId: 'artifact-1', displayName: '   ' }],
    }],
  });

  assert.deepEqual(payload.messages, [{
    role: 'user',
    content: 'look at this',
    attachments: [{ artifact_id: 'artifact-1' }],
  }]);
});

test('Runtime Agent turn payload rejects empty message without content or attachments', () => {
  assert.throws(
    () => buildNimiRuntimeAgentTurnPayload({
      ...validTurn,
      messages: [{ role: 'user', content: '   ' }],
    }),
    /requires non-empty content or an attachment/,
  );
});

test('Runtime Agent turn payload rejects invalid message attachments', () => {
  const invalidAttachments = [
    [{ artifactId: 'artifact-1' }, { artifactId: 'artifact-2' }],
    [{ artifactId: '   ' }],
    [{ artifactId: 'artifact-1', displayName: 42 }],
    [{ artifactId: 'artifact-1', url: 'file:///private.png' }],
    'artifact-1',
  ] as const;

  for (const attachments of invalidAttachments) {
    assert.throws(
      () => buildNimiRuntimeAgentTurnPayload({
        ...validTurn,
        messages: [{ role: 'user', content: '', attachments }],
      } as unknown as NimiRuntimeAgentTurnRequest),
    );
  }
});
