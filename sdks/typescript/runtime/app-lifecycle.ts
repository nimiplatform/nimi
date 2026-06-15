import {
  AppHealthRepairAction,
  type AppOpenScopeRef,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../types';
import type {
  NimiRuntimeAppInstallJobEvent,
  NimiRuntimeAppLifecycleClient,
  NimiRuntimeAppLifecycleGeneratedClient,
  NimiRuntimeAppOpenScopeRef,
} from './app-lifecycle-types';
import {
  normalizeNimiRuntimeAppLifecycleText,
  requireNimiRuntimeAppId,
  requireNimiRuntimeAppLifecycleJobId,
  requireNimiRuntimeAppLifecycleRootPath,
} from './app-lifecycle-decoder-utils';
import {
  decodeNimiRuntimeAccountAppInventoryProjection,
  decodeNimiRuntimeLocalAppAdoption,
} from './app-lifecycle-inventory-decoders';
import {
  decodeNimiRuntimeAppInstallJob,
  decodeNimiRuntimeAppJobEvent,
  decodeNimiRuntimeAppOpenProjection,
  decodeNimiRuntimeAppPackageReadinessProjection,
  decodeNimiRuntimeAppStorageProjection,
  decodeNimiRuntimeAppUninstallResult,
} from './app-lifecycle-projection-decoders';

export * from './app-lifecycle-types';
export {
  decodeNimiRuntimeAccountAppInventoryProjection,
  decodeNimiRuntimeAccountAppInventoryRecord,
  decodeNimiRuntimeAccountAppInventoryRow,
  decodeNimiRuntimeLocalAppAdoption,
} from './app-lifecycle-inventory-decoders';
export {
  decodeNimiRuntimeAppInstallJob,
  decodeNimiRuntimeAppJobEvent,
  decodeNimiRuntimeAppOpenProjection,
  decodeNimiRuntimeAppPackageReadinessProjection,
  decodeNimiRuntimeAppStorageProjection,
  decodeNimiRuntimeAppUninstallResult,
} from './app-lifecycle-projection-decoders';

export function createNimiRuntimeAppLifecycleClient(input: {
  readonly client: NimiRuntimeAppLifecycleGeneratedClient;
}): NimiRuntimeAppLifecycleClient {
  const { client } = input;
  return {
    async accountInventory(options) {
      const response = await client.getAccountAppInventory({}, options);
      return decodeNimiRuntimeAccountAppInventoryProjection(response);
    },
    async adoptLocal(adoptInput, options) {
      const rootPath = requireNimiRuntimeAppLifecycleRootPath(adoptInput?.rootPath);
      const expectedAppId = normalizeNimiRuntimeAppLifecycleText(adoptInput?.expectedAppId);
      const response = await client.adoptLocalApp({ rootPath, expectedAppId }, options);
      return decodeNimiRuntimeLocalAppAdoption(response.adoption);
    },
    async listLocalAdoptions(options) {
      const response = await client.listLocalAppAdoptions({}, options);
      return (response.adoptions || []).map((adoption) => decodeNimiRuntimeLocalAppAdoption(adoption));
    },
    async removeLocalAdoption(removeInput, options) {
      const appId = requireNimiRuntimeAppId(removeInput?.appId);
      const response = await client.removeLocalAppAdoption({
        appId,
        deleteDurableDataConfirmed: Boolean(removeInput?.deleteDurableDataConfirmed),
      }, options);
      return decodeNimiRuntimeLocalAppAdoption(response.adoption);
    },
    async install(installInput, options) {
      const appId = requireNimiRuntimeAppId(installInput?.appId);
      const response = await client.installApp({
        appId,
        confirmed: Boolean(installInput?.confirmed),
      }, options);
      return decodeNimiRuntimeAppInstallJob(response.job);
    },
    async uninstall(uninstallInput, options) {
      const appId = requireNimiRuntimeAppId(uninstallInput?.appId);
      const response = await client.uninstallApp({
        appId,
        deleteDurableData: Boolean(uninstallInput?.deleteDurableData),
        destructiveDataDeleteConfirmed: Boolean(uninstallInput?.destructiveDataDeleteConfirmed),
      }, options);
      return decodeNimiRuntimeAppUninstallResult(response.result, response.job);
    },
    async storage(storageInput, options) {
      const appId = requireNimiRuntimeAppId(storageInput?.appId);
      const response = await client.getAppStorage({ appId }, options);
      return decodeNimiRuntimeAppStorageProjection(response.projection);
    },
    async packageReadiness(readinessInput, options) {
      const appId = requireNimiRuntimeAppId(readinessInput?.appId);
      const response = await client.getAppPackageReadiness({ appId }, options);
      return decodeNimiRuntimeAppPackageReadinessProjection(response.projection);
    },
    async getJob(getInput, options) {
      const jobId = requireNimiRuntimeAppLifecycleJobId(getInput?.jobId);
      const response = await client.getAppInstallJob({ jobId }, options);
      return decodeNimiRuntimeAppInstallJob(response.job);
    },
    async listJobs(listInput, options) {
      const appId = requireNimiRuntimeAppId(listInput?.appId);
      const response = await client.listAppInstallJobs({ appId }, options);
      return (response.jobs || []).map((job) => decodeNimiRuntimeAppInstallJob(job));
    },
    watchJobEvents(watchInput, options) {
      const jobId = requireNimiRuntimeAppLifecycleJobId(watchInput?.jobId);
      const raw = client.watchAppInstallJobEvents({ jobId }, options);
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<NimiRuntimeAppInstallJobEvent> {
          for await (const event of raw) {
            yield decodeNimiRuntimeAppJobEvent(event);
          }
        },
      };
    },
    async update(updateInput, options) {
      const appId = requireNimiRuntimeAppId(updateInput?.appId);
      const response = await client.updateApp({
        appId,
        confirmed: Boolean(updateInput?.confirmed),
      }, options);
      return decodeNimiRuntimeAppInstallJob(response.job);
    },
    async healthRepair(repairInput, options) {
      const appId = requireNimiRuntimeAppId(repairInput?.appId);
      const response = await client.healthRepairApp({
        appId,
        action: toRuntimeGeneratedAppHealthRepairAction(repairInput?.action),
        jobId: normalizeNimiRuntimeAppLifecycleText(repairInput?.jobId),
      }, options);
      return decodeNimiRuntimeAppInstallJob(response.job);
    },
    async open(openInput, options) {
      const appId = requireNimiRuntimeAppId(openInput?.appId);
      const response = await client.openApp({
        appId,
        scope: toRuntimeGeneratedAppOpenScope(appId, openInput?.scope),
      }, options);
      return decodeNimiRuntimeAppOpenProjection(response.projection);
    },
  };
}

function toRuntimeGeneratedAppHealthRepairAction(value: unknown): AppHealthRepairAction {
  switch (value) {
    case 'cancel':
      return AppHealthRepairAction.CANCEL;
    case 'retry':
      return AppHealthRepairAction.RETRY;
    case 'repair':
      return AppHealthRepairAction.REPAIR;
    case 'reinstall':
      return AppHealthRepairAction.REINSTALL;
    default:
      throw createNimiError({
        message: `runtime.appLifecycle.healthRepair rejects action: ${String(value)}`,
        reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_REPAIR_ACTION_INVALID,
        actionHint: 'use_cancel_retry_repair_or_reinstall',
        source: 'sdk',
      });
  }
}

function toRuntimeGeneratedAppOpenScope(appId: string, scope: NimiRuntimeAppOpenScopeRef | undefined): AppOpenScopeRef {
  if (!scope || typeof scope !== 'object') {
    throw createNimiError({
      message: 'runtime.appLifecycle.open requires an explicit app-launch scope',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_SCOPE_REF_REQUIRED,
      actionHint: 'pass_explicit_app_launch_scope_ref',
      source: 'sdk',
    });
  }
  const ownerId = normalizeNimiRuntimeAppLifecycleText(scope.ownerId);
  const surfaceId = normalizeNimiRuntimeAppLifecycleText(scope.surfaceId);
  if (scope.kind !== 'app' || !ownerId || ownerId !== appId) {
    throw createNimiError({
      message: 'runtime.appLifecycle.open scope must be app-shaped with ownerId equal to appId',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_SCOPE_REF_REQUIRED,
      actionHint: 'use_canonical_app_launch_scope_ref',
      source: 'sdk',
    });
  }
  return {
    kind: 'app',
    ownerId,
    surfaceId,
  };
}
