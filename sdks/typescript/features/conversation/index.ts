import type { NimiFinishReason, NimiJsonObject, NimiRunEvent, NimiUsage } from '../../core/contracts';

export interface NimiConversationMessage {
  readonly id: string;
  readonly role: 'system' | 'developer' | 'user' | 'assistant' | 'tool';
  readonly text: string;
  readonly tokenEstimate?: number;
  readonly metadata?: NimiJsonObject;
}

export interface NimiConversationHistoryBudget {
  readonly maxMessages?: number;
  readonly maxChars?: number;
  readonly maxTokenEstimate?: number;
}

export type NimiConversationHistoryTokenCounter<
  TMessage extends Pick<NimiConversationMessage, 'text'> = Pick<NimiConversationMessage, 'text'>,
> = (messages: readonly TMessage[]) => number;

export interface NimiConversationHistoryMessageInput<TMessage> {
  readonly messages: readonly TMessage[];
  readonly isCommitted: (message: TMessage) => boolean;
  readonly getId: (message: TMessage) => string;
  readonly getRole: (message: TMessage) => string;
  readonly getText: (message: TMessage) => string | null | undefined;
  readonly getName?: (message: TMessage) => string | null | undefined;
  readonly getMetadata?: (message: TMessage) => NimiJsonObject | undefined;
  readonly mapAssistantText?: (text: string, message: TMessage) => string;
  readonly maxMessages?: number;
}

export interface NimiConversationHistoryWindowMeasurement {
  readonly messageCount: number;
  readonly chars: number;
  readonly tokenEstimate: number;
  readonly completionReserve: number;
  readonly totalWithReserve: number;
}

export interface NimiConversationHistoryWindowResult<TMessage extends Pick<NimiConversationMessage, 'text'>> {
  readonly messages: readonly TMessage[];
  readonly trimmedCount: number;
  readonly includedChars: number;
  readonly includedTokenEstimate: number | null;
}

export interface NimiConversationTextAccumulatorSnapshot {
  readonly text: string;
  readonly reasoningText: string;
  readonly terminal: 'none' | 'completed' | 'failed';
  readonly finishReason?: NimiFinishReason | string;
  readonly usage?: NimiUsage;
  readonly traceId?: string;
  readonly error?: unknown;
}

export const NIMI_CONVERSATION_SESSION_HISTORY_BUDGET: Required<NimiConversationHistoryBudget> = {
  maxMessages: 24,
  maxChars: 24_000,
  maxTokenEstimate: 6000,
};

export const NIMI_CONVERSATION_SESSION_COMPLETION_RESERVE = {
  tokenEstimate: 1024,
} as const;

export type NimiConversationFeatureEvent =
  | { readonly type: 'conversation.started'; readonly traceId?: string }
  | { readonly type: 'conversation.text_delta'; readonly text: string }
  | { readonly type: 'conversation.reasoning_delta'; readonly text: string }
  | { readonly type: 'conversation.tool_call'; readonly id: string; readonly name: string }
  | { readonly type: 'conversation.warning'; readonly code: string; readonly message: string }
  | { readonly type: 'conversation.artifact'; readonly mimeType: string; readonly sizeBytes: number }
  | { readonly type: 'conversation.completed'; readonly finishReason: string }
  | { readonly type: 'conversation.failed'; readonly code: string; readonly message: string };

const CONVERSATION_HISTORY_ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool']);

export function buildNimiConversationHistoryMessages<TMessage>(
  input: NimiConversationHistoryMessageInput<TMessage>,
): readonly NimiConversationMessage[] {
  const messages: NimiConversationMessage[] = [];
  for (const message of input.messages) {
    if (!input.isCommitted(message)) {
      continue;
    }
    const role = normalizeText(input.getRole(message));
    if (!isNimiConversationRole(role)) {
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
    messages.push({
      id: normalizeText(input.getId(message)),
      role,
      text,
      metadata: input.getMetadata?.(message),
    });
  }
  if (input.maxMessages && input.maxMessages > 0 && messages.length > input.maxMessages) {
    return messages.slice(messages.length - input.maxMessages);
  }
  return messages;
}

export function buildNimiConversationHistoryWindow(
  messages: readonly NimiConversationMessage[],
  budget: NimiConversationHistoryBudget,
): readonly NimiConversationMessage[] {
  return buildNimiConversationHistoryWindowResult({ history: messages, budget }).messages;
}

export function buildNimiConversationHistoryWindowResult<
  TMessage extends Pick<NimiConversationMessage, 'text'>,
>(input: {
  readonly history: readonly TMessage[];
  readonly budget?: Partial<NimiConversationHistoryBudget>;
  readonly countTokens?: NimiConversationHistoryTokenCounter<TMessage>;
}): NimiConversationHistoryWindowResult<TMessage> {
  const budget = {
    ...NIMI_CONVERSATION_SESSION_HISTORY_BUDGET,
    ...(input.budget || {}),
  };
  const normalizedHistory = input.history.filter((message) => normalizeText(message.text).length > 0);
  const selected: TMessage[] = [];
  let includedChars = 0;
  let includedTokenEstimate: number | null = input.countTokens ? 0 : null;

  for (let index = normalizedHistory.length - 1; index >= 0; index -= 1) {
    if (selected.length >= budget.maxMessages) {
      break;
    }
    const message = normalizedHistory[index];
    if (!message) {
      continue;
    }
    const nextChars = includedChars + estimateNimiConversationMessageChars(message);
    if (nextChars > budget.maxChars) {
      continue;
    }
    const nextMessages = [message, ...selected];
    const nextTokenEstimate = input.countTokens
      ? input.countTokens(nextMessages)
      : nextMessages.reduce((sum, nextMessage) => (
        sum + estimateNimiConversationTokens(nextMessage.text)
      ), 0);
    if (nextTokenEstimate > budget.maxTokenEstimate) {
      continue;
    }
    selected.unshift(message);
    includedChars = nextChars;
    includedTokenEstimate = input.countTokens ? nextTokenEstimate : null;
  }

  return {
    messages: selected,
    trimmedCount: normalizedHistory.length - selected.length,
    includedChars,
    includedTokenEstimate,
  };
}

export function buildNimiConversationTokenWindow(
  messages: readonly NimiConversationMessage[],
  budget: NimiConversationHistoryBudget,
): readonly NimiConversationMessage[] {
  const maxMessages = budget.maxMessages ?? messages.length;
  const maxTokenEstimate = budget.maxTokenEstimate ?? Number.POSITIVE_INFINITY;
  const selected: NimiConversationMessage[] = [];
  let tokens = 0;

  for (let index = messages.length - 1; index >= 0 && selected.length < maxMessages; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    const nextTokens = tokens + (message.tokenEstimate ?? estimateNimiConversationTokens(message.text));
    if (nextTokens > maxTokenEstimate && selected.length > 0) {
      break;
    }
    selected.push(message);
    tokens = nextTokens;
  }

  return selected.reverse();
}

export function measureNimiConversationHistoryWindow(
  messages: readonly NimiConversationMessage[],
  reserve = NIMI_CONVERSATION_SESSION_COMPLETION_RESERVE.tokenEstimate,
): NimiConversationHistoryWindowMeasurement {
  const tokenEstimate = messages.reduce(
    (sum, message) => sum + (message.tokenEstimate ?? estimateNimiConversationTokens(message.text)),
    0,
  );
  const chars = messages.reduce((sum, message) => sum + estimateNimiConversationMessageChars(message), 0);
  return {
    messageCount: messages.length,
    chars,
    tokenEstimate,
    completionReserve: reserve,
    totalWithReserve: tokenEstimate + reserve,
  };
}

export function assembleNimiConversationText(events: readonly NimiConversationFeatureEvent[]): string {
  return events
    .filter((event): event is { readonly type: 'conversation.text_delta'; readonly text: string } => {
      return event.type === 'conversation.text_delta';
    })
    .map((event) => event.text)
    .join('');
}

export function buildNimiConversationFeatureEvents(
  events: readonly NimiRunEvent[],
): readonly NimiConversationFeatureEvent[] {
  return events.flatMap((event): readonly NimiConversationFeatureEvent[] => {
    if (event.type === 'start') {
      return [{ type: 'conversation.started', traceId: event.traceId }];
    }
    if (event.type === 'text-delta') {
      return [{ type: 'conversation.text_delta', text: event.text }];
    }
    if (event.type === 'reasoning-delta') {
      return [{ type: 'conversation.reasoning_delta', text: event.text }];
    }
    if (event.type === 'artifact') {
      return [{
        type: 'conversation.artifact',
        mimeType: event.mimeType,
        sizeBytes: event.chunk.byteLength,
      }];
    }
    if (event.type === 'tool-call') {
      return [{ type: 'conversation.tool_call', id: event.toolCall.id, name: event.toolCall.name }];
    }
    if (event.type === 'warning') {
      return [{ type: 'conversation.warning', code: event.code, message: event.message }];
    }
    if (event.type === 'done') {
      return [{ type: 'conversation.completed', finishReason: event.finishReason }];
    }
    if (event.type === 'error') {
      return [{ type: 'conversation.failed', code: event.code, message: event.message }];
    }
    return [];
  });
}

export function createNimiConversationTextAccumulator(): NimiConversationTextAccumulatorSnapshot {
  return {
    text: '',
    reasoningText: '',
    terminal: 'none',
  };
}

export function appendNimiConversationTextDelta(
  snapshot: NimiConversationTextAccumulatorSnapshot,
  delta: string,
): NimiConversationTextAccumulatorSnapshot {
  return {
    ...snapshot,
    text: snapshot.text + delta,
  };
}

export function appendNimiConversationReasoningDelta(
  snapshot: NimiConversationTextAccumulatorSnapshot,
  delta: string,
): NimiConversationTextAccumulatorSnapshot {
  return {
    ...snapshot,
    reasoningText: snapshot.reasoningText + delta,
  };
}

export function completeNimiConversationText(
  snapshot: NimiConversationTextAccumulatorSnapshot,
  input: {
    readonly text?: string | null;
    readonly reasoningText?: string | null;
    readonly finishReason?: NimiFinishReason | string;
    readonly usage?: NimiUsage;
    readonly traceId?: string;
  } = {},
): NimiConversationTextAccumulatorSnapshot {
  return {
    ...snapshot,
    text: normalizeText(input.text) || snapshot.text,
    reasoningText: normalizeText(input.reasoningText) || snapshot.reasoningText,
    terminal: 'completed',
    finishReason: input.finishReason,
    usage: input.usage,
    traceId: input.traceId ?? snapshot.traceId,
  };
}

export function failNimiConversationText(
  snapshot: NimiConversationTextAccumulatorSnapshot,
  input: {
    readonly error: unknown;
    readonly text?: string | null;
    readonly reasoningText?: string | null;
    readonly finishReason?: NimiFinishReason | string;
    readonly usage?: NimiUsage;
    readonly traceId?: string;
  },
): NimiConversationTextAccumulatorSnapshot {
  return {
    ...snapshot,
    text: normalizeText(input.text) || snapshot.text,
    reasoningText: normalizeText(input.reasoningText) || snapshot.reasoningText,
    terminal: 'failed',
    finishReason: input.finishReason,
    usage: input.usage,
    traceId: input.traceId ?? snapshot.traceId,
    error: input.error,
  };
}

export async function assembleNimiConversationRunStream(
  stream: AsyncIterable<NimiRunEvent>,
): Promise<NimiConversationTextAccumulatorSnapshot> {
  let snapshot = createNimiConversationTextAccumulator();
  for await (const event of stream) {
    if (event.type === 'start') {
      snapshot = { ...snapshot, traceId: event.traceId ?? snapshot.traceId };
    } else if (event.type === 'text-delta') {
      snapshot = appendNimiConversationTextDelta(snapshot, event.text);
    } else if (event.type === 'reasoning-delta') {
      snapshot = appendNimiConversationReasoningDelta(snapshot, event.text);
    } else if (event.type === 'done') {
      snapshot = completeNimiConversationText(snapshot, {
        finishReason: event.finishReason,
        usage: event.usage,
      });
    } else if (event.type === 'error') {
      snapshot = failNimiConversationText(snapshot, { error: event });
    }
  }
  return snapshot;
}

export function estimateNimiConversationTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

export function estimateNimiConversationMessageChars(
  message: Pick<NimiConversationMessage, 'text'> & { readonly name?: string | null },
): number {
  return normalizeText(message.text).length + normalizeText(message.name).length + 16;
}

export function estimateNimiConversationTokenEstimateFromChars(charCount: number): number {
  return Math.ceil(Math.max(0, charCount) / 4);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isNimiConversationRole(role: string): role is NimiConversationMessage['role'] {
  return CONVERSATION_HISTORY_ROLES.has(role);
}
