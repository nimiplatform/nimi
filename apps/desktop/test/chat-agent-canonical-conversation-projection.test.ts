import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NimiLocalAppConversationClient,
  NimiLocalAppConversationSnapshot,
} from '@nimiplatform/sdk/app';
import {
  materializeCanonicalConversationBundle,
  reduceCanonicalConversationEvent,
  seedCanonicalConversationProjection,
} from '../src/shell/renderer/features/chat/chat-agent-canonical-conversation-projection.js';
import type { AgentLocalThreadRecord } from '../src/shell/renderer/bridge/runtime-bridge/types.js';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;

function snapshot(): NimiLocalAppConversationSnapshot {
  return {
    conversationAnchorId: 'anchor-1',
    throughSequence: '4',
    truncatedBefore: true,
    turns: [{
      turnId: 'turn-1', status: 'active', phase: 'started',
      terminalReason: null, reasonCode: null, message: null,
    }],
    messages: [{
      messageId: 'message-user-1', turnId: 'turn-1', role: 'user',
      parts: [{ kind: 'text', text: 'hello' }],
    }],
    actions: [{
      actionId: 'action-1', turnId: 'turn-1', capabilityContract: 'image.generate',
      status: 'started', projectionMessageId: 'message-image-1', artifactId: null,
      reasonCode: null, message: null,
    }],
    voices: [{
      voiceId: 'voice-1', turnId: 'turn-1', messageId: 'message-voice-1',
      state: 'failed', artifactId: null, reasonCode: 'AI_ROUTE_UNAVAILABLE',
      message: 'Voice is unavailable.',
    }],
  };
}

function thread(): AgentLocalThreadRecord {
  return {
    id: 'agent-thread:anchor-1',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'source-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    title: 'Agent',
    createdAtMs: 1,
    updatedAtMs: 1,
    lastMessageAtMs: null,
    targetSnapshot: {
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'source-1',
      localAgentRef: 'local-agent:owner-1:agent-1',
      agentHandle: AGENT_HANDLE,
      conversationAnchorId: 'anchor-1',
      displayName: 'Agent',
      handle: '',
      avatarUrl: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
  };
}

test('canonical projection uses snapshot sequence as a monotonic barrier', () => {
  const seeded = seedCanonicalConversationProjection(snapshot());
  const stale = reduceCanonicalConversationEvent(seeded, {
    type: 'text-delta', conversationAnchorId: 'anchor-1', sequence: '4',
    turnId: 'turn-1', delta: 'stale',
  });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.projection, seeded);

  const gap = reduceCanonicalConversationEvent(seeded, {
    type: 'text-delta', conversationAnchorId: 'anchor-1', sequence: '6',
    turnId: 'turn-1', delta: 'gap',
  });
  assert.equal(gap.status, 'gap');
  assert.equal(gap.projection.throughSequence, '4');

  const applied = reduceCanonicalConversationEvent(seeded, {
    type: 'text-delta', conversationAnchorId: 'anchor-1', sequence: '5',
    turnId: 'turn-1', delta: 'live',
  });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.projection.throughSequence, '5');
  assert.equal(applied.projection.transientByTurn['turn-1']?.text, 'live');
});

test('canonical projection keeps stable turn, action, voice, and message identities', () => {
  let projection = seedCanonicalConversationProjection(snapshot());
  projection = reduceCanonicalConversationEvent(projection, {
    type: 'action-failed', conversationAnchorId: 'anchor-1', sequence: '5', turnId: 'turn-1',
    action: {
      actionId: 'action-1', turnId: 'turn-1', capabilityContract: 'image.generate',
      status: 'failed', projectionMessageId: 'message-image-1', artifactId: null,
      reasonCode: 'AI_PROVIDER_TIMEOUT', message: 'Timed out.',
    },
  }).projection;
  projection = reduceCanonicalConversationEvent(projection, {
    type: 'message-committed', conversationAnchorId: 'anchor-1', sequence: '6', turnId: 'turn-1',
    message: {
      messageId: 'message-assistant-1', turnId: 'turn-1', role: 'assistant',
      parts: [{ kind: 'text', text: 'final' }],
    },
  }).projection;
  projection = reduceCanonicalConversationEvent(projection, {
    type: 'turn-completed', conversationAnchorId: 'anchor-1', sequence: '7', turnId: 'turn-1',
    terminalReason: 'stop',
  }).projection;

  assert.equal(projection.turns.length, 1);
  assert.equal(projection.turns[0]?.status, 'completed');
  assert.equal(projection.actions.length, 1);
  assert.equal(projection.actions[0]?.status, 'failed');
  assert.equal(projection.voices.length, 1);
  assert.equal(projection.messages.map((message) => message.messageId).join(','), 'message-user-1,message-assistant-1');
});

test('canonical materialization preserves snapshot recovery metadata and typed child terminals', async () => {
  const conversation = {
    readArtifact: async () => { throw new Error('not used'); },
  } as unknown as NimiLocalAppConversationClient;
  const bundle = await materializeCanonicalConversationBundle({
    conversation,
    thread: thread(),
    projection: seedCanonicalConversationProjection(snapshot()),
    nowMs: 100,
  });

  assert.equal(bundle.canonicalConversation?.throughSequence, '4');
  assert.equal(bundle.canonicalConversation?.truncatedBefore, true);
  assert.equal(bundle.canonicalConversation?.turns.length, 1);
  assert.equal(bundle.canonicalConversation?.actions.length, 1);
  assert.equal(bundle.canonicalConversation?.voices.length, 1);
  assert.equal(bundle.messages.find((message) => message.id === 'message-image-1')?.status, 'pending');
  const voice = bundle.messages.find((message) => message.id === 'canonical-voice:voice-1');
  assert.equal(voice?.error?.code, 'AI_ROUTE_UNAVAILABLE');
  assert.equal(voice?.parentMessageId, 'message-voice-1');
});
