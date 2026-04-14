import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ScenarioJobStatus, toProtoStruct } from '@nimiplatform/sdk/runtime';

import {
  CORE_CHAT_AGENT_MOD_ID,
  generateChatAgentImageRuntime,
  invokeChatAgentRuntime,
  streamChatAgentRuntime,
  synthesizeChatAgentVoiceRuntime,
} from '../src/shell/renderer/features/chat/chat-agent-runtime.js';
import { findRuntimeRouteModelProfile } from '../src/shell/renderer/features/chat/chat-ai-route-view.js';
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
  model?: string;
  route?: string;
  connectorId?: string;
  input: Array<{
    role: string;
    content: string;
    name?: string | undefined;
  }> | string;
  system?: string | null;
  maxTokens?: number;
  reasoning?: unknown;
  timeoutMs?: number;
  metadata?: Record<string, string>;
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

test('agent local runtime invoke uses runtime text generate with desktop-core metadata', async () => {
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

  let capturedGenerateInput: CapturedRuntimeTextStreamInput | null = null;

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
    resolveRouteInputImpl: async () => ({
      modId: CORE_CHAT_AGENT_MOD_ID,
      provider: 'llama',
      localProviderEndpoint: 'http://127.0.0.1:11434/v1',
      localProviderModel: 'llama3',
      localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
    }),
    ensureRuntimeLocalModelWarmImpl: async () => undefined,
    buildRuntimeCallOptionsImpl: async () => ({
      idempotencyKey: 'runtime-idem-1',
      timeoutMs: 120000,
      metadata: {
        traceId: 'prompt-trace-1',
        callerKind: 'desktop-core',
        callerId: CORE_CHAT_AGENT_MOD_ID,
        surfaceId: 'desktop.renderer',
      },
    }),
    getRuntimeClientImpl: () => ({
      ai: {
        text: {
          generate: async (input: CapturedRuntimeTextStreamInput) => {
            capturedGenerateInput = input;
            return {
              text: 'hi',
              finishReason: 'stop',
              usage: {},
              trace: {
                traceId: 'trace-1',
              },
            };
          },
        },
      },
    }) as never,
  });

  assert.equal(result.text, 'hi');
  assert.equal(result.traceId, 'trace-1');
  assert.equal(result.promptTraceId, 'prompt-trace-1');
  assert.deepEqual(capturedGenerateInput, {
    model: 'llama/llama3',
    route: 'local',
    connectorId: undefined,
    input: 'hello',
    system: undefined,
    maxTokens: undefined,
    reasoning: resolveChatThinkingConfig('off', resolveAgentChatThinkingSupport()),
    timeoutMs: 120000,
    metadata: {
      traceId: 'prompt-trace-1',
      callerKind: 'desktop-core',
      callerId: CORE_CHAT_AGENT_MOD_ID,
      surfaceId: 'desktop.renderer',
    },
  });
});

test('agent runtime invoke admits structured messages and system prompt', async () => {
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
  let capturedGenerateInput: CapturedRuntimeTextStreamInput | null = null;

  const result = await invokeChatAgentRuntime({
    agentId: 'agent-1',
    messages: [
      { role: 'assistant', text: 'We should summarize the plan.' },
      { role: 'user', text: 'What should we do next?' },
    ],
    systemPrompt: 'Be warm and concise.',
    threadId: 'thread-structured',
    reasoningPreference: 'off',
    maxOutputTokensRequested: 321,
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
    buildRuntimeCallOptionsImpl: async () => ({
      idempotencyKey: 'runtime-idem-structured',
      timeoutMs: 120000,
      metadata: {
        traceId: 'prompt-trace-structured-invoke',
        callerKind: 'desktop-core',
        callerId: CORE_CHAT_AGENT_MOD_ID,
        surfaceId: 'desktop.renderer',
      },
    }),
    getRuntimeClientImpl: () => ({
      ai: {
        text: {
          generate: async (input: CapturedRuntimeTextStreamInput) => {
            capturedGenerateInput = input;
            return {
              text: 'Structured reply',
              finishReason: 'stop',
              usage: {},
              trace: {
                traceId: 'trace-structured-invoke',
              },
            };
          },
        },
      },
    }) as never,
  });

  assert.equal(result.text, 'Structured reply');
  assert.equal(result.traceId, 'trace-structured-invoke');
  assert.equal(result.promptTraceId, 'prompt-trace-structured-invoke');
  const invokeInput = capturedGenerateInput as CapturedRuntimeTextStreamInput | null;
  if (!invokeInput) {
    throw new Error('structured invoke input was not captured');
  }
  assert.deepEqual(invokeInput.input, [
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
  assert.equal(invokeInput.system, 'Be warm and concise.');
  assert.equal(invokeInput.maxTokens, 321);
  assert.deepEqual(
    invokeInput.reasoning,
    resolveChatThinkingConfig('off', resolveAgentChatThinkingSupport()),
  );
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
    maxOutputTokensRequested: 222,
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
    resolveRouteInputImpl: async () => ({
      modId: CORE_CHAT_AGENT_MOD_ID,
      provider: 'openai',
      connectorId: 'connector-openai',
      localProviderModel: 'gpt-5.4-mini',
    }),
    ensureRuntimeLocalModelWarmImpl: async () => undefined,
    buildRuntimeCallOptionsImpl: async () => ({
      idempotencyKey: 'runtime-idem-cloud',
      timeoutMs: 120000,
      metadata: {
        traceId: 'prompt-trace-cloud',
        callerKind: 'desktop-core',
        callerId: CORE_CHAT_AGENT_MOD_ID,
        surfaceId: 'desktop.renderer',
        keySource: 'managed',
      },
    }),
    getRuntimeClientImpl: () => ({
      ai: {
        text: {
          generate: async (input: CapturedRuntimeTextStreamInput) => {
            assert.equal(input.model, 'cloud/gpt-5.4-mini');
            assert.equal(input.route, 'cloud');
            assert.equal(input.connectorId, 'connector-openai');
            assert.equal(input.maxTokens, 222);
            return {
              text: 'hi cloud',
              finishReason: 'stop',
              usage: {},
              trace: {
                traceId: 'trace-cloud',
              },
            };
          },
        },
      },
    }) as never,
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
    maxOutputTokensRequested: 321,
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
  assert.equal(streamInput.maxTokens, 321);
  assert.deepEqual(
    streamInput.reasoning,
    resolveChatThinkingConfig('off', resolveAgentChatThinkingSupport()),
  );
});

test('agent route view finds cloud model profiles by connector and model', () => {
  const profile = findRuntimeRouteModelProfile({
    selected: null,
    local: {
      defaultEndpoint: 'http://127.0.0.1:11434/v1',
      models: [],
    },
    connectors: [{
      id: 'connector-openai',
      provider: 'openai',
      label: 'OpenAI',
      models: ['gpt-5.4-mini'],
      modelProfiles: [{
        model: 'gpt-5.4-mini',
        maxContextTokens: 128000,
        maxOutputTokens: 4096,
      }],
    }],
  }, {
    source: 'cloud',
    connectorId: 'connector-openai',
    model: 'gpt-5.4-mini',
    modelId: 'gpt-5.4-mini',
  });

  assert.deepEqual(profile, {
    model: 'gpt-5.4-mini',
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
  });
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
    let capturedWarmInput: Record<string, unknown> | null = null;
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
      ensureRuntimeLocalModelWarmImpl: async (input) => {
        capturedWarmInput = input as unknown as Record<string, unknown>;
      },
      buildRuntimeCallOptionsImpl: async () => ({
        idempotencyKey: 'runtime-idem-local',
        timeoutMs: 120000,
        metadata: {
          traceId: 'prompt-trace-local',
          callerKind: 'desktop-core',
          callerId: CORE_CHAT_AGENT_MOD_ID,
          surfaceId: 'desktop.renderer',
        },
      }),
      getRuntimeClientImpl: () => ({
        ai: {
          text: {
            generate: async () => ({
              text: 'hi local',
              finishReason: 'stop',
              usage: {},
              trace: {
                traceId: 'trace-local',
              },
            }),
          },
        },
      }) as never,
    });
    assert.equal(capturedWarmInput?.['endpoint'], 'http://127.0.0.1:11434/v1');
    assert.equal(capturedWarmInput?.['modelId'], 'llama/qwen3');
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

test('agent image runtime captures staged diagnostics from scenario job metadata on raw ai path', async () => {
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
      model: 'local-import/z_image_turbo-Q4_K',
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

  const result = await generateChatAgentImageRuntime({
    prompt: 'draw the inn at sunset',
    imageExecutionSnapshot,
    imageCapabilityParams: {
      steps: 25,
      cfgScale: 6,
      sampler: 'euler',
      scheduler: 'karras',
    },
  }, {
    getRuntimeClientImpl: () => ({
      appId: CORE_CHAT_AGENT_MOD_ID,
      ai: {
        submitScenarioJob: async () => ({
          job: {
            jobId: 'job-image-1',
            traceId: 'trace-image-job',
          },
        }),
        getScenarioJob: async () => ({
          job: {
            status: ScenarioJobStatus.COMPLETED,
            traceId: 'trace-image-job',
          },
        }),
        getScenarioArtifacts: async () => ({
          traceId: 'trace-image-artifacts',
          artifacts: [{
            artifactId: 'artifact-ai-path',
            mimeType: 'image/png',
            uri: 'https://cdn.nimi.test/generated-ai-path.png',
            metadata: toProtoStruct({
              image_load_ms: 1100,
              image_generate_ms: 5200,
              queue_wait_ms: 180,
              load_cache_hit: false,
              resident_reused: false,
              resident_restarted: true,
              queue_serialized: true,
              profile_override_step: 25,
              profile_override_cfg_scale: 6,
              profile_override_sampler: 'euler',
              profile_override_scheduler: 'karras',
            }),
          }],
        }),
      },
    }) as never,
  });

  assert.equal(result.mediaUrl, 'https://cdn.nimi.test/generated-ai-path.png');
  assert.equal(result.traceId, 'trace-image-artifacts');
  assert.equal(result.diagnostics?.imageLoadMs, 1100);
  assert.equal(result.diagnostics?.imageGenerateMs, 5200);
  assert.equal(result.diagnostics?.queueSerialized, true);
  assert.equal(result.diagnostics?.residentRestarted, true);
  assert.equal(result.diagnostics?.profileOverrideSampler, 'euler');
  assert.ok((result.diagnostics?.imageJobSubmitMs || 0) >= 0);
  assert.ok((result.diagnostics?.artifactHydrateMs || 0) >= 0);
});

test('agent image runtime merges typed output artifact with hydrated raw ai artifact payload', async () => {
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
      model: 'local-import/z_image_turbo-Q4_K',
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

  const result = await generateChatAgentImageRuntime({
    prompt: 'draw the inn at sunset',
    imageExecutionSnapshot,
  }, {
    getRuntimeClientImpl: () => ({
      appId: CORE_CHAT_AGENT_MOD_ID,
      ai: {
        submitScenarioJob: async () => ({
          job: {
            jobId: 'job-image-merge-1',
            traceId: 'trace-image-job-merge',
          },
        }),
        getScenarioJob: async () => ({
          job: {
            status: ScenarioJobStatus.COMPLETED,
            traceId: 'trace-image-job-merge',
          },
        }),
        getScenarioArtifacts: async () => ({
          traceId: 'trace-image-artifacts-merge',
          output: {
            output: {
              oneofKind: 'imageGenerate',
              imageGenerate: {
                artifacts: [{
                  artifactId: 'artifact-merge-1',
                  mimeType: 'image/png',
                }],
              },
            },
          },
          artifacts: [{
            artifactId: 'artifact-merge-1',
            mimeType: 'image/png',
            uri: 'https://cdn.nimi.test/generated-merged.png',
          }],
        }),
      },
    }) as never,
  });

  assert.equal(result.mediaUrl, 'https://cdn.nimi.test/generated-merged.png');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.artifactId, 'artifact-merge-1');
  assert.equal(result.traceId, 'trace-image-artifacts-merge');
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
  const adapterStateSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-adapter-state.ts');
  const hostActionHelpersSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-host-actions-helpers.ts');
  const hostActionSubmitSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit.ts');
  const hostActionSubmitRunSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-host-actions-submit-run.ts');
  const voiceAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-adapter-voice.ts');
  const presentationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-presentation.tsx');
  const effectsSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-shell-effects.ts');
  const humanAdapterSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-human-adapter.tsx');
  const orchestrationSource = readWorkspaceFile('src/shell/renderer/features/chat/chat-agent-orchestration.ts');
  assert.match(adapterSource, /createAgentLocalChatConversationProvider/);
  assert.match(adapterSource, /useAgentConversationEffects/);
  assert.match(adapterSource, /useAgentConversationPresentation/);
  assert.match(adapterStateSource, /dataSync\.loadSocialSnapshot\(\)/);
  assert.match(adapterStateSource, /getDesktopAIConfigService\(\)/);
  assert.match(hostActionHelpersSource, /chatAgentStoreClient\.createThread/);
  assert.match(hostActionSubmitSource, /chatAgentStoreClient\.commitTurnResult/);
  assert.match(hostActionSubmitRunSource, /matchConversationTurnEvent/);
  assert.match(hostActionSubmitSource, /createInitialAgentSubmitDriverState/);
  assert.match(hostActionSubmitRunSource, /reduceAgentSubmitDriverEvent/);
  assert.match(hostActionSubmitRunSource, /resolveCompletedAgentSubmitDriverCheckpoint/);
  assert.match(hostActionSubmitSource, /resolveInterruptedAgentSubmitDriverCheckpoint/);
  assert.match(hostActionSubmitRunSource, /resolveAgentSubmitDriverProjectionRefresh/);
  assert.match(hostActionSubmitSource, /resolveAuthoritativeAgentThreadBundle/);
  assert.match(hostActionSubmitRunSource, /assertAgentTurnLifecycleCompleted/);
  assert.match(hostActionSubmitSource, /const activeTarget = input\.hostInput\.activeTarget;/);
  assert.match(hostActionSubmitSource, /if \(!effectiveThreadId \|\| !effectiveThreadRecord\) \{\s+effectiveThreadRecord = await createOrRestoreThreadForTarget\(input\.hostInput, activeTarget\);/);
  assert.match(hostActionSubmitSource, /setSubmittingThreadId\(effectiveThreadId\)/);
  assert.match(hostActionSubmitSource, /setFooterHostState\(effectiveThreadId,\s*null\)/);
  assert.match(hostActionSubmitSource, /releaseSubmittingIfCurrent/);
  assert.ok(
    hostActionSubmitSource.indexOf('input.hostInput.setSubmittingThreadId(effectiveThreadId);')
    < hostActionSubmitSource.indexOf('const refreshedAgentResolution = await ensureAgentConversationSubmitRouteReady({'),
    'agent host actions must enter submitting state before route readiness checks so thinking appears immediately',
  );
  assert.match(hostActionSubmitRunSource, /submitSession\.lifecycle\.projectionVersion\s*\?\s*await chatAgentStoreClient\.getThreadBundle\(input\.threadId\)/);
  assert.match(hostActionSubmitRunSource, /if \(projectionEffects\.awaitRefresh\) \{\s+const rebuiltBundle =/s);
  assert.match(adapterSource, /logRendererEvent/);
  assert.match(adapterSource, /conversationCapabilityProjectionByCapability\['audio\.transcribe'\]/);
  assert.match(adapterSource, /voiceSessionState/);
  assert.match(voiceAdapterSource, /handleVoiceSessionToggle/);
  assert.match(voiceAdapterSource, /resolveIsVoiceSessionForeground/);
  assert.match(voiceAdapterSource, /document\.addEventListener\('visibilitychange', syncForegroundState\)/);
  assert.match(voiceAdapterSource, /autoStopMode:\s*'silence'/);
  assert.match(adapterSource, /return createReadyConversationSetupState\('agent'\);/);
  assert.match(adapterSource, /const composerReady = setupState\.status === 'ready'\s+&& !isBundleLoading\s+&& !bundleError/);
  assert.match(hostActionSubmitSource, /ensureAgentConversationSubmitRouteReady/);
  assert.match(orchestrationSource, /case 'text-delta':/);
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
