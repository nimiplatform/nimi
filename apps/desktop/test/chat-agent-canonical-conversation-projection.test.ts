import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NimiLocalAppConversationSnapshot,
} from '@nimiplatform/sdk/app';
import {
  reduceCanonicalConversationEvent,
  seedCanonicalConversationProjection,
} from '@nimiplatform/kit/features/chat/headless';
import { materializeCanonicalConversationBundle } from '../src/shell/renderer/features/chat/chat-agent-canonical-conversation-projection.js';
import type { AgentLocalThreadRecord } from '../src/shell/renderer/bridge/runtime-bridge/types.js';

const AGENT_HANDLE = `agent_ref_${'a'.repeat(43)}`;

function snapshot(): NimiLocalAppConversationSnapshot {
  return {
    conversationAnchorId: 'anchor-1',
    state:{freeContactEnabled:false,maxFollowUpTurns:8,pendingFollowUp:null,textTurnId:null},
    throughSequence: '4',
    truncatedBefore: true,
    turns: [{
      turnId: 'turn-1', origin:'user', requestId: null, retryOfTurnId: null, inputTurnId: null, canRegenerate: false, status: 'active', phase: 'started',
      terminalReason: null, reasonCode: null, message: null,
    }],
    messages: [{
      partial: false, quote: null, messageId: 'message-user-1', turnId: 'turn-1', role: 'user',
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
    title: 'Agent',
    createdAtMs: 1,
    updatedAtMs: 1,
    lastMessageAtMs: null,
    targetSnapshot: {
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

test('late media failures remain beside their original reply when newer text exists', () => {
  const source = snapshot();
  const value: NimiLocalAppConversationSnapshot = { ...source, messages: [...source.messages, {
    messageId: 'new-user', turnId: 'turn-2', role: 'user', partial: false, quote: null, parts: [{ kind: 'text', text: 'new question' }],
  }], actions: source.actions.map(action => ({ ...action, status: 'failed', reasonCode: 'AI_PROVIDER_TIMEOUT' })) };
  const result = materializeCanonicalConversationBundle({ thread: thread(), projection: seedCanonicalConversationProjection(value), nowMs: 1 });
  const oldImage = result.messages.findIndex(message => message.kind === 'image');
  const oldVoice = result.messages.findIndex(message => message.kind === 'voice');
  const newUser = result.messages.findIndex(message => message.id === 'new-user');
  assert.ok(oldImage > 0 && oldImage < newUser);
  assert.equal(oldVoice, -1);
});


test('empty failed attempts precede the successful regeneration of their original input', () => {
  const base = snapshot();
  const original = { ...base.turns[0]!, status: 'failed' as const, inputTurnId: 'turn-1', canRegenerate: false };
  const value: NimiLocalAppConversationSnapshot = {
    ...base, actions: [], voices: [],
    turns: [original, { ...original, turnId: 'turn-2', retryOfTurnId: 'turn-1' },
      { ...original, turnId: 'turn-3', retryOfTurnId: 'turn-2', status: 'completed' }],
    messages: [...base.messages, {
      messageId: 'successful-answer', turnId: 'turn-3', role: 'assistant', partial: false, quote: null,
      parts: [{ kind: 'text', text: 'The original picture is blue and green.' }],
    }],
  };
  const bundle = materializeCanonicalConversationBundle({ thread: thread(), projection: seedCanonicalConversationProjection(value), nowMs: 1 });
  assert.deepEqual(bundle.messages.map(message => message.id), ['message-user-1', 'canonical-turn:turn-1', 'canonical-turn:turn-2', 'successful-answer']);
  assert.equal(bundle.messages.filter(message => message.role === 'user').length, 1);
  assert.equal(bundle.messages.at(-1)?.status, 'complete');
});

test('late committed images stay with the original reply both live and after reload', () => {
  const base = snapshot();
  const value: NimiLocalAppConversationSnapshot = { ...base, voices: [], messages: [...base.messages,
    { messageId: 'original-answer', turnId: 'turn-1', role: 'assistant', partial: false, quote: null, parts: [{ kind: 'text', text: 'Drawing the boat.' }] },
    { messageId: 'new-user', turnId: 'turn-2', role: 'user', partial: false, quote: null, parts: [{ kind: 'text', text: 'Only describe the wind.' }] },
    { messageId: 'new-answer', turnId: 'turn-2', role: 'assistant', partial: false, quote: null, parts: [{ kind: 'text', text: 'The wind is light.' }] },
  ] };
  const image = { messageId: 'message-image-1', turnId: 'turn-1', role: 'assistant' as const, partial: false, quote: null,
    parts: [{ kind: 'artifact-ref' as const, artifactId: 'image-artifact', mediaKind: 'image' as const, mimeType: 'image/png', displayName: null }] };
  const live = reduceCanonicalConversationEvent(seedCanonicalConversationProjection(value), {
    type: 'message-committed', sequence: '5', conversationAnchorId: 'anchor-1', turnId: 'turn-1', message: image,
  }).projection;
  const restored = seedCanonicalConversationProjection({ ...value, throughSequence: '5', messages: [...value.messages, image] });
  for (const projection of [live, restored]) {
    const bundle = materializeCanonicalConversationBundle({ thread: thread(), projection, nowMs: 1 });
    assert.deepEqual(bundle.messages.map(message => message.id), ['message-user-1', 'original-answer', 'message-image-1', 'new-user', 'new-answer']);
    assert.equal(bundle.messages[2]?.artifactId, 'image-artifact');
  }
});


test('voice failure and recovery share the original reply without a second player or eager audio read', () => {
  const initial = snapshot();
  const base: NimiLocalAppConversationSnapshot = {...initial,messages:[...initial.messages, {messageId:'message-voice-1',turnId:'turn-1',role:'assistant',partial: false, quote: null,parts:[{kind:'text',text:'Original saved reply'}]}]};
  let reads = 0;
  const materialize = (value: NimiLocalAppConversationSnapshot) => materializeCanonicalConversationBundle({thread:thread(),projection:seedCanonicalConversationProjection(value),nowMs:1,media:{get(){reads++;return {mediaUrl:null,mimeType:null};}}});
  const failed = materialize(base).messages.find(message => message.id === 'message-voice-1')!;
  assert.equal(failed.metadataJson?.canonicalVoiceState, 'failed');
  assert.equal(failed.status, 'complete');
  const ready = materialize({...base,actions:[],voices:[{...base.voices[0]!,state:'ready',artifactId:'audio-1',reasonCode:null,message:null}]}).messages;
  assert.equal(ready.filter(message => message.kind === 'voice').length,0);
  assert.equal(ready.find(message=>message.id==='message-voice-1')?.metadataJson?.canonicalVoiceArtifactId,'audio-1');
  assert.equal(reads,0);
});
