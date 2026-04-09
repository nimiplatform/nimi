import type {
  ConversationContinuityAdapter,
  ConversationProjectionRebuildResult,
  ConversationRuntimeTextMessage,
  ConversationRuntimeTextStreamPart,
  ConversationTurnError,
  ConversationTurnEvent,
  ConversationTurnInput,
  ConversationOrchestrationProvider,
} from '@nimiplatform/nimi-kit/features/chat';
import { normalizeConversationRuntimeTextStreamPart } from '@nimiplatform/nimi-kit/features/chat/runtime';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import { feedStreamEvent } from '../turns/stream-controller';
import type {
  AgentLocalCommitTurnResult,
  AgentLocalTargetSnapshot,
  AgentLocalThreadRecord,
  AgentLocalTurnContext,
} from '@renderer/bridge/runtime-bridge/types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  generateChatAgentImageRuntime,
  invokeChatAgentRuntime,
  streamChatAgentRuntime,
  toChatAgentRuntimeError,
} from './chat-agent-runtime';
import type { ChatThinkingPreference } from './chat-thinking';
import type {
  AgentEffectiveCapabilityResolution,
  AISnapshot,
} from './conversation-capability';
import { getStreamState } from '../turns/stream-controller';
import { buildAgentLocalChatExecutionTextRequest } from './chat-ai-execution-engine';
import type {
  AgentResolvedBeat,
  AgentResolvedBeatActionEnvelope,
  AgentResolvedBehavior,
  AgentResolvedModalityAction,
} from './chat-agent-behavior';
import {
  buildAgentResolvedOutputText,
  parseAgentResolvedBeatActionEnvelope,
} from './chat-agent-behavior-resolver';

export { buildAgentLocalChatPrompt } from './chat-ai-execution-engine';

const AGENT_LOCAL_CHAT_PROVIDER_CAPABILITIES = {
  reasoning: true,
  continuity: true,
  firstBeat: true,
  voiceInput: false,
  voiceOutput: false,
  imageGeneration: true,
  videoGeneration: false,
} as const;

type AgentLocalChatStoreClient = Pick<
  typeof chatAgentStoreClient,
  'loadTurnContext' | 'commitTurnResult' | 'cancelTurn' | 'rebuildProjection'
>;

export type AgentLocalChatRuntimeRequest = {
  agentId: string;
  prompt?: string;
  messages?: readonly ConversationRuntimeTextMessage[];
  systemPrompt?: string | null;
  threadId: string;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  textExecutionSnapshot: AISnapshot | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  reasoningPreference: ChatThinkingPreference;
  signal?: AbortSignal;
};

export type AgentLocalChatImageRequest = {
  prompt: string;
  imageExecutionSnapshot: AISnapshot | null;
  imageCapabilityParams?: Record<string, unknown> | null;
  signal?: AbortSignal;
};

export interface AgentLocalChatRuntimeAdapter {
  streamText: (
    request: AgentLocalChatRuntimeRequest,
  ) => Promise<{ stream: AsyncIterable<ConversationRuntimeTextStreamPart> }>;
  invokeText: (
    request: AgentLocalChatRuntimeRequest,
  ) => Promise<{ text: string; traceId: string; promptTraceId: string }>;
  generateImage: (
    request: AgentLocalChatImageRequest,
  ) => Promise<{ mediaUrl: string; mimeType: string; artifactId: string | null; traceId: string }>;
}

export type AgentLocalChatProviderMetadata = {
  agentId: string;
  targetSnapshot: AgentLocalTargetSnapshot;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  textExecutionSnapshot: AISnapshot | null;
  imageExecutionSnapshot: AISnapshot | null;
  imageCapabilityParams?: Record<string, unknown> | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  reasoningPreference: ChatThinkingPreference;
  resolvedBehavior?: AgentResolvedBehavior | null;
};

type AgentLocalChatImageState =
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

type AgentLocalChatContinuityAdapter = ConversationContinuityAdapter<
  AgentLocalTurnContext,
  AgentLocalCommitTurnResult
> & {
  commitAgentTurnResult: (input: {
    modeId: 'agent-local-chat-v1';
    threadId: string;
    turnId: string;
    outcome: 'completed' | 'failed' | 'canceled';
    outputText?: string;
    reasoningText?: string;
    error?: ConversationTurnError;
    events: readonly ConversationTurnEvent[];
    signal?: AbortSignal;
    imageState?: AgentLocalChatImageState;
    textBeatStates?: readonly AgentLocalTextBeatState[];
  }) => Promise<AgentLocalCommitTurnResult>;
};

export type AgentLocalChatProviderOptions = {
  runtimeAdapter?: AgentLocalChatRuntimeAdapter;
  continuityAdapter?: AgentLocalChatContinuityAdapter;
};

type AgentLocalTextBeatState = {
  beatId: string;
  beatIndex: number;
  projectionMessageId: string;
  text: string;
};

type AgentLocalPlannedTextBeat = Pick<
  AgentLocalTextBeatState,
  'beatId' | 'beatIndex' | 'projectionMessageId'
> & {
  deliveryPhase: AgentResolvedBeat['deliveryPhase'];
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

function requireProviderMetadata(metadata: Record<string, unknown> | undefined): AgentLocalChatProviderMetadata {
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
    imageCapabilityParams: (nextRecord.imageCapabilityParams ?? null) as Record<string, unknown> | null,
    runtimeConfigState: (nextRecord.runtimeConfigState ?? null) as RuntimeConfigStateV11 | null,
    runtimeFields: (nextRecord.runtimeFields ?? {}) as RuntimeFieldMap,
    reasoningPreference,
    resolvedBehavior: (nextRecord.resolvedBehavior ?? null) as AgentResolvedBehavior | null,
  };
}

function toAbortLikeErrorMessage(error: unknown): string {
  const message = normalizeText(error instanceof Error ? error.message : String(error || ''));
  return message || 'Generation stopped.';
}

function isAbortLikeError(error: unknown): boolean {
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

function createAbortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

function waitForResolvedDelay(input: {
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

function resolvePlannedTextBeatsFromEnvelope(input: {
  turnId: string;
  envelope: AgentResolvedBeatActionEnvelope;
}): AgentLocalPlannedTextBeat[] {
  return input.envelope.beats.map((beat) => ({
    beatId: beat.beatId,
    beatIndex: beat.beatIndex,
    projectionMessageId: `${input.turnId}:message:${beat.beatIndex}`,
    deliveryPhase: beat.deliveryPhase,
  }));
}

function resolveCompletedTextBeatStatesFromEnvelope(input: {
  turnId: string;
  envelope: AgentResolvedBeatActionEnvelope;
}): AgentLocalTextBeatState[] {
  return input.envelope.beats.map((beat) => ({
    beatId: beat.beatId,
    beatIndex: beat.beatIndex,
    projectionMessageId: `${input.turnId}:message:${beat.beatIndex}`,
    text: beat.text,
  }));
}

function findSingleExecutableImageAction(
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

function resolveImageStateFromResolvedAction(input: {
  turnId: string;
  action: AgentResolvedModalityAction;
  textBeatCount: number;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  imageExecutionSnapshot: AISnapshot | null;
}): AgentLocalChatImageState {
  const beatIndex = input.textBeatCount + input.action.actionIndex;
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
      beatId: input.action.actionId,
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
      beatId: input.action.actionId,
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
    beatId: input.action.actionId,
    beatIndex,
    projectionMessageId,
    prompt,
  };
}

export function createAgentLocalChatConversationRuntimeAdapter(): AgentLocalChatRuntimeAdapter {
  return {
    async streamText(request) {
      const result = await streamChatAgentRuntime({
        agentId: request.agentId,
        prompt: request.prompt,
        messages: request.messages,
        systemPrompt: request.systemPrompt,
        threadId: request.threadId,
        reasoningPreference: request.reasoningPreference,
        agentResolution: request.agentResolution,
        executionSnapshot: request.textExecutionSnapshot,
        runtimeConfigState: request.runtimeConfigState,
        runtimeFields: request.runtimeFields,
        signal: request.signal,
      });
      return {
        stream: normalizeAgentLocalRuntimeStream(result.stream, result.promptTraceId),
      };
    },
    async invokeText(request) {
      return invokeChatAgentRuntime({
        agentId: request.agentId,
        prompt: request.prompt,
        messages: request.messages,
        systemPrompt: request.systemPrompt,
        threadId: request.threadId,
        reasoningPreference: request.reasoningPreference,
        agentResolution: request.agentResolution,
        executionSnapshot: request.textExecutionSnapshot,
        runtimeConfigState: request.runtimeConfigState,
        runtimeFields: request.runtimeFields,
        signal: request.signal,
      });
    },
    async generateImage(request) {
      return generateChatAgentImageRuntime(request);
    },
  };
}

async function* normalizeAgentLocalRuntimeStream(
  stream: AsyncIterable<Awaited<ReturnType<typeof streamChatAgentRuntime>>['stream'] extends AsyncIterable<infer T> ? T : never>,
  promptTraceId: string,
): AsyncIterable<ConversationRuntimeTextStreamPart> {
  for await (const part of stream) {
    const normalizedPart = normalizeConversationRuntimeTextStreamPart(part);
    switch (normalizedPart.type) {
      case 'finish':
        yield {
          ...normalizedPart,
          trace: {
            ...normalizedPart.trace,
            promptTraceId: normalizeText(normalizedPart.trace?.promptTraceId)
              || normalizeText(promptTraceId)
              || null,
          },
        };
        break;
      case 'error':
        yield {
          ...normalizedPart,
          trace: {
            ...normalizedPart.trace,
            promptTraceId: normalizeText(normalizedPart.trace?.promptTraceId)
              || normalizeText(promptTraceId)
              || null,
          },
        };
        break;
      default:
        yield normalizedPart;
    }
  }
}

export function createAgentLocalChatContinuityAdapter(
  options: {
    storeClient?: AgentLocalChatStoreClient;
    now?: () => number;
  } = {},
): AgentLocalChatContinuityAdapter {
  const storeClient = options.storeClient ?? chatAgentStoreClient;
  const now = options.now ?? (() => Date.now());
  const commitAgentTurnResultInternal: AgentLocalChatContinuityAdapter['commitAgentTurnResult'] = async (input) => {
    const context = await storeClient.loadTurnContext({
      threadId: input.threadId,
    });
    const committedAtMs = now();
    const thread = context.thread;
    const textBeats = resolveTextBeatStates({
      events: input.events,
      turnId: input.turnId,
      outputText: input.outputText,
      textBeatStates: input.textBeatStates,
    });
    const imageState = input.imageState || { status: 'none' as const };
    const projectionMessages = [
      ...buildTextProjectionMessages(thread, textBeats, input, committedAtMs),
      ...((imageState.status === 'complete' || imageState.status === 'error')
        ? [buildImageProjectionMessage(thread, imageState, committedAtMs)]
        : []),
    ];
    return storeClient.commitTurnResult({
      threadId: input.threadId,
      turn: {
        id: input.turnId,
        threadId: input.threadId,
        role: 'assistant',
        status: mapOutcomeToTurnStatus(input.outcome),
        providerMode: 'agent-local-chat-v1',
        traceId: resolveTerminalTraceId(input.events),
        promptTraceId: resolveTerminalPromptTraceId(input.events),
        startedAtMs: committedAtMs,
        completedAtMs: input.outcome === 'completed' ? committedAtMs : null,
        abortedAtMs: input.outcome === 'canceled' ? committedAtMs : null,
      },
      beats: [
        ...textBeats.map((textBeat) => ({
          id: textBeat.beatId,
          turnId: input.turnId,
          beatIndex: textBeat.beatIndex,
          modality: 'text' as const,
          status: mapOutcomeToBeatStatus(input.outcome),
          textShadow: textBeat.text || null,
          artifactId: null,
          mimeType: 'text/plain',
          mediaUrl: null,
          projectionMessageId: textBeat.projectionMessageId,
          createdAtMs: committedAtMs,
          deliveredAtMs: input.outcome === 'completed' ? committedAtMs : null,
        })),
        ...(imageState.status === 'none' || imageState.status === 'generate'
          ? []
          : [{
            id: imageState.beatId,
            turnId: input.turnId,
            beatIndex: imageState.beatIndex,
            modality: 'image' as const,
            status: imageState.status === 'complete' ? 'delivered' as const : 'failed' as const,
            textShadow: imageState.prompt || null,
            artifactId: imageState.status === 'complete' ? imageState.artifactId : null,
            mimeType: imageState.status === 'complete' ? imageState.mimeType : null,
            mediaUrl: imageState.status === 'complete' ? imageState.mediaUrl : null,
            projectionMessageId: imageState.projectionMessageId,
            createdAtMs: committedAtMs,
            deliveredAtMs: input.outcome === 'completed' ? committedAtMs : null,
          }]),
      ],
      interactionSnapshot: null,
      relationMemorySlots: [],
      recallEntries: [],
      projection: {
        thread: {
          id: thread.id,
          title: thread.title,
          updatedAtMs: committedAtMs,
          lastMessageAtMs: projectionMessages.length > 0 ? committedAtMs : thread.lastMessageAtMs,
          archivedAtMs: thread.archivedAtMs,
          targetSnapshot: thread.targetSnapshot,
        },
        messages: projectionMessages,
        draft: null,
        clearDraft: input.outcome === 'completed',
      },
    });
  };
  return {
    loadTurnContext: async (input) => storeClient.loadTurnContext({
      threadId: input.threadId,
    }),
    commitTurnResult: async (input) => commitAgentTurnResultInternal({
      ...input,
      modeId: 'agent-local-chat-v1',
      imageState: { status: 'none' },
    }),
    commitAgentTurnResult: commitAgentTurnResultInternal,
    cancelTurn: async (input) => {
      await storeClient.cancelTurn({
        threadId: input.threadId,
        turnId: input.turnId,
        scope: input.scope,
        abortedAtMs: now(),
      });
    },
    rebuildProjection: async (threadId) => {
      const result = await storeClient.rebuildProjection(threadId);
      return {
        threadId,
        projectionVersion: result.projectionVersion,
      } satisfies ConversationProjectionRebuildResult;
    },
  };
}

function resolveTextBeatState(
  events: readonly ConversationTurnEvent[],
  turnId: string,
  outputText?: string,
): AgentLocalTextBeatState | null {
  const plannedTextBeats = events.filter((
    event,
  ): event is Extract<ConversationTurnEvent, { type: 'beat-planned' }> => (
    event.type === 'beat-planned'
      && event.turnId === turnId
      && event.modality === 'text'
  ));
  if (plannedTextBeats.length === 0) {
    return null;
  }
  if (plannedTextBeats.length !== 1) {
    throw new Error('agent-local-chat-v1 commit only supports one text beat per turn');
  }
  const plannedBeat = plannedTextBeats[0]!;
  const sealedBeat = events.find((
    event,
  ): event is Extract<ConversationTurnEvent, { type: 'first-beat-sealed' }> => (
    event.type === 'first-beat-sealed'
      && event.turnId === turnId
      && event.beatId === plannedBeat.beatId
  ));
  const deliveredBeat = events.find((
    event,
  ): event is Extract<ConversationTurnEvent, { type: 'beat-delivered' }> => (
    event.type === 'beat-delivered'
      && event.turnId === turnId
      && event.beatId === plannedBeat.beatId
  ));
  return {
    beatId: plannedBeat.beatId,
    beatIndex: plannedBeat.beatIndex,
    projectionMessageId: deliveredBeat?.projectionMessageId || `${turnId}:message:${plannedBeat.beatIndex}`,
    text: normalizeText(outputText) || sealedBeat?.text || '',
  };
}

function resolveTextBeatStates(input: {
  events: readonly ConversationTurnEvent[];
  turnId: string;
  outputText?: string;
  textBeatStates?: readonly AgentLocalTextBeatState[] | undefined;
}): AgentLocalTextBeatState[] {
  if (input.textBeatStates) {
    return [...input.textBeatStates];
  }
  const textBeat = resolveTextBeatState(input.events, input.turnId, input.outputText);
  return textBeat ? [textBeat] : [];
}

function mapOutcomeToTurnStatus(outcome: 'completed' | 'failed' | 'canceled') {
  switch (outcome) {
    case 'completed':
      return 'completed' as const;
    case 'failed':
      return 'failed' as const;
    case 'canceled':
      return 'canceled' as const;
    default:
      throw new Error(`Unsupported turn outcome: ${String(outcome)}`);
  }
}

function mapOutcomeToBeatStatus(outcome: 'completed' | 'failed' | 'canceled') {
  switch (outcome) {
    case 'completed':
      return 'delivered' as const;
    case 'failed':
      return 'failed' as const;
    case 'canceled':
      return 'canceled' as const;
    default:
      throw new Error(`Unsupported beat outcome: ${String(outcome)}`);
  }
}

function resolveTerminalTraceId(events: readonly ConversationTurnEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.type === 'turn-completed'
      || event?.type === 'turn-failed'
      || event?.type === 'turn-canceled'
    ) {
      return normalizeText(event.trace?.traceId) || null;
    }
  }
  return null;
}

function resolveTerminalPromptTraceId(events: readonly ConversationTurnEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.type === 'turn-completed'
      || event?.type === 'turn-failed'
      || event?.type === 'turn-canceled'
    ) {
      return normalizeText(event.trace?.promptTraceId) || null;
    }
  }
  return null;
}

function buildTextProjectionMessages(
  thread: AgentLocalThreadRecord,
  textBeats: readonly AgentLocalTextBeatState[],
  input: {
    outcome: 'completed' | 'failed' | 'canceled';
    outputText?: string;
    reasoningText?: string;
    error?: ConversationTurnError;
    events: readonly ConversationTurnEvent[];
  },
  committedAtMs: number,
) {
  const error = input.outcome === 'completed'
    ? null
    : {
      code: input.outcome === 'canceled'
        ? 'OPERATION_ABORTED'
        : normalizeText(input.error?.code) || 'AGENT_TURN_FAILED',
      message: input.outcome === 'canceled'
        ? 'Generation stopped.'
        : normalizeText(input.error?.message) || 'Agent response failed',
    };
  return textBeats.map((textBeat, index) => ({
    id: textBeat.projectionMessageId,
    threadId: thread.id,
    role: 'assistant' as const,
    status: input.outcome === 'completed' ? 'complete' as const : 'error' as const,
    kind: 'text' as const,
    contentText: textBeat.text,
    reasoningText: null,
    error,
    traceId: resolveTerminalTraceId(input.events),
    parentMessageId: index > 0 ? textBeats[index - 1]?.projectionMessageId || null : null,
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    createdAtMs: committedAtMs,
    updatedAtMs: committedAtMs,
  }));
}

function buildImageProjectionMessage(
  thread: AgentLocalThreadRecord,
  imageState: Extract<AgentLocalChatImageState, { status: 'complete' | 'error' }>,
  committedAtMs: number,
) {
  return {
    id: imageState.projectionMessageId,
    threadId: thread.id,
    role: 'assistant' as const,
    status: imageState.status === 'complete' ? 'complete' as const : 'error' as const,
    kind: 'image' as const,
    contentText: imageState.prompt,
    reasoningText: null,
    error: imageState.status === 'complete'
      ? null
      : {
        code: 'AGENT_IMAGE_FAILED',
        message: imageState.message,
      },
    traceId: null,
    parentMessageId: null,
    mediaUrl: imageState.status === 'complete' ? imageState.mediaUrl : null,
    mediaMimeType: imageState.status === 'complete' ? imageState.mimeType : null,
    artifactId: imageState.status === 'complete' ? imageState.artifactId : null,
    createdAtMs: committedAtMs,
    updatedAtMs: committedAtMs,
  };
}

async function commitProviderOutcome(input: {
  continuityAdapter: AgentLocalChatContinuityAdapter;
  baseInput: ConversationTurnInput;
  emittedEvents: readonly ConversationTurnEvent[];
  terminalEvent: ConversationTurnEvent;
  outcome: 'completed' | 'failed' | 'canceled';
  outputText: string;
  reasoningText: string;
  error?: ConversationTurnError;
  imageState?: AgentLocalChatImageState;
  textBeatStates?: readonly AgentLocalTextBeatState[];
}): Promise<AgentLocalCommitTurnResult> {
  return input.continuityAdapter.commitAgentTurnResult({
    modeId: 'agent-local-chat-v1',
    threadId: input.baseInput.threadId,
    turnId: input.baseInput.turnId,
    outcome: input.outcome,
    outputText: input.outputText || undefined,
    reasoningText: input.reasoningText || undefined,
    error: input.error,
    events: [
      ...input.emittedEvents,
      input.terminalEvent,
    ],
    signal: input.baseInput.signal,
    imageState: input.imageState,
    textBeatStates: input.textBeatStates,
  });
}

export function createAgentLocalChatConversationProvider(
  options: AgentLocalChatProviderOptions = {},
): ConversationOrchestrationProvider {
  const runtimeAdapter = options.runtimeAdapter ?? createAgentLocalChatConversationRuntimeAdapter();
  const continuityAdapter = options.continuityAdapter ?? createAgentLocalChatContinuityAdapter();
  return {
    modeId: 'agent-local-chat-v1',
    capabilities: AGENT_LOCAL_CHAT_PROVIDER_CAPABILITIES,
    async *runTurn(input: ConversationTurnInput): AsyncIterable<ConversationTurnEvent> {
      const metadata = requireProviderMetadata(input.metadata);
      const userText = normalizeText(input.userMessage.text);
      if (!userText) {
        throw new Error('agent-local-chat-v1 requires a non-empty user message');
      }

      const turnContext = await continuityAdapter.loadTurnContext({
        modeId: 'agent-local-chat-v1',
        threadId: input.threadId,
        turnId: input.turnId,
        signal: input.signal,
      });
      const executionRequest = buildAgentLocalChatExecutionTextRequest({
        systemPrompt: normalizeText(input.systemPrompt) || null,
        targetSnapshot: metadata.targetSnapshot,
        history: input.history,
        userText,
        context: turnContext,
        resolvedBehavior: metadata.resolvedBehavior,
      });

      const emittedEvents: ConversationTurnEvent[] = [];
      const turnStarted: ConversationTurnEvent = {
        type: 'turn-started',
        modeId: 'agent-local-chat-v1',
        threadId: input.threadId,
        turnId: input.turnId,
      };
      emittedEvents.push(turnStarted);
      yield turnStarted;

      let rawModelOutput = '';
      let outputText = '';
      let firstBeatText = '';
      let reasoningText = '';
      let textBeatEmitted = false;
      let terminalEventEmitted = false;
      let completedTextBeatStates: AgentLocalTextBeatState[] | undefined;
      let primaryTextBeat: AgentLocalPlannedTextBeat | null = null;

      const emitFirstBeat = async function* () {
        if (textBeatEmitted || !firstBeatText || !primaryTextBeat) {
          return;
        }

        const sealedEvent: ConversationTurnEvent = {
          type: 'first-beat-sealed',
          turnId: input.turnId,
          beatId: primaryTextBeat.beatId,
          text: firstBeatText,
        };
        emittedEvents.push(sealedEvent);
        yield sealedEvent;
        textBeatEmitted = true;
      };

      try {
        const runtimeResult = await runtimeAdapter.streamText({
          agentId: metadata.agentId,
          prompt: executionRequest.prompt,
          messages: executionRequest.messages,
          systemPrompt: executionRequest.systemPrompt,
          threadId: input.threadId,
          agentResolution: metadata.agentResolution,
          textExecutionSnapshot: metadata.textExecutionSnapshot,
          runtimeConfigState: metadata.runtimeConfigState,
          runtimeFields: metadata.runtimeFields,
          reasoningPreference: metadata.reasoningPreference,
          signal: input.signal,
        });

        for await (const part of runtimeResult.stream) {
          switch (part.type) {
            case 'start':
              break;
            case 'reasoning-delta': {
              reasoningText += part.textDelta;
              const reasoningEvent: ConversationTurnEvent = {
                type: 'reasoning-delta',
                turnId: input.turnId,
                textDelta: part.textDelta,
              };
              emittedEvents.push(reasoningEvent);
              yield reasoningEvent;
              break;
            }
            case 'text-delta': {
              rawModelOutput += part.textDelta;
              break;
            }
            case 'finish': {
              if (!normalizeText(rawModelOutput)) {
                throw new Error('agent-local-chat-v1 runtime stream completed without output text');
              }
              const resolvedEnvelope = parseAgentResolvedBeatActionEnvelope(rawModelOutput);
              const plannedTextBeats = resolvePlannedTextBeatsFromEnvelope({
                turnId: input.turnId,
                envelope: resolvedEnvelope,
              });
              primaryTextBeat = plannedTextBeats[0] || null;
              completedTextBeatStates = resolveCompletedTextBeatStatesFromEnvelope({
                turnId: input.turnId,
                envelope: resolvedEnvelope,
              });
              outputText = buildAgentResolvedOutputText(resolvedEnvelope);
              firstBeatText = completedTextBeatStates[0]?.text || outputText;

              for (const plannedTextBeat of plannedTextBeats) {
                const plannedEvent: ConversationTurnEvent = {
                  type: 'beat-planned',
                  turnId: input.turnId,
                  beatId: plannedTextBeat.beatId,
                  beatIndex: plannedTextBeat.beatIndex,
                  modality: 'text',
                };
                emittedEvents.push(plannedEvent);
                yield plannedEvent;
              }
              for await (const beatEvent of emitFirstBeat()) {
                yield beatEvent;
              }
              if (textBeatEmitted && primaryTextBeat) {
                const deliveredEvent: ConversationTurnEvent = {
                  type: 'beat-delivered',
                  turnId: input.turnId,
                  beatId: primaryTextBeat.beatId,
                  projectionMessageId: primaryTextBeat.projectionMessageId,
                };
                emittedEvents.push(deliveredEvent);
                yield deliveredEvent;
              }
              if (completedTextBeatStates && completedTextBeatStates.length > 1) {
                for (const textBeatState of completedTextBeatStates.slice(1)) {
                  const resolvedBeat = resolvedEnvelope.beats[textBeatState.beatIndex];
                  if (!resolvedBeat || resolvedBeat.deliveryPhase !== 'tail' || resolvedBeat.delayMs === undefined) {
                    throw new Error(`Delayed tail beat ${textBeatState.beatId} is missing resolved wait fields`);
                  }
                  await waitForResolvedDelay({
                    delayMs: resolvedBeat.delayMs,
                    signal: input.signal,
                    threadId: input.threadId,
                  });
                  const deliveryStartedEvent: ConversationTurnEvent = {
                    type: 'beat-delivery-started',
                    turnId: input.turnId,
                    beatId: textBeatState.beatId,
                  };
                  emittedEvents.push(deliveryStartedEvent);
                  yield deliveryStartedEvent;
                  const deliveredEvent: ConversationTurnEvent = {
                    type: 'beat-delivered',
                    turnId: input.turnId,
                    beatId: textBeatState.beatId,
                    projectionMessageId: textBeatState.projectionMessageId,
                  };
                  emittedEvents.push(deliveredEvent);
                  yield deliveredEvent;
                }
              }
              let imageState: AgentLocalChatImageState = { status: 'none' };
              const imageAction = findSingleExecutableImageAction(resolvedEnvelope);
              const imageDecision = imageAction
                ? resolveImageStateFromResolvedAction({
                  turnId: input.turnId,
                  action: imageAction,
                  textBeatCount: resolvedEnvelope.beats.length,
                  agentResolution: metadata.agentResolution,
                  imageExecutionSnapshot: metadata.imageExecutionSnapshot,
                })
                : { status: 'none' as const };
              if (imageDecision.status !== 'none') {
                const imagePlannedEvent: ConversationTurnEvent = {
                  type: 'beat-planned',
                  turnId: input.turnId,
                  beatId: imageDecision.beatId,
                  beatIndex: imageDecision.beatIndex,
                  modality: 'image',
                };
                emittedEvents.push(imagePlannedEvent);
                yield imagePlannedEvent;

                if (imageDecision.status === 'generate') {
                  const imageDeliveryStarted: ConversationTurnEvent = {
                    type: 'beat-delivery-started',
                    turnId: input.turnId,
                    beatId: imageDecision.beatId,
                  };
                  emittedEvents.push(imageDeliveryStarted);
                  yield imageDeliveryStarted;
                  try {
                    // Keep stream alive during long image generation
                    const keepaliveInterval = setInterval(() => {
                      feedStreamEvent(input.threadId, { type: 'keepalive' });
                    }, 10_000);
                    let generatedImage: Awaited<ReturnType<typeof runtimeAdapter.generateImage>>;
                    try {
                      generatedImage = await runtimeAdapter.generateImage({
                        prompt: imageDecision.prompt,
                        imageExecutionSnapshot: metadata.imageExecutionSnapshot,
                        imageCapabilityParams: metadata.imageCapabilityParams,
                        signal: createAgentTailAbortSignal(input.threadId, input.signal),
                      });
                    } finally {
                      clearInterval(keepaliveInterval);
                    }
                    imageState = {
                      status: 'complete',
                      beatId: imageDecision.beatId,
                      beatIndex: imageDecision.beatIndex,
                      projectionMessageId: imageDecision.projectionMessageId,
                      prompt: imageDecision.prompt,
                      mediaUrl: generatedImage.mediaUrl,
                      mimeType: generatedImage.mimeType,
                      artifactId: generatedImage.artifactId,
                    };
                    const artifactReadyEvent: ConversationTurnEvent = {
                      type: 'artifact-ready',
                      turnId: input.turnId,
                      beatId: imageState.beatId,
                      artifactId: imageState.artifactId || imageState.projectionMessageId,
                      mimeType: imageState.mimeType,
                      projectionMessageId: imageState.projectionMessageId,
                    };
                    emittedEvents.push(artifactReadyEvent);
                    yield artifactReadyEvent;
                    const imageDeliveredEvent: ConversationTurnEvent = {
                      type: 'beat-delivered',
                      turnId: input.turnId,
                      beatId: imageState.beatId,
                      projectionMessageId: imageState.projectionMessageId,
                    };
                    emittedEvents.push(imageDeliveredEvent);
                    yield imageDeliveredEvent;
                  } catch (imageError) {
                    imageState = {
                      status: 'error',
                      beatId: imageDecision.beatId,
                      beatIndex: imageDecision.beatIndex,
                      projectionMessageId: imageDecision.projectionMessageId,
                      prompt: imageDecision.prompt,
                      message: toChatAgentRuntimeError(imageError).message,
                    };
                  }
                } else {
                  imageState = imageDecision;
                }
              }
              const terminalEvent: ConversationTurnEvent = {
                type: 'turn-completed',
                turnId: input.turnId,
                outputText,
                reasoningText: reasoningText || undefined,
                finishReason: part.finishReason,
                usage: part.usage,
                trace: part.trace,
              };
              const commitResult = await commitProviderOutcome({
                continuityAdapter,
                baseInput: input,
                emittedEvents,
                terminalEvent,
                outcome: 'completed',
                outputText,
                reasoningText,
                imageState,
                textBeatStates: completedTextBeatStates,
              });
              yield {
                type: 'projection-rebuilt',
                threadId: input.threadId,
                projectionVersion: commitResult.projectionVersion,
              };
              yield terminalEvent;
              return;
            }
            case 'error': {
              const terminalEvent: ConversationTurnEvent = {
                type: 'turn-failed',
                turnId: input.turnId,
                error: part.error,
                outputText: outputText || undefined,
                reasoningText: reasoningText || undefined,
                trace: part.trace,
              };
              const commitResult = await commitProviderOutcome({
                continuityAdapter,
                baseInput: input,
                emittedEvents,
                terminalEvent,
                outcome: 'failed',
                outputText,
                reasoningText,
                error: part.error,
                textBeatStates: textBeatEmitted ? completedTextBeatStates : undefined,
              });
              yield {
                type: 'projection-rebuilt',
                threadId: input.threadId,
                projectionVersion: commitResult.projectionVersion,
              };
              terminalEventEmitted = true;
              yield terminalEvent;
              return;
            }
            default:
              throw new Error(`Unsupported agent-local-chat-v1 runtime part: ${JSON.stringify(part)}`);
          }
        }
        if (!terminalEventEmitted) {
          throw new Error('agent-local-chat-v1 runtime stream ended without a terminal event');
        }
      } catch (error) {
        if (isAbortLikeError(error) || input.signal?.aborted) {
          const terminalEvent: ConversationTurnEvent = {
            type: 'turn-canceled',
            turnId: input.turnId,
            scope: textBeatEmitted ? 'tail' : 'turn',
            outputText: outputText || undefined,
            reasoningText: reasoningText || undefined,
          };
          const commitResult = await commitProviderOutcome({
            continuityAdapter,
            baseInput: input,
            emittedEvents,
            terminalEvent,
            outcome: 'canceled',
            outputText,
            reasoningText,
            error: {
              code: 'OPERATION_ABORTED',
              message: toAbortLikeErrorMessage(error),
            },
            textBeatStates: textBeatEmitted ? completedTextBeatStates : undefined,
          });
          yield {
            type: 'projection-rebuilt',
            threadId: input.threadId,
            projectionVersion: commitResult.projectionVersion,
          };
          yield terminalEvent;
          return;
        }
        const runtimeError = toChatAgentRuntimeError(error);
        const terminalEvent: ConversationTurnEvent = {
          type: 'turn-failed',
          turnId: input.turnId,
          error: runtimeError,
          outputText: outputText || undefined,
          reasoningText: reasoningText || undefined,
        };
        const commitResult = await commitProviderOutcome({
          continuityAdapter,
          baseInput: input,
          emittedEvents,
          terminalEvent,
          outcome: 'failed',
          outputText,
          reasoningText,
          error: runtimeError,
          textBeatStates: textBeatEmitted ? completedTextBeatStates : undefined,
        });
        yield {
          type: 'projection-rebuilt',
          threadId: input.threadId,
          projectionVersion: commitResult.projectionVersion,
        };
        yield terminalEvent;
      }
    },
  };
}
