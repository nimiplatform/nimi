import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExecutionMode,
  RoutePolicy,
  ScenarioJobStatus,
  ScenarioType,
} from '@nimiplatform/sdk/runtime';
import { createAIConfigEvidence, createEmptyAIConfig } from '@nimiplatform/sdk/mod';
import type {
  AgentLocalMessageRecord,
  AgentLocalUpdateMessageInput,
  AgentLocalUpdateTurnBeatInput,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import type { AISnapshot } from '../src/shell/renderer/features/chat/conversation-capability.js';
import { reconcileAgentChatVoiceWorkflowMessage } from '../src/shell/renderer/features/chat/chat-agent-voice-workflow-tracker.js';
import type { ChatAgentVoiceWorkflowRuntimeDeps } from '../src/shell/renderer/features/chat/chat-agent-runtime.js';
import {
  parseAgentChatVoiceWorkflowMetadata,
  toAgentChatVoiceWorkflowMetadataJson,
  type AgentChatVoiceWorkflowMessageMetadata,
} from '../src/shell/renderer/features/chat/chat-agent-voice-workflow.js';
import {
  createAgentTextMessage,
} from './helpers/agent-chat-record-fixtures.js';

function createWorkflowMetadata(
  overrides: Partial<AgentChatVoiceWorkflowMessageMetadata> = {},
): AgentChatVoiceWorkflowMessageMetadata {
  return {
    kind: 'voice-workflow',
    version: 'v1',
    sourceTurnId: 'turn-source',
    sourceMessageId: 'beat-source',
    sourceActionId: 'action-source',
    conversationAnchorId: 'anchor-1',
    beatId: 'beat-workflow',
    workflowCapability: 'voice_workflow.tts_t2v',
    workflowType: 'tts_t2v',
    workflowStatus: 'submitted',
    jobId: 'job-voice-1',
    playbackPrompt: 'Speak with a calm, polished tone.',
    transcriptText: 'Speak with a calm, polished tone.',
    traceId: 'trace-submit',
    message: 'Designing a custom voice for this thread…',
    voiceReference: {
      kind: 'voice_asset_id',
      stableRef: 'voice-asset-1',
    },
    voiceAssetId: 'voice-asset-1',
    providerVoiceRef: 'provider-voice-1',
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    ...overrides,
  };
}

function createWorkflowMessage(
  metadataOverrides: Partial<AgentChatVoiceWorkflowMessageMetadata> = {},
): AgentLocalMessageRecord {
  const metadata = createWorkflowMetadata(metadataOverrides);
  return createAgentTextMessage({
    id: 'message-workflow-1',
    threadId: 'thread-1',
    role: 'assistant',
    status: 'pending',
    contentText: metadata.message || 'Designing a custom voice for this thread…',
    metadataJson: toAgentChatVoiceWorkflowMetadataJson(metadata),
    createdAtMs: 10,
    updatedAtMs: 10,
  });
}

type TestRuntimeClient = Awaited<ReturnType<NonNullable<ChatAgentVoiceWorkflowRuntimeDeps['getRuntimeClientImpl']>>>;
type TestRuntimeCallOptions = Awaited<ReturnType<NonNullable<ChatAgentVoiceWorkflowRuntimeDeps['buildRuntimeCallOptionsImpl']>>>;
type TestGetScenarioJobResponse = Awaited<ReturnType<NonNullable<NonNullable<TestRuntimeClient['ai']>['getScenarioJob']>>>;
type TestExecuteScenarioResponse = Awaited<ReturnType<NonNullable<NonNullable<TestRuntimeClient['ai']>['executeScenario']>>>;

function createVoiceExecutionSnapshot(): AISnapshot {
  return {
    executionId: 'execution-voice-1',
    scopeRef: {
      kind: 'thread',
      scopeId: 'thread-1',
    },
    configEvidence: createAIConfigEvidence(createEmptyAIConfig()),
    conversationCapabilitySlice: {
      executionId: 'slice-voice-1',
      createdAt: '2026-04-10T12:00:00.000Z',
      capability: 'audio.synthesize',
      selectedBinding: null,
      resolvedBinding: {
        capability: 'audio.synthesize',
        source: 'cloud',
        provider: 'dashscope',
        model: 'qwen3-tts',
        modelId: 'qwen3-tts',
        connectorId: 'connector-voice',
      },
      health: null,
      metadata: null,
      agentResolution: null,
    },
    runtimeEvidence: null,
    createdAt: '2026-04-10T12:00:00.000Z',
  } as unknown as AISnapshot;
}

function createStoreHarness(message: AgentLocalMessageRecord) {
  const updateMessageCalls: AgentLocalUpdateMessageInput[] = [];
  const updateTurnBeatCalls: AgentLocalUpdateTurnBeatInput[] = [];
  let currentMessage = message;

  return {
    updateMessageCalls,
    updateTurnBeatCalls,
    storeClient: {
      async updateMessage(input: AgentLocalUpdateMessageInput) {
        updateMessageCalls.push(input);
        currentMessage = {
          ...currentMessage,
          ...input,
        };
        return currentMessage;
      },
      async updateTurnBeat(input: AgentLocalUpdateTurnBeatInput) {
        updateTurnBeatCalls.push(input);
      },
    },
  };
}

function createRuntimeClient(client: object): TestRuntimeClient {
  return client as unknown as TestRuntimeClient;
}

function createRuntimeCallOptions(
  overrides: Partial<TestRuntimeCallOptions> = {},
): TestRuntimeCallOptions {
  return {
    idempotencyKey: 'idem-test',
    timeoutMs: 120_000,
    metadata: {
      traceId: 'trace-runtime-call',
      callerKind: 'desktop-core',
      callerId: 'desktop-test',
      surfaceId: 'desktop-test',
    },
    ...overrides,
  } as TestRuntimeCallOptions;
}

function createRuntimeDeps(input: {
  client: object;
  callOptions?: Partial<TestRuntimeCallOptions>;
}): ChatAgentVoiceWorkflowRuntimeDeps {
  return {
    getRuntimeClientImpl: () => createRuntimeClient(input.client),
    ...(input.callOptions
      ? {
        buildRuntimeCallOptionsImpl: async () => createRuntimeCallOptions(input.callOptions),
      }
      : {}),
  };
}

function createScenarioJobResponse(input: {
  status: ScenarioJobStatus;
  traceId: string;
  reasonDetail?: string;
  reasonCode?: number | string;
}): TestGetScenarioJobResponse {
  return {
    job: {
      jobId: 'job-voice-1',
      scenarioType: ScenarioType.VOICE_DESIGN,
      executionMode: ExecutionMode.ASYNC_JOB,
      routeDecision: RoutePolicy.CLOUD,
      modelResolved: 'qwen3-tts-vd',
      status: input.status,
      providerJobId: '',
      reasonCode: input.reasonCode ?? 0,
      reasonDetail: input.reasonDetail || '',
      retryCount: 0,
      artifacts: [],
      traceId: input.traceId,
      ignoredExtensions: [],
    },
  } as unknown as TestGetScenarioJobResponse;
}

function createExecuteScenarioResponse(input: {
  artifactOverrides?: Record<string, unknown>;
} = {}): TestExecuteScenarioResponse {
  return {
    finishReason: 1,
    routeDecision: RoutePolicy.CLOUD,
    modelResolved: 'qwen3-tts-vd',
    traceId: 'trace-playback-ready',
    ignoredExtensions: [],
    artifacts: [{
      artifactId: 'artifact-voice-ready',
      mimeType: 'audio/mpeg',
      bytes: new Uint8Array(),
      uri: 'file:///tmp/voice-ready.mp3',
      sha256: '',
      sizeBytes: '0',
      durationMs: '0',
      fps: 0,
      width: 0,
      height: 0,
      sampleRateHz: 0,
      channels: 0,
      ...input.artifactOverrides,
    }],
    trace: {
      traceId: 'trace-playback-ready',
    },
  } as unknown as TestExecuteScenarioResponse;
}

test('voice workflow tracker keeps pending messages current when the job is still running', async () => {
  const message = createWorkflowMessage();
  const harness = createStoreHarness(message);

  const result = await reconcileAgentChatVoiceWorkflowMessage({
    message,
    voiceExecutionSnapshot: null,
    storeClient: harness.storeClient,
    runtimeDeps: createRuntimeDeps({
      client: {
        ai: {
          async getScenarioJob() {
            return createScenarioJobResponse({
              status: ScenarioJobStatus.RUNNING,
              traceId: 'trace-running',
              reasonDetail: 'Voice workflow is still preparing assets.',
            });
          },
        },
      },
    }),
    now: () => 123,
  });

  assert.equal(result.stillPending, true);
  assert.equal(harness.updateMessageCalls.length, 1);
  assert.equal(harness.updateTurnBeatCalls.length, 0);
  assert.equal(result.updatedMessage?.status, 'pending');
  const metadata = parseAgentChatVoiceWorkflowMetadata(result.updatedMessage?.metadataJson);
  assert.equal(metadata?.workflowStatus, 'running');
  assert.match(result.updatedMessage?.contentText || '', /still preparing assets/i);
});

test('voice workflow metadata requires source conversation anchor evidence', () => {
  const metadata = createWorkflowMetadata();
  const json = toAgentChatVoiceWorkflowMetadataJson(metadata);
  delete (json as Record<string, unknown>).conversationAnchorId;

  assert.equal(parseAgentChatVoiceWorkflowMetadata(json), null);
});

test('voice workflow tracker does not reconcile messages for a different active anchor', async () => {
  const message = createWorkflowMessage({
    workflowStatus: 'running',
    conversationAnchorId: 'anchor-source',
  });
  const harness = createStoreHarness(message);
  let polled = false;

  const result = await reconcileAgentChatVoiceWorkflowMessage({
    message,
    activeConversationAnchorId: 'anchor-other',
    voiceExecutionSnapshot: createVoiceExecutionSnapshot(),
    storeClient: harness.storeClient,
    runtimeDeps: createRuntimeDeps({
      client: {
        ai: {
          async getScenarioJob() {
            polled = true;
            return createScenarioJobResponse({
              status: ScenarioJobStatus.COMPLETED,
              traceId: 'trace-workflow-complete',
            });
          },
        },
      },
    }),
    now: () => 321,
  });

  assert.equal(result.updatedMessage, null);
  assert.equal(result.stillPending, true);
  assert.equal(polled, false);
  assert.equal(harness.updateMessageCalls.length, 0);
  assert.equal(harness.updateTurnBeatCalls.length, 0);
});

test('voice workflow tracker projects playback back into the current thread when the job completes', async () => {
  const message = createWorkflowMessage({
    workflowStatus: 'running',
  });
  const harness = createStoreHarness(message);

  const result = await reconcileAgentChatVoiceWorkflowMessage({
    message,
    voiceExecutionSnapshot: createVoiceExecutionSnapshot(),
    storeClient: harness.storeClient,
    runtimeDeps: createRuntimeDeps({
      callOptions: {
        idempotencyKey: 'idem-voice-playback',
        metadata: {
          traceId: 'trace-playback-call',
          callerKind: 'desktop-core',
          callerId: 'desktop-test',
          surfaceId: 'desktop-test',
        },
      },
      client: {
        appId: 'desktop-test',
        ai: {
          async getScenarioJob() {
            return createScenarioJobResponse({
              status: ScenarioJobStatus.COMPLETED,
              traceId: 'trace-workflow-complete',
            });
          },
          async executeScenario() {
            return createExecuteScenarioResponse();
          },
        },
      },
    }),
    now: () => 456,
  });

  assert.equal(result.stillPending, false);
  assert.equal(harness.updateMessageCalls.length, 1);
  assert.equal(harness.updateTurnBeatCalls.length, 1);
  assert.equal(result.updatedMessage?.kind, 'voice');
  assert.equal(result.updatedMessage?.status, 'complete');
  assert.equal(result.updatedMessage?.mediaUrl, 'file:///tmp/voice-ready.mp3');
  const metadata = parseAgentChatVoiceWorkflowMetadata(result.updatedMessage?.metadataJson);
  assert.equal(metadata?.workflowStatus, 'complete');
  assert.equal(metadata?.conversationAnchorId, 'anchor-1');
  assert.equal(metadata?.artifactId, 'artifact-voice-ready');
  assert.equal(harness.updateTurnBeatCalls[0]?.status, 'delivered');
  assert.equal(harness.updateTurnBeatCalls[0]?.artifactId, 'artifact-voice-ready');
});

test('voice workflow tracker keeps playback cue envelope parity with plain synth playback', async () => {
  const message = createWorkflowMessage({
    workflowStatus: 'running',
  });
  const harness = createStoreHarness(message);

  const result = await reconcileAgentChatVoiceWorkflowMessage({
    message,
    voiceExecutionSnapshot: createVoiceExecutionSnapshot(),
    storeClient: harness.storeClient,
    runtimeDeps: createRuntimeDeps({
      client: {
        appId: 'desktop-test',
        ai: {
          async getScenarioJob() {
            return createScenarioJobResponse({
              status: ScenarioJobStatus.COMPLETED,
              traceId: 'trace-workflow-complete',
            });
          },
          async executeScenario() {
            return createExecuteScenarioResponse({
              artifactOverrides: {
                metadata: {
                  fields: {
                    timing: {
                      kind: {
                        oneofKind: 'structValue',
                        structValue: {
                          fields: {
                            mouthCues: {
                              kind: {
                                oneofKind: 'listValue',
                                listValue: {
                                  values: [
                                    {
                                      kind: {
                                        oneofKind: 'structValue',
                                        structValue: {
                                          fields: {
                                            start: { kind: { oneofKind: 'numberValue', numberValue: 0 } },
                                            end: { kind: { oneofKind: 'numberValue', numberValue: 110 } },
                                            viseme: { kind: { oneofKind: 'stringValue', stringValue: 'aa' } },
                                            amplitude: { kind: { oneofKind: 'numberValue', numberValue: 0.34 } },
                                          },
                                        },
                                      },
                                    },
                                    {
                                      kind: {
                                        oneofKind: 'structValue',
                                        structValue: {
                                          fields: {
                                            start: { kind: { oneofKind: 'numberValue', numberValue: 110 } },
                                            end: { kind: { oneofKind: 'numberValue', numberValue: 240 } },
                                            phoneme: { kind: { oneofKind: 'stringValue', stringValue: 'oh' } },
                                            weight: { kind: { oneofKind: 'numberValue', numberValue: 0.62 } },
                                          },
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            });
          },
        },
      },
    }),
    now: () => 500,
  });

  assert.equal(result.updatedMessage?.kind, 'voice');
  const metadata = parseAgentChatVoiceWorkflowMetadata(result.updatedMessage?.metadataJson);
  assert.deepEqual(metadata?.playbackCueEnvelope, {
    version: 'v1',
    source: 'provider',
    cues: [
      {
        offsetMs: 0,
        durationMs: 110,
        amplitude: 0.34,
        visemeId: 'aa',
      },
      {
        offsetMs: 110,
        durationMs: 130,
        amplitude: 0.62,
        visemeId: 'oh',
      },
    ],
  });
});

test('voice workflow tracker completes honestly as text when no current voice route is configured', async () => {
  const message = createWorkflowMessage({
    workflowStatus: 'running',
  });
  const harness = createStoreHarness(message);

  const result = await reconcileAgentChatVoiceWorkflowMessage({
    message,
    voiceExecutionSnapshot: null,
    storeClient: harness.storeClient,
    runtimeDeps: createRuntimeDeps({
      client: {
        ai: {
          async getScenarioJob() {
            return createScenarioJobResponse({
              status: ScenarioJobStatus.COMPLETED,
              traceId: 'trace-workflow-complete',
            });
          },
        },
      },
    }),
    now: () => 789,
  });

  assert.equal(result.stillPending, false);
  assert.equal(result.updatedMessage?.kind, 'text');
  assert.equal(result.updatedMessage?.status, 'complete');
  assert.match(result.updatedMessage?.contentText || '', /projected playback is unavailable because no voice route is configured/i);
  assert.equal(harness.updateTurnBeatCalls[0]?.status, 'delivered');
  assert.equal(harness.updateTurnBeatCalls[0]?.artifactId, null);
});

test('voice workflow tracker fails close when the completed job has no recoverable VoiceReference', async () => {
  const message = createWorkflowMessage({
    workflowStatus: 'running',
    voiceReference: null,
    voiceAssetId: null,
    providerVoiceRef: null,
  });
  const harness = createStoreHarness(message);

  const result = await reconcileAgentChatVoiceWorkflowMessage({
    message,
    voiceExecutionSnapshot: createVoiceExecutionSnapshot(),
    storeClient: harness.storeClient,
    runtimeDeps: createRuntimeDeps({
      client: {
        ai: {
          async getScenarioJob() {
            return createScenarioJobResponse({
              status: ScenarioJobStatus.COMPLETED,
              traceId: 'trace-workflow-complete',
            });
          },
        },
      },
    }),
    now: () => 900,
  });

  assert.equal(result.stillPending, false);
  assert.equal(result.updatedMessage?.status, 'error');
  assert.equal(result.updatedMessage?.error?.code, 'AGENT_VOICE_WORKFLOW_REFERENCE_REQUIRED');
  assert.equal(harness.updateTurnBeatCalls[0]?.status, 'failed');
});

test('voice workflow tracker marks the current-thread message failed when the job fails', async () => {
  const message = createWorkflowMessage({
    workflowStatus: 'running',
  });
  const harness = createStoreHarness(message);

  const result = await reconcileAgentChatVoiceWorkflowMessage({
    message,
    voiceExecutionSnapshot: createVoiceExecutionSnapshot(),
    storeClient: harness.storeClient,
    runtimeDeps: createRuntimeDeps({
      client: {
        ai: {
          async getScenarioJob() {
            return createScenarioJobResponse({
              status: ScenarioJobStatus.FAILED,
              traceId: 'trace-workflow-failed',
              reasonDetail: 'Provider rejected the requested voice profile.',
            });
          },
        },
      },
    }),
    now: () => 999,
  });

  assert.equal(result.stillPending, false);
  assert.equal(result.updatedMessage?.status, 'error');
  assert.equal(result.updatedMessage?.error?.code, 'AGENT_VOICE_WORKFLOW_FAILED');
  assert.match(result.updatedMessage?.error?.message || '', /Provider rejected/i);
  assert.equal(harness.updateTurnBeatCalls[0]?.status, 'failed');
});

test('voice workflow tracker maps local speech bundle reasons to user-facing failure copy', async () => {
  const message = createWorkflowMessage({
    workflowStatus: 'running',
  });
  const harness = createStoreHarness(message);

  const result = await reconcileAgentChatVoiceWorkflowMessage({
    message,
    voiceExecutionSnapshot: createVoiceExecutionSnapshot(),
    storeClient: harness.storeClient,
    runtimeDeps: createRuntimeDeps({
      client: {
        ai: {
          async getScenarioJob() {
            return createScenarioJobResponse({
              status: ScenarioJobStatus.FAILED,
              traceId: 'trace-workflow-failed',
              reasonCode: 561,
              reasonDetail: 'speech bundle download confirmation required',
            });
          },
        },
      },
    }),
    now: () => 1001,
  });

  assert.equal(result.stillPending, false);
  assert.equal(result.updatedMessage?.status, 'error');
  assert.equal(result.updatedMessage?.error?.code, 'AGENT_VOICE_WORKFLOW_FAILED');
  assert.equal(result.updatedMessage?.error?.message, 'Local Speech requires explicit download confirmation before continuing.');
  assert.equal(harness.updateTurnBeatCalls[0]?.status, 'failed');
});
