import type {
  NimiFinishReason,
  NimiTokenUsage,
  NimiTraceInfo,
  TextMessage,
  TextStreamPart,
} from '../runtime/index.js';

export type AppAiSessionMessageRole = TextMessage['role'];

export type AppAiSessionHistoryMessage = {
  id: string;
  role: AppAiSessionMessageRole;
  text: string;
  name?: string | null;
  metadata?: Record<string, unknown>;
};

export type AppAiSessionHistoryMessageInput<TMessage> = {
  messages: readonly TMessage[];
  isCommitted: (message: TMessage) => boolean;
  getId: (message: TMessage) => string;
  getRole: (message: TMessage) => string;
  getText: (message: TMessage) => string | null | undefined;
  getName?: (message: TMessage) => string | null | undefined;
  getMetadata?: (message: TMessage) => Record<string, unknown> | undefined;
  mapAssistantText?: (text: string, message: TMessage) => string;
  maxMessages?: number;
};

export type AppAiSessionTextAccumulatorSnapshot = {
  text: string;
  reasoningText: string;
  terminal: 'none' | 'completed' | 'failed';
  finishReason?: NimiFinishReason | string;
  usage?: NimiTokenUsage;
  trace?: NimiTraceInfo;
  error?: unknown;
};

export type AppAiSessionRuntimeTextStreamCallbacks = {
  onTextDelta?: (
    delta: string,
    snapshot: AppAiSessionTextAccumulatorSnapshot,
  ) => void | Promise<void>;
  onReasoningDelta?: (
    delta: string,
    snapshot: AppAiSessionTextAccumulatorSnapshot,
  ) => void | Promise<void>;
};

const APP_AI_SESSION_HISTORY_ROLES = new Set<string>(['system', 'user', 'assistant', 'tool']);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isAppAiSessionMessageRole(role: string): role is AppAiSessionMessageRole {
  return APP_AI_SESSION_HISTORY_ROLES.has(role);
}

export function buildAppAiSessionHistoryMessages<TMessage>(
  input: AppAiSessionHistoryMessageInput<TMessage>,
): AppAiSessionHistoryMessage[] {
  const messages: AppAiSessionHistoryMessage[] = [];
  for (const message of input.messages) {
    if (!input.isCommitted(message)) {
      continue;
    }
    const role = normalizeText(input.getRole(message));
    if (!isAppAiSessionMessageRole(role)) {
      continue;
    }
    const rawText = normalizeText(input.getText(message));
    if (!rawText) {
      continue;
    }
    const text = role === 'assistant' && input.mapAssistantText
      ? normalizeText(input.mapAssistantText(rawText, message))
      : rawText;
    if (!text) {
      continue;
    }
    const name = normalizeText(input.getName?.(message));
    messages.push({
      id: normalizeText(input.getId(message)),
      role,
      text,
      name: name || undefined,
      metadata: input.getMetadata?.(message),
    });
  }
  if (input.maxMessages && input.maxMessages > 0 && messages.length > input.maxMessages) {
    return messages.slice(messages.length - input.maxMessages);
  }
  return messages;
}

export function createAppAiSessionTextAccumulator(): AppAiSessionTextAccumulatorSnapshot {
  return {
    text: '',
    reasoningText: '',
    terminal: 'none',
  };
}

export function appendAppAiSessionTextDelta(
  snapshot: AppAiSessionTextAccumulatorSnapshot,
  delta: string,
): AppAiSessionTextAccumulatorSnapshot {
  return {
    ...snapshot,
    text: snapshot.text + delta,
  };
}

export function appendAppAiSessionReasoningDelta(
  snapshot: AppAiSessionTextAccumulatorSnapshot,
  delta: string,
): AppAiSessionTextAccumulatorSnapshot {
  return {
    ...snapshot,
    reasoningText: snapshot.reasoningText + delta,
  };
}

export function completeAppAiSessionText(
  snapshot: AppAiSessionTextAccumulatorSnapshot,
  input: {
    text?: string | null;
    reasoningText?: string | null;
    finishReason?: NimiFinishReason | string;
    usage?: NimiTokenUsage;
    trace?: NimiTraceInfo;
  } = {},
): AppAiSessionTextAccumulatorSnapshot {
  return {
    ...snapshot,
    text: normalizeText(input.text) || snapshot.text,
    reasoningText: normalizeText(input.reasoningText) || snapshot.reasoningText,
    terminal: 'completed',
    finishReason: input.finishReason,
    usage: input.usage,
    trace: input.trace,
  };
}

export function failAppAiSessionText(
  snapshot: AppAiSessionTextAccumulatorSnapshot,
  input: {
    error: unknown;
    text?: string | null;
    reasoningText?: string | null;
    finishReason?: NimiFinishReason | string;
    usage?: NimiTokenUsage;
    trace?: NimiTraceInfo;
  },
): AppAiSessionTextAccumulatorSnapshot {
  return {
    ...snapshot,
    text: normalizeText(input.text) || snapshot.text,
    reasoningText: normalizeText(input.reasoningText) || snapshot.reasoningText,
    terminal: 'failed',
    finishReason: input.finishReason,
    usage: input.usage,
    trace: input.trace,
    error: input.error,
  };
}

export async function assembleAppAiSessionRuntimeTextStream(
  stream: AsyncIterable<TextStreamPart>,
  callbacks: AppAiSessionRuntimeTextStreamCallbacks = {},
): Promise<AppAiSessionTextAccumulatorSnapshot> {
  let snapshot = createAppAiSessionTextAccumulator();
  for await (const part of stream) {
    switch (part.type) {
      case 'start':
        continue;
      case 'reasoning-delta':
        snapshot = appendAppAiSessionReasoningDelta(snapshot, part.text);
        await callbacks.onReasoningDelta?.(part.text, snapshot);
        continue;
      case 'delta':
        snapshot = appendAppAiSessionTextDelta(snapshot, part.text);
        await callbacks.onTextDelta?.(part.text, snapshot);
        continue;
      case 'finish':
        snapshot = completeAppAiSessionText(snapshot, {
          finishReason: part.finishReason,
          usage: part.usage,
          trace: part.trace,
        });
        continue;
      case 'error':
        snapshot = failAppAiSessionText(snapshot, {
          error: part.error,
        });
        continue;
      default:
        return assertNever(part);
    }
  }
  return snapshot;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled app AI session stream part: ${JSON.stringify(value)}`);
}
