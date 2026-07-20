import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AccountCallerMode,
  AccountReasonCode,
  ReasonCode as RuntimeWireReasonCode,
} from '../../core-generated/runtime-typed-client';
import { ReasonCode } from '../../types';
import { createNimiDesktopLaunchedAvatarRuntimeAccountCaller } from '../../runtime/account-caller';
import {
  createRuntimeAccountMediatedBundledAvatarRealmTransport,
  createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport,
  createRuntimeAccountMediatedRealmTransport,
  NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_IDS,
} from './runtime-account-realm';

test('bundled Avatar Realm transport fixes caller custody and exact operation admission', async () => {
  const caller = createNimiDesktopLaunchedAvatarRuntimeAccountCaller();
  const calls: unknown[] = [];
  const transport = createRuntimeAccountMediatedBundledAvatarRealmTransport({
    accountCaller: caller,
    runtime: {
      account: {
        invokeRealmUnary: async (request: unknown) => {
          calls.push(request);
          return { accepted: true, responseJson: '[]' };
        },
      },
    },
  });

  assert.deepEqual(await transport.unary({
    methodId: 'WorldCoreController_listPersonaCharacters',
    body: { path: {}, query: { scope: 'owned' } },
  }), []);
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as { caller?: unknown }).caller, caller);

  await assert.rejects(
    () => transport.unary({ methodId: 'WorldPublicController_listWorlds', body: {} }),
    { reasonCode: 'SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED' },
  );
  assert.equal(calls.length, 1, 'unadmitted Avatar operation must not reach Runtime');
});

test('bundled Avatar Realm transport rejects renderer-constructed caller variants', () => {
  assert.throws(() => createRuntimeAccountMediatedBundledAvatarRealmTransport({
    accountCaller: {
      ...createNimiDesktopLaunchedAvatarRuntimeAccountCaller(),
      deviceId: 'renderer-selected-device',
    },
    runtime: {
      account: {
        invokeRealmUnary: async () => ({ accepted: true, responseJson: '[]' }),
      },
    },
  }), {
    reasonCode: 'SDK_RUNTIME_REALM_BUNDLED_AVATAR_CALLER_REQUIRED',
  });
});

test('Desktop source-readiness Realm transport delegates admitted unary calls without renderer token custody', async () => {
  const caller = {
    appId: 'nimi.desktop',
    appInstanceId: 'nimi.desktop.local-first-party',
    deviceId: 'desktop-shell',
    mode: AccountCallerMode.DESKTOP_SHELL,
    scopes: [],
  };
  const calls: Array<{ readonly request: unknown; readonly options: unknown }> = [];
  const transport = createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport({
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

test('Desktop source-readiness Realm transport maps upstream failure to typed Realm offline truth', async () => {
  const transport = createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport({
    accountCaller: {
      appId: 'nimi.desktop',
      appInstanceId: 'nimi.desktop.local-first-party',
      deviceId: 'desktop-shell',
      mode: AccountCallerMode.DESKTOP_SHELL,
      scopes: [],
    },
    runtime: {
      account: {
        invokeRealmUnary: async () => ({
          accepted: false,
          responseJson: '',
          reasonCode: RuntimeWireReasonCode.REALM_UNAVAILABLE,
          accountReasonCode: AccountReasonCode.BROKER_REALM_UNAVAILABLE,
          productionInert: false,
          httpStatus: 503,
          errorMessage: 'Realm is offline.',
        }),
      },
    },
  });

  await assert.rejects(
    () => transport.unary({ methodId: 'WorldPublicController_listWorlds', body: {} }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.REALM_UNAVAILABLE);
      assert.equal((error as { source?: string }).source, 'realm');
      assert.equal((error as { retryable?: boolean }).retryable, true);
      return true;
    },
  );
});

test('Desktop source-readiness Realm transport exposes the exact generated operation vocabulary', async () => {
  assert.deepEqual(NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_IDS, [
    'WorldCoreController_getPersonaCharacter',
    'WorldCoreController_getWorldCharacter',
    'WorldCoreController_getWorldEntity',
    'WorldCoreController_listPersonaCharacters',
    'WorldCoreController_discoverPersonaCharacters',
    'WorldCoreController_listWorldRelationships',
    'WorldPublicController_getWorld',
    'WorldPublicController_getWorldDetailWithCharacters',
    'WorldPublicController_listWorlds',
  ]);
  let runtimeCalls = 0;
  const transport = createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport({
    accountCaller: {
      appId: 'nimi.desktop',
      appInstanceId: 'nimi.desktop.local-first-party',
      deviceId: 'desktop-shell',
      mode: AccountCallerMode.DESKTOP_SHELL,
      scopes: [],
    },
    runtime: {
      account: {
        invokeRealmUnary: async () => {
          runtimeCalls += 1;
          return { accepted: true, responseJson: '{}' };
        },
      },
    },
  });

  await assert.rejects(
    () => transport.unary({ methodId: 'getExploreFeed', body: {} }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED');
      return true;
    },
  );
  assert.equal(runtimeCalls, 0, 'unlisted operation must not reach the Runtime carrier');
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

test('Desktop source-readiness Realm transport rejects bundled caller modes', () => {
  assert.throws(() => createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport({
    accountCaller: {
      appId: 'nimi.zhiyu',
      appInstanceId: 'nimi.zhiyu.local-first-party',
      deviceId: 'nimi-zhiyu-local-first-party-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    },
    runtime: {
      account: {
        invokeRealmUnary: async () => ({ accepted: true, responseJson: '{}' }),
      },
    },
  }), {
    reasonCode: 'SDK_RUNTIME_REALM_DESKTOP_CALLER_REQUIRED',
  });
});

test('built Runtime Realm account module loads under strict Node ESM resolution', async () => {
  const builtModuleUrl = new URL('../../dist/core/app/runtime-account-realm.js', import.meta.url);
  const builtModule = await import(builtModuleUrl.href);
  assert.equal(typeof builtModule.createRuntimeAccountMediatedRealmTransport, 'function');
  assert.equal(typeof builtModule.createRuntimeAccountMediatedDesktopSourceReadinessRealmTransport, 'function');
});
