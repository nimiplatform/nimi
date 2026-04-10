import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  CORE_CHAT_AGENT_MOD_ID,
  generateChatAgentImageRuntime,
  invokeChatAgentRuntime,
  streamChatAgentRuntime,
  synthesizeChatAgentVoiceRuntime,
} from '../src/shell/renderer/features/chat/chat-agent-runtime.js';
import { resolveAgentTurnTotalTimeoutMs } from '../src/shell/renderer/features/chat/chat-agent-timeouts.js';
import {
  findAgentConversationThreadByAgentId,
  resolveAgentConversationActiveThreadId,
  toAgentFriendTargetsFromSocialSnapshot,
} from '../src/shell/renderer/features/chat/chat-agent-thread-model.js';
import {
  resolveAgentChatThinkingSupport,
  resolveChatThinkingConfig,
} from '../src/shell/renderer/features/chat/chat-thinking.js';
import type { AgentLocalThreadSummary } from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-types.js';
import {
  buildAgentEffectiveCapabilityResolution,
  createAISnapshot,
} from '../src/shell/renderer/features/chat/conversation-capability.js';
import { createEmptyAIConfig } from '@nimiplatform/sdk/mod';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

type CapturedRuntimeTextStreamInput = {
  input: Array<{
    role: string;
    content: string;
    name?: string | undefined;
  }>;
  system?: string | null;
  reasoning?: unknown;
};

test('agent local mode filters social snapshot to agent friends and fails close on broken agent targets', () => {
  const targets = toAgentFriendTargetsFromSocialSnapshot({
    friends: [
      {
        id: 'human-1',
        displayName: 'Human',
        handle: 'human',
        isAgent: false,
      },
      {
        id: 'agent-1',
        displayName: 'Companion',
        handle: 'companion',
        isAgent: true,
        worldId: 'world-1',
        worldName: 'World One',
        bio: 'friend agent',
        ownershipType: 'MASTER_OWNED',
      },
    ],
  });

  assert.deepEqual(targets, [{
    agentId: 'agent-1',
    displayName: 'Companion',
    handle: 'companion',
    avatarUrl: null,
    worldId: 'world-1',
    worldName: 'World One',
    bio: 'friend agent',
    ownershipType: 'MASTER_OWNED',
  }]);

  assert.throws(() => {
    toAgentFriendTargetsFromSocialSnapshot({
      friends: [{
        id: 'agent-2',
        displayName: '',
        handle: 'broken',
        isAgent: true,
      }],
    });
  }, /displayName is required/);
});

test('agent local mode keeps one thread per agent when restoring selection', () => {
  const threads: AgentLocalThreadSummary[] = [
    {
      id: 'thread-agent-1',
      agentId: 'agent-1',
      title: 'Agent One',
      updatedAtMs: 100,
      lastMessageAtMs: 90,
      archivedAtMs: null,
      targetSnapshot: {
        agentId: 'agent-1',
        displayName: 'Agent One',
        handle: 'agent-one',
        avatarUrl: null,
        worldId: null,
        worldName: null,
        bio: null,
        ownershipType: null,
      },
    },
    {
      id: 'thread-agent-2',
      agentId: 'agent-2',
      title: 'Agent Two',
      updatedAtMs: 200,
      lastMessageAtMs: 180,
      archivedAtMs: null,
      targetSnapshot: {
        agentId: 'agent-2',
        displayName: 'Agent Two',
        handle: 'agent-two',
        avatarUrl: null,
        worldId: null,
        worldName: null,
        bio: null,
        ownershipType: null,
      },
    },
  ];

  assert.equal(findAgentConversationThreadByAgentId(threads, 'agent-2')?.id, 'thread-agent-2');
  assert.equal(resolveAgentConversationActiveThreadId({
    threads,
    selectionThreadId: null,
    selectionAgentId: 'agent-2',
    lastSelectedThreadId: 'thread-agent-1',
  }), 'thread-agent-2');
  assert.equal(resolveAgentConversationActiveThreadId({
    threads,
    selectionThreadId: 'thread-missing',
    selectionAgentId: 'agent-1',
    lastSelectedThreadId: 'thread-agent-2',
  }), 'thread-agent-1');
});

test('agent local runtime invoke passes core mod id and agentId to the runtime call', async () => {
  const projection = {
    capability: 'text.generate' as const,
    selectedBinding: {
      source: 'local' as const,
      connectorId: '',
      model: 'llama3',
    },
    resolvedBinding: {
      capability: 'text.generate' as const,
      source: 'local' as const,
      provider: 'llama',
      model: 'llama3',
      modelId: 'llama3',
      localModelId: 'local-chat-1',
      connectorId: '',
      endpoint: 'http://127.0.0.1:11434/v1',
      localProviderEndpoint: 'http://127.0.0.1:11434/v1',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      detail: 'ready',
    },
    metadata: {
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'local:llama3',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: false,
        traceModeSupport: 'none' as const,
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    },
    supported: true,
    reasonCode: null,
  };
  const agentResolution = buildAgentEffectiveCapabilityResolution({
    textProjection: projection,
  });
  const executionSnapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'text.generate',
    projection,
    agentResolution,
  });

  const result = await invokeChatAgentRuntime({
    agentId: 'agent-1',
    prompt: 'hello',
    threadId: 'thread-1',
    reasoningPreference: 'off',
    agentResolution,
    executionSnapshot,
    runtimeConfigState: null,
    runtimeFields: {
      targetType: '',
      targetAccountId: '',
      agentId: '',
      targetId: '',
      worldId: '',
      provider: 'llama',
      runtimeModelType: 'chat',
      localProviderEndpoint: 'http://127.0.0.1:11434/v1',
      localProviderModel: 'llama3',
      localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
      connectorId: '',
      mode: 'STORY',
      turnIndex: 1,
      userConfirmedUpload: false,
    },
  }, {
    invokeModLlmImpl: async (input) => {
      assert.equal(input.modId, CORE_CHAT_AGENT_MOD_ID);
      assert.equal(input.agentId, 'agent-1');
      return {
        text: 'hi',
        traceId: 'trace-1',
        promptTraceId: 'prompt-trace-1',
      };
    },
  });

  assert.equal(result.text, 'hi');
});

test('agent local host turn timeout honors larger image timeout settings', () => {
  const aiConfig = createEmptyAIConfig();
  aiConfig.capabilities.selectedParams['image.generate'] = {
    timeoutMs: '600000',
  };
  assert.equal(resolveAgentTurnTotalTimeoutMs(aiConfig), 600000);
});

test('agent local host turn timeout never drops below text stream default', () => {
  const aiConfig = createEmptyAIConfig();
  aiConfig.capabilities.selectedParams['image.generate'] = {
    timeoutMs: '15000',
  };
  assert.equal(resolveAgentTurnTotalTimeoutMs(aiConfig), 120000);
});

test('agent runtime invoke supports cloud routes via connectorId', async () => {
  const projection = {
    capability: 'text.generate' as const,
    selectedBinding: {
      source: 'cloud' as const,
      connectorId: 'connector-openai',
      model: 'gpt-5.4-mini',
    },
    resolvedBinding: {
      capability: 'text.generate' as const,
      resolvedBindingRef: 'cloud:connector-openai:gpt-5.4-mini',
      source: 'cloud' as const,
      provider: 'openai',
      model: 'gpt-5.4-mini',
      modelId: 'gpt-5.4-mini',
      connectorId: 'connector-openai',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      detail: 'ready',
    },
    metadata: {
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'cloud:connector-openai:gpt-5.4-mini',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: true,
        traceModeSupport: 'separate' as const,
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    },
    supported: true,
    reasonCode: null,
  };
  const agentResolution = buildAgentEffectiveCapabilityResolution({
    textProjection: projection,
  });
  const executionSnapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'text.generate',
    projection,
    agentResolution,
  });

  const result = await invokeChatAgentRuntime({
    agentId: 'agent-1',
    prompt: 'hello cloud',
    threadId: 'thread-cloud',
    reasoningPreference: 'off',
    agentResolution,
    executionSnapshot,
    runtimeConfigState: null,
    runtimeFields: {
      targetType: '',
      targetAccountId: '',
      agentId: '',
      targetId: '',
      worldId: '',
      provider: 'openai',
      runtimeModelType: 'chat',
      localProviderEndpoint: '',
      localProviderModel: '',
      localOpenAiEndpoint: '',
      connectorId: 'connector-openai',
      mode: 'STORY',
      turnIndex: 1,
      userConfirmedUpload: false,
    },
  }, {
    invokeModLlmImpl: async (input) => {
      assert.equal(input.modId, CORE_CHAT_AGENT_MOD_ID);
      assert.equal(input.agentId, 'agent-1');
      assert.equal(input.provider, 'openai');
      assert.equal(input.connectorId, 'connector-openai');
      assert.equal(input.localProviderModel, 'gpt-5.4-mini');
      return {
        text: 'hi cloud',
        traceId: 'trace-cloud',
        promptTraceId: 'prompt-trace-cloud',
      };
    },
  });

  assert.equal(result.text, 'hi cloud');
});

test('agent runtime stream admits structured messages and system prompt', async () => {
  const runtimeFields = {
    targetType: '',
    targetAccountId: '',
    agentId: '',
    targetId: '',
    worldId: '',
    provider: 'llama',
    runtimeModelType: 'chat',
    localProviderEndpoint: 'http://127.0.0.1:11434/v1',
    localProviderModel: 'llama3',
    localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
    connectorId: '',
    mode: 'STORY' as const,
    turnIndex: 1,
    userConfirmedUpload: false,
  };
  let capturedStreamInput: CapturedRuntimeTextStreamInput | null = null;

  const result = await streamChatAgentRuntime({
    agentId: 'agent-1',
    messages: [
      { role: 'assistant', text: 'We should summarize the plan.' },
      { role: 'user', text: 'What should we do next?' },
    ],
    systemPrompt: 'Be warm and concise.',
    threadId: 'thread-structured',
    reasoningPreference: 'off',
    agentResolution: null,
    executionSnapshot: null,
    runtimeConfigState: null,
    runtimeFields,
  }, {
    resolveRouteInputImpl: async () => ({
      modId: CORE_CHAT_AGENT_MOD_ID,
      provider: 'llama',
      localProviderEndpoint: 'http://127.0.0.1:11434/v1',
      localProviderModel: 'llama3',
      localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
    }),
    ensureRuntimeLocalModelWarmImpl: async () => undefined,
    buildRuntimeStreamOptionsImpl: async () => ({
      idempotencyKey: 'runtime-idem-1',
      timeoutMs: 120000,
      signal: undefined,
      metadata: {
        traceId: 'prompt-trace-structured',
        callerKind: 'desktop-core',
        callerId: CORE_CHAT_AGENT_MOD_ID,
        surfaceId: 'desktop.renderer',
      },
    }),
    getRuntimeClientImpl: () => ({
      ai: {
        text: {
          stream: async (input: CapturedRuntimeTextStreamInput) => {
            capturedStreamInput = input;
            async function* stream() {
              yield { type: 'start' as const };
            }
            return { stream: stream() };
          },
        },
      },
    }) as never,
  });

  assert.equal(result.promptTraceId, 'prompt-trace-structured');
  const streamInput = capturedStreamInput as CapturedRuntimeTextStreamInput | null;
  if (!streamInput) {
    throw new Error('structured stream input was not captured');
  }
  assert.deepEqual(streamInput.input, [
    {
      role: 'assistant',
      content: 'We should summarize the plan.',
      name: undefined,
    },
    {
      role: 'user',
      content: 'What should we do next?',
      name: undefined,
    },
  ]);
  assert.equal(streamInput.system, 'Be warm and concise.');
  assert.deepEqual(
    streamInput.reasoning,
    resolveChatThinkingConfig('off', resolveAgentChatThinkingSupport()),
  );
});

test('agent local runtime invoke falls back to resolved endpoint when provider-specific endpoints are absent', async () => {
  const projection = {
    capability: 'text.generate' as const,
    selectedBinding: {
      source: 'local' as const,
      connectorId: '',
      model: 'qwen3',
    },
    resolvedBinding: {
      capability: 'text.generate' as const,
      resolvedBindingRef: 'local:llama:qwen3',
      source: 'local' as const,
      provider: 'llama',
      model: 'qwen3',
      modelId: 'qwen3',
      localModelId: 'local-chat-1',
      connectorId: '',
      endpoint: 'http://127.0.0.1:11434/v1',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      detail: 'ready',
    },
    metadata: {
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'local:llama:qwen3',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: false,
        traceModeSupport: 'none' as const,
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    },
    supported: true,
    reasonCode: null,
  };
  const agentResolution = buildAgentEffectiveCapabilityResolution({
    textProjection: projection,
  });
  const executionSnapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'text.generate',
    projection,
    agentResolution,
  });

  await assert.doesNotReject(async () => {
    await invokeChatAgentRuntime({
      agentId: 'agent-1',
      prompt: 'hello local',
      threadId: 'thread-local',
      reasoningPreference: 'off',
      agentResolution,
      executionSnapshot,
      runtimeConfigState: null,
      runtimeFields: {
        targetType: '',
        targetAccountId: '',
        agentId: '',
        targetId: '',
        worldId: '',
        provider: 'llama',
        runtimeModelType: 'chat',
        localProviderEndpoint: '',
        localProviderModel: '',
        localOpenAiEndpoint: '',
        connectorId: '',
        mode: 'STORY',
        turnIndex: 1,
        userConfirmedUpload: false,
      },
    }, {
      invokeModLlmImpl: async (input) => {
        assert.equal(input.localProviderEndpoint, 'http://127.0.0.1:11434/v1');
        assert.equal(input.localOpenAiEndpoint, 'http://127.0.0.1:11434/v1');
        return {
          text: 'hi local',
          traceId: 'trace-local',
          promptTraceId: 'prompt-trace-local',
        };
      },
    });
  });
});

test('agent image runtime returns artifact uri when provided by runtime media output', async () => {
  const projection = {
    capability: 'image.generate' as const,
    selectedBinding: {
      source: 'local' as const,
      connectorId: '',
      model: 'flux',
    },
    resolvedBinding: {
      capability: 'image.generate' as const,
      resolvedBindingRef: 'local:forge:flux',
      source: 'local' as const,
      provider: 'forge',
      model: 'flux',
      modelId: 'flux',
      connectorId: '',
      endpoint: 'http://127.0.0.1:7860',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      detail: 'ready',
    },
    metadata: null,
    supported: true,
    reasonCode: null,
  };
  const agentResolution = buildAgentEffectiveCapabilityResolution({
    textProjection: null,
    imageProjection: projection,
  });
  const imageExecutionSnapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'image.generate',
    projection,
    agentResolution,
  });

  const result = await generateChatAgentImageRuntime({
    prompt: 'draw the inn at sunset',
    imageExecutionSnapshot,
  }, {
    buildRuntimeRequestMetadataImpl: async () => ({ traceId: 'trace-image-uri' }),
    getRuntimeClientImpl: () => ({
      media: {
        image: {
          generate: async (request: Record<string, unknown>) => {
            assert.equal(request.prompt, 'draw the inn at sunset');
            assert.equal(request.model, 'flux');
            return {
              artifacts: [{
                artifactId: 'artifact-uri',
                mimeType: 'image/png',
                uri: 'https://cdn.nimi.test/generated.png',
              }],
              trace: {
                traceId: 'trace-image-uri',
              },
            };
          },
        },
      },
    }) as never,
  });

  assert.equal(result.mediaUrl, 'https://cdn.nimi.test/generated.png');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.artifactId, 'artifact-uri');
});

test('agent image runtime encodes artifact bytes to stable data url when uri is absent', async () => {
  const projection = {
    capability: 'image.generate' as const,
    selectedBinding: {
      source: 'cloud' as const,
      connectorId: 'connector-image',
      model: 'gpt-image-1',
    },
    resolvedBinding: {
      capability: 'image.generate' as const,
      resolvedBindingRef: 'cloud:connector-image:gpt-image-1',
      source: 'cloud' as const,
      provider: 'openai',
      model: 'gpt-image-1',
      modelId: 'gpt-image-1',
      connectorId: 'connector-image',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      detail: 'ready',
    },
    metadata: null,
    supported: true,
    reasonCode: null,
  };
  const agentResolution = buildAgentEffectiveCapabilityResolution({
    textProjection: null,
    imageProjection: projection,
  });
  const imageExecutionSnapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'image.generate',
    projection,
    agentResolution,
  });

  const result = await generateChatAgentImageRuntime({
    prompt: 'paint a tea bowl',
    imageExecutionSnapshot,
  }, {
    buildRuntimeRequestMetadataImpl: async () => ({ traceId: 'trace-image-bytes' }),
    getRuntimeClientImpl: () => ({
      media: {
        image: {
          generate: async () => ({
            artifacts: [{
              artifactId: 'artifact-bytes',
              mimeType: 'image/png',
              bytes: new Uint8Array([0x41, 0x42, 0x43]),
            }],
            trace: {
              traceId: 'trace-image-bytes',
            },
          }),
        },
      },
    }) as never,
  });

  assert.equal(result.mediaUrl, 'data:image/png;base64,QUJD');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.artifactId, 'artifact-bytes');
});

test('agent voice runtime returns cached playback artifact from audio.synthesize routes', async () => {
  const textProjection = {
    capability: 'text.generate' as const,
    selectedBinding: {
      source: 'local' as const,
      connectorId: '',
      model: 'qwen3',
    },
    resolvedBinding: {
      capability: 'text.generate' as const,
      resolvedBindingRef: 'local:text:qwen3',
      source: 'local' as const,
      provider: 'llama',
      model: 'qwen3',
      modelId: 'qwen3',
      connectorId: '',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      detail: 'ready',
    },
    metadata: null,
    supported: true,
    reasonCode: null,
  };
  const voiceProjection = {
    capability: 'audio.synthesize' as const,
    selectedBinding: {
      source: 'local' as const,
      connectorId: '',
      model: 'kokoro-82m',
    },
    resolvedBinding: {
      capability: 'audio.synthesize' as const,
      resolvedBindingRef: 'local:audio:kokoro-82m',
      source: 'local' as const,
      provider: 'kokoro',
      model: 'kokoro-82m',
      modelId: 'kokoro-82m',
      connectorId: '',
      endpoint: 'http://127.0.0.1:8010',
      localProviderEndpoint: 'http://127.0.0.1:8010',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      detail: 'ready',
    },
    metadata: null,
    supported: true,
    reasonCode: null,
  };
  const agentResolution = buildAgentEffectiveCapabilityResolution({
    textProjection,
    voiceProjection,
  });
  const voiceExecutionSnapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'audio.synthesize',
    projection: voiceProjection,
    agentResolution,
  });
  const capturedRequests: Array<{
    model?: unknown;
    text?: unknown;
    route?: unknown;
    audioFormat?: unknown;
  }> = [];

  const result = await synthesizeChatAgentVoiceRuntime({
    prompt: '晚安，记得早点休息。',
    voiceExecutionSnapshot,
  }, {
    buildRuntimeRequestMetadataImpl: async () => ({ traceId: 'trace-voice-request' }),
    getRuntimeClientImpl: () => ({
      media: {
        tts: {
          synthesize: async (request: {
            model?: unknown;
            text?: unknown;
            route?: unknown;
            audioFormat?: unknown;
          }) => {
            capturedRequests.push(request);
            return {
              artifacts: [{
                artifactId: 'voice-artifact-1',
                mimeType: 'audio/mpeg',
                uri: 'file:///tmp/voice-turn-1.mp3',
              }],
              trace: {
                traceId: 'trace-voice-1',
              },
            };
          },
        },
      },
    }) as never,
  });

  assert.equal(capturedRequests[0]?.model, 'kokoro-82m');
  assert.equal(capturedRequests[0]?.text, '晚安，记得早点休息。');
  assert.equal(capturedRequests[0]?.route, 'local');
  assert.equal(capturedRequests[0]?.audioFormat, 'mp3');
  assert.equal(result.mediaUrl, 'file:///tmp/voice-turn-1.mp3');
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(result.artifactId, 'voice-artifact-1');
});

test('agent image runtime injects managed image workflow profile entries for local-import z_image_turbo routes', async () => {
  const projection = {
    capability: 'image.generate' as const,
    selectedBinding: {
      source: 'local' as const,
      connectorId: '',
      model: 'local-import/z_image_turbo-Q4_K',
    },
    resolvedBinding: {
      capability: 'image.generate' as const,
      resolvedBindingRef: 'local:media:local-import/z_image_turbo-Q4_K',
      source: 'local' as const,
      provider: 'media',
      engine: 'media',
      model: 'media/local-import/z_image_turbo-Q4_K',
      modelId: 'local-import/z_image_turbo-Q4_K',
      localModelId: '01-main',
      goRuntimeLocalModelId: '01-main',
      connectorId: '',
      endpoint: 'http://127.0.0.1:8321/v1',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      detail: 'ready',
    },
    metadata: null,
    supported: true,
    reasonCode: null,
  };
  const agentResolution = buildAgentEffectiveCapabilityResolution({
    textProjection: null,
    imageProjection: projection,
  });
  const imageExecutionSnapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'image.generate',
    projection,
    agentResolution,
  });
  let capturedRequest: Record<string, unknown> | null = null;

  await generateChatAgentImageRuntime({
    prompt: 'draw the harbor in fog',
    imageExecutionSnapshot,
    imageCapabilityParams: {
      size: '512x512',
      responseFormat: 'auto',
      seed: '42',
      timeoutMs: '600000',
      steps: '15',
      cfgScale: '1.5',
      sampler: 'euler',
      scheduler: 'karras',
      optionsText: 'diffusion_fa:true',
      companionSlots: {
        vae_path: 'vae-1',
        llm_path: 'llm-1',
      },
    },
  }, {
    buildRuntimeRequestMetadataImpl: async () => ({ traceId: 'trace-image-workflow' }),
    getRuntimeClientImpl: () => ({
      media: {
        image: {
          generate: async (request: Record<string, unknown>) => {
            capturedRequest = request;
            return {
              artifacts: [{
                artifactId: 'artifact-workflow',
                mimeType: 'image/png',
                uri: 'https://cdn.nimi.test/workflow.png',
              }],
              trace: {
                traceId: 'trace-image-workflow',
              },
            };
          },
        },
      },
    }) as never,
  });

  if (!capturedRequest) {
    assert.fail('expected runtime media image request to be captured');
  }
  const request = capturedRequest as Record<string, unknown>;
  assert.equal(request['prompt'], 'draw the harbor in fog');
  assert.equal(request['model'], 'local-import/z_image_turbo-Q4_K');
  assert.equal(request['responseFormat'], undefined);
  assert.equal(request['size'], '512x512');
  assert.equal(request['seed'], 42);
  assert.equal(request['timeoutMs'], 600000);
  assert.deepEqual(request['extensions'], {
    entry_overrides: [
      { entry_id: 'agent-chat/image-main-model', local_asset_id: '01-main' },
      { entry_id: 'agent-chat/image-slot/vae_path', local_asset_id: 'vae-1' },
      { entry_id: 'agent-chat/image-slot/llm_path', local_asset_id: 'llm-1' },
    ],
    profile_entries: [
      {
        entryId: 'agent-chat/image-main-model',
        kind: 'asset',
        capability: 'image',
        title: 'Selected local image model',
        required: true,
        preferred: true,
        assetId: 'local-import/z_image_turbo-Q4_K',
        assetKind: 'image',
      },
      {
        entryId: 'agent-chat/image-slot/vae_path',
        kind: 'asset',
        capability: 'image',
        title: 'Workflow slot vae_path',
        required: true,
        preferred: true,
        assetId: 'vae_path',
        assetKind: 'vae',
        engineSlot: 'vae_path',
      },
      {
        entryId: 'agent-chat/image-slot/llm_path',
        kind: 'asset',
        capability: 'image',
        title: 'Workflow slot llm_path',
        required: true,
        preferred: true,
        assetId: 'llm_path',
        assetKind: 'chat',
        engineSlot: 'llm_path',
      },
    ],
    profile_overrides: {
      step: 15,
      cfg_scale: 1.5,
      sampler: 'euler',
      scheduler: 'karras',
      options: ['diffusion_fa:true'],
    },
  });
});


test('agent submit fail-closes when AgentEffectiveCapabilityResolution.ready is false', () => {
  const supportedProjection = {
    capability: 'text.generate' as const,
    selectedBinding: { source: 'local' as const, connectorId: '', model: 'qwen3' },
    resolvedBinding: { capability: 'text.generate' as const, resolvedBindingRef: 'local:llama:qwen3', source: 'local' as const, provider: 'llama', model: 'qwen3', modelId: 'qwen3', connectorId: '' },
    health: { healthy: true, status: 'healthy' as const, detail: 'ready' },
    metadata: { capability: 'text.generate' as const, metadataVersion: 'v1' as const, resolvedBindingRef: 'local:llama:qwen3', metadataKind: 'text.generate' as const, metadata: { supportsThinking: false, traceModeSupport: 'none' as const, supportsImageInput: false, supportsAudioInput: false, supportsVideoInput: false, supportsArtifactRefInput: false } },
    supported: true,
    reasonCode: null,
  };

  // projection_unavailable
  const res1 = buildAgentEffectiveCapabilityResolution({
    textProjection: null,
  });
  assert.equal(res1.ready, false);
  assert.equal(res1.reason, 'projection_unavailable');

  // route_unresolved (supported but no resolvedBinding)
  const noBindingProjection = { ...supportedProjection, resolvedBinding: null };
  const res2 = buildAgentEffectiveCapabilityResolution({
    textProjection: noBindingProjection,
  });
  assert.equal(res2.ready, false);
  assert.equal(res2.reason, 'route_unresolved');

  // ok
  const res3 = buildAgentEffectiveCapabilityResolution({
    textProjection: supportedProjection,
  });
  assert.equal(res3.ready, true);
  assert.equal(res3.reason, 'ok');
});

test('agent capability resolution keeps image and voice optional while exposing readiness truth', () => {
  const textProjection = {
    capability: 'text.generate' as const,
    selectedBinding: { source: 'local' as const, connectorId: '', model: 'qwen3' },
    resolvedBinding: {
      capability: 'text.generate' as const,
      resolvedBindingRef: 'local:text:qwen3',
      source: 'local' as const,
      provider: 'llama',
      model: 'qwen3',
      modelId: 'qwen3',
      connectorId: '',
    },
    health: { healthy: true, status: 'healthy' as const, detail: 'ready' },
    metadata: {
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'local:text:qwen3',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: false,
        traceModeSupport: 'none' as const,
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    },
    supported: true,
    reasonCode: null,
  };
  const readyImageProjection = {
    capability: 'image.generate' as const,
    selectedBinding: { source: 'local' as const, connectorId: '', model: 'flux' },
    resolvedBinding: {
      capability: 'image.generate' as const,
      resolvedBindingRef: 'local:image:flux',
      source: 'local' as const,
      provider: 'forge',
      model: 'flux',
      modelId: 'flux',
      connectorId: '',
      endpoint: 'http://127.0.0.1:7860',
    },
    health: { healthy: true, status: 'healthy' as const, detail: 'ready' },
    metadata: null,
    supported: true,
    reasonCode: null,
  };
  const readyVoiceProjection = {
    capability: 'audio.synthesize' as const,
    selectedBinding: { source: 'cloud' as const, connectorId: 'connector-voice', model: 'gpt-4o-mini-tts' },
    resolvedBinding: {
      capability: 'audio.synthesize' as const,
      resolvedBindingRef: 'cloud:audio:connector-voice:gpt-4o-mini-tts',
      source: 'cloud' as const,
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      modelId: 'gpt-4o-mini-tts',
      connectorId: 'connector-voice',
    },
    health: { healthy: true, status: 'healthy' as const, detail: 'ready' },
    metadata: null,
    supported: true,
    reasonCode: null,
  };

  const withoutImage = buildAgentEffectiveCapabilityResolution({
    textProjection,
    imageProjection: null,
    voiceProjection: null,
  });
  assert.equal(withoutImage.ready, true);
  assert.equal(withoutImage.imageProjection, null);
  assert.equal(withoutImage.imageReady, false);
  assert.equal(withoutImage.voiceProjection, null);
  assert.equal(withoutImage.voiceReady, false);
  assert.equal(withoutImage.voiceWorkflowReadyByCapability['voice_workflow.tts_v2v'], false);
  assert.equal(withoutImage.voiceWorkflowReadyByCapability['voice_workflow.tts_t2v'], false);

  const readyVoiceWorkflowCloneProjection = {
    capability: 'voice_workflow.tts_v2v' as const,
    selectedBinding: { source: 'cloud' as const, connectorId: 'connector-voice-clone', model: 'qwen3-tts-vc' },
    resolvedBinding: {
      capability: 'voice_workflow.tts_v2v' as const,
      resolvedBindingRef: 'cloud:voice_workflow.tts_v2v:connector-voice-clone:qwen3-tts-vc',
      source: 'cloud' as const,
      provider: 'dashscope',
      model: 'qwen3-tts-vc',
      modelId: 'qwen3-tts-vc',
      connectorId: 'connector-voice-clone',
    },
    health: { healthy: true, status: 'healthy' as const, detail: 'ready' },
    metadata: {
      capability: 'voice_workflow.tts_v2v' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'cloud:voice_workflow.tts_v2v:connector-voice-clone:qwen3-tts-vc',
      metadataKind: 'voice_workflow.tts_v2v' as const,
      metadata: {
        workflowType: 'tts_v2v' as const,
        supportsReferenceAudioInput: true as const,
        supportsTextPromptInput: true,
        requiresTargetSynthesisBinding: true,
      },
    },
    supported: true,
    reasonCode: null,
  };
  const readyVoiceWorkflowDesignProjection = {
    capability: 'voice_workflow.tts_t2v' as const,
    selectedBinding: { source: 'cloud' as const, connectorId: 'connector-voice-design', model: 'qwen3-tts-vd' },
    resolvedBinding: {
      capability: 'voice_workflow.tts_t2v' as const,
      resolvedBindingRef: 'cloud:voice_workflow.tts_t2v:connector-voice-design:qwen3-tts-vd',
      source: 'cloud' as const,
      provider: 'dashscope',
      model: 'qwen3-tts-vd',
      modelId: 'qwen3-tts-vd',
      connectorId: 'connector-voice-design',
    },
    health: { healthy: true, status: 'healthy' as const, detail: 'ready' },
    metadata: {
      capability: 'voice_workflow.tts_t2v' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'cloud:voice_workflow.tts_t2v:connector-voice-design:qwen3-tts-vd',
      metadataKind: 'voice_workflow.tts_t2v' as const,
      metadata: {
        workflowType: 'tts_t2v' as const,
        supportsReferenceAudioInput: false as const,
        supportsTextPromptInput: true as const,
        requiresTargetSynthesisBinding: true,
      },
    },
    supported: true,
    reasonCode: null,
  };

  const withReadyImage = buildAgentEffectiveCapabilityResolution({
    textProjection,
    imageProjection: readyImageProjection,
    voiceProjection: readyVoiceProjection,
    voiceWorkflowCloneProjection: readyVoiceWorkflowCloneProjection,
    voiceWorkflowDesignProjection: readyVoiceWorkflowDesignProjection,
  });
  assert.equal(withReadyImage.ready, true);
  assert.equal(withReadyImage.imageProjection?.capability, 'image.generate');
  assert.equal(withReadyImage.imageReady, true);
  assert.equal(withReadyImage.voiceProjection?.capability, 'audio.synthesize');
  assert.equal(withReadyImage.voiceReady, true);
  assert.equal(withReadyImage.voiceWorkflowProjections['voice_workflow.tts_v2v']?.capability, 'voice_workflow.tts_v2v');
  assert.equal(withReadyImage.voiceWorkflowProjections['voice_workflow.tts_t2v']?.capability, 'voice_workflow.tts_t2v');
  assert.equal(withReadyImage.voiceWorkflowReadyByCapability['voice_workflow.tts_v2v'], true);
  assert.equal(withReadyImage.voiceWorkflowReadyByCapability['voice_workflow.tts_t2v'], true);

  const unresolvedImage = buildAgentEffectiveCapabilityResolution({
    textProjection,
    imageProjection: {
      ...readyImageProjection,
      resolvedBinding: null,
    },
    voiceProjection: {
      ...readyVoiceProjection,
      resolvedBinding: null,
    },
    voiceWorkflowCloneProjection: {
      ...readyVoiceWorkflowCloneProjection,
      resolvedBinding: null,
    },
  });
  assert.equal(unresolvedImage.ready, true);
  assert.equal(unresolvedImage.imageReady, false);
  assert.equal(unresolvedImage.voiceReady, false);
  assert.equal(unresolvedImage.voiceWorkflowReadyByCapability['voice_workflow.tts_v2v'], false);
});

test('agent local mode creates image execution snapshot for runtime-authoritative local image routes with endpoint', () => {
  const textProjection = {
    capability: 'text.generate' as const,
    selectedBinding: { source: 'local' as const, connectorId: '', model: 'llama3' },
    resolvedBinding: {
      capability: 'text.generate' as const,
      resolvedBindingRef: 'local:text:llama3',
      source: 'local' as const,
      provider: 'llama',
      model: 'llama3',
      modelId: 'llama3',
      localModelId: 'local-chat-1',
      connectorId: '',
      endpoint: 'http://127.0.0.1:11434/v1',
      localProviderEndpoint: 'http://127.0.0.1:11434/v1',
    },
    health: { healthy: true, status: 'healthy' as const, detail: 'ready' },
    metadata: {
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'local:text:llama3',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: false,
        traceModeSupport: 'none' as const,
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    },
    supported: true,
    reasonCode: null,
  };
  const imageProjection = {
    capability: 'image.generate' as const,
    selectedBinding: { source: 'local' as const, connectorId: '', model: 'z_image_turbo' },
    resolvedBinding: {
      capability: 'image.generate' as const,
      resolvedBindingRef: 'local:image:z_image_turbo',
      source: 'local' as const,
      provider: 'media',
      model: 'media/z_image_turbo',
      modelId: 'z_image_turbo',
      localModelId: '01JIMAGE',
      connectorId: '',
      engine: 'media',
      endpoint: 'http://127.0.0.1:8321/v1',
      localProviderEndpoint: 'http://127.0.0.1:8321/v1',
      goRuntimeLocalModelId: 'go-z-image',
      goRuntimeStatus: 'active',
    },
    health: { healthy: true, status: 'healthy' as const, detail: 'ready' },
    metadata: null,
    supported: true,
    reasonCode: null,
  };

  const agentResolution = buildAgentEffectiveCapabilityResolution({
    textProjection,
    imageProjection,
  });
  const imageExecutionSnapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'image.generate',
    projection: imageProjection,
    agentResolution,
  });
  const resolvedBinding = imageExecutionSnapshot.conversationCapabilitySlice?.resolvedBinding as {
    endpoint?: string;
    goRuntimeLocalModelId?: string;
    goRuntimeStatus?: string;
  } | undefined;

  assert.equal(agentResolution.ready, true);
  assert.equal(agentResolution.imageReady, true);
  assert.equal(imageExecutionSnapshot.conversationCapabilitySlice?.capability, 'image.generate');
  assert.equal(resolvedBinding?.endpoint, 'http://127.0.0.1:8321/v1');
  assert.equal(resolvedBinding?.goRuntimeLocalModelId, 'go-z-image');
  assert.equal(resolvedBinding?.goRuntimeStatus, 'active');
});

test('agent local mode keeps thinking unsupported and forces effective off config', () => {
  assert.deepEqual(resolveAgentChatThinkingSupport(), {
    supported: false,
    reason: 'agent_route_unsupported',
  });
  assert.deepEqual(
    resolveChatThinkingConfig('on', resolveAgentChatThinkingSupport()),
    {
      mode: 'off',
      traceMode: 'hide',
    },
  );
});

test('agent shell stays desktop-owned and uses social snapshot plus local agent store', () => {
  const adapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-adapter.tsx');
  const hostActionsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-host-actions.ts');
  const presentationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx');
  const effectsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-effects.ts');
  const humanAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-human-adapter.tsx');
  const orchestrationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-orchestration.ts');
  assert.match(adapterSource, /dataSync\.loadSocialSnapshot\(\)/);
  assert.match(adapterSource, /createAgentLocalChatConversationProvider/);
  assert.match(adapterSource, /useAgentConversationEffects/);
  assert.match(adapterSource, /useAgentConversationPresentation/);
  assert.match(hostActionsSource, /chatAgentStoreClient\.createThread/);
  assert.match(hostActionsSource, /chatAgentStoreClient\.commitTurnResult/);
  assert.match(hostActionsSource, /matchConversationTurnEvent/);
  assert.match(hostActionsSource, /createInitialAgentSubmitDriverState/);
  assert.match(hostActionsSource, /reduceAgentSubmitDriverEvent/);
  assert.match(hostActionsSource, /resolveCompletedAgentSubmitDriverCheckpoint/);
  assert.match(hostActionsSource, /resolveInterruptedAgentSubmitDriverCheckpoint/);
  assert.match(hostActionsSource, /resolveAgentSubmitDriverProjectionRefresh/);
  assert.match(hostActionsSource, /resolveAuthoritativeAgentThreadBundle/);
  assert.match(hostActionsSource, /assertAgentTurnLifecycleCompleted/);
  assert.match(hostActionsSource, /const activeTarget = input\.activeTarget;/);
  assert.match(hostActionsSource, /if \(!effectiveThreadId \|\| !effectiveThreadRecord\) \{\s+effectiveThreadRecord = await createOrRestoreThreadForTarget\(activeTarget\);/);
  assert.match(hostActionsSource, /setSubmittingThreadId\(effectiveThreadId\)/);
  assert.match(hostActionsSource, /setFooterHostState\(effectiveThreadId,\s*null\)/);
  assert.match(hostActionsSource, /finally\s*\{[\s\S]*input\.setSubmittingThreadId\(null\);/);
  assert.match(hostActionsSource, /submitSession\.lifecycle\.projectionVersion\s*\?\s*await chatAgentStoreClient\.getThreadBundle\(effectiveThreadId\)/);
  assert.match(hostActionsSource, /if \(submitSession\.lifecycle\.projectionVersion\) \{\s+refreshedBundle = await chatAgentStoreClient\.getThreadBundle\(effectiveThreadId\);/);
  assert.match(hostActionsSource, /projectionRefreshPromise = chatAgentStoreClient\.getThreadBundle\(effectiveThreadId\)/);
  assert.match(adapterSource, /logRendererEvent/);
  assert.match(adapterSource, /conversationCapabilityProjectionByCapability\['audio\.transcribe'\]/);
  assert.match(adapterSource, /voiceSessionState/);
  assert.match(adapterSource, /handleVoiceSessionToggle/);
  assert.match(adapterSource, /resolveIsVoiceSessionForeground/);
  assert.match(adapterSource, /document\.addEventListener\('visibilitychange', syncForegroundState\)/);
  assert.match(adapterSource, /autoStopMode:\s*'silence'/);
  assert.match(adapterSource, /return createReadyConversationSetupState\('agent'\);/);
  assert.match(adapterSource, /const composerReady = setupState\.status === 'ready'\s+&& !isBundleLoading\s+&& !bundleQuery\.error/);
  assert.match(hostActionsSource, /ensureAgentConversationSubmitRouteReady/);
  assert.match(orchestrationSource, /normalizeConversationRuntimeTextStreamPart/);
  assert.doesNotMatch(orchestrationSource, /Unsupported agent runtime stream part/);
  assert.doesNotMatch(orchestrationSource, /yield \{ type: 'start' \};/);
  assert.match(presentationSource, /showStreamingText=\{false\}/);
  assert.match(presentationSource, /resolveAgentFooterViewState/);
  assert.match(presentationSource, /resolveAgentConversationSurfaceState/);
  assert.match(presentationSource, /resolveAgentConversationHostView/);
  assert.match(presentationSource, /resolveAgentConversationHostSnapshot/);
  assert.match(presentationSource, /resolveAgentTargetSummaries/);
  assert.match(presentationSource, /resolveAgentCanonicalMessages/);
  assert.match(presentationSource, /resolveAgentSelectedTargetId/);
  assert.match(presentationSource, /voiceState=\{resolveAgentComposerVoiceState/);
  assert.match(effectsSource, /applyDriverEffects/);
  assert.match(effectsSource, /applyHostInteractionPatch/);
  assert.doesNotMatch(humanAdapterSource, /voice session mode stays on/);
  assert.doesNotMatch(adapterSource, /chatAgentStoreClient\.createThread/);
  assert.doesNotMatch(adapterSource, /chatAgentStoreClient\.commitTurnResult/);
  assert.doesNotMatch(adapterSource, /matchConversationTurnEvent/);
  assert.doesNotMatch(adapterSource, /createInitialAgentSubmitDriverState/);
  assert.doesNotMatch(adapterSource, /reduceAgentSubmitDriverEvent/);
  assert.doesNotMatch(adapterSource, /resolveCompletedAgentSubmitDriverCheckpoint/);
  assert.doesNotMatch(adapterSource, /resolveInterruptedAgentSubmitDriverCheckpoint/);
  assert.doesNotMatch(adapterSource, /resolveAgentSubmitDriverProjectionRefresh/);
  assert.doesNotMatch(adapterSource, /resolveAuthoritativeAgentThreadBundle/);
  assert.doesNotMatch(adapterSource, /assertAgentTurnLifecycleCompleted/);
  assert.doesNotMatch(adapterSource, /streamState\s*&&\s*streamState\.phase === 'waiting'/);
  assert.doesNotMatch(adapterSource, /streamState\s*&&\s*\(streamState\.phase === 'waiting' \|\| streamState\.phase === 'streaming'\)/);
  assert.doesNotMatch(adapterSource, /overlayAgentAssistantVisibleState/);
  assert.doesNotMatch(adapterSource, /createInitialAgentSubmitSessionState/);
  assert.doesNotMatch(adapterSource, /reduceAgentSubmitSessionEvent/);
  assert.doesNotMatch(adapterSource, /resolveCompletedAgentSubmitSession/);
  assert.doesNotMatch(adapterSource, /resolveInterruptedAgentSubmitSession/);
  assert.doesNotMatch(adapterSource, /resolveProjectionRefreshAgentSubmitSession/);
  assert.doesNotMatch(adapterSource, /resolveCompletedAgentSubmitHostFlow/);
  assert.doesNotMatch(adapterSource, /resolveInterruptedAgentSubmitHostFlow/);
  assert.doesNotMatch(adapterSource, /resolveAgentProjectionRefreshOutcome/);
  assert.doesNotMatch(adapterSource, /resolveCompletedAgentHostInteraction/);
  assert.doesNotMatch(adapterSource, /resolveInterruptedAgentHostInteraction/);
  assert.doesNotMatch(adapterSource, /resolveProjectionRefreshAgentHostInteraction/);
  assert.doesNotMatch(adapterSource, /applyAuthoritativeBundle/);
  assert.doesNotMatch(adapterSource, /applySubmitOutcome/);
  assert.doesNotMatch(adapterSource, /if \(!refreshOutcome\.hostInteractionPatch\)/);
  assert.doesNotMatch(adapterSource, /let streamedText =/);
  assert.doesNotMatch(adapterSource, /let streamedReasoningText =/);
  assert.doesNotMatch(adapterSource, /let runtimeTraceId =/);
  assert.doesNotMatch(adapterSource, /let promptTraceId =/);
  assert.doesNotMatch(adapterSource, /let assistantVisible =/);
  assert.doesNotMatch(adapterSource, /let workingBundle =/);
  assert.doesNotMatch(adapterSource, /chatAgentStoreClient\.createMessage/);
  assert.doesNotMatch(adapterSource, /chatAgentStoreClient\.updateMessage/);
  assert.doesNotMatch(adapterSource, /relay:/);
  assert.doesNotMatch(adapterSource, /nimi-mods\/runtime\/local-chat/);
  assert.doesNotMatch(adapterSource, /RuntimeStatusSidebar/);
});
