import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  NimiRuntimeAgentScopeRunner,
  NimiRuntimeAgentTurnsRuntime,
} from '@nimiplatform/sdk/runtime';
import { createNimiError } from '@nimiplatform/sdk/types';
import {
  isAgentVoiceInputCancellationError,
  readableRealtimeVoiceError,
  transcribeAndSubmitCapturedAgentVoiceInput,
} from '../src/shell/renderer/features/chat/chat-agent-voice-input.js';
import { createAgentRealtimeTerminalError } from '../src/shell/renderer/features/chat/chat-agent-realtime-voice.js';
import { AGENT_RUNTIME_CHAT_PROVIDER_CAPABILITIES } from '../src/shell/renderer/features/chat/chat-agent-runtime-turn-types.js';

test('Desktop Agent voice input transcribes the selected conversation and submits only typed text', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const callOptions: Array<Record<string, unknown> | undefined> = [];
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
      async transcribeAgentVoiceInput(
        request: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) {
        calls.push(request);
        callOptions.push(options);
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
  const abortController = new AbortController();

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
    signal: abortController.signal,
    handleSubmit: async (input) => {
      submitted.push(input);
    },
  });

  assert.equal(result.submitted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.agentId, 'local-agent:user-1:agent-1');
  assert.equal(calls[0]?.conversationAnchorId, 'anchor-1');
  assert.equal(callOptions[0]?.signal, abortController.signal);
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

test('Desktop Agent voice input cancellation ignores failure message text', () => {
  const abort = new Error('capture stopped');
  abort.name = 'AbortError';
  assert.equal(isAgentVoiceInputCancellationError(abort), true);
  assert.equal(isAgentVoiceInputCancellationError({
    reasonCode: 'RUNTIME_GRPC_CANCELLED',
  }), true);
  assert.equal(isAgentVoiceInputCancellationError({
    reasonCode: 'AI_LOCAL_EXECUTION_CANCELED',
  }), true);
  assert.equal(
    isAgentVoiceInputCancellationError(new Error('provider canceled while reporting an inference failure')),
    false,
  );
});

test('Desktop Agent Realtime voice keeps voice-input rejection readable and recoverable', () => {
  const error = readableRealtimeVoiceError(
    createAgentRealtimeTerminalError('AI_VOICE_INPUT_INVALID'),
    'Voice input failed.',
  );
  assert.equal(error.reasonCode, 'AI_VOICE_INPUT_INVALID');
  assert.equal(error.actionHint, 'retry_voice_input');
  assert.equal(
    error.message,
    'Voice input was rejected. Check the microphone signal and try speaking again.',
  );
});

test('Desktop Agent Realtime voice explains microphone denial and missing configuration', () => {
  const denied = readableRealtimeVoiceError(
    new DOMException('Permission denied', 'NotAllowedError'),
    'Voice input failed.',
  );
  assert.equal(denied.actionHint, 'allow_microphone_access');
  assert.match(denied.message, /Microphone access was denied/);

  const unconfigured = readableRealtimeVoiceError(
    createNimiError({
      message: 'AI_CONFIG_INVALID',
      reasonCode: 'AI_CONFIG_INVALID',
      actionHint: 'inspect_runtime',
      source: 'runtime',
    }),
    'Voice input failed.',
  );
  assert.equal(unconfigured.reasonCode, 'AI_CONFIG_INVALID');
  assert.equal(unconfigured.actionHint, 'configure_realtime_interact_route');
  assert.match(unconfigured.message, /Realtime voice is not configured/);
});
