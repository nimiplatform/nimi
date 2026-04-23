import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';

import { toChatAgentRuntimeError } from '../src/shell/renderer/features/chat/chat-agent-runtime.js';
import { toChatAiRuntimeError } from '../src/shell/renderer/features/chat/chat-nimi-runtime.js';

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

test('chat runtime error message maps local speech bundle reasons to user-facing copy', () => {
  const speechError = createNimiError({
    message: 'runtime call failed',
    reasonCode: ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED,
    actionHint: 'confirm_download',
    source: 'runtime',
  });

  assert.deepEqual(toChatAiRuntimeError(speechError), {
    code: ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED,
    message: 'Local Speech requires explicit download confirmation before continuing.',
  });

  const degradedSpeechError = createNimiError({
    message: 'runtime call failed',
    reasonCode: ReasonCode.AI_LOCAL_SPEECH_BUNDLE_DEGRADED,
    actionHint: 'repair_local_speech',
    source: 'runtime',
  });

  assert.deepEqual(toChatAgentRuntimeError(degradedSpeechError), {
    code: ReasonCode.AI_LOCAL_SPEECH_BUNDLE_DEGRADED,
    message: 'Local Speech is degraded and must be repaired before continuing.',
  });
});
