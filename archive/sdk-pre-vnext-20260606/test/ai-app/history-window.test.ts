import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APP_AI_SESSION_HISTORY_BUDGET,
  buildAppAiHistoryWindow,
  estimateAppAiHistoryTokenCountFromChars,
  measureAppAiHistoryWindowBudget,
} from '../../src/ai-app/index.js';

type MingMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  name?: string | null;
};

test('app AI history window trims newest-first without inventing history', () => {
  const history: MingMessage[] = [
    { id: '1', role: 'user', text: 'a'.repeat(120) },
    { id: '2', role: 'assistant', text: 'short-2' },
    { id: '3', role: 'tool', text: 'short-3', name: 'view_state' },
  ];

  const result = buildAppAiHistoryWindow({
    history,
    budget: {
      ...APP_AI_SESSION_HISTORY_BUDGET,
      maxMessages: 3,
      maxChars: 80,
    },
  });

  assert.deepEqual(result.messages.map((message) => message.id), ['2', '3']);
  assert.equal(result.trimmedCount, 1);
  assert.equal(result.includedTokens, null);
});

test('app AI history window honors caller-owned token counters', () => {
  const history: MingMessage[] = [
    { id: '1', role: 'user', text: 'ministry report' },
    { id: '2', role: 'assistant', text: 'policy options' },
    { id: '3', role: 'user', text: 'pick one' },
  ];

  const result = buildAppAiHistoryWindow({
    history,
    budget: {
      maxMessages: 3,
      maxChars: 1_000,
      maxTokens: 5,
    },
    countTokens: (messages) => messages.reduce((total, message) => total + message.text.split(' ').length, 0),
  });

  assert.deepEqual(result.messages.map((message) => message.id), ['2', '3']);
  assert.equal(result.includedTokens, 4);
});

test('app AI history budget measurement is deterministic and non-authoritative', () => {
  const history: MingMessage[] = [
    { id: '1', role: 'user', text: 'abcd', name: 'u' },
    { id: '2', role: 'assistant', text: 'efgh' },
  ];

  const measured = measureAppAiHistoryWindowBudget(history);

  assert.equal(measured.chars, 41);
  assert.equal(measured.tokens, null);
  assert.equal(estimateAppAiHistoryTokenCountFromChars(9), 3);
});
