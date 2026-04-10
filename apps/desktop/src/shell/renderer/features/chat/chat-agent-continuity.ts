import type {
  ConversationContinuityAdapter,
  ConversationProjectionRebuildResult,
  ConversationTurnError,
  ConversationTurnEvent,
  ConversationTurnInput,
} from '@nimiplatform/nimi-kit/features/chat';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import type {
  AgentLocalCommitTurnResult,
  AgentLocalThreadRecord,
  AgentLocalTurnContext,
} from '@renderer/bridge/runtime-bridge/types';
import type {
  AgentLocalChatImageState,
  AgentLocalChatVoiceState,
  AgentLocalTextBeatState,
} from './chat-agent-turn-plan';

type AgentLocalChatStoreClient = Pick<
  typeof chatAgentStoreClient,
  'loadTurnContext' | 'commitTurnResult' | 'cancelTurn' | 'rebuildProjection'
>;

export type AgentLocalChatContinuityAdapter = ConversationContinuityAdapter<
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
    voiceState?: AgentLocalChatVoiceState;
    textBeatStates?: readonly AgentLocalTextBeatState[];
  }) => Promise<AgentLocalCommitTurnResult>;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    metadataJson: null,
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
    metadataJson: null,
    createdAtMs: committedAtMs,
    updatedAtMs: committedAtMs,
  };
}

function buildVoiceProjectionMessage(
  thread: AgentLocalThreadRecord,
  voiceState: Extract<AgentLocalChatVoiceState, { status: 'pending' | 'complete' | 'error' }>,
  committedAtMs: number,
) {
  const metadataJson = 'metadata' in voiceState && voiceState.metadata
    ? voiceState.metadata
    : null;
  const shouldRenderAsVoice = voiceState.status === 'complete'
    && Boolean(voiceState.mediaUrl);
  return {
    id: voiceState.projectionMessageId,
    threadId: thread.id,
    role: 'assistant' as const,
    status: voiceState.status === 'pending'
      ? 'pending' as const
      : voiceState.status === 'complete'
        ? 'complete' as const
        : 'error' as const,
    kind: shouldRenderAsVoice ? 'voice' as const : 'text' as const,
    contentText: voiceState.status === 'pending'
      ? voiceState.message
      : voiceState.transcriptText,
    reasoningText: null,
    error: voiceState.status === 'pending' || voiceState.status === 'complete'
      ? null
      : {
        code: 'AGENT_VOICE_FAILED',
        message: voiceState.message,
      },
    traceId: null,
    parentMessageId: null,
    mediaUrl: voiceState.status === 'complete' ? voiceState.mediaUrl : null,
    mediaMimeType: voiceState.status === 'complete' ? voiceState.mimeType : null,
    artifactId: voiceState.status === 'complete' ? voiceState.artifactId : null,
    metadataJson,
    createdAtMs: committedAtMs,
    updatedAtMs: committedAtMs,
  };
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
    const voiceState = input.voiceState || { status: 'none' as const };
    const projectionMessages = [
      ...buildTextProjectionMessages(thread, textBeats, input, committedAtMs),
      ...((voiceState.status === 'pending' || voiceState.status === 'complete' || voiceState.status === 'error')
        ? [buildVoiceProjectionMessage(thread, voiceState, committedAtMs)]
        : []),
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
        ...(voiceState.status === 'none' || voiceState.status === 'synthesize'
          ? []
          : [{
            id: voiceState.beatId,
            turnId: input.turnId,
            beatIndex: voiceState.beatIndex,
            modality: 'voice' as const,
            status: voiceState.status === 'pending'
              ? 'planned' as const
              : voiceState.status === 'complete'
                ? 'delivered' as const
                : 'failed' as const,
            textShadow: voiceState.transcriptText || voiceState.prompt || null,
            artifactId: voiceState.status === 'complete' ? voiceState.artifactId : null,
            mimeType: voiceState.status === 'complete' ? voiceState.mimeType : null,
            mediaUrl: voiceState.status === 'complete' ? voiceState.mediaUrl : null,
            projectionMessageId: voiceState.projectionMessageId,
            createdAtMs: committedAtMs,
            deliveredAtMs: voiceState.status === 'complete' && input.outcome === 'completed'
              ? committedAtMs
              : null,
          }]),
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
      voiceState: { status: 'none' },
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

export async function commitProviderOutcome(input: {
  continuityAdapter: AgentLocalChatContinuityAdapter;
  baseInput: ConversationTurnInput;
  emittedEvents: readonly ConversationTurnEvent[];
  terminalEvent: ConversationTurnEvent;
  outcome: 'completed' | 'failed' | 'canceled';
  outputText: string;
  reasoningText: string;
  error?: ConversationTurnError;
  imageState?: AgentLocalChatImageState;
  voiceState?: AgentLocalChatVoiceState;
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
    voiceState: input.voiceState,
    textBeatStates: input.textBeatStates,
  });
}
