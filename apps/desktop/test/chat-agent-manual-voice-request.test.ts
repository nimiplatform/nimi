import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';

import {
  resolveAgentManualVoiceRenderRequest,
} from '../src/shell/renderer/features/chat/chat-agent-manual-voice-request.js';
import type { AgentLocalTargetSnapshot } from '../src/shell/renderer/bridge/runtime-bridge/types.js';

function target(): AgentLocalTargetSnapshot {
  return {
    agentHandle: 'agent_ref_test-handle',
    displayName: 'Companion',
    handle: 'companion',
    avatarUrl: null,
    worldId: 'world-1',
    worldName: 'World',
    bio: null,
    ownershipType: 'MASTER_OWNED',
    greeting: null,
    builtinDocsContext: null,
  };
}

function runtimeAssistantMessage(overrides?: Partial<ConversationCanonicalMessage>): ConversationCanonicalMessage {
  return {
    id: 'message-1',
    sessionId: 'anchor-1',
    targetId: 'local-agent:user-1:agent-1',
    source: 'agent',
    role: 'assistant',
    text: 'Committed answer.',
    kind: 'text',
    status: 'complete',
    createdAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
    metadata: {
      canonicalTurnId: 'turn-1',
      canonicalConversationAnchorId: 'anchor-1',
      canonicalPartial: false,
      canonicalTurnStatus: 'completed',
    },
    ...overrides,
  };
}

test('desktop manual voice request targets a committed Runtime assistant message', () => {
  assert.deepEqual(resolveAgentManualVoiceRenderRequest({
    message: runtimeAssistantMessage(),
    activeTarget: target(),
    activeConversationAnchorId: 'anchor-1',
  }), {
    agentHandle: 'agent_ref_test-handle',
    conversationAnchorId: 'anchor-1',
    messageId: 'message-1',
  });
});

test('desktop manual voice request is absent without Runtime turn identity', () => {
  assert.equal(resolveAgentManualVoiceRenderRequest({
    message: runtimeAssistantMessage({ metadata: undefined }),
    activeTarget: target(),
    activeConversationAnchorId: 'anchor-1',
  }), null);
});

test('desktop manual voice request is absent when anchor identity does not match the active session', () => {
  assert.equal(resolveAgentManualVoiceRenderRequest({
    message: runtimeAssistantMessage(),
    activeTarget: target(),
    activeConversationAnchorId: 'anchor-2',
  }), null);
});

test('desktop manual voice playback uses only canonical Conversation voice and artifact operations', async () => {
  const source = await readFile(path.resolve(
    import.meta.dirname,
    '../src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx',
  ), 'utf8');
  assert.match(source, /conversation\.renderVoice\(\{/u);
  assert.match(source, /conversation\.readArtifact\(\{/u);
  assert.doesNotMatch(source, /createNimiRuntimeAgentTurnsModule|runtimeAgentTurns|readArtifactBytes|ownerUserId|runtimeSourceRef|localAgentRef/u);
});


test('manual voice excludes uncommitted, partial, user, and legacy debug-only messages', () => {
  for (const message of [
    runtimeAssistantMessage({ status: 'pending' }),
    runtimeAssistantMessage({ metadata: { canonicalTurnId: 'turn-1', canonicalConversationAnchorId: 'anchor-1', canonicalTurnStatus: 'active' } }),
    runtimeAssistantMessage({ status: 'error' }),
    runtimeAssistantMessage({ role: 'user' }),
    runtimeAssistantMessage({ metadata: { canonicalTurnId: 'turn-1', canonicalConversationAnchorId: 'anchor-1', canonicalPartial: true } }),
    runtimeAssistantMessage({ metadata: { runtimeAgentTurns: { transport: 'runtime.agent.turns', conversationAnchorId: 'anchor-1' } } }),
  ]) {
    assert.equal(resolveAgentManualVoiceRenderRequest({ message, activeTarget: target(), activeConversationAnchorId: 'anchor-1' }), null);
  }
});
