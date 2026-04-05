import type { ConversationTurnHistoryMessage } from './contracts.js';

export type ConversationTokenCounter = (
  messages: readonly ConversationTurnHistoryMessage[],
) => number;

export type ConversationHistoryBudget = {
  maxMessages: number;
  maxChars: number;
  maxTokens?: number | null;
};

export type ConversationHistoryWindowResult = {
  messages: readonly ConversationTurnHistoryMessage[];
  trimmedCount: number;
  includedChars: number;
  includedTokens: number | null;
};

export const SIMPLE_AI_HISTORY_BUDGET: ConversationHistoryBudget = {
  maxMessages: 32,
  maxChars: 24_000,
  maxTokens: 6_000,
};

export const SIMPLE_AI_COMPLETION_RESERVE = {
  maxChars: 6_000,
  maxTokens: 2_000,
} as const;

export function estimateConversationMessageChars(
  message: Pick<ConversationTurnHistoryMessage, 'text' | 'name'>,
): number {
  const textChars = normalizeText(message.text).length;
  const nameChars = normalizeText(message.name).length;
  return textChars + nameChars + 16;
}

export function estimateConversationTokenCountFromChars(charCount: number): number {
  return Math.ceil(Math.max(0, charCount) / 4);
}

export function measureConversationHistoryBudget(
  messages: readonly ConversationTurnHistoryMessage[],
  countTokens?: ConversationTokenCounter,
): { chars: number; tokens: number | null } {
  const chars = messages.reduce((total, message) => total + estimateConversationMessageChars(message), 0);
  if (!countTokens) {
    return {
      chars,
      tokens: null,
    };
  }
  return {
    chars,
    tokens: countTokens(messages),
  };
}

export function buildConversationHistoryWindow(input: {
  history: readonly ConversationTurnHistoryMessage[];
  budget?: Partial<ConversationHistoryBudget>;
  countTokens?: ConversationTokenCounter;
}): ConversationHistoryWindowResult {
  const budget: ConversationHistoryBudget = {
    ...SIMPLE_AI_HISTORY_BUDGET,
    ...(input.budget || {}),
  };
  const normalizedHistory = input.history.filter((message) => normalizeText(message.text).length > 0);
  const selected: ConversationTurnHistoryMessage[] = [];
  let includedChars = 0;
  let includedTokens: number | null = input.countTokens ? 0 : null;

  for (let index = normalizedHistory.length - 1; index >= 0; index -= 1) {
    if (selected.length >= budget.maxMessages) {
      break;
    }
    const nextMessage = normalizedHistory[index];
    if (!nextMessage) {
      continue;
    }
    const nextChars = includedChars + estimateConversationMessageChars(nextMessage);
    if (nextChars > budget.maxChars) {
      continue;
    }
    const nextMessages = [nextMessage, ...selected];
    if (input.countTokens && budget.maxTokens != null) {
      const nextTokens = input.countTokens(nextMessages);
      if (nextTokens > budget.maxTokens) {
        continue;
      }
      includedTokens = nextTokens;
    }
    selected.unshift(nextMessage);
    includedChars = nextChars;
  }

  return {
    messages: selected,
    trimmedCount: normalizedHistory.length - selected.length,
    includedChars,
    includedTokens,
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
