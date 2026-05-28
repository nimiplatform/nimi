import type {
  ConversationTurnError,
  ConversationTurnEvent,
  ConversationTurnInput,
} from '@nimiplatform/kit/features/chat';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import type {
  AgentLocalCommitTurnResult,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
} from '@renderer/bridge/runtime-bridge/types';
import type {
  AgentLocalTextMessageState,
} from './chat-agent-runtime-turn-types';
import { RUNTIME_AGENT_CHAT_MODE_ID, type RuntimeAgentChatModeId } from './chat-agent-runtime-mode';

type AgentLocalChatStoreClient = Pick<
  typeof chatAgentStoreClient,
  'getThreadBundle' | 'commitTurnResult'
>;

export type AgentLocalChatContinuityAdapter = {
  commitAgentTurnResult: (input: {
    modeId: RuntimeAgentChatModeId;
    threadId: string;
    turnId: string;
    outcome: 'completed' | 'failed' | 'canceled';
    outputText?: string;
    reasoningText?: string;
    error?: ConversationTurnError;
    events: readonly ConversationTurnEvent[];
    signal?: AbortSignal;
    textMessageState?: AgentLocalTextMessageState;
  }) => Promise<AgentLocalCommitTurnResult>;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveTextMessageState(
  turnId: string,
  outputText?: string,
): AgentLocalTextMessageState | null {
  const text = normalizeText(outputText);
  if (!text) {
    return null;
  }
  return {
    messageId: `${turnId}:message-source:0`,
    projectionMessageId: `${turnId}:message:0`,
    text,
    metadataJson: null,
  };
}

function resolveTextMessageStates(input: {
  turnId: string;
  outputText?: string;
  textMessageState?: AgentLocalTextMessageState | undefined;
}): AgentLocalTextMessageState[] {
  if (input.textMessageState) {
    return [input.textMessageState];
  }
  const textMessage = resolveTextMessageState(input.turnId, input.outputText);
  return textMessage ? [textMessage] : [];
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

async function requireThreadBundle(
  storeClient: AgentLocalChatStoreClient,
  threadId: string,
): Promise<AgentLocalThreadBundle> {
  const bundle = await storeClient.getThreadBundle(threadId);
  if (!bundle) {
    throw new Error('commit chat_agent projection failed: thread not found');
  }
  return bundle;
}

function buildTextProjectionMessages(
  thread: AgentLocalThreadRecord,
  textMessages: readonly AgentLocalTextMessageState[],
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
  return textMessages.map((textMessage) => ({
    id: textMessage.projectionMessageId,
    threadId: thread.id,
    role: 'assistant' as const,
    status: input.outcome === 'completed' ? 'complete' as const : 'error' as const,
    kind: 'text' as const,
    contentText: textMessage.text,
    reasoningText: null,
    error,
    traceId: resolveTerminalTraceId(input.events),
    parentMessageId: null,
    mediaUrl: null,
    mediaMimeType: null,
    artifactId: null,
    metadataJson: textMessage.metadataJson,
    createdAtMs: committedAtMs,
    updatedAtMs: committedAtMs,
  }));
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
    const bundle = await requireThreadBundle(storeClient, input.threadId);
    const committedAtMs = now();
    const thread = bundle.thread;
    const textMessages = resolveTextMessageStates({
      turnId: input.turnId,
      outputText: input.outputText,
      textMessageState: input.textMessageState,
    });
    const projectionMessages = [
      ...buildTextProjectionMessages(thread, textMessages, input, committedAtMs),
    ];
    return storeClient.commitTurnResult({
      threadId: input.threadId,
      turn: {
        id: input.turnId,
        threadId: input.threadId,
        role: 'assistant',
        status: mapOutcomeToTurnStatus(input.outcome),
        providerMode: RUNTIME_AGENT_CHAT_MODE_ID,
        traceId: resolveTerminalTraceId(input.events),
        promptTraceId: resolveTerminalPromptTraceId(input.events),
        startedAtMs: committedAtMs,
        completedAtMs: input.outcome === 'completed' ? committedAtMs : null,
        abortedAtMs: input.outcome === 'canceled' ? committedAtMs : null,
      },
      beats: [
        ...textMessages.map((textMessage) => ({
          id: `${input.turnId}:beat:0`,
          turnId: input.turnId,
          beatIndex: 0,
          modality: 'text' as const,
          status: mapOutcomeToBeatStatus(input.outcome),
          textShadow: textMessage.text || null,
          artifactId: null,
          mimeType: 'text/plain',
          mediaUrl: null,
          projectionMessageId: textMessage.projectionMessageId,
          createdAtMs: committedAtMs,
          deliveredAtMs: input.outcome === 'completed' ? committedAtMs : null,
        })),
      ],
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
    commitAgentTurnResult: commitAgentTurnResultInternal,
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
  textMessageState?: AgentLocalTextMessageState;
}): Promise<AgentLocalCommitTurnResult> {
  return input.continuityAdapter.commitAgentTurnResult({
    modeId: RUNTIME_AGENT_CHAT_MODE_ID,
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
    textMessageState: input.textMessageState,
  });
}
