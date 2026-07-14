import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AccountCallerMode,
  AccountReasonCode,
  ReasonCode as RuntimeWireReasonCode,
} from '../../core-generated/runtime-typed-client';
import { ReasonCode } from '../../types';
import { createRuntimeAccountMediatedRealmTransport } from './runtime-account-realm';

test('Runtime-mediated Realm transport delegates unary calls without renderer token custody', async () => {
  const caller = {
    appId: 'nimi.zhiyu',
    appInstanceId: 'nimi.zhiyu.local-first-party',
    deviceId: 'nimi-zhiyu-local-first-party-device',
    mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
    scopes: [],
  };
  const calls: Array<{ readonly request: unknown; readonly options: unknown }> = [];
  const transport = createRuntimeAccountMediatedRealmTransport({
    accountCaller: caller,
    runtime: {
      account: {
        invokeRealmUnary: async (request: unknown, options: unknown) => {
          calls.push({ request, options });
          return {
            accepted: true,
            responseJson: JSON.stringify({ id: 'world-1', name: 'Tang literary world' }),
          };
        },
      },
    },
  });

  const response = await transport.unary({
    methodId: 'WorldPublicController_getWorld',
    body: { path: { worldId: 'world-1' } },
    timeoutMs: 15_000,
  });
  await transport.unary({
    methodId: 'WorldPublicController_getWorld',
    body: { path: { worldId: 'world-1' } },
    timeoutMs: 15_000,
  });

  assert.deepEqual(response, { id: 'world-1', name: 'Tang literary world' });
  assert.deepEqual(calls.map((call) => call.request), [{
    caller,
    methodId: 'WorldPublicController_getWorld',
    realmBaseUrl: '',
    requestJson: JSON.stringify({ path: { worldId: 'world-1' } }),
    timeoutMs: 15_000,
  }, {
    caller,
    methodId: 'WorldPublicController_getWorld',
    realmBaseUrl: '',
    requestJson: JSON.stringify({ path: { worldId: 'world-1' } }),
    timeoutMs: 15_000,
  }]);
  const options = calls[0]?.options as { readonly metadata?: Record<string, string> } | undefined;
  const repeatedOptions = calls[1]?.options as { readonly metadata?: Record<string, string> } | undefined;
  assert.match(options?.metadata?.idempotencyKey ?? '', /^runtime-realm-WorldPublicController_getWorld-[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(options?.metadata?.['x-nimi-idempotency-key'], options?.metadata?.idempotencyKey);
  assert.notEqual(
    repeatedOptions?.metadata?.idempotencyKey,
    options?.metadata?.idempotencyKey,
    'separate Realm broker invocations must not replay authorization across account-session changes',
  );
});

test('Runtime-mediated Realm transport maps upstream failure to typed Realm offline truth', async () => {
  const transport = createRuntimeAccountMediatedRealmTransport({
    accountCaller: {
      appId: 'nimi.zhiyu',
      appInstanceId: 'nimi.zhiyu.local-first-party',
      deviceId: 'desktop-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    },
    runtime: {
      account: {
        invokeRealmUnary: async () => ({
          accepted: false,
          responseJson: '',
          reasonCode: RuntimeWireReasonCode.AI_PROVIDER_UNAVAILABLE,
          accountReasonCode: AccountReasonCode.BROKER_UPSTREAM_FAILED,
          productionInert: false,
          httpStatus: 503,
          errorMessage: 'Realm is offline.',
        }),
      },
    },
  });

  await assert.rejects(
    () => transport.unary({ methodId: 'WorldCoreController_listWorldCores', body: {} }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.REALM_UNAVAILABLE);
      assert.equal((error as { source?: string }).source, 'realm');
      assert.equal((error as { retryable?: boolean }).retryable, true);
      return true;
    },
  );
});

test('Runtime-mediated Realm transport rejects local-app callers before operation admission', () => {
  assert.throws(() => createRuntimeAccountMediatedRealmTransport({
    accountCaller: {
      appId: 'community.nimi.fixture',
      appInstanceId: 'community.nimi.fixture.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      mode: AccountCallerMode.LOCAL_APP,
      scopes: [],
    },
    runtime: {
      account: {
        invokeRealmUnary: async () => ({ accepted: true, responseJson: '{}' }),
      },
    },
  }), {
    reasonCode: 'SDK_RUNTIME_REALM_MEDIATION_CALLER_MODE_FORBIDDEN',
  });
});
