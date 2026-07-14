import assert from 'node:assert/strict';
import {
  AppPackageReadinessState,
  ReasonCode,
} from '../../../sdks/typescript/core-generated/runtime-typed-client.ts';
import { createNimiRuntimeAppLifecycleClient } from '../../../sdks/typescript/runtime/app-lifecycle.ts';

async function main(): Promise<void> {
  const readinessRequests: unknown[] = [];
  const lifecycle = createNimiRuntimeAppLifecycleClient({
    client: {
      async getAccountAppInventory() {
        return { exists: false };
      },
      async getAppStorage() {
        throw new Error('storage is outside this immutable-package behavior fixture');
      },
      async getAppPackageReadiness(request) {
        readinessRequests.push(request);
        return {
          projection: {
            state: AppPackageReadinessState.BLOCKED,
            reasonCode: ReasonCode.LOCAL_APP_OPERATION_UNAVAILABLE,
            detail: 'immutable_profile_unavailable',
          },
        };
      },
    },
  });

  assert.deepEqual(Object.keys(lifecycle).sort(), ['accountInventory', 'packageReadiness', 'storage']);
  for (const forbidden of [
    'prepareAppLifecycleIntent',
    'getAppLifecycleIntentStatus',
    'installApp',
    'uninstallApp',
    'getAppInstallJob',
    'listAppInstallJobs',
    'watchAppInstallJobEvents',
    'updateApp',
    'healthRepairApp',
  ]) {
    assert.equal(forbidden in lifecycle, false, `${forbidden} must not exist on the high-level SDK client`);
  }

  assert.deepEqual(await lifecycle.packageReadiness(), {
    state: 'unavailable',
    reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
    detail: 'immutable_profile_unavailable',
  });
  assert.deepEqual(readinessRequests, [{ appId: '' }]);

  const leaking = createNimiRuntimeAppLifecycleClient({
    client: {
      async getAccountAppInventory() {
        return { exists: false };
      },
      async getAppStorage() {
        throw new Error('storage is outside this immutable-package behavior fixture');
      },
      async getAppPackageReadiness() {
        return {
          projection: {
            state: AppPackageReadinessState.BLOCKED,
            reasonCode: ReasonCode.LOCAL_APP_OPERATION_UNAVAILABLE,
            detail: 'immutable_profile_unavailable',
            activeVersion: '1.0.0',
          },
        };
      },
    },
  });
  await assert.rejects(
    leaking.packageReadiness(),
    /leaked package selectors or positive materialization truth/u,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
