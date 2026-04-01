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

test('toBridgeNimiError maps LOCAL_AI_HF_DOWNLOAD_DISK_FULL reason code', () => {
  const error = toBridgeNimiError(new Error('LOCAL_AI_HF_DOWNLOAD_DISK_FULL: no space left on device'));
  assert.equal(error.reasonCode, 'LOCAL_AI_HF_DOWNLOAD_DISK_FULL');
  assert.equal(
    String(error.details?.userMessage || ''),
    'Insufficient disk space. Free up space and try the download again.',
  );
});

test('toBridgeNimiError maps LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_FILE_NAME_INVALID reason code', () => {
  const error = toBridgeNimiError(
    new Error('LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_FILE_NAME_INVALID: unsupported file'),
  );
  assert.equal(error.reasonCode, 'LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_FILE_NAME_INVALID');
  assert.equal(
    String(error.details?.userMessage || ''),
    'Only `asset.manifest.json` manifest files can be imported.',
  );
});

test('toBridgeNimiError maps LOCAL_AI_ARTIFACT_ORPHAN_KIND_INVALID reason code', () => {
  const error = toBridgeNimiError(
    new Error('LOCAL_AI_ARTIFACT_ORPHAN_KIND_INVALID: unsupported kind'),
  );
  assert.equal(error.reasonCode, 'LOCAL_AI_ARTIFACT_ORPHAN_KIND_INVALID');
  assert.equal(
    String(error.details?.userMessage || ''),
    'Please choose a valid dependency asset type.',
  );
});

test('toBridgeNimiError maps LOCAL_AI_ARTIFACT_ORPHAN_NOT_FOUND reason code', () => {
  const error = toBridgeNimiError(
    new Error('LOCAL_AI_ARTIFACT_ORPHAN_NOT_FOUND: file does not exist'),
  );
  assert.equal(error.reasonCode, 'LOCAL_AI_ARTIFACT_ORPHAN_NOT_FOUND');
  assert.equal(
    String(error.details?.userMessage || ''),
    'The dependency asset file to import was not found. Refresh and try again.',
  );
});

test('toBridgeNimiError maps LOCAL_AI_FILE_IMPORT_SYMLINK_FORBIDDEN reason code', () => {
  const error = toBridgeNimiError(
    new Error('LOCAL_AI_FILE_IMPORT_SYMLINK_FORBIDDEN: refusing symbolic link source: /tmp/model.gguf'),
  );
  assert.equal(error.reasonCode, 'LOCAL_AI_FILE_IMPORT_SYMLINK_FORBIDDEN');
  assert.equal(
    String(error.details?.userMessage || ''),
    'Symbolic links are not supported for import. Import the real model file path instead.',
  );
});

test('toBridgeNimiError preserves structured payload fields and adds userMessage', () => {
  const error = toBridgeNimiError(JSON.stringify({
    reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
    actionHint: 'retry_or_switch_route',
    traceId: 'trace-bridge-001',
    retryable: true,
    message: 'provider timeout',
  }));
  assert.equal(error.reasonCode, ReasonCode.AI_PROVIDER_TIMEOUT);
  assert.equal(error.actionHint, 'retry_or_switch_route');
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
