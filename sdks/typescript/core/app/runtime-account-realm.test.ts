import assert from 'node:assert/strict';
import test from 'node:test';

import { AccountCallerMode } from '../../core-generated/runtime-typed-client';
import { NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID } from '../../runtime/account-caller';
import { createInstalledNimiAppBootstrap } from './installed-app-bootstrap';
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

test('Runtime-mediated Realm transport rejects installed callers before A.1', () => {
  assert.throws(() => createRuntimeAccountMediatedRealmTransport({
    accountCaller: {
      appId: 'community.nimi.fixture',
      appInstanceId: 'community.nimi.fixture.desktop-host',
      deviceId: 'desktop-installed-app-host-device',
      mode: AccountCallerMode.DESKTOP_LAUNCHED_NIMI_APP,
      launchHostId: NIMI_DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
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

test('installed app bootstrap fails closed before A.1 even with complete host-shaped input', () => {
  assert.throws(() => createInstalledNimiAppBootstrap({
    runtime: {
      account: {
        invokeRealmUnary: async () => ({ accepted: true, responseJson: JSON.stringify({ items: [] }) }),
      },
      protectedRuntimeCall: async () => 'host-owned-runtime-surface',
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
  }), {
    reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_A1_CARRIER_REQUIRED',
  });
});

test('installed app bootstrap rejects all constructed input before A.1', () => {
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
    reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_A1_CARRIER_REQUIRED',
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
    reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_A1_CARRIER_REQUIRED',
  });
});

test('installed app bootstrap rejects incomplete standard-shell fixtures before A.1', () => {
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
    reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_A1_CARRIER_REQUIRED',
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
    reasonCode: 'SDK_INSTALLED_APP_BOOTSTRAP_A1_CARRIER_REQUIRED',
  });
});
