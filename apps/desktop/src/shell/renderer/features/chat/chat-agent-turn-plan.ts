import { feedStreamEvent } from '../turns/stream-controller';
import type {
  AgentResolvedBeat,
  AgentResolvedBeatActionEnvelope,
  AgentResolvedModalityAction,
} from './chat-agent-behavior';
import type {
  AgentEffectiveCapabilityResolution,
  AgentVoiceWorkflowCapability,
  AISnapshot,
} from './conversation-capability';
import type { AgentChatVoiceWorkflowMessageMetadata } from './chat-agent-voice-workflow';

export type AgentLocalChatImageState =
  | {
    status: 'none';
  }
  | {
    status: 'generate';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
  }
  | {
    status: 'error';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
    message: string;
  }
  | {
    status: 'complete';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
    mediaUrl: string;
    mimeType: string;
    artifactId: string | null;
  };

export type AgentLocalChatVoiceState =
  | {
    status: 'none';
  }
  | {
    status: 'synthesize';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
    sourceBeatId: string;
    sourceActionId: string;
  }
  | {
    status: 'pending';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
    transcriptText: string;
    message: string;
    sourceBeatId: string;
    workflowIntent: AgentVoiceWorkflowIntent;
    sourceActionId: string;
    metadata?: AgentChatVoiceWorkflowMessageMetadata | null;
  }
  | {
    status: 'error';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
    transcriptText: string;
    message: string;
    sourceBeatId: string;
    sourceActionId: string;
    workflowIntent?: AgentVoiceWorkflowIntent | null;
    metadata?: AgentChatVoiceWorkflowMessageMetadata | null;
  }
  | {
    status: 'complete';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
    transcriptText: string;
    mediaUrl: string;
    mimeType: string;
    artifactId: string | null;
    sourceBeatId: string;
    sourceActionId: string;
    metadata?: AgentChatVoiceWorkflowMessageMetadata | null;
  };

export type AgentVoiceWorkflowIntent = {
  capability: AgentVoiceWorkflowCapability;
  workflowType: 'tts_v2v' | 'tts_t2v';
  operation: string;
};

export type AgentLocalTextBeatState = {
  beatId: string;
  beatIndex: number;
  projectionMessageId: string;
  text: string;
};

export type AgentLocalPlannedTextBeat = Pick<
  AgentLocalTextBeatState,
  'beatId' | 'beatIndex' | 'projectionMessageId'
> & {
  deliveryPhase: AgentResolvedBeat['deliveryPhase'];
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createAbortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

export function waitForResolvedDelay(input: {
  delayMs: number;
  signal?: AbortSignal;
  threadId: string;
}): Promise<void> {
  if (!Number.isFinite(input.delayMs) || input.delayMs <= 0) {
    throw new Error(`Resolved delayed beat requires a positive delayMs, received ${String(input.delayMs)}`);
  }
  if (input.signal?.aborted) {
    return Promise.reject(createAbortError());
  }
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, input.delayMs);
    const keepaliveIntervalId = setInterval(() => {
      feedStreamEvent(input.threadId, { type: 'keepalive' });
    }, 10_000);
    const onAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    const cleanup = () => {
      clearTimeout(timeoutId);
      clearInterval(keepaliveIntervalId);
      input.signal?.removeEventListener('abort', onAbort);
    };
    input.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const AGENT_NSFW_RE = /\b(?:nude|naked|sex|porn|nsfw|explicit)\b|(?:裸体|裸照|色情|成人视频|成人图)/iu;

function isPromptLikelyNsfw(text: string): boolean {
  return AGENT_NSFW_RE.test(normalizeText(text));
}

function resolveVoiceWorkflowLabel(intent: AgentVoiceWorkflowIntent): string {
  return intent.workflowType === 'tts_v2v'
    ? 'Voice clone workflow'
    : 'Voice design workflow';
}

function resolveVoiceActionWorkflowIntent(
  action: AgentResolvedModalityAction,
): AgentVoiceWorkflowIntent | null {
  const operation = normalizeText(action.operation).toLowerCase();
  if (!operation || operation === 'generate' || operation === 'audio.synthesize') {
    return null;
  }
  if (operation === 'voice_workflow.tts_v2v') {
    return {
      capability: 'voice_workflow.tts_v2v',
      workflowType: 'tts_v2v',
      operation,
    };
  }
  if (operation === 'voice_workflow.tts_t2v') {
    return {
      capability: 'voice_workflow.tts_t2v',
      workflowType: 'tts_t2v',
      operation,
    };
  }
  throw new Error(`voice action ${action.actionId} declares unsupported operation ${action.operation}`);
}

export function resolvePlannedTextBeatsFromEnvelope(input: {
  turnId: string;
  envelope: AgentResolvedBeatActionEnvelope;
}): AgentLocalPlannedTextBeat[] {
  return input.envelope.beats.map((beat) => ({
    beatId: `${input.turnId}:beat:${beat.beatIndex}`,
    beatIndex: beat.beatIndex,
    projectionMessageId: `${input.turnId}:message:${beat.beatIndex}`,
    deliveryPhase: beat.deliveryPhase,
  }));
}

export function resolveCompletedTextBeatStatesFromEnvelope(input: {
  turnId: string;
  envelope: AgentResolvedBeatActionEnvelope;
}): AgentLocalTextBeatState[] {
  return input.envelope.beats.map((beat) => ({
    beatId: `${input.turnId}:beat:${beat.beatIndex}`,
    beatIndex: beat.beatIndex,
    projectionMessageId: `${input.turnId}:message:${beat.beatIndex}`,
    text: beat.text,
  }));
}

export function findSingleExecutableImageAction(
  envelope: AgentResolvedBeatActionEnvelope,
): AgentResolvedModalityAction | null {
  const imageActions = envelope.actions.filter((action) => action.modality === 'image');
  if (imageActions.length === 0) {
    return null;
  }
  if (imageActions.length > 1) {
    throw new Error('agent-local-chat-v1 admits at most one image action in phase 0');
  }
  return imageActions[0] || null;
}

export function findSingleExecutableVoiceAction(
  envelope: AgentResolvedBeatActionEnvelope,
): AgentResolvedModalityAction | null {
  const voiceActions = envelope.actions.filter((action) => action.modality === 'voice');
  if (voiceActions.length === 0) {
    return null;
  }
  if (voiceActions.length > 1) {
    throw new Error('agent-local-chat-v1 admits at most one voice action in phase 1');
  }
  return voiceActions[0] || null;
}

export function resolveImageStateFromResolvedAction(input: {
  turnId: string;
  action: AgentResolvedModalityAction;
  textBeatCount: number;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  imageExecutionSnapshot: AISnapshot | null;
}): AgentLocalChatImageState {
  const beatIndex = input.textBeatCount + input.action.actionIndex;
  const storageBeatId = `${input.turnId}:beat:${beatIndex}`;
  const projectionMessageId = `${input.turnId}:message:${beatIndex}`;
  const prompt = input.action.promptPayload.kind === 'image-prompt'
    ? input.action.promptPayload.promptText
    : '';

  if (!prompt) {
    throw new Error(`image action ${input.action.actionId} is missing a promptText payload`);
  }
  if (isPromptLikelyNsfw(prompt)) {
    return {
      status: 'error',
      beatId: storageBeatId,
      beatIndex,
      projectionMessageId,
      prompt,
      message: 'Image generation was blocked by the current safety policy.',
    };
  }

  const imageProjection = input.agentResolution?.imageProjection || null;
  const imageReady = input.agentResolution?.imageReady === true;
  if (!imageReady || !input.imageExecutionSnapshot) {
    return {
      status: 'error',
      beatId: storageBeatId,
      beatIndex,
      projectionMessageId,
      prompt,
      message: !imageProjection?.selectedBinding
        ? 'Image generation is unavailable because no image route is configured.'
        : 'Image generation is unavailable because the image runtime is not ready.',
    };
  }

  return {
    status: 'generate',
    beatId: storageBeatId,
    beatIndex,
    projectionMessageId,
    prompt,
  };
}

export function resolveVoiceStateFromResolvedAction(input: {
  turnId: string;
  action: AgentResolvedModalityAction;
  textBeatCount: number;
  transcriptText: string;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  voiceExecutionSnapshot: AISnapshot | null;
  voiceWorkflowExecutionSnapshotByCapability: Partial<Record<AgentVoiceWorkflowCapability, AISnapshot | null>>;
}): AgentLocalChatVoiceState {
  const beatIndex = input.textBeatCount + input.action.actionIndex;
  const storageBeatId = `${input.turnId}:beat:${beatIndex}`;
  const projectionMessageId = `${input.turnId}:message:${beatIndex}`;
  const prompt = input.action.promptPayload.kind === 'voice-prompt'
    ? input.action.promptPayload.promptText
    : '';
  const transcriptText = normalizeText(input.transcriptText) || prompt;

  if (!prompt) {
    throw new Error(`voice action ${input.action.actionId} is missing a promptText payload`);
  }
  if (!transcriptText) {
    throw new Error(`voice action ${input.action.actionId} is missing a transcript-compatible source text`);
  }
  const workflowIntent = resolveVoiceActionWorkflowIntent(input.action);
  if (workflowIntent) {
    const workflowProjection = input.agentResolution?.voiceWorkflowProjections[workflowIntent.capability] || null;
    const workflowReady = input.agentResolution?.voiceWorkflowReadyByCapability[workflowIntent.capability] === true;
    const workflowExecutionSnapshot = input.voiceWorkflowExecutionSnapshotByCapability[workflowIntent.capability] || null;
    const workflowLabel = resolveVoiceWorkflowLabel(workflowIntent);
    if (!workflowReady || !workflowExecutionSnapshot) {
      return {
      status: 'error',
      beatId: storageBeatId,
      beatIndex,
      projectionMessageId,
      prompt,
      transcriptText,
      sourceBeatId: input.action.sourceBeatId,
      sourceActionId: input.action.actionId,
      message: !workflowProjection?.selectedBinding
        ? `${workflowLabel} is unavailable because no workflow route is configured.`
        : `${workflowLabel} is unavailable because the workflow runtime is not ready.`,
        workflowIntent,
      };
    }
    return {
      status: 'pending',
      beatId: storageBeatId,
      beatIndex,
      projectionMessageId,
      prompt,
      transcriptText,
      sourceBeatId: input.action.sourceBeatId,
      sourceActionId: input.action.actionId,
      message: `${workflowLabel} started in the current thread.`,
      workflowIntent,
    };
  }

  const voiceProjection = input.agentResolution?.voiceProjection || null;
  const voiceReady = input.agentResolution?.voiceReady === true;
  if (!voiceReady || !input.voiceExecutionSnapshot) {
    return {
      status: 'error',
      beatId: storageBeatId,
      beatIndex,
      projectionMessageId,
      prompt,
      transcriptText,
      sourceBeatId: input.action.sourceBeatId,
      sourceActionId: input.action.actionId,
      message: !voiceProjection?.selectedBinding
        ? 'Voice playback is unavailable because no voice route is configured.'
        : 'Voice playback is unavailable because the voice runtime is not ready.',
    };
  }

  return {
    status: 'synthesize',
    beatId: storageBeatId,
    beatIndex,
    projectionMessageId,
    prompt,
    sourceBeatId: input.action.sourceBeatId,
    sourceActionId: input.action.actionId,
  };
}
