import assert from 'node:assert/strict';
import test from 'node:test';
import { seedCanonicalConversationProjection, reduceCanonicalConversationEvent } from '@nimiplatform/kit/features/chat/headless';
import type { NimiLocalAppConversationQuote, NimiLocalAppConversationSnapshot } from '@nimiplatform/sdk/app';
import { projectZhiyuConversation } from '../src/shell/agent-chat/agent-conversation-state.js';
import { isZhiyuDirectLocalAppSubmitEnabled } from '../src/shell/app/direct-local-app-submit-gate.js';
import { createInitialZhiyuEvidence } from '../src/shell/app/evidence.js';
import { turnStatusFromChat } from '../src/shell/app/app-evidence-transitions.js';
import { subscribeZhiyuAmbientConversation } from '../src/shell/agent-chat/ambient-conversation-subscription.js';
import { conversationMessagesForDisplay } from '../src/shell/agent-chat/ZhiyuAgentChatLabels.js';

function snapshot(): NimiLocalAppConversationSnapshot {
  return { conversationAnchorId: 'anchor', throughSequence: '5', truncatedBefore: false,
    state: { textTurnId: null, freeContactEnabled: false, maxFollowUpTurns: 8, pendingFollowUp: null },
    turns: [{ controlOutcome: null, turnId: 'turn', origin: 'user', requestId: 'request', inputTurnId: 'turn', retryOfTurnId: null, canRegenerate: true,
      status: 'interrupted', phase: 'started', terminalReason: 'user_cancel', reasonCode: null, message: null }],
    messages: [{ messageId: 'answer', turnId: 'turn', role: 'assistant', partial: true, quote: null, parts: [{ kind: 'text', text: '这部分已经收到' }] }],
    actions: [], voices: [] };
}
const scope = { agentHandle: 'agent_ref_test' as never, conversationAnchorId: 'anchor' };

test('display preserves empty terminal attempts and exact canonical text while hiding only empty streaming placeholders', () => {
  const source = snapshot();
  const failed = projectZhiyuConversation({ ...scope, projection: seedCanonicalConversationProjection({ ...source,
    messages: [], turns: source.turns.map(turn => ({ ...turn, status: 'failed', terminalReason: 'error', reasonCode: 'AI_STREAM_BROKEN' })),
  }) });
  const displayed = conversationMessagesForDisplay(failed.messages, '伙伴');
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0]?.status, 'error');
  assert.equal(displayed[0]?.text, '');
  assert.notEqual(displayed[0]?.metadata?.canonicalMessageCommitted, true);
  const text = '  原文\n\n第二段\n';
  assert.equal(conversationMessagesForDisplay([{ ...displayed[0]!, status: 'complete', text }], '伙伴')[0]?.text, text);
  assert.equal(conversationMessagesForDisplay([{ ...displayed[0]!, status: 'streaming' }], '伙伴').length, 0);
});

test('explicit media reload rereads a failed image without sending or replacing its original message', async () => {
  const source = snapshot();
  source.messages.push({ messageId: 'image', turnId: 'turn', role: 'assistant', partial: false, quote: null,
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
    messages: source.messages.map(message => ({ ...message, partial: false, quote: null })),
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
    messages: source.messages.map(message => ({ ...message, partial: false, quote: null })),
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
  projection = reduceCanonicalConversationEvent(projection, { type: 'message-committed', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '10', message: { ...source.messages[0]!, partial: false, quote: null, parts: [{ kind: 'text', text: '完整正文' }] } }).projection;
  const chat = projectZhiyuConversation({ ...scope, projection });
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0]?.text, '完整正文');
  assert.equal(chat.messages[0]?.id, 'answer');
});


test('a late image stays with its owner turn when a later question already exists', () => {
  const source = snapshot();
  const later = { ...source.turns[0]!, turnId: 'later', status: 'active' as const };
  const seeded = seedCanonicalConversationProjection({ ...source, turns: [...source.turns, later], messages: [...source.messages,
    { messageId: 'next-question', turnId: 'later', role: 'user', partial: false, quote: null, parts: [{ kind: 'text', text: '下一题' }] }] });
  const projection = reduceCanonicalConversationEvent(seeded, { type: 'message-committed', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '9',
    message: { messageId: 'late-image', turnId: 'turn', role: 'assistant', partial: false, quote: null,
      parts: [{ kind: 'artifact-ref', artifactId: 'image', mediaKind: 'image', mimeType: 'image/png', displayName: null }] } }).projection;
  assert.deepEqual(projectZhiyuConversation({ ...scope, projection }).messages.map(message => message.id), ['answer', 'late-image', 'next-question', 'canonical-turn:later']);
});

test('an image failure belongs only to its assistant text, not the original question or image', () => {
  const source = snapshot();
  const chat = projectZhiyuConversation({ ...scope, projection: seedCanonicalConversationProjection({ ...source,
    messages: [
      { messageId: 'question', turnId: 'turn', role: 'user', partial: false, quote: null, parts: [{ kind: 'text', text: '请画一幅画' }] },
      source.messages[0]!,
      { messageId: 'image', turnId: 'turn', role: 'assistant', partial: false, quote: null, parts: [{ kind: 'artifact-ref', artifactId: 'image', mediaKind: 'image', mimeType: 'image/png', displayName: null }] },
    ],
    actions: [{ actionId: 'image-action', turnId: 'turn', capabilityContract: 'image.generate', status: 'failed', reasonCode: 'AI_PROVIDER_TIMEOUT', message: null, artifactId: null, projectionMessageId: null }],
  }) });
  assert.deepEqual(chat.messages.map(message => (message.metadata?.canonicalImageFailures as unknown[]).length), [0, 1, 0]);
});

test('Zhiyu preserves the confirmed quote and committed body while media stays active', () => {
  const source = snapshot();
  const quote: NimiLocalAppConversationQuote = {
    sourceMessageId: 'source-outside-tail', sourceRole: 'assistant', sourcePartial: true,
    format: 'nimi.quote-text.v1', startByte: 3, endByte: 15, text: '早先的话',
  };
  const projection = seedCanonicalConversationProjection({
    ...source, turns: source.turns.map(turn => ({ ...turn, status: 'active', canRegenerate: false, terminalReason: null })),
    messages: [
      { messageId: 'quoted-question', turnId: 'turn', role: 'user', partial: false, quote,
        parts: [{ kind: 'text', text: '继续说这句话' }] },
      { ...source.messages[0]!, partial: false, quote: null },
    ],
    actions: [{ actionId: 'pending-image', turnId: 'turn', capabilityContract: 'image.generate', status: 'started',
      projectionMessageId: null, artifactId: null, reasonCode: null, message: null }],
  });
  const chat = projectZhiyuConversation({ ...scope, projection });
  assert.equal(chat.canonicalProjection, projection);
  const question = chat.messages.find(message => message.id === 'quoted-question')!;
  const answer = chat.messages.find(message => message.id === 'answer')!;
  assert.deepEqual(question.metadata?.canonicalQuote, quote);
  assert.equal(question.text, '继续说这句话', 'the reference remains separate from the current body');
  assert.equal(answer.status, 'complete');
  assert.equal(answer.metadata?.canonicalMessageCommitted, true);
  assert.equal(answer.metadata?.canonicalPartial, false);
  assert.equal(answer.metadata?.canonicalMediaRunning, true);
  assert.equal(answer.metadata?.canonicalTurnStatus, 'active');
  assert.equal(answer.metadata?.canonicalQuote, null);
});

test('Zhiyu distinguishes transient failed placeholders from owner-persisted partial text', () => {
  const source = snapshot();
  let projection = seedCanonicalConversationProjection({
    ...source, messages: [], state: { ...source.state, textTurnId: 'turn' },
    turns: source.turns.map(turn => ({ ...turn, status: 'active', terminalReason: null })),
  });
  projection = reduceCanonicalConversationEvent(projection, {
    type: 'text-delta', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '6', delta: '临时接收到的文字',
  }).projection;
  const streaming = projectZhiyuConversation({ ...scope, projection });
  assert.equal(streaming.messages[0]?.status, 'streaming');
  assert.notEqual(streaming.messages[0]?.metadata?.canonicalMessageCommitted, true);
  projection = reduceCanonicalConversationEvent(projection, {
    type: 'turn-failed', conversationAnchorId: 'anchor', turnId: 'turn', sequence: '7',
    reasonCode: 'AI_STREAM_BROKEN', message: 'Stream lost.',
  }).projection;
  const failed = projectZhiyuConversation({ ...scope, projection });
  assert.equal(failed.messages[0]?.id, 'canonical-turn:turn');
  assert.equal(failed.messages[0]?.status, 'error');
  assert.notEqual(failed.messages[0]?.metadata?.canonicalMessageCommitted, true);
  assert.equal(failed.messages[0]?.metadata?.canonicalQuote, undefined);
  assert.equal(failed.canonicalProjection?.messages.length, 0);

  const saved = projectZhiyuConversation({ ...scope, projection: seedCanonicalConversationProjection(source) });
  assert.equal(saved.messages[0]?.id, 'answer');
  assert.equal(saved.messages[0]?.metadata?.canonicalMessageCommitted, true);
  assert.equal(saved.messages[0]?.metadata?.canonicalPartial, true);
  assert.equal(saved.messages[0]?.metadata?.canonicalTurnStatus, 'interrupted');
});
