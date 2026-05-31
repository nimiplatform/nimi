import assert from 'node:assert/strict';
import test from 'node:test';

import {
  asCatalogHash,
  asExternalPrincipalId,
  asScopeCatalogVersion,
  asScopeName,
  classifyOfflineError,
  classifyOfflineReasonCode,
  isNimiErrorLike,
  isRealmOfflineErrorLike,
  isRuntimeOfflineErrorLike,
  isRealmOfflineReasonCode,
  isRuntimeOfflineReasonCode,
  ReasonCode,
} from '../src/types/index.js';

test('isNimiErrorLike recognizes structured NimiError-shaped objects', () => {
  assert.equal(isNimiErrorLike(new Error('plain error')), false);
  assert.equal(isNimiErrorLike({
    reasonCode: 'TEST_REASON',
    actionHint: 'retry',
    traceId: 'trace-1',
    retryable: false,
    source: 'sdk',
  }), true);
});

test('branded string helpers preserve runtime string values', () => {
  assert.equal(asScopeName('app.test.chat.read'), 'app.test.chat.read');
  assert.equal(asScopeCatalogVersion('1.0.0'), '1.0.0');
  assert.equal(asCatalogHash('hash-1'), 'hash-1');
  assert.equal(asExternalPrincipalId('principal-1'), 'principal-1');
});

test('offline reason-code projections classify Realm and Runtime unavailability', () => {
  assert.equal(isRealmOfflineReasonCode(ReasonCode.REALM_UNAVAILABLE), true);
  assert.equal(isRealmOfflineReasonCode(ReasonCode.REALM_RATE_LIMITED), false);
  assert.equal(isRuntimeOfflineReasonCode(ReasonCode.RUNTIME_UNAVAILABLE), true);
  assert.equal(isRuntimeOfflineReasonCode(ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE), true);
  assert.equal(isRuntimeOfflineReasonCode(ReasonCode.AI_PROVIDER_TIMEOUT), false);
  assert.equal(classifyOfflineReasonCode(ReasonCode.REALM_UNAVAILABLE), 'realm');
  assert.equal(classifyOfflineReasonCode(ReasonCode.RUNTIME_UNAVAILABLE), 'runtime');
  assert.equal(classifyOfflineReasonCode(ReasonCode.AUTH_TOKEN_INVALID), null);
});

test('offline error projections prefer structured ReasonCode over retryable metadata', () => {
  assert.equal(classifyOfflineError({
    reasonCode: ReasonCode.REALM_UNAVAILABLE,
    actionHint: 'retry_realm_request',
    retryable: true,
  }), 'realm');
  assert.equal(classifyOfflineError({
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    actionHint: 'retry_runtime_request',
    retryable: true,
  }), 'runtime');
  assert.equal(classifyOfflineError({
    reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
    actionHint: 'retry_provider_request',
    retryable: true,
  }), null);
  assert.equal(isRealmOfflineErrorLike(new Error('fetch failed'), { transportOwner: 'realm' }), true);
  assert.equal(isRuntimeOfflineErrorLike(new Error('daemon unavailable')), true);
});
