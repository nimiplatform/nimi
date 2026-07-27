import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationAnchorStatus } from '@nimiplatform/sdk/runtime/wire-types';
import type { AgentLocalTargetSnapshot } from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import { toAgentRuntimeConversationSummary } from '../src/shell/renderer/features/chat/chat-agent-runtime-conversation-summaries.js';

test('Runtime Agent conversation summary adapter keeps Runtime anchor identity explicit', () => {
  const target: AgentLocalTargetSnapshot = {
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    displayName: 'Guide',
    handle: '@guide',
    avatarUrl: null,
    presentationProfile: null,
    worldId: null,
    worldName: null,
    bio: null,
    ownershipType: null,
    greeting: null,
    builtinDocsContext: null,
  };

  const summary = toAgentRuntimeConversationSummary(target, {
    anchor: {
      conversationAnchorId: 'anchor-1',
      agentId: '',
      subjectUserId: 'owner-1',
      status: ConversationAnchorStatus.ACTIVE,
      lastTurnId: 'turn-1',
      lastMessageId: 'msg-anchor',
      localAgentRef: 'local-agent:owner-1:agent-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      createdAt: { seconds: '1700000000', nanos: 0 },
      updatedAt: { seconds: '1700000001', nanos: 250000000 },
    },
    title: 'Runtime title',
    lastMessageRole: 'assistant',
    lastMessageText: 'Hello from Runtime',
    lastMessageId: 'msg-summary',
    transcriptMessageCount: 2,
    updatedAt: { seconds: '1700000002', nanos: 500000000 },
  });

  assert.equal(summary?.conversationAnchorId, 'anchor-1');
  assert.equal(summary?.localAgentRef, target.localAgentRef);
  assert.equal(summary?.lastMessageId, 'msg-summary');
  assert.equal(summary?.updatedAtMs, 1700000002500);
  assert.equal(summary?.targetSnapshot, target);
});
