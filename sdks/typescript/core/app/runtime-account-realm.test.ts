import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AccountCallerMode,
  AccountReasonCode,
  ReasonCode as RuntimeWireReasonCode,
} from '../../core-generated/runtime-typed-client';
import { NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID } from '../../runtime/account-caller';
import { ReasonCode } from '../../types';
import { createInstalledNimiAppBootstrap } from './installed-app-bootstrap';
import {
  createRealmWithRuntimeAccountToken,
  createRuntimeAccountMediatedRealmTransport,
} from './runtime-account-realm';

test('explicit first-party Realm Runtime account helper adds a Runtime-projected bearer without public refresh', async () => {
  const calls: Array<{ readonly authorization: string }> = [];
  const realm = createRealmWithRuntimeAccountToken({
    baseUrl: 'https://realm.test',
    runtime: {
      account: {
        getAccessToken: async () => ({ accepted: true, accessToken: 'token-1' }),
      },
    },
    accountCaller: {
      appId: 'nimi.thirdparty.fixture',
      appInstanceId: 'fixture.instance',
      deviceId: 'fixture.device',
      mode: 1,
      scopes: [],
    },
    fetchImpl: async (_request, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ authorization: headers.get('authorization') || '' });
      return new Response(JSON.stringify({ value: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  await realm.core.unary({
    methodId: 'listNotifications',
    body: { query: {}, path: {}, headers: {} },
  } as never);

  assert.deepEqual(calls.map((call) => call.authorization), ['Bearer token-1']);
});

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
            responseJson: JSON.stringify({ id: 'world-1', name: '唐代文人世界' }),
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

  assert.deepEqual(response, { id: 'world-1', name: '唐代文人世界' });
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

test('Runtime-mediated Realm transport maps broker upstream failure to typed Realm offline truth', async () => {
  const transport = createRuntimeAccountMediatedRealmTransport({
    accountCaller: {
      appId: 'nimi.desktop',
      appInstanceId: 'nimi.desktop.local-first-party',
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

test('raw Runtime account token Realm helper rejects installed and developer callers before transport', () => {
  for (const mode of [
    AccountCallerMode.LOCAL_DEVELOPER_APP,
    AccountCallerMode.DESKTOP_LAUNCHED_NIMI_APP,
  ]) {
    assert.throws(() => createRealmWithRuntimeAccountToken({
      baseUrl: 'https://realm.test',
      runtime: { account: { getAccessToken: async () => ({ accepted: true, accessToken: 'must-not-project' }) } },
      accountCaller: {
        appId: 'community.nimi.fixture',
        appInstanceId: 'community.nimi.fixture.instance',
        deviceId: 'device-1',
        mode,
        scopes: [],
      },
      fetchImpl: async () => new Response('{}'),
    }), {
      reasonCode: 'SDK_RUNTIME_ACCOUNT_RAW_TOKEN_MODE_FORBIDDEN',
    });
  }
});

test('installed app bootstrap composes host-owned Runtime account, Realm, and standard shell surfaces', async () => {
  const brokerCalls: unknown[] = [];
  const runtime = {
    account: {
      invokeRealmUnary: async (request: unknown) => {
        brokerCalls.push(request);
        return { accepted: true, responseJson: JSON.stringify({ items: [] }) };
      },
    },
    protectedRuntimeCall: async () => 'host-owned-runtime-surface',
  };
  const bootstrap = createInstalledNimiAppBootstrap({
    runtime,
    launchBinding: {
      appId: 'community.nimi.fixture.platform-proof',
      appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      launchHostId: NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
      launchNonce: 'launch-nonce-1',
      releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
    },
    standardShell: {
      aiConfig: {
        get: async (scopeRef) => ({ scopeRef, capabilities: { targetRefs: {} } }),
        set: async (_scopeRef, config) => config,
      },
      config: {
        get: async () => ({ theme: 'dark' }),
        set: async (config) => ({ saved: config }),
      },
      data: {
        resolvePath: async (relativePath) => `/runtime/app-storage/${relativePath}`,
      },
      storage: {
        readJson: async (relativePath) => ({ relativePath }),
        writeJson: async (relativePath, value) => ({ relativePath, value }),
        removeJson: async (relativePath) => ({ relativePath, removed: true }),
      },
      localAssets: {
        resolveUrl: async (relativePath) => `nimi-installed-app://fixture/${relativePath}`,
      },
    },
  });

  assert.equal(bootstrap.appId, 'community.nimi.fixture.platform-proof');
  assert.equal(bootstrap.runtime, runtime);
  assert.equal(await bootstrap.runtime.protectedRuntimeCall(), 'host-owned-runtime-surface');
  assert.deepEqual(bootstrap.accountCaller, {
    appId: 'community.nimi.fixture.platform-proof',
    appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
    deviceId: 'desktop-installed-app-host-device',
    mode: AccountCallerMode.DESKTOP_LAUNCHED_NIMI_APP,
    scopes: [],
    launchHostId: NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
    launchNonce: 'launch-nonce-1',
    releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
  });
  assert.deepEqual(await bootstrap.standardShell.config.get(), { theme: 'dark' });
  assert.deepEqual(await bootstrap.standardShell.config.set({ compact: true }), { saved: { compact: true } });
  assert.deepEqual(await bootstrap.standardShell.aiConfig.get('app:fixture'), {
    scopeRef: 'app:fixture',
    capabilities: { targetRefs: {} },
  });
  assert.deepEqual(await bootstrap.standardShell.aiConfig.set('app:fixture', { capabilities: { selectedParams: {} } }), {
    capabilities: { selectedParams: {} },
  });
  assert.equal(await bootstrap.standardShell.data.resolvePath('settings/view.json'), '/runtime/app-storage/settings/view.json');
  assert.deepEqual(await bootstrap.standardShell.storage.readJson('settings/view.json'), { relativePath: 'settings/view.json' });
  assert.deepEqual(await bootstrap.standardShell.storage.writeJson('settings/view.json', { zoom: 1 }), {
    relativePath: 'settings/view.json',
    value: { zoom: 1 },
  });
  assert.deepEqual(await bootstrap.standardShell.storage.removeJson('settings/view.json'), {
    relativePath: 'settings/view.json',
    removed: true,
  });
  assert.equal(await bootstrap.standardShell.localAssets.resolveUrl('dist/icon.png'), 'nimi-installed-app://fixture/dist/icon.png');

  await bootstrap.realm.core.unary({
    methodId: 'WorldPublicController_listWorlds',
    body: {},
  } as never);

  assert.deepEqual(brokerCalls, [{
    caller: bootstrap.accountCaller,
    methodId: 'WorldPublicController_listWorlds',
    realmBaseUrl: '',
    requestJson: '{}',
    timeoutMs: 30_000,
  }]);
});

test('installed app bootstrap rejects renderer-provided auth custody fields', () => {
  assert.throws(() => createInstalledNimiAppBootstrap({
    runtime: {
      account: {
        invokeRealmUnary: async () => ({ accepted: true, responseJson: '{}' }),
      },
    },
    launchBinding: {
      appId: 'community.nimi.fixture.platform-proof',
      appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      launchHostId: NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
      launchNonce: '',
      releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
    },
    standardShell: {
      aiConfig: {
        get: async () => ({}),
        set: async (_scopeRef, config) => config,
      },
      config: {
        get: async () => ({}),
        set: async (config) => config,
      },
      data: {
        resolvePath: async (relativePath) => relativePath,
      },
      storage: {
        readJson: async () => ({}),
        writeJson: async (_relativePath, value) => value,
        removeJson: async (relativePath) => ({ relativePath, removed: true }),
      },
      localAssets: {
        resolveUrl: async () => 'nimi-installed-app://fixture/dist/icon.png',
      },
    },
  }), {
    reasonCode: 'SDK_RUNTIME_INSTALLED_APP_CALLER_BINDING_REQUIRED',
  });

  assert.throws(() => createInstalledNimiAppBootstrap({
    runtime: {
      account: {
        invokeRealmUnary: async () => ({ accepted: true, responseJson: '{}' }),
      },
    },
    launchBinding: {
      appId: 'community.nimi.fixture.platform-proof',
      appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      launchHostId: NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
      launchNonce: 'launch-nonce-1',
      releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
    },
    standardShell: {
      aiConfig: {
        get: async () => ({}),
        set: async (_scopeRef, config) => config,
      },
      config: {
        get: async () => ({}),
        set: async (config) => config,
      },
      data: {
        resolvePath: async (relativePath) => relativePath,
      },
      storage: {
        readJson: async () => ({}),
        writeJson: async (_relativePath, value) => value,
        removeJson: async (relativePath) => ({ relativePath, removed: true }),
      },
      localAssets: {
        resolveUrl: async () => 'nimi-installed-app://fixture/dist/icon.png',
      },
    },
    authorization: 'Bearer renderer-owned-token',
  } as never), {
    reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_HOST_METADATA_ONLY',
  });
});

test('installed app bootstrap requires full standard shell including ai-config, data, and storage lifecycle surfaces', () => {
  assert.throws(() => createInstalledNimiAppBootstrap({
    runtime: {
      account: {
        invokeRealmUnary: async () => ({ accepted: true, responseJson: '{}' }),
      },
    },
    launchBinding: {
      appId: 'community.nimi.fixture.platform-proof',
      appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      launchHostId: NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
      launchNonce: 'launch-nonce-1',
      releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
    },
    standardShell: {
      config: {
        get: async () => ({}),
        set: async (config) => config,
      },
      storage: {
        readJson: async () => ({}),
        writeJson: async (_relativePath, value) => value,
      },
      localAssets: {
        resolveUrl: async () => 'nimi-installed-app://fixture/dist/icon.png',
      },
    } as never,
  }), {
    reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_STANDARD_SHELL_REQUIRED',
  });

  assert.throws(() => createInstalledNimiAppBootstrap({
    runtime: {
      account: {
        invokeRealmUnary: async () => ({ accepted: true, responseJson: '{}' }),
      },
    },
    launchBinding: {
      appId: 'community.nimi.fixture.platform-proof',
      appInstanceId: 'community.nimi.fixture.platform-proof.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      launchHostId: NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
      launchNonce: 'launch-nonce-1',
      releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
    },
    standardShell: {
      aiConfig: {
        get: async () => ({}),
      },
      config: {
        get: async () => ({}),
        set: async (config) => config,
      },
      data: {
        resolvePath: async (relativePath) => relativePath,
      },
      storage: {
        readJson: async () => ({}),
        writeJson: async (_relativePath, value) => value,
        removeJson: async (relativePath) => ({ relativePath, removed: true }),
      },
      localAssets: {
        resolveUrl: async () => 'nimi-installed-app://fixture/dist/icon.png',
      },
    } as never,
  }), {
    reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_STANDARD_SHELL_REQUIRED',
  });
});
