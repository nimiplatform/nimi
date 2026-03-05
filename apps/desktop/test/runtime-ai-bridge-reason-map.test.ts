import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  extractRuntimeReasonCode,
  toLocalAiReasonCode,
} from '../src/runtime/llm-adapter/execution/runtime-ai-bridge';

test('runtime ai bridge keeps model-not-found reason distinguishable', () => {
  const mapped = toLocalAiReasonCode({
    reasonCode: 'AI_MODEL_NOT_FOUND',
    actionHint: 'switch_model',
    traceId: 'trace-1',
    retryable: false,
    source: 'runtime',
  });
  assert.equal(mapped, ReasonCode.AI_MODEL_NOT_FOUND);
});

test('runtime ai bridge maps modality and media option numeric reason codes', () => {
  assert.equal(extractRuntimeReasonCode(new Error('rpc error reason=351')), 'AI_MODALITY_NOT_SUPPORTED');
  assert.equal(extractRuntimeReasonCode(new Error('rpc error reason=411')), 'AI_MEDIA_OPTION_UNSUPPORTED');
});

test('runtime ai bridge keeps media-option reason distinguishable', () => {
  const mapped = toLocalAiReasonCode({
    reasonCode: 'AI_MEDIA_OPTION_UNSUPPORTED',
    actionHint: 'adjust_tts_voice_or_audio_options',
    traceId: 'trace-2',
    retryable: false,
    source: 'runtime',
  });
  assert.equal(mapped, ReasonCode.AI_MEDIA_OPTION_UNSUPPORTED);
});

test('runtime ai bridge no longer collapses AI_INPUT_INVALID to LOCAL_AI_CAPABILITY_MISSING', () => {
  const mapped = toLocalAiReasonCode({
    reasonCode: 'AI_INPUT_INVALID',
    actionHint: 'check_tts_input_and_extensions',
    traceId: 'trace-3',
    retryable: false,
    source: 'runtime',
  });
  assert.equal(mapped, ReasonCode.AI_INPUT_INVALID);
});
