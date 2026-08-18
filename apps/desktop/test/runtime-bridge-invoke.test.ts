import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import { toBridgeNimiError } from '../src/shell/renderer/bridge/runtime-bridge/invoke';

test('toBridgeNimiError maps LOCAL_LIFECYCLE_WRITE_DENIED reason code', () => {
  const error = toBridgeNimiError(new Error('LOCAL_LIFECYCLE_WRITE_DENIED: caller=sideload'));
  assert.equal(error.reasonCode, 'LOCAL_LIFECYCLE_WRITE_DENIED');
  assert.equal(error.message, 'LOCAL_LIFECYCLE_WRITE_DENIED: caller=sideload');
  assert.equal(
    String(error.details?.userMessage || ''),
    'The current source is not allowed to perform local model lifecycle writes.',
  );
});

test('toBridgeNimiError keeps generic fallback for unknown runtime reason', () => {
  const error = toBridgeNimiError(new Error('SOME_UNKNOWN_RUNTIME_REASON'));
  assert.equal(error.message, 'SOME_UNKNOWN_RUNTIME_REASON');
  assert.equal(
    String(error.details?.userMessage || ''),
    'Operation failed. Please try again later.',
  );
});

test('toBridgeNimiError preserves structured payload fields and adds userMessage', () => {
  const error = toBridgeNimiError(JSON.stringify({
    reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
    actionHint: 'retry_after_runtime_recovery',
    traceId: 'trace-bridge-001',
    retryable: true,
    message: 'provider timeout',
  }));
  assert.equal(error.reasonCode, ReasonCode.AI_PROVIDER_TIMEOUT);
  assert.equal(error.actionHint, 'retry_after_runtime_recovery');
  assert.equal(error.traceId, 'trace-bridge-001');
  assert.equal(error.retryable, true);
  assert.equal(error.message, 'provider timeout');
  assert.equal(
    String(error.details?.userMessage || ''),
    'AI provider request timed out.',
  );
});

test('toBridgeNimiError maps DESKTOP_HTTP_METHOD_INVALID reason code', () => {
  const error = toBridgeNimiError(JSON.stringify({
    reasonCode: 'DESKTOP_HTTP_METHOD_INVALID',
    message: 'unsupported request method: TRACE',
  }));
  assert.equal(error.reasonCode, 'DESKTOP_HTTP_METHOD_INVALID');
  assert.equal(
    String(error.details?.userMessage || ''),
    'Unsupported request method. Please review the request configuration.',
  );
});

test('toBridgeNimiError maps DESKTOP_HTTP_URL_SCHEME_INVALID reason code', () => {
  const error = toBridgeNimiError(JSON.stringify({
    reasonCode: 'DESKTOP_HTTP_URL_SCHEME_INVALID',
    message: 'unsupported URL scheme: ftp',
  }));
  assert.equal(error.reasonCode, 'DESKTOP_HTTP_URL_SCHEME_INVALID');
  assert.equal(
    String(error.details?.userMessage || ''),
    'Invalid request URL. Please review the configuration.',
  );
});

test('toBridgeNimiError maps DESKTOP_HTTP_PAYLOAD_INVALID reason code', () => {
  const error = toBridgeNimiError(JSON.stringify({
    reasonCode: 'DESKTOP_HTTP_PAYLOAD_INVALID',
    message: 'proxyHttp payload must be an object',
  }));
  assert.equal(error.reasonCode, 'DESKTOP_HTTP_PAYLOAD_INVALID');
  assert.equal(
    String(error.details?.userMessage || ''),
    'Request payload is invalid. Please try again.',
  );
});

test('toBridgeNimiError maps DESKTOP_HTTP_FETCH_UNAVAILABLE reason code', () => {
  const error = toBridgeNimiError(JSON.stringify({
    reasonCode: 'DESKTOP_HTTP_FETCH_UNAVAILABLE',
    message: 'native fetch is unavailable in the current environment',
  }));
  assert.equal(error.reasonCode, 'DESKTOP_HTTP_FETCH_UNAVAILABLE');
  assert.equal(
    String(error.details?.userMessage || ''),
    'This feature is not available in the current environment.',
  );
});

test('toBridgeNimiError maps REALM_UNAVAILABLE from desktop http_request send failure', () => {
  const error = toBridgeNimiError(JSON.stringify({
    reasonCode: ReasonCode.REALM_UNAVAILABLE,
    actionHint: 'check_realm_service_status',
    retryable: true,
    message: 'Realm service is unavailable: error sending request for url (http://localhost:3002/api/world)',
  }));
  assert.equal(error.reasonCode, ReasonCode.REALM_UNAVAILABLE);
  assert.equal(error.actionHint, 'check_realm_service_status');
  assert.equal(error.retryable, true);
  assert.equal(
    String(error.details?.userMessage || ''),
    'Realm service is unavailable. Start or repair Realm and try again.',
  );
});

test('toBridgeNimiError maps AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED reason code', () => {
  const error = toBridgeNimiError(JSON.stringify({
    reasonCode: ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED,
    actionHint: 'show_download_confirmation',
    message: 'explicit local speech download confirmation is required',
  }));
  assert.equal(error.reasonCode, ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED);
  assert.equal(error.actionHint, 'show_download_confirmation');
  assert.equal(
    String(error.details?.userMessage || ''),
    'Local Speech requires explicit download confirmation before continuing.',
  );
});

test('toBridgeNimiError maps AI_LOCAL_SPEECH_ENV_INIT_FAILED reason code', () => {
  const error = toBridgeNimiError(JSON.stringify({
    reasonCode: ReasonCode.AI_LOCAL_SPEECH_ENV_INIT_FAILED,
    details: { capability: 'audio.synthesize' },
    message: 'local speech env init failed',
  }));
  assert.equal(error.reasonCode, ReasonCode.AI_LOCAL_SPEECH_ENV_INIT_FAILED);
  assert.equal(
    String(error.details?.userMessage || ''),
    'Runtime local speech environment initialization failed. Inspect Runtime diagnostics.',
  );
});
