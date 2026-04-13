import {
  createNimiError,
  ExecutionMode,
  ScenarioJobStatus,
  ScenarioType,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  buildRuntimeCallOptions,
  buildRuntimeRequestMetadata,
  getRuntimeClient,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import type {
  AgentRuntimeResolvedBinding,
  ChatAgentTranscribeRuntimeInvokeDeps,
  ChatAgentTranscribeRuntimeInvokeInput,
  ChatAgentTranscribeRuntimeInvokeResult,
  ChatAgentVoiceReferenceSynthesisInput,
  ChatAgentVoiceRuntimeInvokeDeps,
  ChatAgentVoiceRuntimeInvokeInput,
  ChatAgentVoiceRuntimeInvokeResult,
  ChatAgentVoiceWorkflowPollResult,
  ChatAgentVoiceWorkflowRuntimeDeps,
  ChatAgentVoiceWorkflowSubmitInput,
  ChatAgentVoiceWorkflowSubmitResult,
} from './chat-agent-runtime-types';
import { CORE_CHAT_AGENT_MOD_ID } from './chat-agent-runtime-types';
import {
  normalizeText,
  requireValue,
  resolveExecutionSlice,
  toRuntimeRoutePolicy,
} from './chat-agent-runtime-shared';
import {
  resolveMediaUrlFromArtifact,
  resolveVoiceReferenceFromAsset,
  resolveWorkflowJobStatus,
  toRuntimeVoiceReference,
} from './chat-agent-runtime-voice-helpers';

export async function synthesizeChatAgentVoiceRuntime(
  input: ChatAgentVoiceRuntimeInvokeInput,
  deps: ChatAgentVoiceRuntimeInvokeDeps = {},
): Promise<ChatAgentVoiceRuntimeInvokeResult> {
  const prompt = normalizeText(input.prompt);
  if (!prompt) {
    throw createNimiError({
      message: 'agent voice prompt is required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'provide_voice_prompt',
      source: 'runtime',
    });
  }
  const slice = resolveExecutionSlice(input.voiceExecutionSnapshot, 'audio.synthesize');
  const resolved = slice.resolvedBinding as AgentRuntimeResolvedBinding;
  const metadata = await (deps.buildRuntimeRequestMetadataImpl || buildRuntimeRequestMetadata)({
    source: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    providerEndpoint: normalizeText(resolved.endpoint)
      || normalizeText(resolved.localProviderEndpoint)
      || normalizeText(resolved.localOpenAiEndpoint)
      || undefined,
  });
  const response = await (deps.getRuntimeClientImpl || getRuntimeClient)().media.tts.synthesize({
    model: requireValue(
      resolved.modelId || resolved.model || resolved.localModelId,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'agent voice route model is missing',
    ),
    text: prompt,
    route: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    audioFormat: 'mp3',
    metadata,
    signal: input.signal,
  });
  const artifact = Array.isArray(response.artifacts) ? response.artifacts[0] : null;
  const media = resolveMediaUrlFromArtifact({
    artifact,
    defaultMimeType: 'audio/mpeg',
    missingArtifactMessage: 'agent voice synthesis returned no artifacts',
    missingMediaMessage: 'agent voice synthesis artifact has no uri or bytes',
    actionHint: 'retry_voice_synthesis',
  });
  return {
    ...media,
    traceId: normalizeText(response.trace?.traceId) || normalizeText(metadata.traceId),
  };
}

export async function submitChatAgentVoiceWorkflowRuntime(
  input: ChatAgentVoiceWorkflowSubmitInput,
  deps: ChatAgentVoiceWorkflowRuntimeDeps = {},
): Promise<ChatAgentVoiceWorkflowSubmitResult> {
  const prompt = normalizeText(input.prompt);
  if (!prompt) {
    throw createNimiError({
      message: 'agent voice workflow prompt is required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'provide_voice_prompt',
      source: 'runtime',
    });
  }
  const slice = resolveExecutionSlice(
    input.voiceWorkflowExecutionSnapshot,
    input.workflowIntent.capability,
  );
  const resolved = slice.resolvedBinding as AgentRuntimeResolvedBinding;
  const runtimeClient = (deps.getRuntimeClientImpl || getRuntimeClient)();
  const callOptions = await (deps.buildRuntimeCallOptionsImpl || buildRuntimeCallOptions)({
    modId: CORE_CHAT_AGENT_MOD_ID,
    timeoutMs: 180_000,
    source: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    providerEndpoint: normalizeText(resolved.endpoint)
      || normalizeText(resolved.localProviderEndpoint)
      || normalizeText(resolved.localOpenAiEndpoint)
      || undefined,
  });
  const modelId = requireValue(
    resolved.modelId || resolved.model || resolved.localModelId,
    ReasonCode.AI_INPUT_INVALID,
    'select_runtime_route_binding',
    'agent voice workflow route model is missing',
  );
  const preferredName = `agent-chat-${input.turnId.slice(-6)}-${input.beatId.slice(-4)}`;
  const response = await runtimeClient.ai.submitScenarioJob({
    head: {
      appId: runtimeClient.appId,
      modelId,
      routePolicy: toRuntimeRoutePolicy(resolved.source),
      timeoutMs: 180_000,
      connectorId: normalizeText(resolved.connectorId),
    },
    scenarioType: input.workflowIntent.workflowType === 'tts_v2v'
      ? ScenarioType.VOICE_CLONE
      : ScenarioType.VOICE_DESIGN,
    executionMode: ExecutionMode.ASYNC_JOB,
    requestId: callOptions.idempotencyKey,
    idempotencyKey: callOptions.idempotencyKey,
    labels: {
      surface: 'agent-chat',
      thread_id: input.threadId,
      turn_id: input.turnId,
      beat_id: input.beatId,
    },
    extensions: [],
    spec: input.workflowIntent.workflowType === 'tts_v2v'
      ? {
        spec: {
          oneofKind: 'voiceClone' as const,
          voiceClone: {
            targetModelId: modelId,
            input: {
              referenceAudioBytes: input.referenceAudio?.bytes || (() => {
                throw createNimiError({
                  message: 'voice clone workflow requires current-thread reference audio',
                  reasonCode: ReasonCode.AI_INPUT_INVALID,
                  actionHint: 'record_voice_input',
                  source: 'runtime',
                });
              })(),
              referenceAudioMime: requireValue(
                input.referenceAudio?.mimeType,
                ReasonCode.AI_INPUT_INVALID,
                'record_voice_input',
                'voice clone workflow requires a reference audio mimeType',
              ),
              referenceAudioUri: '',
              text: prompt,
              preferredName,
              languageHints: [],
            },
          },
        },
      }
      : {
        spec: {
          oneofKind: 'voiceDesign' as const,
          voiceDesign: {
            targetModelId: modelId,
            input: {
              instructionText: prompt,
              previewText: prompt,
              language: '',
              preferredName,
            },
          },
        },
      },
  }, callOptions);
  const jobId = normalizeText(response.job?.jobId);
  if (!jobId) {
    throw createNimiError({
      message: 'voice workflow submit returned no jobId',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_voice_workflow',
      source: 'runtime',
    });
  }
  const workflowStatus = resolveWorkflowJobStatus(Number(response.job?.status || ScenarioJobStatus.SUBMITTED));
  if (workflowStatus === 'complete' || workflowStatus === 'failed' || workflowStatus === 'canceled') {
    throw createNimiError({
      message: 'voice workflow submit returned an unexpected terminal state',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_voice_workflow',
      source: 'runtime',
    });
  }
  const voiceReference = resolveVoiceReferenceFromAsset(response.asset || null);
  return {
    jobId,
    traceId: normalizeText(response.job?.traceId) || normalizeText(callOptions.metadata.traceId),
    workflowStatus,
    voiceReference: voiceReference.voiceReference,
    voiceAssetId: voiceReference.voiceAssetId,
    providerVoiceRef: voiceReference.providerVoiceRef,
  };
}

export async function pollChatAgentVoiceWorkflowRuntime(
  input: {
    jobId: string;
    signal?: AbortSignal;
  },
  deps: ChatAgentVoiceWorkflowRuntimeDeps = {},
): Promise<ChatAgentVoiceWorkflowPollResult> {
  const runtimeClient = (deps.getRuntimeClientImpl || getRuntimeClient)();
  const response = await runtimeClient.ai.getScenarioJob({
    jobId: requireValue(
      input.jobId,
      ReasonCode.AI_INPUT_INVALID,
      'retry_voice_workflow',
      'voice workflow jobId is required',
    ),
  });
  const workflowStatus = resolveWorkflowJobStatus(Number(response.job?.status || 0));
  return {
    workflowStatus,
    traceId: normalizeText(response.job?.traceId) || null,
    message: normalizeText(response.job?.reasonDetail) || normalizeText(response.job?.reasonCode) || null,
  };
}

export async function synthesizeChatAgentVoiceReferenceRuntime(
  input: ChatAgentVoiceReferenceSynthesisInput,
  deps: ChatAgentVoiceWorkflowRuntimeDeps = {},
): Promise<ChatAgentVoiceRuntimeInvokeResult> {
  const prompt = normalizeText(input.prompt);
  if (!prompt) {
    throw createNimiError({
      message: 'projected voice playback requires text',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'provide_voice_prompt',
      source: 'runtime',
    });
  }
  const slice = resolveExecutionSlice(input.voiceExecutionSnapshot, 'audio.synthesize');
  const resolved = slice.resolvedBinding as AgentRuntimeResolvedBinding;
  const runtimeClient = (deps.getRuntimeClientImpl || getRuntimeClient)();
  const callOptions = await (deps.buildRuntimeCallOptionsImpl || buildRuntimeCallOptions)({
    modId: CORE_CHAT_AGENT_MOD_ID,
    timeoutMs: 120_000,
    source: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    providerEndpoint: normalizeText(resolved.endpoint)
      || normalizeText(resolved.localProviderEndpoint)
      || normalizeText(resolved.localOpenAiEndpoint)
      || undefined,
  });
  const response = await runtimeClient.ai.executeScenario({
    head: {
      appId: runtimeClient.appId,
      modelId: requireValue(
        resolved.modelId || resolved.model || resolved.localModelId,
        ReasonCode.AI_INPUT_INVALID,
        'select_runtime_route_binding',
        'agent voice route model is missing',
      ),
      routePolicy: toRuntimeRoutePolicy(resolved.source),
      timeoutMs: 120_000,
      connectorId: normalizeText(resolved.connectorId),
    },
    scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
    executionMode: ExecutionMode.SYNC,
    extensions: [],
    spec: {
      spec: {
        oneofKind: 'speechSynthesize' as const,
        speechSynthesize: {
          text: prompt,
          audioFormat: 'mp3',
          language: '',
          sampleRateHz: 0,
          speed: 0,
          pitch: 0,
          volume: 0,
          emotion: '',
          timingMode: 0,
          voiceRef: toRuntimeVoiceReference(input.voiceReference),
        },
      },
    },
  }, callOptions);
  const responseArtifacts = (
    Array.isArray((response as { artifacts?: unknown[] }).artifacts)
      ? (response as { artifacts?: unknown[] }).artifacts
      : []
  ) as unknown[];
  const media = resolveMediaUrlFromArtifact({
    artifact: responseArtifacts[0] as {
      mimeType?: unknown;
      uri?: unknown;
      bytes?: Uint8Array | null;
      artifactId?: unknown;
    } | null,
    defaultMimeType: 'audio/mpeg',
    missingArtifactMessage: 'projected voice playback returned no artifacts',
    missingMediaMessage: 'projected voice playback artifact has no uri or bytes',
    actionHint: 'retry_voice_synthesis',
  });
  return {
    ...media,
    traceId: normalizeText((response as { trace?: { traceId?: string } }).trace?.traceId)
      || normalizeText(callOptions.metadata.traceId),
  };
}

export async function transcribeChatAgentVoiceRuntime(
  input: ChatAgentTranscribeRuntimeInvokeInput,
  deps: ChatAgentTranscribeRuntimeInvokeDeps = {},
): Promise<ChatAgentTranscribeRuntimeInvokeResult> {
  if (!(input.audioBytes instanceof Uint8Array) || input.audioBytes.length === 0) {
    throw createNimiError({
      message: 'agent voice transcription requires audio bytes',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'record_voice_input',
      source: 'runtime',
    });
  }
  const mimeType = normalizeText(input.mimeType);
  if (!mimeType) {
    throw createNimiError({
      message: 'agent voice transcription requires an audio mimeType',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'record_voice_input',
      source: 'runtime',
    });
  }
  const slice = resolveExecutionSlice(input.transcribeExecutionSnapshot, 'audio.transcribe');
  const resolved = slice.resolvedBinding as AgentRuntimeResolvedBinding;
  const metadata = await (deps.buildRuntimeRequestMetadataImpl || buildRuntimeRequestMetadata)({
    source: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    providerEndpoint: normalizeText(resolved.endpoint)
      || normalizeText(resolved.localProviderEndpoint)
      || normalizeText(resolved.localOpenAiEndpoint)
      || undefined,
  });
  const response = await (deps.getRuntimeClientImpl || getRuntimeClient)().media.stt.transcribe({
    model: requireValue(
      resolved.modelId || resolved.model || resolved.localModelId,
      ReasonCode.AI_INPUT_INVALID,
      'select_runtime_route_binding',
      'agent voice transcribe route model is missing',
    ),
    audio: {
      kind: 'bytes',
      bytes: input.audioBytes,
    },
    mimeType,
    language: normalizeText(input.language) || undefined,
    route: resolved.source,
    connectorId: normalizeText(resolved.connectorId) || undefined,
    metadata,
    signal: input.signal,
  });
  const text = normalizeText(response.text);
  if (!text) {
    throw createNimiError({
      message: 'agent voice transcription returned no transcript text',
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_voice_transcription',
      source: 'runtime',
    });
  }
  return {
    text,
    traceId: normalizeText(response.trace?.traceId) || normalizeText(metadata.traceId),
  };
}
