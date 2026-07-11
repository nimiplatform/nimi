// Desktop App Lifecycle bridge.
//
// Renderer-side seam for read-only SDK `runtime.appLifecycle` projections and
// protected-host lifecycle mutation requests. The desktop Apps surface (T4-W4) drives app
// install / uninstall / update / health-repair and observes the typed
// `AppInstallJob` lifecycle through this bridge — never through a direct
// gRPC client and never through a renderer-local job/registry truth.
//
// Authority:
//   - K-APP-001 / K-APP-011..K-APP-016
//     (.nimi/spec/runtime/kernel/app-messaging-contract.md)
//   - D-IPC-012 (.nimi/spec/desktop/kernel/bridge-ipc-contract.md): app
//     install/update/repair lifecycle mutations require a protected desktop
//     carrier. The renderer submits only request fields and never receives a
//     Runtime-issued lifecycle intent or invokes the carrier directly.
//
// Fail-closed posture:
//   - The SDK surface already fail-closes on a missing job projection, an
//     unspecified phase/state/kind, and a failed/cancelled job that omits a
//     typed reason code. This bridge adds no rescue path and synthesizes no
//     placeholder job.
//   - A transport / RPC failure is normalized to a typed `NimiError`; the
//     bridge never returns a fabricated "success" job.
//   - No provider / route rescue knobs are exposed: install source, phase,
//     and state are read straight from the SDK typed projection.

import type {
  NimiRuntimeAppHealthRepairInput,
  NimiRuntimeAdoptLocalAppInput,
  NimiRuntimeAppInstallInput,
  NimiRuntimeAppInstallJob,
  NimiRuntimeAppInstallJobEvent,
  NimiRuntimeAppLifecycleClient,
  NimiRuntimeAppLifecycleIntentBinding,
  NimiRuntimeAppOpenInput,
  NimiRuntimeAppOpenProjection,
  NimiRuntimeAppStorageProjection,
  NimiRuntimeLocalAppAdoption,
  NimiRuntimeRemoveLocalAppAdoptionInput,
  NimiRuntimeAppUninstallInput,
  NimiRuntimeAppUninstallResult,
  NimiRuntimeAppUpdateInput,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode as RuntimeGeneratedReasonCode } from '@nimiplatform/sdk/runtime/wire-types';
import {
  asNimiError,
  createNimiError,
  ReasonCode,
  type NimiError,
} from '@nimiplatform/sdk/types';
import { getDesktopRuntime } from '@renderer/infra/sdk/desktop-nimi-client-session';

// Re-export the SDK typed projections so the Apps surface (T4-W4) consumes a
// single bridge entrypoint without reaching into `@nimiplatform/sdk/runtime`
// for lifecycle types directly.
export type {
  NimiRuntimeAppHealthRepairAction,
  NimiRuntimeAppInstallJob,
  NimiRuntimeAppInstallJobEvent,
  NimiRuntimeAppInstallJobPhase,
  NimiRuntimeAppInstallJobState,
  NimiRuntimeAppInstallSourceKind,
  NimiRuntimeAppInstallStorage,
  NimiRuntimeAppLifecycleJobKind,
  NimiRuntimeAppOpenFlowStep,
  NimiRuntimeAppOpenProjection,
  NimiRuntimeAppOpenScopeRef,
  NimiRuntimeAppOpenState,
  NimiRuntimeAppStorageProjection,
  NimiRuntimeLocalAppAdoption,
  NimiRuntimeAppUninstallResult,
} from '@nimiplatform/sdk/runtime';

/**
 * Stable non-authoritative renderer call metadata for read-only app-lifecycle
 * RPCs. Host-owned identity is stamped by the protected carrier;
 * `surfaceId` scopes the call to the Apps surface for observability.
 */
const APP_LIFECYCLE_CALL_OPTIONS = {
  timeoutMs: 20_000,
  metadata: {
    surfaceId: 'desktop.apps',
  },
} as const;

/**
 * Stable streaming call metadata for the job-event watch. No timeout: a job
 * event stream is long-lived and terminates with the job's terminal frame or
 * an explicit `AbortSignal`.
 */
const APP_LIFECYCLE_STREAM_OPTIONS = {
  metadata: {
    surfaceId: 'desktop.apps',
  },
} as const;

/**
 * Resolve the SDK `runtime.appLifecycle` client. Kept lazy — the desktop
 * Runtime session is constructed during bootstrap, so the client is read at
 * call time rather than at import time.
 */
function appLifecycleModule(): NimiRuntimeAppLifecycleClient {
  return getDesktopRuntime().appLifecycle;
}

/**
 * Normalize any thrown value into a typed `NimiError`. SDK-originated
 * `NimiError`s pass through unchanged; an opaque transport failure is
 * fail-closed onto `RUNTIME_CALL_FAILED` rather than surfaced as a partial or
 * synthesized result.
 */
export function asAppLifecycleNimiError(error: unknown): NimiError {
  return asNimiError(error, {
    message: 'Runtime app lifecycle call failed',
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: 'check_runtime_app_lifecycle',
    source: 'runtime',
  });
}

/**
 * Render a single-line, human-readable detail string for an app-lifecycle
 * failure. Used by the Apps card surface for error banners; it never collapses
 * distinct fail-closed reasons into a generic message.
 */
export function formatAppLifecycleErrorDetail(error: unknown): string {
  const nimiError = asAppLifecycleNimiError(error);
  const detail = typeof nimiError.details?.cause === 'string'
    ? nimiError.details.cause.trim()
    : '';
  const message = nimiError.message || nimiError.reasonCode;
  const base = message.includes(nimiError.reasonCode)
    ? message
    : `${nimiError.reasonCode}: ${message}`;
  if (detail && !nimiError.message.includes(detail)) {
    return `${base}: ${detail}`;
  }
  return base;
}

/**
 * Renderer-safe lifecycle requests deliberately omit the Runtime-issued
 * intent binding. The renderer can request an operation, but only a
 * protected desktop host carrier can prepare and attach the anchored intent.
 */
type DesktopAppLifecycleMutationRequest<Input> = Omit<
  Input,
  keyof NimiRuntimeAppLifecycleIntentBinding
>;

export type DesktopAppLifecycleInstallRequest =
  DesktopAppLifecycleMutationRequest<NimiRuntimeAppInstallInput>;
export type DesktopAppLifecycleUninstallRequest =
  DesktopAppLifecycleMutationRequest<NimiRuntimeAppUninstallInput>;
export type DesktopAppLifecycleUpdateRequest =
  DesktopAppLifecycleMutationRequest<NimiRuntimeAppUpdateInput>;
export type DesktopAppLifecycleHealthRepairRequest =
  DesktopAppLifecycleMutationRequest<NimiRuntimeAppHealthRepairInput>;
export type DesktopAppLifecycleOpenRequest =
  DesktopAppLifecycleMutationRequest<NimiRuntimeAppOpenInput>;
export type DesktopAppLifecycleAdoptLocalRequest =
  DesktopAppLifecycleMutationRequest<NimiRuntimeAdoptLocalAppInput>;
export type DesktopAppLifecycleRemoveLocalAdoptionRequest =
  DesktopAppLifecycleMutationRequest<NimiRuntimeRemoveLocalAppAdoptionInput>;

/**
 * Host-owned, protected execution seam for lifecycle mutations. Implementors
 * prepare the Runtime-issued anchored intent over the protected desktop
 * carrier; this renderer module never receives or fabricates that binding.
 */
export interface DesktopAppLifecycleMutationExecutor {
  install(input: DesktopAppLifecycleInstallRequest): Promise<NimiRuntimeAppInstallJob>;
  adoptLocal(input: DesktopAppLifecycleAdoptLocalRequest): Promise<NimiRuntimeLocalAppAdoption>;
  removeLocalAdoption(
    input: DesktopAppLifecycleRemoveLocalAdoptionRequest,
  ): Promise<NimiRuntimeLocalAppAdoption>;
  uninstall(input: DesktopAppLifecycleUninstallRequest): Promise<NimiRuntimeAppUninstallResult>;
  update(input: DesktopAppLifecycleUpdateRequest): Promise<NimiRuntimeAppInstallJob>;
  healthRepair(input: DesktopAppLifecycleHealthRepairRequest): Promise<NimiRuntimeAppInstallJob>;
  open(input: DesktopAppLifecycleOpenRequest): Promise<NimiRuntimeAppOpenProjection>;
}

/**
 * The desktop App Lifecycle bridge surface. Read methods use the SDK typed
 * projections with stable desktop metadata; mutation methods delegate only to
 * the injected protected host executor. Each method either resolves with a
 * typed projection or rejects with a typed `NimiError`.
 */
export interface DesktopAppLifecycleBridge {
  /**
   * Trigger the Runtime-owned install lifecycle for an admitted app. Resolves
   * with the initial typed `AppInstallJob` projection (`kind=install`).
   */
  install(input: DesktopAppLifecycleInstallRequest): Promise<NimiRuntimeAppInstallJob>;
  /** Explicitly adopt a user-selected local app root through Runtime validation. */
  adoptLocal(input: DesktopAppLifecycleAdoptLocalRequest): Promise<NimiRuntimeLocalAppAdoption>;
  /** Remove a Runtime-owned local adoption record without deleting durable data by default. */
  removeLocalAdoption(
    input: DesktopAppLifecycleRemoveLocalAdoptionRequest,
  ): Promise<NimiRuntimeLocalAppAdoption>;
  /**
   * Uninstall an app's release payload. Durable app data is kept unless the
   * caller passes the explicit destructive-delete confirmation.
   */
  uninstall(input: DesktopAppLifecycleUninstallRequest): Promise<NimiRuntimeAppUninstallResult>;
  /** Read a single lifecycle job's typed projection by id. */
  getJob(jobId: string): Promise<NimiRuntimeAppInstallJob>;
  /** List lifecycle job projections for one app. There is no global job list. */
  listJobs(appId: string): Promise<NimiRuntimeAppInstallJob[]>;
  /** Read the Runtime-owned app-scoped storage projection. */
  storage(
    input: { appId: string },
    options?: Parameters<NimiRuntimeAppLifecycleClient['storage']>[1],
  ): Promise<NimiRuntimeAppStorageProjection>;
  /**
   * Subscribe to the typed job-event stream. Each frame carries a monotonic
   * sequence and the full job snapshot, so the consumer never rebuilds state
   * from a partial delta. `signal` aborts the long-lived stream.
   */
  watchJobEvents(input: {
    jobId: string;
    signal?: AbortSignal;
  }): Promise<AsyncIterable<NimiRuntimeAppInstallJobEvent>>;
  /**
   * Trigger the Runtime-owned atomic update lifecycle. Resolves with the typed
   * update job projection (`kind=update`).
   */
  update(input: DesktopAppLifecycleUpdateRequest): Promise<NimiRuntimeAppInstallJob>;
  /**
   * Trigger the Runtime-owned health/repair lifecycle. `cancel` resolves with
   * the cancelled job; `retry` / `repair` / `reinstall` resolve with the new
   * in-flight job.
   */
  healthRepair(input: DesktopAppLifecycleHealthRepairRequest): Promise<NimiRuntimeAppInstallJob>;
  /**
   * Open (launch) an admitted Nimi App through the Runtime Open flow
   * (`K-APP-017`). Requires an explicit app-launch `AIScopeRef` — the bridge
   * forwards it verbatim and never infers it. Resolves with the typed Open
   * projection: a `blocked` open carries the distinct fail-closed `reasonCode`
   * and the step that blocked; it is never projected as launched.
   */
  open(input: DesktopAppLifecycleOpenRequest): Promise<NimiRuntimeAppOpenProjection>;
}

function requireJobId(jobId: string): string {
  const normalized = typeof jobId === 'string' ? jobId.trim() : '';
  if (!normalized) {
    // Fail closed before the RPC: a job read with no id can never resolve to
    // a real projection, and must not be papered over with a placeholder.
    throw asAppLifecycleNimiError(
      createNimiError({
        message: 'desktop apps lifecycle bridge requires a non-empty jobId',
        reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_JOB_ID_REQUIRED,
        actionHint: 'pass_runtime_emitted_job_id',
        source: 'sdk',
      }),
    );
  }
  return normalized;
}

async function rejectMissingProtectedDesktopLifecycleCarrier(): Promise<never> {
  throw createNimiError({
    message: 'Desktop Apps requires a protected desktop control carrier for lifecycle changes',
    reasonCode: RuntimeGeneratedReasonCode[
      RuntimeGeneratedReasonCode.DESKTOP_CONTROL_TRANSPORT_REQUIRED
    ],
    actionHint: 'connect_protected_desktop_control_carrier',
    source: 'runtime',
  });
}

const missingProtectedDesktopLifecycleCarrier: DesktopAppLifecycleMutationExecutor = {
  install: rejectMissingProtectedDesktopLifecycleCarrier,
  adoptLocal: rejectMissingProtectedDesktopLifecycleCarrier,
  removeLocalAdoption: rejectMissingProtectedDesktopLifecycleCarrier,
  uninstall: rejectMissingProtectedDesktopLifecycleCarrier,
  update: rejectMissingProtectedDesktopLifecycleCarrier,
  healthRepair: rejectMissingProtectedDesktopLifecycleCarrier,
  open: rejectMissingProtectedDesktopLifecycleCarrier,
};

/**
 * Construct the desktop App Lifecycle bridge. Read-only projections use the
 * SDK client; mutations require an injected host-owned protected executor.
 */
export function createDesktopAppLifecycleBridge(deps?: {
  getModule?: () => NimiRuntimeAppLifecycleClient;
  mutationExecutor?: DesktopAppLifecycleMutationExecutor;
}): DesktopAppLifecycleBridge {
  const getModule = deps?.getModule ?? appLifecycleModule;
  const mutationExecutor = deps?.mutationExecutor ?? missingProtectedDesktopLifecycleCarrier;
  return {
    async install(input) {
      try {
        return await mutationExecutor.install(input);
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async adoptLocal(input) {
      try {
        return await mutationExecutor.adoptLocal(input);
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async removeLocalAdoption(input) {
      const appId = requireAppId(input?.appId ?? '');
      try {
        return await mutationExecutor.removeLocalAdoption({
          appId,
          deleteDurableDataConfirmed: Boolean(input?.deleteDurableDataConfirmed),
        });
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async uninstall(input) {
      try {
        return await mutationExecutor.uninstall(input);
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async getJob(jobId) {
      const normalized = requireJobId(jobId);
      try {
        return await getModule().getJob({ jobId: normalized }, APP_LIFECYCLE_CALL_OPTIONS);
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async listJobs(appId) {
      const filterAppId = requireAppId(appId);
      try {
        return await getModule().listJobs(
          { appId: filterAppId },
          APP_LIFECYCLE_CALL_OPTIONS,
        );
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async storage(input, options) {
      try {
        return await getModule().storage(input, options ?? APP_LIFECYCLE_CALL_OPTIONS);
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async watchJobEvents(input) {
      const jobId = requireJobId(input?.jobId ?? '');
      try {
        return await getModule().watchJobEvents(
          { jobId },
          {
            ...APP_LIFECYCLE_STREAM_OPTIONS,
            ...(input?.signal ? { signal: input.signal } : {}),
          },
        );
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async update(input) {
      try {
        return await mutationExecutor.update(input);
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async healthRepair(input) {
      try {
        return await mutationExecutor.healthRepair(input);
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async open(input) {
      try {
        return await mutationExecutor.open(input);
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
  };
}

function requireAppId(appId: string): string {
  const normalized = typeof appId === 'string' ? appId.trim() : '';
  if (!normalized) {
    throw asAppLifecycleNimiError(
      createNimiError({
        message: 'desktop apps lifecycle bridge requires a non-empty appId',
        reasonCode: ReasonCode.SDK_RUNTIME_APP_LIFECYCLE_APP_ID_REQUIRED,
        actionHint: 'pass_admitted_nimi_app_id',
        source: 'sdk',
      }),
    );
  }
  return normalized;
}

/**
 * Default desktop App Lifecycle bridge bound to the live platform client.
 * The Apps surface (T4-W4) consumes this; tests construct their own bridge
 * via `createDesktopAppLifecycleBridge` with an injected module stub.
 */
export const desktopAppLifecycleBridge: DesktopAppLifecycleBridge =
  createDesktopAppLifecycleBridge();
