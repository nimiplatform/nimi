import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

import { toChatAgentRuntimeError } from '../src/shell/renderer/features/chat/chat-agent-runtime.js';
import { toChatAiRuntimeError } from '../src/shell/renderer/features/chat/chat-ai-runtime.js';

test('chat runtime error message prefers reason-code copy over raw action hints', () => {
  const timeoutError = createNimiError({
    message: 'retry stream request',
    reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
    actionHint: 'retry stream request',
    source: 'runtime',
  });

  assert.deepEqual(toChatAiRuntimeError(timeoutError), {
    code: ReasonCode.AI_PROVIDER_TIMEOUT,
    message: 'AI provider request timed out.',
  });

  const brokenStreamError = createNimiError({
    message: 'retry stream request',
    reasonCode: ReasonCode.AI_STREAM_BROKEN,
    actionHint: 'retry stream request',
    source: 'runtime',
  });

  assert.deepEqual(toChatAgentRuntimeError(brokenStreamError), {
    code: ReasonCode.AI_STREAM_BROKEN,
    message: 'AI streaming response was interrupted.',
  });
});

test('chat runtime error message keeps readable provider messages when present', () => {
  const error = createNimiError({
    message: 'Upstream provider rejected the request body.',
    reasonCode: ReasonCode.AI_PROVIDER_INTERNAL,
    actionHint: 'retry stream request',
    source: 'runtime',
  });

  assert.deepEqual(toChatAiRuntimeError(error), {
    code: ReasonCode.AI_PROVIDER_INTERNAL,
    message: 'Upstream provider rejected the request body.',
  });
});
