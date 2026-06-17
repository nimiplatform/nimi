import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat/headless';

import {
  resolveAgentManualVoiceRenderRequest,
} from '../src/shell/renderer/features/chat/chat-agent-manual-voice-request.js';
import type { AgentLocalTargetSnapshot } from '../src/shell/renderer/bridge/runtime-bridge/types.js';

function target(): AgentLocalTargetSnapshot {
  return {
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
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
      debugType: 'agent-text-turn',
      prompt: 'Prompt',
      systemPrompt: null,
      rawModelOutput: null,
      normalizedModelOutput: null,
      statusCue: null,
      followUpInstruction: null,
      followUpTurn: false,
      chainId: null,
      followUpDepth: null,
      maxFollowUpTurns: null,
      followUpCanceledByUser: false,
      followUpSourceActionId: null,
      followUpDelayMs: null,
      runtimeAgentTurns: {
        transport: 'runtime.agent.turns',
        conversationAnchorId: 'anchor-1',
        runtimeTurnId: 'turn-1',
        runtimeStreamId: 'stream-1',
        route: 'local',
        modelId: 'model-1',
        connectorId: null,
        traceId: null,
        modelResolved: null,
        routeDecision: null,
      },
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
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    messageId: 'message-1',
    text: 'Committed answer.',
    playbackTarget: 'desktop_manual',
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
