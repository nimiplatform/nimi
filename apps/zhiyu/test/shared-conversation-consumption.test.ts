import assert from 'node:assert/strict';
import test from 'node:test';
import { seedCanonicalConversationProjection, reduceCanonicalConversationEvent } from '@nimiplatform/kit/features/chat/headless';
import type { NimiLocalAppConversationSnapshot } from '@nimiplatform/sdk/app';
import { projectZhiyuConversation } from '../src/shell/agent-chat/agent-conversation-state.js';
import { isZhiyuDirectLocalAppSubmitEnabled } from '../src/shell/app/direct-local-app-submit-gate.js';
import { createInitialZhiyuEvidence } from '../src/shell/app/evidence.js';
import { turnStatusFromChat } from '../src/shell/app/app-evidence-transitions.js';
import { subscribeZhiyuAmbientConversation } from '../src/shell/agent-chat/ambient-conversation-subscription.js';

function snapshot(): NimiLocalAppConversationSnapshot {
  return { conversationAnchorId: 'anchor', throughSequence: '5', truncatedBefore: false,
    state: { textTurnId: null, followUpEnabled: false, followUpPolicyRevision: '0', maxFollowUpTurns: 8, pendingFollowUp: null },
    turns: [{ turnId: 'turn', origin: 'user', requestId: 'request', inputTurnId: 'turn', retryOfTurnId: null, canRegenerate: true,
      status: 'interrupted', phase: 'started', terminalReason: 'user_cancel', reasonCode: null, message: null }],
    messages: [{ messageId: 'answer', turnId: 'turn', role: 'assistant', partial: true, parts: [{ kind: 'text', text: '这部分已经收到' }] }],
    actions: [], voices: [] };
}
const scope = { agentHandle: 'agent_ref_test' as never, conversationAnchorId: 'anchor' };

test('explicit media reload rereads a failed image without sending or replacing its original message', async () => {
  const source = snapshot();
  source.messages.push({ messageId: 'image', turnId: 'turn', role: 'assistant', partial: false,
    parts: [{ kind: 'artifact-ref', artifactId: 'stored-image', mediaKind: 'image', mimeType: 'image/png', displayName: null }] });
  const chats: ReturnType<typeof projectZhiyuConversation>[] = [];
  const artifacts: string[] = [];
  let close!: () => void;
  const closed = new Promise<void>(resolve => { close = resolve; });
  const observation = subscribeZhiyuAmbientConversation({ identity: scope, onChat: chat => chats.push(chat), conversation: {
    snapshot: async () => source,
    subscribe: async () => ({ cancel: async () => close(), async *[Symbol.asyncIterator]() { await closed; } }),
    readArtifact: async ({ artifactId }: { artifactId: string }) => {
      artifacts.push(artifactId);
      if (artifacts.length === 1) throw new Error('temporary transport failure');
      return { mimeType: 'image/png', bytes: new Uint8Array([1, 2]) };
    },
  } as unknown as import('@nimiplatform/sdk/app').NimiLocalAppConversationClient });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(chats.at(-1)?.mediaReadError, 'failed');
    assert.equal(chats.at(-1)?.messages[0]?.text, '这部分已经收到');
    await observation.refresh();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(artifacts, ['stored-image'], 'ordinary state refresh does not silently retry image reads');
    observation.retryMedia();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(artifacts, ['stored-image', 'stored-image']);
    assert.equal(chats.at(-1)?.mediaReadError, null);
    assert.match(String(chats.at(-1)?.messages[1]?.metadata?.mediaUrl), /^data:image\/png;base64,/);
    assert.equal(chats.at(-1)?.messages[1]?.id, 'image');
    assert.equal(chats.at(-1)?.textTurnId, null);
  } finally { observation.close(); }
});

test('Zhiyu preserves partial owner text and cancellation, including regeneration eligibility', () => {
  const chat = projectZhiyuConversation({ ...scope, projection: seedCanonicalConversationProjection(snapshot()) });
  assert.equal(chat.messages[0]?.id, 'answer');
  assert.equal(chat.messages[0]?.text, '这部分已经收到');
  assert.equal(chat.messages[0]?.status, 'canceled');
  assert.equal(chat.messages[0]?.metadata?.canonicalPartial, true);
  assert.equal(chat.state, 'canceled');
  assert.equal(chat.regenerateTurnId, 'turn');
});

test('released text permits the next input while a media tail remains active', () => {
  const source = snapshot();
  const projection = seedCanonicalConversationProjection({ ...source,
    turns: source.turns.map(turn => ({ ...turn, status: 'active', canRegenerate: false, terminalReason: null })),
    messages: source.messages.map(message => ({ ...message, partial: false })),
  });
  const chat = projectZhiyuConversation({ ...scope, projection });
  assert.equal(chat.state, 'media-pending');
  assert.equal(chat.messages[0]?.metadata?.canonicalMediaRunning, true);
  const initial = createInitialZhiyuEvidence();
  assert.equal(isZhiyuDirectLocalAppSubmitEnabled({ draft: '下一条问题', evidence: {
    ...initial, conversation: { ...initial.conversation, ...scope, ready: true }, chat, turn: turnStatusFromChat(chat),
  } }), true);
});

test('optional failed voice does not replace completed text or occupy input', () => {
  const source = snapshot();
  const projection = seedCanonicalConversationProjection({ ...source,
    turns: source.turns.map(turn => ({ ...turn, status: 'completed', canRegenerate: false })),
    messages: source.messages.map(message => ({ ...message, partial: false })),
    voices: [{ turnId: 'turn', messageId: 'answer', voiceId: 'voice', state: 'failed', artifactId: null, reasonCode: 'AI_PROVIDER_TIMEOUT', message: 'voice unavailable' }],
  });
  const chat = projectZhiyuConversation({ ...scope, projection, media: { get: () => ({ mediaUrl: null, mimeType: null }) } });
  assert.equal(chat.messages[0]?.text, '这部分已经收到');
  assert.equal(chat.messages[0]?.kind, 'text');
  assert.equal(chat.messages[0]?.metadata?.canonicalVoiceState, 'failed');
  assert.equal(chat.state, 'completed');
  assert.equal(chat.textTurnId, null);
});

test('shared deltas and committed message keep one primary body in Zhiyu', () => {
  const source = snapshot();
  const live = { ...source, state: { ...source.state, textTurnId: 'turn' }, turns: source.turns.map(turn => ({ ...turn, status: 'active' as const })) };
  let projection = seedCanonicalConversationProjection(live);
  projection = reduceCanonicalConversationEvent(projection, { type: 'text-delta', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '9', delta: '，还有后文' }).projection;
  projection = reduceCanonicalConversationEvent(projection, { type: 'message-committed', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '10', message: { ...source.messages[0]!, partial: false, parts: [{ kind: 'text', text: '完整正文' }] } }).projection;
  const chat = projectZhiyuConversation({ ...scope, projection });
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0]?.text, '完整正文');
  assert.equal(chat.messages[0]?.id, 'answer');
});


test('a late image stays with its owner turn when a later question already exists', () => {
  const source = snapshot();
  const later = { ...source.turns[0]!, turnId: 'later', status: 'active' as const };
  const seeded = seedCanonicalConversationProjection({ ...source, turns: [...source.turns, later], messages: [...source.messages,
    { messageId: 'next-question', turnId: 'later', role: 'user', partial: false, parts: [{ kind: 'text', text: '下一题' }] }] });
  const projection = reduceCanonicalConversationEvent(seeded, { type: 'message-committed', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '9',
    message: { messageId: 'late-image', turnId: 'turn', role: 'assistant', partial: false,
      parts: [{ kind: 'artifact-ref', artifactId: 'image', mediaKind: 'image', mimeType: 'image/png', displayName: null }] } }).projection;
  assert.deepEqual(projectZhiyuConversation({ ...scope, projection }).messages.map(message => message.id), ['answer', 'late-image', 'next-question', 'canonical-turn:later']);
});

test('an image failure belongs only to its assistant text, not the original question or image', () => {
  const source = snapshot();
  const chat = projectZhiyuConversation({ ...scope, projection: seedCanonicalConversationProjection({ ...source,
    messages: [
      { messageId: 'question', turnId: 'turn', role: 'user', partial: false, parts: [{ kind: 'text', text: '请画一幅画' }] },
      source.messages[0]!,
      { messageId: 'image', turnId: 'turn', role: 'assistant', partial: false, parts: [{ kind: 'artifact-ref', artifactId: 'image', mediaKind: 'image', mimeType: 'image/png', displayName: null }] },
    ],
    actions: [{ actionId: 'image-action', turnId: 'turn', capabilityContract: 'image.generate', status: 'failed', reasonCode: 'AI_PROVIDER_TIMEOUT', message: null, artifactId: null, projectionMessageId: null }],
  }) });
  assert.deepEqual(chat.messages.map(message => (message.metadata?.canonicalImageFailures as unknown[]).length), [0, 1, 0]);
});
