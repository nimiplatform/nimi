import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changeLocale,
  i18n,
  initI18n,
} from '../src/shell/renderer/i18n/index.js';
import {
  projectChatContextCapacityFailure,
  toChatUserFacingRuntimeError,
} from '../src/shell/renderer/features/chat/chat-runtime-error-message.js';

test.before(async () => {
  await initI18n();
  await changeLocale('en');
});

test('Agent Chat projects context capacity failure into actionable configuration copy', () => {
  const internal = new Error(
    'context_capacity_exceeded: required=13820 available=2304 required_window=15612 current_window=4096 blocking_lane=source_identity',
  );
  const error = new Error('Agent response failed', { cause: internal });

  assert.deepEqual(projectChatContextCapacityFailure(error), {
    requiredInputTokens: 13820,
    availableInputTokens: 2304,
    requiredWindowTokens: 15612,
    currentWindowTokens: 4096,
  });
  const projected = toChatUserFacingRuntimeError(error, 'Agent response failed', i18n.t);
  assert.equal(projected.code, 'AI_CONFIG_INVALID');
  assert.match(projected.message, /4096-token context/u);
  assert.match(projected.message, /at least 15612/u);
  assert.match(projected.message, /Automatic/u);
  assert.doesNotMatch(projected.message, /source_identity|AI_OUTPUT_INVALID/u);
});
