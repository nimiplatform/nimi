import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractRuntimeReasonCodeFromError,
  getRuntimeReasonCodeDefaultMessage,
  getRuntimeReasonCodeMessage,
  mapRuntimeErrorToLocalAiReasonCode,
  mapRuntimeReasonCodeToLocalAiReasonCode,
  normalizeRuntimeReasonCode,
  RUNTIME_REASON_CODE_MESSAGE_MAP,
} from '../../src/runtime/reason-code-messages.js';
import { ReasonCode } from '../../src/types/index.js';

test('runtime reason-code message projection exposes stable AI and runtime defaults', () => {
  assert.deepEqual(getRuntimeReasonCodeMessage(ReasonCode.AI_PROVIDER_TIMEOUT), {
    reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
    defaultMessage: 'AI provider request timed out.',
  });
  assert.equal(
    getRuntimeReasonCodeDefaultMessage(ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED),
    'Local Speech requires explicit download confirmation before continuing.',
  );
  assert.equal(
    getRuntimeReasonCodeDefaultMessage(ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE),
    'Runtime daemon is unavailable.',
  );
  assert.equal(
    getRuntimeReasonCodeDefaultMessage('AI_LOCAL_TEMPLATE_NOT_FOUND'),
    'Local AI template was not found.',
  );
});

test('runtime reason-code message projection covers Desktop D-ERR-007 Phase 1 codes', () => {
  const phase1CriticalCodes = [
    ReasonCode.AI_PROVIDER_TIMEOUT,
    ReasonCode.AI_PROVIDER_UNAVAILABLE,
    ReasonCode.AI_STREAM_BROKEN,
    ReasonCode.AI_CONNECTOR_CREDENTIAL_MISSING,
    ReasonCode.AI_MODEL_NOT_FOUND,
    ReasonCode.AI_MEDIA_IDEMPOTENCY_CONFLICT,
    ReasonCode.AI_LOCAL_MODEL_UNAVAILABLE,
    ReasonCode.AUTH_TOKEN_INVALID,
    ReasonCode.SESSION_EXPIRED,
    ReasonCode.RUNTIME_UNAVAILABLE,
  ];

  for (const code of phase1CriticalCodes) {
    assert.ok(
      getRuntimeReasonCodeMessage(code),
      `missing Runtime reason-code message projection for ${code}`,
    );
  }
});

test('runtime reason-code message projection rejects unknown or empty codes', () => {
  assert.equal(getRuntimeReasonCodeMessage(''), null);
  assert.equal(getRuntimeReasonCodeMessage('DESKTOP_HTTP_URL_REQUIRED'), null);
  assert.equal(getRuntimeReasonCodeDefaultMessage('UNKNOWN_REASON'), null);
});

test('runtime reason-code message map keeps Runtime projection lookup immutable by key', () => {
  assert.equal(
    RUNTIME_REASON_CODE_MESSAGE_MAP[ReasonCode.AI_STREAM_BROKEN]?.defaultMessage,
    'AI streaming response was interrupted.',
  );
  assert.equal(
    RUNTIME_REASON_CODE_MESSAGE_MAP[ReasonCode.LOCAL_LIFECYCLE_WRITE_DENIED]?.defaultMessage,
    'The current source is not allowed to perform local model lifecycle writes.',
  );
});

test('runtime reason-code projection normalizes numeric and string enum values', () => {
  assert.equal(normalizeRuntimeReasonCode(351), ReasonCode.AI_MODALITY_NOT_SUPPORTED);
  assert.equal(normalizeRuntimeReasonCode('411'), ReasonCode.AI_MEDIA_OPTION_UNSUPPORTED);
  assert.equal(normalizeRuntimeReasonCode('AI_PROVIDER_TIMEOUT'), ReasonCode.AI_PROVIDER_TIMEOUT);
  assert.equal(normalizeRuntimeReasonCode(0), '');
  assert.equal(normalizeRuntimeReasonCode(''), '');
});

test('runtime reason-code projection extracts structured and message-carried errors', () => {
  assert.equal(
    extractRuntimeReasonCodeFromError({ reasonCode: 561 }),
    ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED,
  );
  assert.equal(
    extractRuntimeReasonCodeFromError(new Error('rpc error reason=351')),
    ReasonCode.AI_MODALITY_NOT_SUPPORTED,
  );
  assert.equal(
    extractRuntimeReasonCodeFromError(new Error('runtime failed: AI_PROVIDER_TIMEOUT')),
    ReasonCode.AI_PROVIDER_TIMEOUT,
  );
  assert.equal(extractRuntimeReasonCodeFromError(new Error('plain failure')), null);
});

test('runtime reason-code projection maps local AI compatibility classes', () => {
  assert.equal(mapRuntimeReasonCodeToLocalAiReasonCode(351), ReasonCode.AI_MODALITY_NOT_SUPPORTED);
  assert.equal(mapRuntimeReasonCodeToLocalAiReasonCode(411), ReasonCode.AI_MEDIA_OPTION_UNSUPPORTED);
  assert.equal(mapRuntimeReasonCodeToLocalAiReasonCode(ReasonCode.AI_MODEL_NOT_READY), ReasonCode.LOCAL_AI_CAPABILITY_MISSING);
  assert.equal(mapRuntimeReasonCodeToLocalAiReasonCode(ReasonCode.AI_PROVIDER_UNAVAILABLE), 'LOCAL_AI_SERVICE_UNREACHABLE');
  assert.equal(mapRuntimeErrorToLocalAiReasonCode(new Error('runtime failed: AI_STREAM_BROKEN')), 'LOCAL_AI_PROVIDER_INTERNAL_ERROR');
  assert.equal(mapRuntimeReasonCodeToLocalAiReasonCode('UNKNOWN_REASON'), null);
});
