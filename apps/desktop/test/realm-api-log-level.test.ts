import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import { resolveRealmDataErrorLogLevel } from '../src/shell/renderer/infra/realm/realm-api-log-level';

test('current-user authorization denial is an expected deferred bootstrap state', () => {
  assert.equal(resolveRealmDataErrorLogLevel({
    action: 'load-current-user',
    reasonCode: ReasonCode.APP_AUTHORIZATION_DENIED,
    realmOffline: false,
    runtimeOffline: false,
  }), 'warn');
});

test('current-user source-readiness admission gap is an expected deferred bootstrap state', () => {
  assert.equal(resolveRealmDataErrorLogLevel({
    action: 'load-current-user',
    reasonCode: 'SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED',
    realmOffline: false,
    runtimeOffline: false,
  }), 'warn');
});

test('source-readiness admission gaps remain warnings for deferred Realm projections', () => {
  assert.equal(resolveRealmDataErrorLogLevel({
    action: 'load-social-snapshot',
    reasonCode: 'SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED',
    realmOffline: false,
    runtimeOffline: false,
  }), 'warn');
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
