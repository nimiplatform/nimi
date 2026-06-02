import {
  APP_AI_SESSION_COMPLETION_RESERVE,
  APP_AI_SESSION_HISTORY_BUDGET,
  buildAppAiHistoryWindow,
  estimateAppAiHistoryMessageChars,
  estimateAppAiHistoryTokenCountFromChars,
  measureAppAiHistoryWindowBudget,
  type AppAiHistoryTokenCounter,
  type AppAiHistoryWindowBudget,
  type AppAiHistoryWindowResult,
} from '@nimiplatform/kit/core/sdk-contract';
import type { ConversationTurnHistoryMessage } from './contracts.js';

export type ConversationTokenCounter = AppAiHistoryTokenCounter<ConversationTurnHistoryMessage>;
export type ConversationHistoryBudget = AppAiHistoryWindowBudget;
export type ConversationHistoryWindowResult =
  AppAiHistoryWindowResult<ConversationTurnHistoryMessage>;

export const SIMPLE_AI_HISTORY_BUDGET = APP_AI_SESSION_HISTORY_BUDGET;
export const SIMPLE_AI_COMPLETION_RESERVE = APP_AI_SESSION_COMPLETION_RESERVE;
export const estimateConversationMessageChars = estimateAppAiHistoryMessageChars;
export const estimateConversationTokenCountFromChars = estimateAppAiHistoryTokenCountFromChars;
export const measureConversationHistoryBudget = measureAppAiHistoryWindowBudget;
export const buildConversationHistoryWindow = buildAppAiHistoryWindow<
  ConversationTurnHistoryMessage
>;
