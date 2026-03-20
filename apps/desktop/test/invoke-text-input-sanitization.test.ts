import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeScenarioTextInput } from '../src/runtime/llm-adapter/execution/invoke-text';

test('sanitizeScenarioTextInput trims and normalizes supported prompt text', () => {
  assert.equal(
    sanitizeScenarioTextInput('  hello\r\nworld  ', 'prompt'),
    'hello\nworld',
  );
  assert.equal(
    sanitizeScenarioTextInput('\n system prompt \r\n', 'systemPrompt'),
    'system prompt',
  );
});

test('sanitizeScenarioTextInput rejects empty or control-character prompt text', () => {
  assert.throws(
    () => sanitizeScenarioTextInput('   ', 'prompt'),
    (error: Error & { reasonCode?: string }) => error.reasonCode === 'AI_INPUT_INVALID',
  );
  assert.throws(
    () => sanitizeScenarioTextInput('hello\u0000world', 'prompt'),
    (error: Error & { reasonCode?: string }) => error.reasonCode === 'AI_INPUT_INVALID',
  );
});
