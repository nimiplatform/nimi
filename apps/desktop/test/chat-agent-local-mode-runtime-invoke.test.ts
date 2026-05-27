import {
  assert,
  test,
  CORE_CHAT_AGENT_TARGET_ID,
  invokeChatAgentRuntime,
  streamChatAgentRuntime,
  findRuntimeRouteModelProfile,
  resolveAgentChatRequestedMaxOutputTokens,
  resolveAgentTurnTotalTimeoutMs,
  resolveAgentChatThinkingSupport,
  resolveChatThinkingConfig,
  buildAgentEffectiveCapabilityResolution,
  createAISnapshot,
  createEmptyAIConfig,
  createLocalTextProjection,
} from './chat-agent-local-mode-test-utils.js';
import type {
  CapturedRuntimeTextStreamInput,
} from './chat-agent-local-mode-test-utils.js';

function localResolvedRouteInput() {
  return {
    targetId: CORE_CHAT_AGENT_TARGET_ID,
    resolvedBinding: {
      capability: 'text.generate' as const,
      source: 'local' as const,
      connectorId: '',
      provider: 'llama',
      engine: 'llama',
      model: 'llama3',
      modelId: 'llama3',
      localModelId: 'local-model-1',
      goRuntimeLocalModelId: 'local-model-1',
      endpoint: 'http://127.0.0.1:11434/v1',
      localProviderEndpoint: 'http://127.0.0.1:11434/v1',
    },
  };
}

function cloudResolvedRouteInput() {
  return {
    targetId: CORE_CHAT_AGENT_TARGET_ID,
    resolvedBinding: {
      capability: 'text.generate' as const,
      source: 'cloud' as const,
      connectorId: 'connector-openai',
      provider: 'openai',
      model: 'gpt-5.4-mini',
      modelId: 'gpt-5.4-mini',
    },
  };
}

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
      localModelId: 'local-model-1',
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
      mode: 'STORY',
      turnIndex: 1,
      userConfirmedUpload: false,
    },
  }, {
    resolveRouteInputImpl: async () => localResolvedRouteInput(),
    ensureRuntimeLocalModelWarmImpl: async () => undefined,
    buildRuntimeCallOptionsImpl: async () => ({
      idempotencyKey: 'runtime-idem-1',
      timeoutMs: 120000,
      metadata: {
        traceId: 'prompt-trace-1',
        callerKind: 'desktop-core',
        callerId: CORE_CHAT_AGENT_TARGET_ID,
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
      callerId: CORE_CHAT_AGENT_TARGET_ID,
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
    resolveRouteInputImpl: async () => localResolvedRouteInput(),
    ensureRuntimeLocalModelWarmImpl: async () => undefined,
    buildRuntimeCallOptionsImpl: async () => ({
      idempotencyKey: 'runtime-idem-structured',
      timeoutMs: 120000,
      metadata: {
        traceId: 'prompt-trace-structured-invoke',
        callerKind: 'desktop-core',
        callerId: CORE_CHAT_AGENT_TARGET_ID,
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

test('agent AISnapshot configEvidence freezes materialized AIConfig details', () => {
  const projection = createLocalTextProjection();
  const configA = createEmptyAIConfig();
  configA.capabilities.selectedBindings['text.generate'] = {
    source: 'cloud',
    connectorId: 'connector-a',
    model: 'model-a',
  };
  configA.capabilities.selectedParams['text.generate'] = {
    temperature: 0.2,
  };
  const configB = createEmptyAIConfig();
  configB.capabilities.selectedBindings['text.generate'] = {
    source: 'cloud',
    connectorId: 'connector-a',
    model: 'model-b',
  };
  configB.capabilities.selectedParams['text.generate'] = {
    temperature: 0.8,
  };

  const snapshotA = createAISnapshot({
    config: configA,
    capability: 'text.generate',
    projection,
  });
  const snapshotB = createAISnapshot({
    config: configB,
    capability: 'text.generate',
    projection,
  });

  assert.deepEqual(snapshotA.configEvidence.capabilityBindingKeys, ['text.generate']);
  assert.equal(snapshotA.configEvidence.configSnapshot.capabilities.selectedBindings['text.generate']?.model, 'model-a');
  assert.equal(snapshotB.configEvidence.configSnapshot.capabilities.selectedBindings['text.generate']?.model, 'model-b');
  assert.notEqual(snapshotA.configEvidence.configHash, snapshotB.configEvidence.configHash);
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
      mode: 'STORY',
      turnIndex: 1,
      userConfirmedUpload: false,
    },
  }, {
    resolveRouteInputImpl: async () => cloudResolvedRouteInput(),
    ensureRuntimeLocalModelWarmImpl: async () => undefined,
    buildRuntimeCallOptionsImpl: async () => ({
      idempotencyKey: 'runtime-idem-cloud',
      timeoutMs: 120000,
      metadata: {
        traceId: 'prompt-trace-cloud',
        callerKind: 'desktop-core',
        callerId: CORE_CHAT_AGENT_TARGET_ID,
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
    resolveRouteInputImpl: async () => localResolvedRouteInput(),
    ensureRuntimeLocalModelWarmImpl: async () => undefined,
    buildRuntimeStreamOptionsImpl: async () => ({
      idempotencyKey: 'runtime-idem-1',
      timeoutMs: 120000,
      signal: undefined,
      metadata: {
        traceId: 'prompt-trace-structured',
        callerKind: 'desktop-core',
        callerId: CORE_CHAT_AGENT_TARGET_ID,
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

test('agent route view ignores undersized max output token ceilings for structured chat requests', () => {
  assert.equal(resolveAgentChatRequestedMaxOutputTokens(null), null);
  assert.equal(resolveAgentChatRequestedMaxOutputTokens({
    model: 'gpt-5.4-mini',
    maxOutputTokens: 256,
  }), null);
  assert.equal(resolveAgentChatRequestedMaxOutputTokens({
    model: 'gpt-5.4-mini',
    maxOutputTokens: 512,
  }), 512);
  assert.equal(resolveAgentChatRequestedMaxOutputTokens({
    model: 'gpt-5.4-mini',
    maxOutputTokens: 4096,
  }), 4096);
});

test('agent local runtime invoke uses resolved binding evidence when runtimeFields endpoints are absent', async () => {
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
      localModelId: 'local-model-1',
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
    let capturedGenerateInput: CapturedRuntimeTextStreamInput | null = null;
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
          callerId: CORE_CHAT_AGENT_TARGET_ID,
          surfaceId: 'desktop.renderer',
        },
      }),
      getRuntimeClientImpl: () => ({
        ai: {
          text: {
            generate: async (input: CapturedRuntimeTextStreamInput) => {
              capturedGenerateInput = input;
              return {
                text: 'hi local',
                finishReason: 'stop',
                usage: {},
                trace: {
                  traceId: 'trace-local',
                },
              };
            },
          },
        },
      }) as never,
    });
    const warmBinding = capturedWarmInput?.['resolvedBinding'] as Record<string, unknown> | undefined;
    const generateInput = capturedGenerateInput as CapturedRuntimeTextStreamInput | null;
    assert.equal(warmBinding?.['endpoint'], 'http://127.0.0.1:11434/v1');
    assert.equal(generateInput?.model, 'llama/qwen3');
  });
});
