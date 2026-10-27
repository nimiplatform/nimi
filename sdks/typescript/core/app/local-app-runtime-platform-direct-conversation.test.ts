import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalAppConversationVoiceState, LocalAppConversationMessageRole, LocalAppConversationTurnStatus, LocalAppConversationTurnPhase } from '../../core-generated/runtime-protobuf/runtime/v1/agent_service.js';
import {
  createNimiLocalAppConversationRuntimeClient,
  type NimiLocalAppConversationRuntime,
} from './local-app-runtime-platform-direct-conversation.js';
import type { NimiLocalAppAgentHandle } from './local-app-runtime-platform-conversation.js';

test('direct Local App conversation voice render carries only the canonical committed-message selectors', async () => {
  const calls: unknown[] = [];
  const runtime = {
    async renderLocalAppConversationVoice(request: unknown) {
      calls.push(request);
      return {
        voice: {
          voiceId: 'voice-1',
          turnId: 'turn-1',
          messageId: 'message-1',
          state: LocalAppConversationVoiceState.READY,
          artifactId: 'artifact-voice-1',
          reasonCode: 0,
        },
      };
    },
  } as NimiLocalAppConversationRuntime;
  const client = createNimiLocalAppConversationRuntimeClient(runtime);
  const agentHandle = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;

  assert.deepEqual(await client.renderVoice({
    agentHandle,
    conversationAnchorId: 'anchor-1',
    messageId: 'message-1',
    requestId: 'voice-render-request-1',
  }), {
    status: 'ready',
    voiceId: 'voice-1',
    turnId: 'turn-1',
    messageId: 'message-1',
    artifactId: 'artifact-voice-1',
  });
  assert.deepEqual(calls, [{
    agentHandle,
    conversationAnchorId: 'anchor-1',
    messageId: 'message-1',
    requestId: 'voice-render-request-1',
  }]);
  assert.equal(JSON.stringify(calls).includes('localAgentRef'), false);
  assert.equal(JSON.stringify(calls).includes('ownerUserId'), false);
  assert.equal(JSON.stringify(calls).includes('runtimeSourceRef'), false);
  assert.equal(JSON.stringify(calls).includes('text'), false);
});

test('direct conversation carrier preserves quote intent, confirmed quote and independent read watermark', async () => {
  const calls: unknown[] = [];
  const quote = { sourceMessageId: 'source', format: 'nimi.quote-text.v1' as const, startByte: 3, endByte: 6 };
  const message = { messageId: 'message', turnId: 'turn', role: LocalAppConversationMessageRole.USER, partial: false,
    parts: [{ part: { oneofKind: 'text' as const, text: { text: '解释这句' } } }],
    quote: { ...quote, sourceRole: LocalAppConversationMessageRole.ASSISTANT, sourcePartial: true, text: '文' } };
  const runtime = {
    async sendLocalAppConversationTurn(input: unknown) { calls.push(input); return { turnId: 'turn' }; },
    async readLocalAppConversationMessage(input: unknown) {
      calls.push(input);
      return { conversationAnchorId: 'anchor', readWatermark: 7n, message, quoteText: '解释这句', quoteFormat: 'nimi.quote-text.v1',
        window: { messages: [message], turns: [{ turnId: 'turn', status: LocalAppConversationTurnStatus.ACTIVE, phase: LocalAppConversationTurnPhase.STARTED,
          canRegenerate: false, reasonCode: 0, origin: 'user', inputTurnId: 'turn' }], actions: [], voices: [], truncatedBefore: true, truncatedAfter: false } };
    },
  } as unknown as NimiLocalAppConversationRuntime;
  const client = createNimiLocalAppConversationRuntimeClient(runtime);
  const scope = { agentHandle: `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle, conversationAnchorId: 'anchor' };
  await client.send({ ...scope, requestId: 'request', parts: [{ kind: 'text', text: '解释这句' }], quote });
  assert.deepEqual((calls[0] as { quote: unknown }).quote, quote);
  const read = await client.readMessage({ ...scope, messageId: 'message' });
  assert.equal(read.readWatermark, '7');
  assert.deepEqual(read.message.quote, { ...quote, sourceRole: 'assistant', sourcePartial: true, text: '文' });
  assert.equal('throughSequence' in read, false);
  assert.deepEqual(calls[1], { ...scope, messageId: 'message' });
});
