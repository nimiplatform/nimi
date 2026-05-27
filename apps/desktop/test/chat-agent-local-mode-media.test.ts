import {
  assert,
  test,
  ScenarioJobStatus,
  toProtoStruct,
  CORE_CHAT_AGENT_TARGET_ID,
  generateChatAgentImageRuntime,
  synthesizeChatAgentVoiceRuntime,
  buildAgentEffectiveCapabilityResolution,
  createAISnapshot,
  createEmptyAIConfig,
} from './chat-agent-local-mode-test-utils.js';


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
      resolvedBindingRef: 'local:image:flux',
      source: 'local' as const,
      provider: 'local-image',
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
      appId: CORE_CHAT_AGENT_TARGET_ID,
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
      appId: CORE_CHAT_AGENT_TARGET_ID,
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
    timingMode?: unknown;
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
                speechAlignment: {
                  unit: 2,
                  tokens: [
                    {
                      token: '晚',
                      startMs: '0',
                      endMs: '120',
                    },
                    {
                      token: '安',
                      startMs: '120',
                      endMs: '260',
                    },
                  ],
                },
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
  assert.equal(capturedRequests[0]?.timingMode, 'char');
  assert.equal(result.mediaUrl, 'file:///tmp/voice-turn-1.mp3');
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(result.artifactId, 'voice-artifact-1');
  assert.deepEqual(result.playbackCueEnvelope, {
    version: 'v1',
    source: 'runtime',
    cues: [
      {
        offsetMs: 0,
        durationMs: 120,
        amplitude: 0.44,
        visemeId: 'ih',
      },
      {
        offsetMs: 120,
        durationMs: 140,
        amplitude: 0.44,
        visemeId: 'oh',
      },
    ],
  });
});

test('agent voice runtime fails closed when audio.synthesize artifact omits mimeType', async () => {
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
    textProjection: null,
    voiceProjection,
  });
  const voiceExecutionSnapshot = createAISnapshot({
    config: createEmptyAIConfig(),
    capability: 'audio.synthesize',
    projection: voiceProjection,
    agentResolution,
  });

  await assert.rejects(() => synthesizeChatAgentVoiceRuntime({
    prompt: '晚安，记得早点休息。',
    voiceExecutionSnapshot,
  }, {
    buildRuntimeRequestMetadataImpl: async () => ({ traceId: 'trace-voice-request' }),
    getRuntimeClientImpl: () => ({
      media: {
        tts: {
          synthesize: async () => ({
            artifacts: [{
              artifactId: 'voice-artifact-missing-mime',
              uri: 'file:///tmp/voice-turn-1.mp3',
            }],
          }),
        },
      },
    }) as never,
  }), /missing a legal audio mime type/);
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
