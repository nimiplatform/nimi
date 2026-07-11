import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentEventType,
  AgentLifecycleStatus,
  AgentPresentationEventFamily,
  CancellableStream,
  LOCAL_AGENT_REF,
  OWNER_USER_ID,
  RUNTIME_SOURCE_REF,
  RuntimeGeneratedReasonCode,
  SdkReasonCode,
  VoiceOutputMode,
  VoicePlaybackState,
  agentIdentity,
  buildNimiRuntimeAgentTurnPayload,
  createNimiError,
  createNimiHostRuntimeAgentLifecycleSurface,
  createNimiRuntimeAgentTurnsModule,
  createNimiRuntimeAgentVoiceModule,
  fromNimiRuntimeProtoStruct,
  protectedAppAuth,
  protectedAuth,
  toNimiRuntimeProtoStruct,
  toNimiRuntimeTimestamp,
  trackedPendingStream,
  voicePlaybackRequestedAgentEvent,
  type AgentEvent,
  type AgentVoiceStreamEvent,
  type AppMessageEvent,
  type GetAgentRequest,
  type InitializeAgentRequest,
  type InterruptAgentVoicePlaybackRequest,
  type InterruptAgentVoicePlaybackResponse,
  type ReadArtifactBytesRequest,
  type ReadArtifactBytesResponse,
  type RuntimeTypedCallOptions,
  type SendAppMessageRequest,
  type SubscribeAgentEventsRequest,
  type SubscribeAgentVoiceStreamRequest,
  type SubscribeAppMessagesRequest,
  type TerminateAgentRequest,
} from './runtime-agent-helpers.test-helper';

test('Runtime Agent turn helper requests committed-message voice render and resolves playable Runtime projection', async () => {
  const sendCalls: SendAppMessageRequest[] = [];
  const sendOptions: RuntimeTypedCallOptions[] = [];
  const scopes: readonly string[][] = [];
  const voiceEvent = {
    messageType: 'runtime.agent.presentation.voice_playback_requested',
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: LOCAL_AGENT_REF,
      agent_id: LOCAL_AGENT_REF,
      conversation_anchor_id: 'anchor-1',
      turn_id: 'turn-1',
      stream_id: 'stream-1',
      detail: {
        audio_artifact_id: 'artifact-audio-1',
        audio_mime_type: 'audio/wav',
        message_id: 'message-1',
        playback_state: 'requested',
        playback_target: 'desktop_manual',
        final_artifact: true,
      },
    }),
  } as AppMessageEvent;
  const appStream = new CancellableStream<AppMessageEvent>([voiceEvent]);
  const agentStream = new CancellableStream<AgentEvent>([]);
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        subscribeAgentEvents() {
          return agentStream;
        },
      },
      appMessages: {
        async sendAppMessage(request, options) {
          sendCalls.push(request);
          sendOptions.push(options ?? {});
          return { messageId: 'request-message-1', accepted: true, reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED };
        },
        subscribeAppMessages() {
          return appStream;
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (nextScopes, operation) => {
      scopes.push(nextScopes);
      return operation({ metadata: { scoped: nextScopes.join(',') } });
    },
  });

  const result = await module.renderVoice({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    messageId: 'message-1',
    text: 'Committed answer',
    idempotencyKey: 'voice-render-test-1',
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.status === 'ready' ? result.audioArtifactId : '', 'artifact-audio-1');
  assert.deepEqual(scopes, [
    ['runtime.agent.turn.read'],
    ['runtime.agent.read'],
    ['runtime.agent.turn.write'],
  ]);
  assert.equal(sendCalls[0]?.messageType, 'runtime.agent.turn.voice_render');
  assert.equal(sendCalls[0]?.subjectUserId, 'user-1');
  assert.deepEqual(fromNimiRuntimeProtoStruct(sendCalls[0]?.payload), {
    conversation_anchor_id: 'anchor-1',
    turn_id: 'turn-1',
    message_id: 'message-1',
    text: 'Committed answer',
    playback_target: 'desktop_manual',
  });
  assert.equal(sendOptions[0]?.metadata?.idempotencyKey, 'voice-render-test-1');
  assert.equal(sendOptions[0]?.metadata?.['x-nimi-idempotency-key'], 'voice-render-test-1');
  assert.equal(sendOptions[0]?.metadata?.scoped, 'runtime.agent.turn.write');
  assert.equal(appStream.returnCount, 1);
  assert.equal(agentStream.returnCount, 1);
});

test('Runtime Agent turn helper resolves voice render projection from Agent presentation events when app stream has no live tail', async () => {
  const appStream = new CancellableStream<AppMessageEvent>([]);
  const agentStream = new CancellableStream<AgentEvent>([
    voicePlaybackRequestedAgentEvent({
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-1',
      streamId: 'stream-1',
      messageId: 'message-1',
      audioArtifactId: 'artifact-agent-audio-1',
      audioMimeType: 'audio/wav',
      playbackTarget: 'desktop_manual',
    }),
  ]);
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        subscribeAgentEvents() {
          return agentStream;
        },
      },
      appMessages: {
        async sendAppMessage() {
          return { messageId: 'request-message-1', accepted: true, reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED };
        },
        subscribeAppMessages() {
          return appStream;
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (_nextScopes, operation) => operation({}),
  });

  const result = await module.renderVoice({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    messageId: 'message-1',
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.status === 'ready' ? result.audioArtifactId : '', 'artifact-agent-audio-1');
  assert.equal(appStream.returnCount, 1);
  assert.equal(agentStream.returnCount, 1);
});

test('Runtime Agent turn helper reports text_only when Runtime emits no playable voice projection', async () => {
  const appStream = new CancellableStream<AppMessageEvent>([]);
  const agentStream = new CancellableStream<AgentEvent>([]);
  const module = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agents: {
        async getPublicChatSessionSnapshot() {
          return {};
        },
        subscribeAgentEvents() {
          return agentStream;
        },
      },
      appMessages: {
        async sendAppMessage() {
          return { messageId: 'request-message-1', accepted: true, reasonCode: RuntimeGeneratedReasonCode.ACTION_EXECUTED };
        },
        subscribeAppMessages() {
          return appStream;
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (_nextScopes, operation) => operation({}),
  });

  const result = await module.renderVoice({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    messageId: 'message-1',
    timeoutMs: 0,
  });

  assert.deepEqual(result, {
    status: 'text_only',
    reason: 'voice_projection_unavailable',
  });
  assert.equal(appStream.returnCount, 1);
  assert.equal(agentStream.returnCount, 1);
});

test('Runtime Agent voice helper consumes typed stream and replays only audio artifacts', async () => {
  const scopes: readonly string[][] = [];
  const streamRequests: SubscribeAgentVoiceStreamRequest[] = [];
  const interruptRequests: InterruptAgentVoicePlaybackRequest[] = [];
  const artifactReads: ReadArtifactBytesRequest[] = [];
  const scopedBinding = {
    bindingId: 'binding-voice-1',
    bindingHandle: 'binding-handle-1',
    runtimeAppId: 'desktop',
    appInstanceId: 'desktop-instance-1',
    windowId: 'window-1',
    avatarInstanceId: 'avatar-1',
    agentId: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    worldId: 'world-1',
  };
  const voiceEvents: AgentVoiceStreamEvent[] = [{
    voiceStreamId: 'voice-stream-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
    messageId: 'message-1',
    chunkSequence: '1',
    chunk: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/wav',
    voiceOutputMode: 1,
    playbackTarget: 'avatar_autoplay',
    terminal: false,
    voicePlaybackState: 1,
    terminalReason: '',
    replayTruncated: false,
  }];
  const module = createNimiRuntimeAgentVoiceModule({
    runtime: {
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agents: {
        async *subscribeAgentVoiceStream(request) {
          streamRequests.push(request);
          yield* voiceEvents;
        },
        async interruptAgentVoicePlayback(request): Promise<InterruptAgentVoicePlaybackResponse> {
          interruptRequests.push(request);
          return {
            voiceStreamId: request.voiceStreamId,
            voiceOutputMode: 1,
            voicePlaybackState: 3,
            terminalReason: request.reason || 'runtime_voice_interrupt_requested',
          };
        },
      },
      artifacts: {
        async readArtifactBytes(request): Promise<ReadArtifactBytesResponse> {
          artifactReads.push(request);
          return {
            bytes: new Uint8Array([9, 8, 7]),
            mimeType: request.artifactId === 'artifact-audio-1' ? 'audio/wav' : 'text/plain',
            sizeBytes: '3',
            mimeInferred: false,
          };
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (nextScopes, operation) => {
      scopes.push(nextScopes);
      return operation({ metadata: { scoped: nextScopes.join(',') } });
    },
  });

  const stream = await module.subscribeStream({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    voiceStreamId: 'voice-stream-1',
    scopedBinding,
  });
  const received: AgentVoiceStreamEvent[] = [];
  for await (const event of stream) {
    received.push(event);
  }
  assert.deepEqual([...received[0]?.chunk ?? []], [1, 2, 3]);
  assert.equal(streamRequests[0]?.voiceStreamId, 'voice-stream-1');
  assert.equal(streamRequests[0]?.context?.localAgentRef, LOCAL_AGENT_REF);
  assert.deepEqual(streamRequests[0]?.context?.scopedBinding, scopedBinding);
  assert.deepEqual(scopes[0], ['runtime.agent.turn.read']);

  const replay = await module.replayFinalArtifact({ artifactId: 'artifact-audio-1' });
  assert.deepEqual([...replay.bytes], [9, 8, 7]);
  assert.equal(artifactReads[0]?.artifactId, 'artifact-audio-1');
  await assert.rejects(
    () => module.replayFinalArtifact({ artifactId: 'artifact-text-1' }),
    /must be audio/,
  );
  const interrupt = await module.interruptPlayback({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    voiceStreamId: 'voice-stream-1',
    reason: 'avatar_user_interrupt',
    scopedBinding,
  });
  assert.equal(interrupt.voicePlaybackState, 3);
  assert.equal(interrupt.terminalReason, 'avatar_user_interrupt');
  assert.equal(interruptRequests[0]?.voiceStreamId, 'voice-stream-1');
  assert.equal(interruptRequests[0]?.conversationAnchorId, 'anchor-1');
  assert.equal(interruptRequests[0]?.turnId, 'turn-1');
  assert.equal(interruptRequests[0]?.context?.localAgentRef, LOCAL_AGENT_REF);
  assert.deepEqual(interruptRequests[0]?.context?.scopedBinding, scopedBinding);
  assert.deepEqual(scopes[1], ['runtime.agent.turn.write']);
});

test('Runtime Agent voice helper fails closed when its carrier provides only raw public token metadata', async () => {
  const streamOptions: RuntimeTypedCallOptions[] = [];
  const interruptOptions: RuntimeTypedCallOptions[] = [];
  const authCalls: string[] = [];
  const module = createNimiRuntimeAgentVoiceModule({
    runtime: {
      appId: 'desktop',
      auth: {
        async registerApp() {
          authCalls.push('register');
          return { accepted: true };
        },
      },
      appAuth: {
        async authorizeExternalPrincipal() {
          authCalls.push('authorize');
          return { tokenId: 'token-voice', secret: 'secret-voice' };
        },
      },
      agents: {
        async *subscribeAgentVoiceStream(_request, options) {
          streamOptions.push(options ?? {});
          yield {
            voiceStreamId: 'voice-stream-1',
            conversationAnchorId: 'anchor-1',
            turnId: 'turn-1',
            streamId: 'stream-1',
            messageId: 'message-1',
            chunkSequence: '1',
            chunk: new Uint8Array([1]),
            mimeType: 'audio/wav',
            voiceOutputMode: 1,
            playbackTarget: 'avatar_autoplay',
            terminal: false,
            voicePlaybackState: 1,
            terminalReason: '',
            replayTruncated: false,
          };
        },
        async interruptAgentVoicePlayback(_request, options) {
          interruptOptions.push(options ?? {});
          throw new Error('not expected');
        },
      },
      artifacts: {
        async readArtifactBytes() {
          throw new Error('not expected');
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (_nextScopes, operation) =>
      operation({
        metadata: {
          'x-nimi-access-token-id': 'portable-voice-token',
          'x-nimi-access-token-secret': 'portable-voice-secret',
        },
      }),
  });

  await assert.rejects(
    module.subscribeStream({
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef: RUNTIME_SOURCE_REF,
      localAgentRef: LOCAL_AGENT_REF,
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-1',
      voiceStreamId: 'voice-stream-1',
    }),
    (error: unknown) =>
      (error as { readonly reasonCode?: string }).reasonCode === 'SDK_RUNTIME_AGENT_SCOPED_CARRIER_REQUIRED',
  );
  await assert.rejects(
    module.interruptPlayback({
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef: RUNTIME_SOURCE_REF,
      localAgentRef: LOCAL_AGENT_REF,
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-1',
      voiceStreamId: 'voice-stream-1',
      reason: 'user_cancelled',
    }),
    (error: unknown) =>
      (error as { readonly reasonCode?: string }).reasonCode === 'SDK_RUNTIME_AGENT_SCOPED_CARRIER_REQUIRED',
  );

  assert.deepEqual(authCalls, []);
  assert.deepEqual(streamOptions, []);
  assert.deepEqual(interruptOptions, []);
});

test('Runtime Agent voice helper preserves scoped Runtime binding without renderer token fallback', async () => {
  const streamOptions: RuntimeTypedCallOptions[] = [];
  const streamRequests: unknown[] = [];
  const authCalls: string[] = [];
  const module = createNimiRuntimeAgentVoiceModule({
    runtime: {
      appId: 'avatar',
      auth: {
        async registerApp() {
          authCalls.push('register');
          throw new Error('Runtime auth fallback must not run for Runtime auth bindings');
        },
      },
      appAuth: {
        async authorizeExternalPrincipal() {
          authCalls.push('authorize');
          throw new Error('Runtime protected token fallback must not run for Runtime auth bindings');
        },
      },
      agents: {
        async *subscribeAgentVoiceStream(request, options) {
          streamRequests.push(request);
          streamOptions.push(options ?? {});
          yield {
            voiceStreamId: 'voice-stream-1',
            conversationAnchorId: 'anchor-1',
            turnId: 'turn-1',
            streamId: 'stream-1',
            messageId: 'message-1',
            chunkSequence: '1',
            chunk: new Uint8Array([1]),
            mimeType: 'audio/wav',
            voiceOutputMode: 1,
            playbackTarget: 'avatar_autoplay',
            terminal: false,
            voicePlaybackState: 1,
            terminalReason: '',
            replayTruncated: false,
          };
        },
        async interruptAgentVoicePlayback() {
          throw new Error('not expected');
        },
      },
      artifacts: {
        async readArtifactBytes() {
          throw new Error('not expected');
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (_nextScopes, operation) => operation({
      metadata: { 'x-nimi-runtime-scoped-binding-id': 'binding-voice' },
    }),
  });

  const stream = await module.subscribeStream({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    voiceStreamId: 'voice-stream-1',
  });
  for await (const _event of stream) {
    break;
  }

  assert.deepEqual(authCalls, []);
  assert.equal(streamOptions[0]?.metadata?.['x-nimi-runtime-scoped-binding-id'], 'binding-voice');
  assert.equal(streamOptions[0]?.metadata?.['x-nimi-access-token-id'], undefined);
  const context = (streamRequests[0] as {
    readonly context?: {
      readonly scopedBinding?: {
        readonly bindingId?: string;
        readonly runtimeAppId?: string;
        readonly agentId?: string;
        readonly conversationAnchorId?: string;
      };
    };
  } | undefined)?.context;
  assert.equal(context?.scopedBinding?.bindingId, 'binding-voice');
  assert.equal(context?.scopedBinding?.runtimeAppId, 'avatar');
  assert.equal(context?.scopedBinding?.agentId, LOCAL_AGENT_REF);
  assert.equal(context?.scopedBinding?.conversationAnchorId, 'anchor-1');
});

test('Runtime Agent voice helper preserves host equivalence without renderer token fallback', async () => {
  const streamOptions: RuntimeTypedCallOptions[] = [];
  const authCalls: string[] = [];
  const module = createNimiRuntimeAgentVoiceModule({
    runtime: {
      appId: 'zhiyu',
      auth: {
        async registerApp() {
          authCalls.push('register');
          throw new Error('Runtime auth fallback must not run for Runtime host equivalence');
        },
      },
      appAuth: {
        async authorizeExternalPrincipal() {
          authCalls.push('authorize');
          throw new Error('Runtime protected token fallback must not run for Runtime host equivalence');
        },
      },
      agents: {
        async *subscribeAgentVoiceStream(_request, options) {
          streamOptions.push(options ?? {});
          yield {
            voiceStreamId: 'voice-stream-1',
            conversationAnchorId: 'anchor-1',
            turnId: 'turn-1',
            streamId: 'stream-1',
            messageId: 'message-1',
            chunkSequence: '1',
            chunk: new Uint8Array([1]),
            mimeType: 'audio/wav',
            voiceOutputMode: 1,
            playbackTarget: 'avatar_autoplay',
            terminal: false,
            voicePlaybackState: 1,
            terminalReason: '',
            replayTruncated: false,
          };
        },
        async interruptAgentVoicePlayback() {
          throw new Error('not expected');
        },
      },
      artifacts: {
        async readArtifactBytes() {
          throw new Error('not expected');
        },
      },
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (_nextScopes, operation) => operation({
      metadata: {
        'x-nimi-runtime-host-equivalence': 'runtime-sdk-authority:kit-electron-runtime-bridge-local-first-party-host',
      },
    }),
  });

  const stream = await module.subscribeStream({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    voiceStreamId: 'voice-stream-1',
  });
  for await (const _event of stream) {
    break;
  }

  assert.deepEqual(authCalls, []);
  assert.equal(
    streamOptions[0]?.metadata?.['x-nimi-runtime-host-equivalence'],
    'runtime-sdk-authority:kit-electron-runtime-bridge-local-first-party-host',
  );
  assert.equal(streamOptions[0]?.metadata?.['x-nimi-access-token-id'], undefined);
  assert.equal(streamOptions[0]?.metadata?.['x-nimi-access-token-secret'], undefined);
});
