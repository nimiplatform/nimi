import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import { realmDataErrorDiagnosticDetails, resolveRealmDataErrorLogLevel } from '../src/shell/renderer/infra/realm/realm-api-log-level';

test('mediated Realm diagnostics retain status and account reason without remote content', () => {
  assert.deepEqual(realmDataErrorDiagnosticDetails({ details: {
    httpStatus: 503,
    accountReasonCode: 'BROKER_REALM_UNAVAILABLE',
    errorMessage: 'remote content must not be copied',
    requestJson: 'private request content',
  } }), { httpStatus: 503, accountReasonCode: 'BROKER_REALM_UNAVAILABLE' });
  assert.deepEqual(realmDataErrorDiagnosticDetails({ details: { httpStatus: 0 } }), { httpStatus: 0 });
});

test('absent or malformed diagnostic details do not become an HTTP status or log payload', () => {
  for (const error of [null, new Error('unavailable'), { details: [] }, { details: 'remote text' },
    { details: { httpStatus: '503', accountReasonCode: 'reason\nprivate content' } },
    { details: { httpStatus: 999, accountReasonCode: 'x'.repeat(100) } },
    { details: { httpStatus: 200.5 } }]) {
    assert.deepEqual(realmDataErrorDiagnosticDetails(error), {});
  }
});

test('current-user authorization denial is an expected deferred bootstrap state', () => {
  assert.equal(resolveRealmDataErrorLogLevel({
    action: 'load-current-user',
    reasonCode: ReasonCode.APP_AUTHORIZATION_DENIED,
    realmOffline: false,
    runtimeOffline: false,
  }), 'warn');
});

test('current-user product admission gaps are configuration errors', () => {
  assert.equal(resolveRealmDataErrorLogLevel({
    action: 'load-current-user',
    reasonCode: 'SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED',
    realmOffline: false,
    runtimeOffline: false,
  }), 'error');
});

test('product admission gaps remain errors for Realm projections', () => {
  assert.equal(resolveRealmDataErrorLogLevel({
    action: 'load-social-snapshot',
    reasonCode: 'SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED',
    realmOffline: false,
    runtimeOffline: false,
  }), 'error');
});

test('authorization denial outside the current-user bootstrap probe remains an error', () => {
  assert.equal(resolveRealmDataErrorLogLevel({
    action: 'load-world-identity',
    reasonCode: ReasonCode.APP_AUTHORIZATION_DENIED,
    realmOffline: false,
    runtimeOffline: false,
  }), 'error');
});

test('offline Realm and Runtime failures remain typed warnings', () => {
  assert.equal(resolveRealmDataErrorLogLevel({
    action: 'load-current-user',
    reasonCode: ReasonCode.REALM_UNAVAILABLE,
    realmOffline: true,
    runtimeOffline: false,
  }), 'warn');
});
