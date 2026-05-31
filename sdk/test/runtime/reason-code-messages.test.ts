import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRuntimeReasonCodeDefaultMessage,
  getRuntimeReasonCodeMessage,
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
