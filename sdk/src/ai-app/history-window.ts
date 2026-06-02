export type AppAiHistoryWindowMessage = {
  text: string;
  name?: string | null;
};

export type AppAiHistoryTokenCounter<TMessage extends AppAiHistoryWindowMessage = AppAiHistoryWindowMessage> = (
  messages: readonly TMessage[],
) => number;

export type AppAiHistoryWindowBudget = {
  maxMessages: number;
  maxChars: number;
  maxTokens?: number | null;
};

export type AppAiHistoryWindowResult<TMessage extends AppAiHistoryWindowMessage = AppAiHistoryWindowMessage> = {
  messages: readonly TMessage[];
  trimmedCount: number;
  includedChars: number;
  includedTokens: number | null;
};

export const APP_AI_SESSION_HISTORY_BUDGET: AppAiHistoryWindowBudget = {
  maxMessages: 32,
  maxChars: 24_000,
  maxTokens: 6_000,
};

export const APP_AI_SESSION_COMPLETION_RESERVE = {
  maxChars: 6_000,
  maxTokens: 2_000,
} as const;

export function estimateAppAiHistoryMessageChars(
  message: Pick<AppAiHistoryWindowMessage, 'text' | 'name'>,
): number {
  const textChars = normalizeText(message.text).length;
  const nameChars = normalizeText(message.name).length;
  return textChars + nameChars + 16;
}

export function estimateAppAiHistoryTokenCountFromChars(charCount: number): number {
  return Math.ceil(Math.max(0, charCount) / 4);
}

export function measureAppAiHistoryWindowBudget<TMessage extends AppAiHistoryWindowMessage>(
  messages: readonly TMessage[],
  countTokens?: AppAiHistoryTokenCounter<TMessage>,
): { chars: number; tokens: number | null } {
  const chars = messages.reduce((total, message) => total + estimateAppAiHistoryMessageChars(message), 0);
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

export function buildAppAiHistoryWindow<TMessage extends AppAiHistoryWindowMessage>(input: {
  history: readonly TMessage[];
  budget?: Partial<AppAiHistoryWindowBudget>;
  countTokens?: AppAiHistoryTokenCounter<TMessage>;
}): AppAiHistoryWindowResult<TMessage> {
  const budget: AppAiHistoryWindowBudget = {
    ...APP_AI_SESSION_HISTORY_BUDGET,
    ...(input.budget || {}),
  };
  const normalizedHistory = input.history.filter((message) => normalizeText(message.text).length > 0);
  const selected: TMessage[] = [];
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
    const nextChars = includedChars + estimateAppAiHistoryMessageChars(nextMessage);
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
