import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import type { AgentLocalTargetSnapshot } from '@renderer/bridge/runtime-bridge/types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type {
  AgentResolvedBehavior,
} from './chat-agent-behavior';
import type { AgentModelOutputDiagnostics } from './chat-agent-behavior-resolver';
import type {
  AgentChatVoiceWorkflowMessageMetadata,
  AgentChatVoiceWorkflowStatus,
} from './chat-agent-voice-workflow';
import type {
  AgentEffectiveCapabilityResolution,
  AgentVoiceWorkflowCapability,
  AISnapshot,
} from './conversation-capability';
import { getStreamState } from '../turns/stream-controller';
import type { ChatAgentVoiceWorkflowReferenceAudio } from './chat-agent-runtime';
import type {
  AgentLocalChatProviderMetadata,
} from './chat-agent-orchestration';
import type { AgentLocalChatVoiceState } from './chat-agent-turn-plan';

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizePositiveInteger(value: unknown): number | null {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

export function mergeAgentImageDiagnostics(
  diagnostics: AgentModelOutputDiagnostics | null,
  imageDiagnostics: Partial<NonNullable<AgentModelOutputDiagnostics['image']>> | null | undefined,
): AgentModelOutputDiagnostics | null {
  if (!diagnostics || !imageDiagnostics) {
    return diagnostics;
  }
  const mergedImage = {
    ...(diagnostics.image || {
      textPlanningMs: null,
      imageJobSubmitMs: null,
      imageLoadMs: null,
      imageGenerateMs: null,
      artifactHydrateMs: null,
      queueWaitMs: null,
      loadCacheHit: null,
      residentReused: null,
      residentRestarted: null,
      queueSerialized: null,
      profileOverrideStep: null,
      profileOverrideCfgScale: null,
      profileOverrideSampler: null,
      profileOverrideScheduler: null,
    }),
    ...imageDiagnostics,
  };
  return {
    ...diagnostics,
    image: mergedImage,
  };
}

function isTextStreamIdleTimeoutState(threadId: string): boolean {
  const streamState = getStreamState(threadId);
  return streamState.cancelSource === 'timeout'
    && normalizeText(streamState.errorMessage).startsWith('No stream activity within ');
}

export function createAgentTailAbortSignal(
  threadId: string,
  signal: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!signal) {
    return undefined;
  }
  if (signal.aborted) {
    return isTextStreamIdleTimeoutState(threadId) ? undefined : signal;
  }
  const controller = new AbortController();
  const propagateAbort = () => {
    if (isTextStreamIdleTimeoutState(threadId)) {
      return;
    }
    controller.abort();
  };
  signal.addEventListener('abort', propagateAbort, { once: true });
  return controller.signal;
}

export function requireProviderMetadata(
  metadata: Record<string, unknown> | undefined,
): AgentLocalChatProviderMetadata {
  const record = metadata?.agentLocalChat;
  if (!record || typeof record !== 'object') {
    throw new Error('agent-local-chat-v1 requires metadata.agentLocalChat');
  }
  const nextRecord = record as Record<string, unknown>;
  const agentId = normalizeText(nextRecord.agentId);
  if (!agentId) {
    throw new Error('agent-local-chat-v1 metadata.agentId is required');
  }
  const targetSnapshot = nextRecord.targetSnapshot;
  if (!targetSnapshot || typeof targetSnapshot !== 'object') {
    throw new Error('agent-local-chat-v1 metadata.targetSnapshot is required');
  }
  const reasoningPreference = nextRecord.reasoningPreference === 'on' ? 'on' : 'off';
  return {
    agentId,
    targetSnapshot: targetSnapshot as AgentLocalTargetSnapshot,
    agentResolution: (nextRecord.agentResolution ?? null) as AgentEffectiveCapabilityResolution | null,
    textExecutionSnapshot: (nextRecord.textExecutionSnapshot ?? null) as AISnapshot | null,
    imageExecutionSnapshot: (nextRecord.imageExecutionSnapshot ?? null) as AISnapshot | null,
    voiceExecutionSnapshot: (nextRecord.voiceExecutionSnapshot ?? null) as AISnapshot | null,
    voiceWorkflowExecutionSnapshotByCapability: (nextRecord.voiceWorkflowExecutionSnapshotByCapability ?? {}) as Partial<Record<AgentVoiceWorkflowCapability, AISnapshot | null>>,
    latestVoiceCapture: (nextRecord.latestVoiceCapture ?? null) as ChatAgentVoiceWorkflowReferenceAudio | null,
    imageCapabilityParams: (nextRecord.imageCapabilityParams ?? null) as Record<string, unknown> | null,
    runtimeConfigState: (nextRecord.runtimeConfigState ?? null) as RuntimeConfigStateV11 | null,
    runtimeFields: (nextRecord.runtimeFields ?? {}) as RuntimeFieldMap,
    reasoningPreference,
    textModelContextTokens: normalizePositiveInteger(nextRecord.textModelContextTokens),
    textMaxOutputTokensRequested: normalizePositiveInteger(nextRecord.textMaxOutputTokensRequested),
    resolvedBehavior: (nextRecord.resolvedBehavior ?? null) as AgentResolvedBehavior | null,
  };
}

export function toAbortLikeErrorMessage(error: unknown): string {
  const message = normalizeText(error instanceof Error ? error.message : String(error || ''));
  return message || 'Generation stopped.';
}

export function isAbortLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const name = normalizeText((error as { name?: unknown }).name).toLowerCase();
  const code = normalizeText((error as { code?: unknown }).code).toLowerCase();
  const message = normalizeText(error instanceof Error ? error.message : String(error)).toLowerCase();
  return name === 'aborterror'
    || code === 'aborterror'
    || code === 'aborted'
    || message.includes('aborted')
    || message.includes('cancelled')
    || message.includes('canceled');
}

export function resolveVoiceWorkflowProgressMessage(
  workflowType: AgentChatVoiceWorkflowMessageMetadata['workflowType'],
): string {
  return workflowType === 'tts_v2v'
    ? 'Creating a custom voice from current-thread reference audio…'
    : 'Designing a custom voice for this thread…';
}

export function buildVoiceWorkflowMetadata(input: {
  turnId: string;
  voiceDecision: Extract<AgentLocalChatVoiceState, { status: 'pending' }>;
  workflowStatus: AgentChatVoiceWorkflowStatus;
  jobId: string;
  traceId: string;
  voiceReference: import('./chat-agent-voice-workflow').AgentChatVoiceReferenceMeaning | null;
  voiceAssetId: string | null;
  providerVoiceRef: string | null;
  message: string;
}): AgentChatVoiceWorkflowMessageMetadata {
  return {
    kind: 'voice-workflow',
    version: 'v1',
    sourceTurnId: input.turnId,
    sourceMessageId: input.voiceDecision.sourceMessageId,
    sourceActionId: input.voiceDecision.sourceActionId,
    beatId: input.voiceDecision.beatId,
    workflowCapability: input.voiceDecision.workflowIntent.capability,
    workflowType: input.voiceDecision.workflowIntent.workflowType,
    workflowStatus: input.workflowStatus,
    jobId: input.jobId,
    playbackPrompt: input.voiceDecision.prompt,
    transcriptText: input.voiceDecision.transcriptText,
    traceId: input.traceId,
    message: input.message,
    voiceReference: input.voiceReference,
    voiceAssetId: input.voiceAssetId,
    providerVoiceRef: input.providerVoiceRef,
  };
}
