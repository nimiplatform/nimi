import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import type {
  NimiRuntimeAppLifecycleClient,
  NimiRuntimeAppOpenProjection,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode as RuntimeGeneratedReasonCode } from '@nimiplatform/sdk/runtime/generated';
import { ReasonCode, createNimiError } from '@nimiplatform/sdk/types';

import {
  createDesktopAppLifecycleBridge,
  type DesktopAppLifecycleMutationExecutor,
} from '../src/shell/renderer/features/apps/apps-lifecycle-bridge';

describe('Desktop App Lifecycle OpenApp protected-host handoff', () => {
  test('rejects OpenApp before SDK or renderer launch when no protected host carrier exists', async () => {
    let sdkOpenCalls = 0;
    const bridge = createDesktopAppLifecycleBridge({
      getModule: () => ({
        async open() {
          sdkOpenCalls += 1;
          throw new Error('renderer must not invoke Runtime OpenApp directly');
        },
      } as unknown as NimiRuntimeAppLifecycleClient),
    });

    await assert.rejects(
      () => bridge.open({
        appId: 'community.nimi.fixture.platform-proof',
        scope: { kind: 'app', ownerId: 'community.nimi.fixture.platform-proof' },
      }),
      (error: unknown) => {
        assert.equal(
          (error as { reasonCode?: string }).reasonCode,
          RuntimeGeneratedReasonCode[RuntimeGeneratedReasonCode.DESKTOP_CONTROL_TRANSPORT_REQUIRED],
        );
        return true;
      },
    );
    assert.equal(sdkOpenCalls, 0);
  });

  test('returns only the protected-host OpenApp projection and never owns child launch', async () => {
    const projection = launchedProjection();
    const scope = { kind: 'app' as const, ownerId: projection.appId };
    let hostOpenCalls = 0;
    const executor = mutationExecutor({
      async open(input) {
        hostOpenCalls += 1;
        assert.deepEqual(input.scope, scope);
        return projection;
      },
    });
    const bridge = createDesktopAppLifecycleBridge({
      getModule: () => {
        throw new Error('OpenApp must not resolve the renderer SDK module');
      },
      mutationExecutor: executor,
    });

    const result = await bridge.open({
      appId: projection.appId,
      scope,
    });

    assert.deepEqual(result, projection);
    assert.equal(hostOpenCalls, 1);
  });

  test('normalizes a protected-host OpenApp failure without a renderer launch fallback', async () => {
    const bridge = createDesktopAppLifecycleBridge({
      getModule: () => {
        throw new Error('OpenApp must not resolve the renderer SDK module');
      },
      mutationExecutor: mutationExecutor({
        async open() {
          throw createNimiError({
            message: 'protected host rejected the pending child launch',
            reasonCode: RuntimeGeneratedReasonCode[
              RuntimeGeneratedReasonCode.LIFECYCLE_INTENT_REQUIRED
            ],
            actionHint: 'complete_installed_app_child_launch_admission',
            source: 'runtime',
          });
        },
      }),
    });

    await assert.rejects(
      () => bridge.open({
        appId: 'community.nimi.fixture.platform-proof',
        scope: { kind: 'app', ownerId: 'community.nimi.fixture.platform-proof' },
      }),
      (error: unknown) => {
        assert.equal(
          (error as { reasonCode?: string }).reasonCode,
          RuntimeGeneratedReasonCode[RuntimeGeneratedReasonCode.LIFECYCLE_INTENT_REQUIRED],
        );
        return true;
      },
    );
  });
});

function mutationExecutor(
  overrides: Partial<DesktopAppLifecycleMutationExecutor>,
): DesktopAppLifecycleMutationExecutor {
  const unavailable = async (): Promise<never> => {
    throw new Error('unexpected lifecycle mutation');
  };
  return {
    install: unavailable,
    adoptLocal: unavailable,
    removeLocalAdoption: unavailable,
    uninstall: unavailable,
    update: unavailable,
    healthRepair: unavailable,
    open: unavailable,
    ...overrides,
  };
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
