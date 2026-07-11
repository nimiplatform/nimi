import assert from 'node:assert/strict';
import test from 'node:test';

import { AccountCallerMode } from '../../core-generated/runtime-typed-client';
import {
  createRuntimeAccountMediatedRealmTransport,
} from './runtime-account-realm';

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
            responseJson: JSON.stringify({ id: 'world-1', name: '鍞愪唬鏂囦汉涓栫晫' }),
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

  assert.deepEqual(response, { id: 'world-1', name: '鍞愪唬鏂囦汉涓栫晫' });
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
    'separate Realm broker invocations must not replay an authorization result across account-session changes',
  );
});

test('Runtime-mediated Realm transport rejects installed callers before operation admission', () => {
  assert.throws(() => createRuntimeAccountMediatedRealmTransport({
    accountCaller: {
      appId: 'community.nimi.fixture',
      appInstanceId: 'community.nimi.fixture.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      mode: AccountCallerMode.DESKTOP_LAUNCHED_NIMI_APP,
      launchHostId: 'forged-renderer-host',
      launchNonce: 'launch-nonce-1',
      releaseDescriptorRef: 'community.nimi.fixture.0.1.0-sandbox',
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
