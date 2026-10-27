import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNimiLocalAppConversationClient,
  projectNimiLocalAppConversationMessageReadResult,
  validateNimiLocalAppConversationQuoteInput,
  type NimiLocalAppConversationShell,
  type NimiLocalAppAgentHandle,
} from './local-app-runtime-platform-conversation.js';

const agentHandle = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;
const scope = { agentHandle, conversationAnchorId: 'anchor' };
const quote = { sourceMessageId: 'source', format: 'nimi.quote-text.v1' as const, startByte: 3, endByte: 6 };
const confirmed = { ...quote, sourceRole: 'assistant', sourcePartial: false, text: '文' };
const source = { messageId: 'source', turnId: 'turn', role: 'assistant', partial: false, parts: [{ kind: 'text', text: '中文' }], quote: null };
const turn = { turnId: 'turn', status: 'active', phase: 'started', terminalReason: null, reasonCode: null, message: null,
  requestId: 'original', retryOfTurnId: null, inputTurnId: 'turn', canRegenerate: false, origin: 'user' };
function readResult() {
  return { conversationAnchorId: 'anchor', readWatermark: '12', message: source, quoteText: '中文', quoteFormat: 'nimi.quote-text.v1',
    window: { messages: [source], turns: [turn], actions: [], voices: [], truncatedBefore: true, truncatedAfter: true } };
}

test('quote send is a closed typed intent; regeneration cannot replace its original quote', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppConversationClient({ send: async input => { calls.push(input); return { turnId: 'accepted' }; } } as NimiLocalAppConversationShell);
  const input = { ...scope, requestId: 'request', parts: [{ kind: 'text' as const, text: '解释这句' }], quote };
  await client.send(input);
  assert.deepEqual(calls, [input]);
  await assert.rejects(client.send({ ...scope, requestId: 'again', retryOfTurnId: 'accepted', quote } as never));
  await assert.rejects(client.send({ ...input, quote: { ...quote, text: 'App-authored source' } } as never));
  assert.equal(calls.length, 1);
  for (const invalid of [
    { ...quote, format: 'wrong' }, { ...quote, startByte: -1 }, { ...quote, startByte: 3.5 },
    { ...quote, endByte: 3 }, { ...quote, endByte: 65537 }, { ...quote, startByte: 0, endByte: 16385 },
  ]) assert.throws(() => validateNimiLocalAppConversationQuoteInput(invalid));
});

test('readMessage retains its own watermark and the completed text while media turn is active', async () => {
  const calls: unknown[] = [];
  const client = createNimiLocalAppConversationClient({ readMessage: async input => { calls.push(input); return readResult(); } } as NimiLocalAppConversationShell);
  const result = await client.readMessage({ ...scope, messageId: 'source' });
  assert.deepEqual(calls, [{ ...scope, messageId: 'source' }]);
  assert.equal(result.readWatermark, '12');
  assert.equal(result.quoteText, '中文');
  assert.equal(result.window.turns[0]?.status, 'active');
  assert.equal('throughSequence' in result, false);
  assert.equal('state' in result, false);
  assert.equal(result.message.quote, null);
  assert.ok(Object.isFrozen(result.window.messages));
});

test('message read fails closed on wrong scope, extra live state, missing/contradictory target and split quote representation', async () => {
  const bad = [
    { ...readResult(), throughSequence: '13' },
    { ...readResult(), quoteFormat: null },
    { ...readResult(), quoteText: '' },
    { ...readResult(), window: { ...readResult().window, messages: [] } },
    { ...readResult(), window: { ...readResult().window, messages: [{ ...source, partial: true }] } },
    { ...readResult(), window: { ...readResult().window, messages: [source, source] } },
  ];
  for (const value of bad) assert.throws(() => projectNimiLocalAppConversationMessageReadResult(value));
  const client = createNimiLocalAppConversationClient({ readMessage: async () => ({ ...readResult(), conversationAnchorId: 'other' }) } as unknown as NimiLocalAppConversationShell);
  await assert.rejects(client.readMessage({ ...scope, messageId: 'source' }));
});

test('confirmed quote is preserved exactly and contributes to bounded history content', () => {
  const target = { ...source, role: 'user', quote: confirmed };
  const result = { ...readResult(), message: target, window: { ...readResult().window, messages: [target] } };
  assert.deepEqual(projectNimiLocalAppConversationMessageReadResult(result).message.quote, confirmed);
  for (const altered of [{ ...confirmed, text: '不同' }, { ...confirmed, sourceRole: 'system' }, { ...confirmed, permission: 'granted' }]) {
    const message = { ...target, quote: altered };
    assert.throws(() => projectNimiLocalAppConversationMessageReadResult({ ...result, message, window: { ...result.window, messages: [message] } }));
  }
  const large = { ...source, parts: [{ kind: 'text', text: 'x'.repeat(65536) }] };
  const messages = Array.from({ length: 4 }, (_, index) => ({ ...large, messageId: `m${index}` }));
  const exact = { ...readResult(), message: messages[0], quoteText: 'x'.repeat(65536), window: { ...readResult().window, messages } };
  assert.equal(projectNimiLocalAppConversationMessageReadResult(exact).window.messages.length, 4, 'target appears twice on wire but counts once');
  const quoted = messages.map((message, index) => index === 0 ? { ...message, quote: confirmed } : message);
  assert.throws(() => projectNimiLocalAppConversationMessageReadResult({ ...exact, message: quoted[0], window: { ...exact.window, messages: quoted } }), 'quote metadata and text exceed the already-full window budget');
});
