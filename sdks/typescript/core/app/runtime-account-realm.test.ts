import assert from 'node:assert/strict';
import test from 'node:test';

import { AccountCallerMode } from '../../core-generated/runtime-typed-client';
import { NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID } from '../../runtime/account-caller';
import { createInstalledNimiAppBootstrap } from './installed-app-bootstrap';
import {
  createRealmWithRuntimeAccountToken,
  createRuntimeAccountMediatedRealmTransport,
} from './runtime-account-realm';

test('Realm Runtime account helper adds bearer token and refreshes after 401', async () => {
  const calls: Array<{ readonly authorization: string }> = [];
  let token = 'token-1';
  const realm = createRealmWithRuntimeAccountToken({
    baseUrl: 'https://realm.test',
    runtime: {
      account: {
        getAccessToken: async () => ({ accepted: true, accessToken: token }),
        refreshAccountSession: async () => {
          token = 'token-2';
          return { accepted: true };
        },
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
      return calls.length === 1
        ? new Response(JSON.stringify({ message: 'expired' }), { status: 401, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ value: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  await realm.core.unary({
    methodId: 'listNotifications',
    body: { query: {}, path: {}, headers: {} },
  } as never);

  assert.deepEqual(calls.map((call) => call.authorization), [
    'Bearer token-1',
    'Bearer token-2',
  ]);
});

test('Runtime-mediated Realm transport delegates unary calls without renderer token custody', async () => {
  const caller = {
    appId: 'nimi.zhiyu',
    appInstanceId: 'nimi.zhiyu.local-first-party',
    deviceId: 'nimi-zhiyu-local-first-party-device',
    mode: AccountCallerMode.ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
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

  assert.deepEqual(response, { id: 'world-1', name: '唐代文人世界' });
  assert.deepEqual(calls.map((call) => call.request), [{
    caller,
    methodId: 'WorldPublicController_getWorld',
    realmBaseUrl: '',
    requestJson: JSON.stringify({ path: { worldId: 'world-1' } }),
    timeoutMs: 15_000,
  }]);
  const options = calls[0]?.options as { readonly metadata?: Record<string, string> } | undefined;
  assert.match(options?.metadata?.idempotencyKey ?? '', /^runtime-realm:WorldPublicController_getWorld:[a-f0-9]{16}$/);
  assert.equal(options?.metadata?.['x-nimi-idempotency-key'], options?.metadata?.idempotencyKey);
});

test('installed app bootstrap composes host-owned Runtime account, Realm, and standard shell surfaces', async () => {
  const authorizations: string[] = [];
  let observedCaller: unknown;
  let token = 'runtime-account-token-1';
  const runtime = {
    account: {
      getAccessToken: async (request: { readonly caller: unknown }) => {
        observedCaller = request.caller;
        return { accepted: true, accessToken: token };
      },
      refreshAccountSession: async () => {
        token = 'runtime-account-token-2';
        return { accepted: true };
      },
    },
    protectedRuntimeCall: async () => 'host-owned-runtime-surface',
  };
  const bootstrap = createInstalledNimiAppBootstrap({
    realmBaseUrl: 'https://realm.test',
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
    fetchImpl: async (_request, init) => {
      authorizations.push(new Headers(init?.headers).get('authorization') || '');
      return authorizations.length === 1
        ? new Response(JSON.stringify({ message: 'expired' }), { status: 401, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ value: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
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
    methodId: 'listNotifications',
    body: { query: {}, path: {}, headers: {} },
  } as never);

  assert.deepEqual(authorizations, [
    'Bearer runtime-account-token-1',
    'Bearer runtime-account-token-2',
  ]);
  assert.deepEqual(observedCaller, bootstrap.accountCaller);
});

test('installed app bootstrap rejects renderer-provided auth custody fields', () => {
  assert.throws(() => createInstalledNimiAppBootstrap({
    realmBaseUrl: 'https://realm.test',
    runtime: {
      account: {
        getAccessToken: async () => ({ accepted: true, accessToken: 'runtime-token' }),
        refreshAccountSession: async () => ({ accepted: true }),
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
    realmBaseUrl: 'https://realm.test',
    runtime: {
      account: {
        getAccessToken: async () => ({ accepted: true, accessToken: 'runtime-token' }),
        refreshAccountSession: async () => ({ accepted: true }),
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
    realmBaseUrl: 'https://realm.test',
    runtime: {
      account: {
        getAccessToken: async () => ({ accepted: true, accessToken: 'runtime-token' }),
        refreshAccountSession: async () => ({ accepted: true }),
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
    realmBaseUrl: 'https://realm.test',
    runtime: {
      account: {
        getAccessToken: async () => ({ accepted: true, accessToken: 'runtime-token' }),
        refreshAccountSession: async () => ({ accepted: true }),
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
