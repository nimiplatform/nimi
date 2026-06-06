import {
  NIMI_CONVERSATION_SESSION_COMPLETION_RESERVE,
  NIMI_CONVERSATION_SESSION_HISTORY_BUDGET,
  buildNimiConversationHistoryWindowResult,
  estimateNimiConversationMessageChars,
  estimateNimiConversationTokenEstimateFromChars,
  measureNimiConversationHistoryWindow,
  type NimiConversationHistoryBudget,
  type NimiConversationHistoryTokenCounter,
  type NimiConversationHistoryWindowResult,
} from '@nimiplatform/kit/core/sdk-contract';
import type { ConversationTurnHistoryMessage } from './contracts.js';

export type ConversationTokenCounter = NimiConversationHistoryTokenCounter<ConversationTurnHistoryMessage>;
export type ConversationHistoryBudget = NimiConversationHistoryBudget & {
  readonly maxTokens?: number | null;
};
export type ConversationHistoryWindowResult = Omit<
  NimiConversationHistoryWindowResult<ConversationTurnHistoryMessage>,
  'includedTokenEstimate'
> & {
  readonly includedTokens: number | null;
};

export const SIMPLE_AI_HISTORY_BUDGET = {
  ...NIMI_CONVERSATION_SESSION_HISTORY_BUDGET,
  maxTokens: NIMI_CONVERSATION_SESSION_HISTORY_BUDGET.maxTokenEstimate,
} as const;
export const SIMPLE_AI_COMPLETION_RESERVE = {
  tokenEstimate: NIMI_CONVERSATION_SESSION_COMPLETION_RESERVE.tokenEstimate,
  maxTokens: NIMI_CONVERSATION_SESSION_COMPLETION_RESERVE.tokenEstimate,
} as const;
export const estimateConversationMessageChars = estimateNimiConversationMessageChars;
export const estimateConversationTokenCountFromChars = estimateNimiConversationTokenEstimateFromChars;
export const measureConversationHistoryBudget = measureNimiConversationHistoryWindow;

export function buildConversationHistoryWindow(input: {
  readonly history: readonly ConversationTurnHistoryMessage[];
  readonly budget?: Partial<ConversationHistoryBudget>;
  readonly countTokens?: ConversationTokenCounter;
}): ConversationHistoryWindowResult {
  const result = buildNimiConversationHistoryWindowResult({
    history: input.history,
    budget: toNimiConversationBudget(input.budget),
    countTokens: input.countTokens,
  });
  return {
    messages: result.messages,
    trimmedCount: result.trimmedCount,
    includedChars: result.includedChars,
    includedTokens: result.includedTokenEstimate,
  };
}

function toNimiConversationBudget(
  budget: Partial<ConversationHistoryBudget> | undefined,
): Partial<NimiConversationHistoryBudget> | undefined {
  if (!budget) {
    return undefined;
  }
  const { maxTokens, ...rest } = budget;
  return {
    ...rest,
    maxTokenEstimate: budget.maxTokenEstimate ?? maxTokens ?? undefined,
  };
}
