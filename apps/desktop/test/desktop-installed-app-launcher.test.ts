import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe } from 'node:test';

import type { NimiRuntimeAppOpenProjection } from '@nimiplatform/sdk/runtime';

import {
  DESKTOP_INSTALLED_APP_CALLER_MODE,
  DESKTOP_INSTALLED_APP_DEVICE_ID,
  DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
  INSTALLED_APP_STANDARD_SHELL_CAPABILITY_SET_REF,
  createDesktopInstalledAppLauncher,
  desktopInstalledAppInstanceId,
} from '../src-electron/app-launch/installed-app-launcher.js';
import {
  buildDesktopInstalledAppHostWindowOptions,
} from '../src-electron/app-launch/installed-app-host-window.js';
import {
  createDesktopInstalledAppProtocolBinding,
} from '../src-electron/app-launch/installed-app-protocol.js';
import {
  createDesktopInstalledAppAuthProviderInput,
} from '../src-electron/app-launch/installed-app-auth.js';
import {
  DESKTOP_INSTALLED_APP_LAUNCH_COMMAND,
  DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES,
} from '../src/shell/shared/installed-app-launch-contract';

describe('Desktop installed app launcher', () => {
  test('creates a host only from the Runtime-attested launched projection', async () => {
    const projection = launchedProjection();
    const protocolInputs: unknown[] = [];
    const authInputs: unknown[] = [];
    const hostInputs: unknown[] = [];
    const aiConfigStore = {
      get: async () => null,
      set: async ({ config }: { readonly config: Readonly<Record<string, unknown>> }) => config,
    };
    const launcher = createDesktopInstalledAppLauncher({
      runtimeEndpoint: '127.0.0.1:46371',
      preloadPath: 'D:/nimi/desktop/preload.cjs',
      createAIConfigStore: (dataRoot) => {
        assert.equal(dataRoot, projection.storage?.durableDataRoot);
        return aiConfigStore;
      },
      registerProtocol: async (input) => {
        protocolInputs.push(input);
        return {
          scheme: 'nimi-installed-app',
          origin: 'nimi-installed-app://community.nimi.fixture.platform-proof',
          entryUrl: 'nimi-installed-app://community.nimi.fixture.platform-proof/dist/index.html',
          entryFilePath: 'D:/nimi-data/apps/community.nimi.fixture.platform-proof/releases/0.1.0-sandbox/dist/index.html',
          releaseRoot: 'D:/nimi-data/apps/community.nimi.fixture.platform-proof/releases/0.1.0-sandbox',
          allowedOrigins: ['nimi-installed-app://community.nimi.fixture.platform-proof'],
        };
      },
      createAuthProvider: (input) => {
        authInputs.push(input);
        return async () => ({ metadata: { participantId: projection.appId } });
      },
      createHostWindow: async (input) => {
        hostInputs.push(input);
        return { windowId: 42, entryUrl: input.entryUrl };
      },
    });

    const result = await launcher.launch({ projection });

    assert.equal(result.state, 'launched');
    assert.equal(result.appId, projection.appId);
    assert.equal(result.windowId, 42);
    assert.equal(protocolInputs.length, 1);
    assert.equal(authInputs.length, 1);
    assert.equal(hostInputs.length, 1);
    assert.deepEqual(protocolInputs[0], {
      appId: projection.appId,
      releaseDescriptorRef: projection.releaseDescriptorRef,
      activeReleaseRoot: projection.activeReleaseRoot,
      runtimeEntryRef: projection.runtimeEntryRef,
    });
    assert.deepEqual(authInputs[0], {
      appId: projection.appId,
      runtimeEndpoint: '127.0.0.1:46371',
      installedApp: {
        appInstanceId: desktopInstalledAppInstanceId(projection.appId),
        deviceId: DESKTOP_INSTALLED_APP_DEVICE_ID,
        launchHostId: DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID,
        launchNonce: projection.launchNonce,
        releaseDescriptorRef: projection.releaseDescriptorRef,
      },
      appSession: {
        appVersion: projection.activeVersion,
        capabilities: [],
      },
      protectedAccess: {
        consentId: `${projection.appId}:desktop-installed-app-runtime-account`,
        authorizationVersion: 'desktop-installed-app-runtime-account-v1',
        scopeCatalogVersion: 'desktop-installed-app-standard-shell-v1',
        scopes: [],
      },
    });
    const hostInput = hostInputs[0] as {
      readonly appId?: string;
      readonly preloadPath?: string;
      readonly entryUrl?: string;
      readonly allowedOrigins?: readonly string[];
      readonly runtimeEndpoint?: string;
      readonly trustedRuntimeMetadataProvider?: unknown;
      readonly standardShell?: {
        readonly capabilitySetRef?: string;
        readonly standardDataRootBinding?: {
          readonly source?: string;
          readonly durableDataRoot?: string;
          readonly cacheRoot?: string;
          readonly tempRoot?: string;
          readonly projectionRef?: string;
        };
        readonly localAssetRoots?: readonly string[];
        readonly aiConfigStore?: unknown;
      };
    };
    assert.equal(hostInput.appId, projection.appId);
    assert.equal(hostInput.preloadPath, 'D:/nimi/desktop/preload.cjs');
    assert.equal(hostInput.entryUrl, 'nimi-installed-app://community.nimi.fixture.platform-proof/dist/index.html');
    assert.deepEqual(hostInput.allowedOrigins, ['nimi-installed-app://community.nimi.fixture.platform-proof']);
    assert.equal(hostInput.runtimeEndpoint, '127.0.0.1:46371');
    assert.equal(typeof hostInput.trustedRuntimeMetadataProvider, 'function');
    assert.equal(hostInput.standardShell?.capabilitySetRef, INSTALLED_APP_STANDARD_SHELL_CAPABILITY_SET_REF);
    assert.deepEqual(hostInput.standardShell?.standardDataRootBinding, {
      source: 'runtime-launch-projection',
      durableDataRoot: projection.storage?.durableDataRoot,
      cacheRoot: projection.storage?.cacheRoot,
      tempRoot: projection.storage?.tempRoot,
      projectionRef: projection.releaseDescriptorRef,
    });
    assert.deepEqual(hostInput.standardShell?.localAssetRoots, [projection.activeReleaseRoot]);
    assert.equal(hostInput.standardShell?.aiConfigStore, aiConfigStore);
  });

  test('rejects blocked Runtime OpenApp projections without creating a host', async () => {
    const hostInputs: unknown[] = [];
    const launcher = createDesktopInstalledAppLauncher({
      runtimeEndpoint: '127.0.0.1:46371',
      preloadPath: 'D:/nimi/desktop/preload.cjs',
      createHostWindow: async (input) => {
        hostInputs.push(input);
        return { windowId: 1, entryUrl: input.entryUrl };
      },
    });

    await assert.rejects(
      () => launcher.launch({
        projection: {
          ...launchedProjection(),
          state: 'blocked',
          reachedStep: 'verify_package',
          launched: false,
          reasonCode: 'APP_INSTALL_DIGEST_MISMATCH',
        },
      }),
      (error: unknown) =>
        (error as { reasonCode?: string }).reasonCode
          === DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.projectionBlocked,
    );
    assert.equal(hostInputs.length, 0);
  });

  test('rejects caller-supplied descriptor/root/entry overrides', async () => {
    const launcher = createDesktopInstalledAppLauncher({
      runtimeEndpoint: '127.0.0.1:46371',
      preloadPath: 'D:/nimi/desktop/preload.cjs',
    });

    await assert.rejects(
      () => launcher.launch({
        projection: launchedProjection(),
        override: {
          releaseDescriptorRef: 'community.nimi.fixture.platform-proof.other',
        },
      }),
      (error: unknown) =>
        (error as { reasonCode?: string }).reasonCode
          === DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.attestationMismatch,
    );
  });

  test('rejects launched projections missing installed app launch-resolution fields', async () => {
    const launcher = createDesktopInstalledAppLauncher({
      runtimeEndpoint: '127.0.0.1:46371',
      preloadPath: 'D:/nimi/desktop/preload.cjs',
    });

    await assert.rejects(
      () => launcher.launch({
        projection: {
          ...launchedProjection(),
          releaseDescriptorRef: undefined,
        },
      }),
      (error: unknown) =>
        (error as { reasonCode?: string }).reasonCode
          === DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.resolutionRequired,
    );
  });
});

describe('Desktop installed app host window/protocol/auth plans', () => {
  test('host window options keep installed app renderer isolated from Node', () => {
    const options = buildDesktopInstalledAppHostWindowOptions({
      appId: 'community.nimi.fixture.platform-proof',
      preloadPath: 'D:/nimi/desktop/preload.cjs',
    });

    assert.equal(options.title, 'community.nimi.fixture.platform-proof');
    assert.equal(options.webPreferences?.preload, 'D:/nimi/desktop/preload.cjs');
    assert.equal(options.webPreferences?.contextIsolation, true);
    assert.equal(options.webPreferences?.nodeIntegration, false);
    assert.equal(options.webPreferences?.sandbox, true);
  });

  test('protocol binding loads only the Runtime-attested release entry', () => {
    const binding = createDesktopInstalledAppProtocolBinding({
      appId: 'community.nimi.fixture.platform-proof',
      releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
      activeReleaseRoot: 'D:/nimi-data/apps/community.nimi.fixture.platform-proof/releases/0.1.0-sandbox',
      runtimeEntryRef: 'dist/index.html',
    });

    assert.equal(binding.origin, 'nimi-installed-app://community.nimi.fixture.platform-proof');
    assert.equal(binding.entryUrl, 'nimi-installed-app://community.nimi.fixture.platform-proof/dist/index.html');
    assert.deepEqual(binding.allowedOrigins, ['nimi-installed-app://community.nimi.fixture.platform-proof']);
    assert.match(binding.entryFilePath.replaceAll('\\', '/'), /releases\/0\.1\.0-sandbox\/dist\/index\.html$/);
    assert.throws(
      () => createDesktopInstalledAppProtocolBinding({
        appId: 'community.nimi.fixture.platform-proof',
        releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
        activeReleaseRoot: 'D:/nimi-data/apps/community.nimi.fixture.platform-proof/releases/0.1.0-sandbox',
        runtimeEntryRef: '../secrets.txt',
      }),
      /runtimeEntryRef/,
    );
  });

  test('auth provider input binds installed-app caller posture and launch nonce', () => {
    const input = createDesktopInstalledAppAuthProviderInput({
      runtimeEndpoint: '127.0.0.1:46371',
      projection: launchedProjection(),
    });

    assert.equal(input.appId, 'community.nimi.fixture.platform-proof');
    assert.equal(input.installedApp.launchHostId, DESKTOP_INSTALLED_APP_LAUNCH_HOST_ID);
    assert.equal(input.installedApp.launchNonce, 'launch-nonce-1');
    assert.equal(input.installedApp.releaseDescriptorRef, 'community.nimi.fixture.platform-proof.0.1.0-sandbox');
    assert.equal(input.appSession.developerRegistration, undefined);
  });

  test('Electron main registers the Desktop installed-app launch command', () => {
    const mainSource = readFileSync(new URL('../src-electron/main.ts', import.meta.url), 'utf8');
    assert.match(mainSource, /registerDesktopInstalledAppLaunchIpc/);
    assert.match(mainSource, /DESKTOP_INSTALLED_APP_LAUNCH_COMMAND/);
    assert.match(mainSource, /DESKTOP_INSTALLED_APP_PROTOCOL_SCHEME/);
    assert.match(mainSource, /createAIConfigStore:\s*createDesktopAiConfigStore/);
    assert.match(mainSource, /protocol\.registerSchemesAsPrivileged/);
    assert.equal(DESKTOP_INSTALLED_APP_LAUNCH_COMMAND, 'desktop.installedApp.launch');
  });
});

function launchedProjection(
  overrides: Partial<NimiRuntimeAppOpenProjection> = {},
): NimiRuntimeAppOpenProjection {
  return {
    appId: 'community.nimi.fixture.platform-proof',
    state: 'launched',
    reachedStep: 'launch',
    launched: true,
    activeVersion: '0.1.0-sandbox',
    scope: { kind: 'app', ownerId: 'community.nimi.fixture.platform-proof' },
    reasonCode: 'ACTION_EXECUTED',
    releaseDescriptorRef: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
    descriptorClass: 'external-immutable-artifact',
    admissionTrack: 'admission-sandbox-ci',
    sourceKind: 'admission-sandbox-https-artifact',
    ordinaryVisibility: 'developer-only',
    digestVerificationState: 'digest-verified',
    runtimeEntryRef: 'dist/index.html',
    activeReleaseRoot: 'D:/nimi-data/apps/community.nimi.fixture.platform-proof/releases/0.1.0-sandbox',
    storage: {
      appRoot: 'D:/nimi-data/apps/community.nimi.fixture.platform-proof',
      releaseRoot: 'D:/nimi-data/apps/community.nimi.fixture.platform-proof/releases/0.1.0-sandbox',
      durableDataRoot: 'D:/nimi-data/apps/community.nimi.fixture.platform-proof/data',
      cacheRoot: 'D:/nimi-data/apps/community.nimi.fixture.platform-proof/cache',
      tempRoot: 'D:/nimi-data/apps/community.nimi.fixture.platform-proof/tmp',
    },
    shellCapabilitySetRef: INSTALLED_APP_STANDARD_SHELL_CAPABILITY_SET_REF,
    callerMode: DESKTOP_INSTALLED_APP_CALLER_MODE,
    launchNonce: 'launch-nonce-1',
    productReadinessClaimAllowed: false,
    ...overrides,
  };
}
