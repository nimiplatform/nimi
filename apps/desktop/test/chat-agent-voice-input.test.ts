import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NimiRuntimeAgentScopeRunner,
  NimiRuntimeAgentTurnsRuntime,
} from '@nimiplatform/sdk/runtime';
import { transcribeAndSubmitCapturedAgentVoiceInput } from '../src/shell/renderer/features/chat/chat-agent-voice-input.js';
import { AGENT_RUNTIME_CHAT_PROVIDER_CAPABILITIES } from '../src/shell/renderer/features/chat/chat-agent-runtime-turn-types.js';

test('Desktop Agent voice input transcribes the selected conversation and submits only typed text', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const submitted: Array<{ text: string; attachments: readonly unknown[] }> = [];
  const runtime = {
    appId: 'nimi.desktop',
    agents: {
      async getPublicChatSessionSnapshot() {
        return {};
      },
      async *subscribeAgentEvents() {
        yield undefined;
      },
      async transcribeAgentVoiceInput(request: Record<string, unknown>) {
        calls.push(request);
        return { text: 'spoken intent', jobId: 'job-voice-1', traceId: 'trace-voice-1' };
      },
    },
    appMessages: {
      async sendAppMessage() {
        return { messageId: '', accepted: false, reasonCode: 0 };
      },
      async *subscribeAppMessages() {
        yield undefined as never;
      },
    },
  } as unknown as NimiRuntimeAgentTurnsRuntime;
  const withScopes: NimiRuntimeAgentScopeRunner = async (_scopes, operation) => operation({});

  const result = await transcribeAndSubmitCapturedAgentVoiceInput({
    runtime: {
      runtimeAgentTurns: () => runtime,
      withRuntimeProtectedScopes: withScopes,
    },
    target: {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      displayName: 'Agent',
      handle: 'agent',
      avatarUrl: null,
      presentationProfile: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
    conversationAnchorId: 'anchor-1',
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/webm',
    handleSubmit: async (input) => {
      submitted.push(input);
    },
  });

  assert.equal(result.submitted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.agentId, 'local-agent:user-1:agent-1');
  assert.equal(calls[0]?.conversationAnchorId, 'anchor-1');
  assert.deepEqual(submitted, [{ text: 'spoken intent', attachments: [] }]);
  assert.equal(AGENT_RUNTIME_CHAT_PROVIDER_CAPABILITIES.voiceInput, true);
});

test('Desktop Agent voice input drops a transcript when the selected conversation changes', async () => {
  let submitted = false;
  const result = await transcribeAndSubmitCapturedAgentVoiceInput({
    runtime: {
      runtimeAgentTurns: () => ({
        appId: 'nimi.desktop',
        agents: {
          async getPublicChatSessionSnapshot() {
            return {};
          },
          async *subscribeAgentEvents() {
            yield undefined;
          },
          async transcribeAgentVoiceInput() {
            return { text: 'stale intent', jobId: 'job-stale' };
          },
        },
        appMessages: {
          async sendAppMessage() {
            return { messageId: '', accepted: false, reasonCode: 0 };
          },
          async *subscribeAppMessages() {
            yield undefined as never;
          },
        },
      } as unknown as NimiRuntimeAgentTurnsRuntime),
      withRuntimeProtectedScopes: async (_scopes, operation) => operation({}),
    },
    target: {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      displayName: 'Agent',
      handle: 'agent',
      avatarUrl: null,
      presentationProfile: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
    conversationAnchorId: 'anchor-1',
    bytes: new Uint8Array([1]),
    mimeType: 'audio/webm',
    beforeSubmit: () => false,
    handleSubmit: async () => {
      submitted = true;
    },
  });

  assert.equal(result.submitted, false);
  assert.equal(submitted, false);
});
