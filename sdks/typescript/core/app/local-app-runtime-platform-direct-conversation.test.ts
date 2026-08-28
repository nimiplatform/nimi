import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalAppConversationVoiceState } from '../../core-generated/runtime-protobuf/runtime/v1/agent_service.js';
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
  const agentHandle = 'agent_ref_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789' as NimiLocalAppAgentHandle;

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
