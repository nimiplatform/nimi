import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import type {
  NimiRuntimeAppLifecycleClient,
  NimiRuntimeAppOpenProjection,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode, createNimiError } from '@nimiplatform/sdk/types';

import {
  createDesktopAppLifecycleBridge,
} from '../src/shell/renderer/features/apps/apps-lifecycle-bridge';
import {
  DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES,
} from '../src/shell/shared/installed-app-launch-contract';

describe('Desktop App Lifecycle OpenApp launch-resolution handoff', () => {
  test('invokes Desktop installed-app launch after Runtime returns a launched projection', async () => {
    const projection = launchedProjection();
    const launchCalls: NimiRuntimeAppOpenProjection[] = [];
    const bridge = createDesktopAppLifecycleBridge({
      getModule: () => stubLifecycle({ projection }),
      launchInstalledApp: async (input) => {
        launchCalls.push(input);
        return {
          appId: input.appId,
          state: 'launched',
          launchHostId: 'desktop-electron-installed-app-host',
          releaseDescriptorRef: input.releaseDescriptorRef || '',
          windowId: 7,
        };
      },
    });

    const result = await bridge.open({
      appId: projection.appId,
      scope: { kind: 'app', ownerId: projection.appId },
    });

    assert.deepEqual(result, projection);
    assert.deepEqual(launchCalls, [projection]);
  });

  test('does not invoke Desktop launch for blocked Runtime OpenApp projections', async () => {
    const projection: NimiRuntimeAppOpenProjection = {
      ...launchedProjection(),
      state: 'blocked',
      reachedStep: 'verify_package',
      launched: false,
      reasonCode: ReasonCode.APP_INSTALL_DIGEST_MISMATCH,
    };
    const launchCalls: NimiRuntimeAppOpenProjection[] = [];
    const bridge = createDesktopAppLifecycleBridge({
      getModule: () => stubLifecycle({ projection }),
      launchInstalledApp: async (input) => {
        launchCalls.push(input);
        throw new Error('must not launch blocked projection');
      },
    });

    const result = await bridge.open({
      appId: projection.appId,
      scope: { kind: 'app', ownerId: projection.appId },
    });

    assert.deepEqual(result, projection);
    assert.deepEqual(launchCalls, []);
  });

  test('normalizes Electron launch failure as a Desktop Apps error, not Runtime OpenApp failure', async () => {
    const projection = launchedProjection();
    const bridge = createDesktopAppLifecycleBridge({
      getModule: () => stubLifecycle({ projection }),
      launchInstalledApp: async () => {
        throw createNimiError({
          message: 'installed app BrowserWindow creation failed',
          reasonCode: DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.hostWindowFailed,
          actionHint: 'check_desktop_installed_app_launch',
          source: 'sdk',
        });
      },
    });

    await assert.rejects(
      () => bridge.open({
        appId: projection.appId,
        scope: { kind: 'app', ownerId: projection.appId },
      }),
      (error: unknown) => {
        assert.equal(
          (error as { reasonCode?: string }).reasonCode,
          DESKTOP_INSTALLED_APP_LAUNCH_REASON_CODES.hostWindowFailed,
        );
        assert.equal((error as { source?: string }).source, 'sdk');
        return true;
      },
    );
  });
});

function stubLifecycle(input: {
  readonly projection: NimiRuntimeAppOpenProjection;
}): NimiRuntimeAppLifecycleClient {
  return {
    async open() {
      return input.projection;
    },
  } as unknown as NimiRuntimeAppLifecycleClient;
}

function launchedProjection(): NimiRuntimeAppOpenProjection {
  return {
    appId: 'community.nimi.fixture.platform-proof',
    state: 'launched',
    reachedStep: 'launch',
    launched: true,
    activeVersion: '0.1.0-sandbox',
    scope: { kind: 'app', ownerId: 'community.nimi.fixture.platform-proof' },
    reasonCode: ReasonCode.ACTION_EXECUTED,
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
    shellCapabilitySetRef: 'installed-nimi-app-standard-shell-v1',
    callerMode: 'desktop-launched-nimi-app',
    launchNonce: 'launch-nonce-1',
    productReadinessClaimAllowed: false,
  };
}
