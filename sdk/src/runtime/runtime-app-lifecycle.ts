// Runtime App Lifecycle module — typed install / uninstall / update /
// healthRepair surface plus the AppInstallJob projection and progress stream.
//
// Authority: K-APP-001 / K-APP-011..K-APP-016
//   (.nimi/spec/runtime/kernel/app-messaging-contract.md)
// Proto: proto/runtime/v1/app.proto (RuntimeAppService lifecycle RPCs)
//
// Fail-closed posture:
//   - A missing job projection surfaces as a typed NimiError, never a
//     synthesized placeholder job.
//   - A terminal FAILED / CANCELLED job carries the runtime-owned typed
//     reason_code verbatim; it is never collapsed into a generic value and
//     never projected as success.
//   - No provider / route rescue knobs; install source / phase / state are
//     read straight from the runtime projection, never inferred.

import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import { AppHealthRepairAction } from './generated/runtime/v1/app.js';
import type {
  AppOpenScopeRef as ProtoAppOpenScopeRef,
} from './generated/runtime/v1/app.js';
import type { RuntimeInternalContext } from './internal-context.js';

export type {
  RuntimeAppHealthRepairAction,
  RuntimeAppHealthRepairInput,
  RuntimeAppInstallInput,
  RuntimeAppInstallJob,
  RuntimeAppInstallJobEvent,
  RuntimeAppInstallJobPhase,
  RuntimeAppInstallJobState,
  RuntimeAppInstallSourceKind,
  RuntimeAppInstallStorage,
  RuntimeAppLifecycleJobKind,
  RuntimeAppLifecycleModule,
  RuntimeAppOpenInput,
  RuntimeAppOpenFlowStep,
  RuntimeAppOpenProjection,
  RuntimeAppOpenScopeRef,
  RuntimeAppOpenState,
  RuntimeAppUninstallInput,
  RuntimeAppUninstallResult,
  RuntimeAppUpdateInput,
} from './runtime-app-lifecycle-types.js';
import type {
  RuntimeAppHealthRepairAction,
  RuntimeAppInstallJobEvent,
  RuntimeAppLifecycleModule,
  RuntimeAppOpenScopeRef,
} from './runtime-app-lifecycle-types.js';

// ── Input validation ───────────────────────────────────────────────────

function requireAppId(value: unknown): string {
  const appId = typeof value === 'string' ? value.trim() : '';
  if (!appId) {
    throw createNimiError({
      message: 'runtime.appLifecycle requires a non-empty appId',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_APP_ID_REQUIRED,
      actionHint: 'pass_admitted_nimi_app_id',
      source: 'sdk',
    });
  }
  return appId;
}

function requireJobId(value: unknown): string {
  const jobId = typeof value === 'string' ? value.trim() : '';
  if (!jobId) {
    throw createNimiError({
      message: 'runtime.appLifecycle requires a non-empty jobId',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_JOB_ID_REQUIRED,
      actionHint: 'pass_runtime_emitted_job_id',
      source: 'sdk',
    });
  }
  return jobId;
}

/**
 * Validate the mandatory explicit app-launch AIScopeRef and map it to the
 * proto shape. `open` never infers the scope: a missing scope, a non-`app`
 * kind, or an `ownerId` that does not equal the opened `appId` fails closed
 * (`S-APP-003` / `K-APP-017` / `P-AISC-007`).
 */
function toProtoOpenScope(
  appId: string,
  scope: RuntimeAppOpenScopeRef | undefined,
): ProtoAppOpenScopeRef {
  if (!scope || typeof scope !== 'object') {
    throw createNimiError({
      message: 'runtime.appLifecycle.open requires an explicit app-launch AIScopeRef',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_SCOPE_REF_REQUIRED,
      actionHint: 'pass_explicit_app_launch_scope_ref',
      source: 'sdk',
    });
  }
  const ownerId = typeof scope.ownerId === 'string' ? scope.ownerId.trim() : '';
  const surfaceId =
    typeof scope.surfaceId === 'string' ? scope.surfaceId.trim() : '';
  if (scope.kind !== 'app' || !ownerId || ownerId !== appId) {
    throw createNimiError({
      message:
        'runtime.appLifecycle.open AIScopeRef must be app-shaped with ownerId equal to the opened appId',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_SCOPE_REF_REQUIRED,
      actionHint: 'use_canonical_app_launch_scope_ref',
      source: 'sdk',
    });
  }
  return { kind: 'app', ownerId, surfaceId };
}

function toProtoHealthRepairAction(
  value: RuntimeAppHealthRepairAction,
): AppHealthRepairAction {
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

import {
  decodeAppInstallJob,
  decodeJobEvent,
  decodeOpenProjection,
  decodeUninstallResult,
} from './runtime-app-lifecycle-decode.js';

export { decodeAppInstallJob } from './runtime-app-lifecycle-decode.js';

// ── Module factory ─────────────────────────────────────────────────────

/**
 * Construct the RuntimeAppLifecycleModule from the Runtime internal context.
 * Called from the Runtime constructor (Runtime class `readonly appLifecycle`
 * field, never a singleton const export).
 */
export function createRuntimeAppLifecycleModule(input: {
  ctx: RuntimeInternalContext;
}): RuntimeAppLifecycleModule {
  const { ctx } = input;
  return {
    async install(installInput, optionsValue) {
      const appId = requireAppId(installInput?.appId);
      const response = await ctx.invokeWithClient(async (client) =>
        client.app.installApp(
          { appId, confirmed: Boolean(installInput?.confirmed) },
          optionsValue,
        ),
      );
      return decodeAppInstallJob(response.job);
    },
    async uninstall(uninstallInput, optionsValue) {
      const appId = requireAppId(uninstallInput?.appId);
      const response = await ctx.invokeWithClient(async (client) =>
        client.app.uninstallApp(
          {
            appId,
            deleteDurableData: Boolean(uninstallInput?.deleteDurableData),
            destructiveDataDeleteConfirmed: Boolean(
              uninstallInput?.destructiveDataDeleteConfirmed,
            ),
          },
          optionsValue,
        ),
      );
      return decodeUninstallResult(response.result, response.job);
    },
    async getJob(getInput, optionsValue) {
      const jobId = requireJobId(getInput?.jobId);
      const response = await ctx.invokeWithClient(async (client) =>
        client.app.getAppInstallJob({ jobId }, optionsValue),
      );
      return decodeAppInstallJob(response.job);
    },
    async listJobs(listInput, optionsValue) {
      const appId =
        typeof listInput?.appId === 'string' ? listInput.appId.trim() : '';
      const response = await ctx.invokeWithClient(async (client) =>
        client.app.listAppInstallJobs({ appId }, optionsValue),
      );
      return (response.jobs || []).map((job) => decodeAppInstallJob(job));
    },
    async watchJobEvents(watchInput, optionsValue) {
      const jobId =
        typeof watchInput?.jobId === 'string' ? watchInput.jobId.trim() : '';
      const raw = await ctx.invokeWithClient(async (client) =>
        client.app.watchAppInstallJobEvents({ jobId }, optionsValue),
      );
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<RuntimeAppInstallJobEvent> {
          for await (const event of raw) {
            yield decodeJobEvent(event);
          }
        },
      };
    },
    async update(updateInput, optionsValue) {
      const appId = requireAppId(updateInput?.appId);
      const response = await ctx.invokeWithClient(async (client) =>
        client.app.updateApp(
          { appId, confirmed: Boolean(updateInput?.confirmed) },
          optionsValue,
        ),
      );
      return decodeAppInstallJob(response.job);
    },
    async healthRepair(repairInput, optionsValue) {
      const appId = requireAppId(repairInput?.appId);
      const action = toProtoHealthRepairAction(repairInput?.action);
      const jobId =
        typeof repairInput?.jobId === 'string' ? repairInput.jobId.trim() : '';
      const response = await ctx.invokeWithClient(async (client) =>
        client.app.healthRepairApp({ appId, action, jobId }, optionsValue),
      );
      return decodeAppInstallJob(response.job);
    },
    async open(openInput, optionsValue) {
      const appId = requireAppId(openInput?.appId);
      const scope = toProtoOpenScope(appId, openInput?.scope);
      const response = await ctx.invokeWithClient(async (client) =>
        client.app.openApp({ appId, scope }, optionsValue),
      );
      return decodeOpenProjection(response.projection);
    },
  };
}
