import assert from 'node:assert/strict';
import test from 'node:test';

import { isNimiLocalAppAgentSelectorMismatchError } from './local-app-agent-selector-error.js';

test('Local App selector mismatch accepts the exact Electron wrapped Conversation miss', () => {
  assert.equal(isNimiLocalAppAgentSelectorMismatchError(Object.assign(
    new Error(
      'Electron Runtime endpoint is unavailable for nimi.shell.runtime.unary: '
      + '5 NOT_FOUND: local-app conversation resource not found',
    ),
    {
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-endpoint-unavailable',
      details: {
        cause: '5 NOT_FOUND: local-app conversation resource not found',
      },
    },
  )), true);
});

test('Local App selector mismatch accepts the canonical access-denied reason', () => {
  assert.equal(isNimiLocalAppAgentSelectorMismatchError(Object.assign(
    new Error('selector mismatch'),
    { reasonCode: 'LOCAL_APP_ACCESS_DENIED' },
  )), true);
});

test('Local App selector mismatch accepts the exact normalized Tauri Conversation miss', () => {
  assert.equal(isNimiLocalAppAgentSelectorMismatchError(Object.assign(
    new Error(JSON.stringify({
      reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
      actionHint: 'check_request_and_app_auth',
      message: 'local-app conversation resource not found',
      retryable: false,
      traceId: '',
    })),
    {
      code: 'RUNTIME_GRPC_NOT_FOUND',
      reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
    },
  )), true);
});

test('Local App selector mismatch does not hide unrelated NotFound or owner failures', () => {
  for (const error of [
    Object.assign(new Error('5 NOT_FOUND: local-app conversation owner not found'), { code: 5 }),
    Object.assign(new Error('local-app conversation resource not found'), { code: 'UNAVAILABLE' }),
    Object.assign(new Error(JSON.stringify({
      reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
      message: 'local-app conversation owner not found',
    })), {
      code: 'RUNTIME_GRPC_NOT_FOUND',
      reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
    }),
    Object.assign(new Error('unrelated resource not found'), {
      code: 'RUNTIME_GRPC_NOT_FOUND',
      reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
    }),
    Object.assign(new Error('owner unavailable'), { reasonCode: 'LOCAL_APP_OWNER_UNAVAILABLE' }),
  ]) {
    assert.equal(isNimiLocalAppAgentSelectorMismatchError(error), false);
  }
});
