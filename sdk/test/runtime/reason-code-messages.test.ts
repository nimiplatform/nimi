import assert from 'node:assert/strict';
import test from 'node:test';

import {
  asRuntimeCallNimiError,
  extractRuntimeReasonCodeFromError,
  formatRuntimeNimiErrorBanner,
  formatRuntimeNimiErrorDetail,
  getRuntimeReasonCodeDefaultMessage,
  getRuntimeReasonCodeMessage,
  mapRuntimeErrorToLocalAiReasonCode,
  mapRuntimeReasonCodeToLocalAiReasonCode,
  normalizeRuntimeReasonCode,
  RUNTIME_REASON_CODE_MESSAGE_MAP,
  toRuntimeUserFacingError,
} from '../../src/runtime/reason-code-messages.js';
import { createNimiError } from '../../src/core/errors.js';
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

test('runtime error presentation prefers reason-code copy over raw action hints', () => {
  const timeoutError = createNimiError({
    message: 'retry stream request',
    reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
    actionHint: 'retry stream request',
    source: 'runtime',
  });

  assert.deepEqual(toRuntimeUserFacingError(timeoutError, {
    fallbackMessage: 'AI response failed',
  }), {
    code: ReasonCode.AI_PROVIDER_TIMEOUT,
    message: 'AI provider request timed out.',
  });

  const brokenStreamError = createNimiError({
    message: 'retry stream request',
    reasonCode: ReasonCode.AI_STREAM_BROKEN,
    actionHint: 'retry stream request',
    source: 'runtime',
  });

  assert.deepEqual(toRuntimeUserFacingError(brokenStreamError, {
    fallbackMessage: 'Agent response failed',
  }), {
    code: ReasonCode.AI_STREAM_BROKEN,
    message: 'AI streaming response was interrupted.',
  });
});

test('runtime error presentation keeps readable provider messages when present', () => {
  const error = createNimiError({
    message: 'Upstream provider rejected the request body.',
    reasonCode: ReasonCode.AI_PROVIDER_INTERNAL,
    actionHint: 'retry stream request',
    source: 'runtime',
  });

  assert.deepEqual(toRuntimeUserFacingError(error, {
    fallbackMessage: 'AI response failed',
  }), {
    code: ReasonCode.AI_PROVIDER_INTERNAL,
    message: 'Upstream provider rejected the request body.',
  });
});

test('runtime error presentation maps local speech bundle reasons to user-facing copy', () => {
  const speechError = createNimiError({
    message: 'runtime call failed',
    reasonCode: ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED,
    actionHint: 'confirm_download',
    source: 'runtime',
  });

  assert.deepEqual(toRuntimeUserFacingError(speechError, {
    fallbackMessage: 'AI response failed',
  }), {
    code: ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED,
    message: 'Local Speech requires explicit download confirmation before continuing.',
  });

  const degradedSpeechError = createNimiError({
    message: 'runtime call failed',
    reasonCode: ReasonCode.AI_LOCAL_SPEECH_BUNDLE_DEGRADED,
    actionHint: 'repair_local_speech',
    source: 'runtime',
  });

  assert.deepEqual(toRuntimeUserFacingError(degradedSpeechError, {
    fallbackMessage: 'Agent response failed',
  }), {
    code: ReasonCode.AI_LOCAL_SPEECH_BUNDLE_DEGRADED,
    message: 'Local Speech is degraded and must be repaired before continuing.',
  });
});

test('runtime error presentation accepts app-local translated reason-code copy', () => {
  const error = createNimiError({
    message: 'runtime call failed',
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    actionHint: 'retry_runtime',
    source: 'runtime',
  });

  assert.deepEqual(toRuntimeUserFacingError(error, {
    fallbackMessage: 'AI response failed',
    resolveReasonCodeMessage: (reasonCode, defaultMessage) => (
      reasonCode === ReasonCode.RUNTIME_UNAVAILABLE ? 'Runtime translated.' : defaultMessage
    ),
  }), {
    code: ReasonCode.RUNTIME_UNAVAILABLE,
    message: 'Runtime translated.',
  });
});

test('runtime error detail formatting preserves reason code and trace id', () => {
  const structured = createNimiError({
    message: 'socket hang up',
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: 'retry_runtime_call',
    traceId: 'trace-runtime-1',
    source: 'runtime',
  });

  assert.equal(
    formatRuntimeNimiErrorDetail(structured),
    'socket hang up (reasonCode=RUNTIME_CALL_FAILED, traceId=trace-runtime-1)',
  );
  assert.equal(
    formatRuntimeNimiErrorBanner('Connector test failed', structured),
    'Connector test failed: socket hang up (reasonCode=RUNTIME_CALL_FAILED, traceId=trace-runtime-1)',
  );
});

test('runtime call error normalization preserves SDK NimiError and defaults opaque failures', () => {
  const sdkError = createNimiError({
    message: 'already normalized',
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    actionHint: 'retry_runtime',
    source: 'runtime',
  });

  assert.equal(asRuntimeCallNimiError(sdkError), sdkError);
  assert.equal(
    asRuntimeCallNimiError(new Error('plain transport failure')).reasonCode,
    ReasonCode.RUNTIME_CALL_FAILED,
  );
});
