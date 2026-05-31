// Desktop App Lifecycle bridge.
//
// Renderer-side seam onto the SDK `runtime.appLifecycle` surface
// (`RuntimeAppLifecycleModule`). The desktop Apps surface (T4-W4) drives app
// install / uninstall / update / health-repair and observes the typed
// `AppInstallJob` lifecycle through this bridge — never through a direct
// gRPC client and never through a renderer-local job/registry truth.
//
// Authority:
//   - K-APP-001 / K-APP-011..K-APP-016
//     (.nimi/spec/runtime/kernel/app-messaging-contract.md)
//   - D-IPC-012 (.nimi/spec/desktop/kernel/bridge-ipc-contract.md): app
//     install/update/repair lifecycle is a Phase 2 Runtime RPC surface and
//     travels the SDK gRPC path — `getPlatformClient().runtime` — not the
//     Tauri IPC bridge path. This module is therefore an SDK-path renderer
//     service, not a `runtime-bridge/` Tauri command client.
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

import { getPlatformClient } from '@nimiplatform/sdk';
import { asNimiError } from '@nimiplatform/sdk/runtime';
import type {
  RuntimeAppHealthRepairInput,
  RuntimeAppInstallInput,
  RuntimeAppInstallJob,
  RuntimeAppInstallJobEvent,
  RuntimeAppLifecycleModule,
  RuntimeAppOpenInput,
  RuntimeAppOpenProjection,
  RuntimeAppStorageProjection,
  RuntimeAppUninstallInput,
  RuntimeAppUninstallResult,
  RuntimeAppUpdateInput,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode, type NimiError } from '@nimiplatform/sdk/types';

// Re-export the SDK typed projections so the Apps surface (T4-W4) consumes a
// single bridge entrypoint without reaching into `@nimiplatform/sdk/runtime`
// for lifecycle types directly.
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
  RuntimeAppOpenFlowStep,
  RuntimeAppOpenInput,
  RuntimeAppOpenProjection,
  RuntimeAppOpenScopeRef,
  RuntimeAppOpenState,
  RuntimeAppStorageProjection,
  RuntimeAppUninstallInput,
  RuntimeAppUninstallResult,
  RuntimeAppUpdateInput,
} from '@nimiplatform/sdk/runtime';

/**
 * Stable desktop-core call metadata for every app-lifecycle RPC. `callerKind`
 * marks the request as first-party desktop traffic; `surfaceId` scopes it to
 * the Apps surface for runtime-side observability.
 */
const APP_LIFECYCLE_CALL_OPTIONS = {
  timeoutMs: 20_000,
  metadata: {
    callerKind: 'desktop-core' as const,
    callerId: 'desktop.apps.lifecycle',
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
    callerKind: 'desktop-core' as const,
    callerId: 'desktop.apps.lifecycle',
    surfaceId: 'desktop.apps',
  },
} as const;

/**
 * Resolve the SDK `runtime.appLifecycle` module. Kept lazy — the platform
 * client is constructed during desktop bootstrap, so the module is read at
 * call time rather than at import time.
 */
function appLifecycleModule(): RuntimeAppLifecycleModule {
  return getPlatformClient().runtime.appLifecycle;
}

/**
 * Normalize any thrown value into a typed `NimiError`. SDK-originated
 * `NimiError`s pass through unchanged; an opaque transport failure is
 * fail-closed onto `RUNTIME_CALL_FAILED` rather than surfaced as a partial or
 * synthesized result.
 */
export function asAppLifecycleNimiError(error: unknown): NimiError {
  return asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: 'retry_or_check_runtime_status',
    source: 'runtime',
  });
}

/**
 * Render a single-line, human-readable detail string for an app-lifecycle
 * failure. Used by the Apps card surface for error banners; it never collapses
 * distinct fail-closed reasons into a generic message.
 */
export function formatAppLifecycleErrorDetail(error: unknown): string {
  const normalized = asAppLifecycleNimiError(error);
  const traceSuffix = normalized.traceId ? `, traceId=${normalized.traceId}` : '';
  return `${normalized.message} (reasonCode=${normalized.reasonCode}${traceSuffix})`;
}

/**
 * The desktop App Lifecycle bridge surface. Mirrors the SDK
 * `RuntimeAppLifecycleModule` one-to-one — install / uninstall / getJob /
 * listJobs / watchJobEvents / update / healthRepair — projecting the typed
 * `RuntimeAppInstallJob` lifecycle to the renderer with stable desktop-core
 * call metadata. Each method either resolves with the SDK typed projection or
 * rejects with a typed `NimiError`.
 */
export interface DesktopAppLifecycleBridge {
  /**
   * Trigger the Runtime-owned install lifecycle for an admitted app. Resolves
   * with the initial typed `AppInstallJob` projection (`kind=install`).
   */
  install(input: RuntimeAppInstallInput): Promise<RuntimeAppInstallJob>;
  /**
   * Uninstall an app's release payload. Durable app data is kept unless the
   * caller passes the explicit destructive-delete confirmation.
   */
  uninstall(input: RuntimeAppUninstallInput): Promise<RuntimeAppUninstallResult>;
  /** Read a single lifecycle job's typed projection by id. */
  getJob(jobId: string): Promise<RuntimeAppInstallJob>;
  /** List lifecycle job projections, optionally filtered to a single app. */
  listJobs(appId?: string): Promise<RuntimeAppInstallJob[]>;
  /** Read the Runtime-owned app-scoped storage truth projection. */
  storage(
    input: { appId: string },
    options?: Parameters<RuntimeAppLifecycleModule['storage']>[1],
  ): Promise<RuntimeAppStorageProjection>;
  /**
   * Subscribe to the typed job-event stream. Each frame carries a monotonic
   * sequence and the full job snapshot, so the consumer never rebuilds state
   * from a partial delta. `signal` aborts the long-lived stream.
   */
  watchJobEvents(input?: {
    jobId?: string;
    signal?: AbortSignal;
  }): Promise<AsyncIterable<RuntimeAppInstallJobEvent>>;
  /**
   * Trigger the Runtime-owned atomic update lifecycle. Resolves with the typed
   * update job projection (`kind=update`).
   */
  update(input: RuntimeAppUpdateInput): Promise<RuntimeAppInstallJob>;
  /**
   * Trigger the Runtime-owned health/repair lifecycle. `cancel` resolves with
   * the cancelled job; `retry` / `repair` / `reinstall` resolve with the new
   * in-flight job.
   */
  healthRepair(input: RuntimeAppHealthRepairInput): Promise<RuntimeAppInstallJob>;
  /**
   * Open (launch) an admitted Nimi App through the Runtime Open flow
   * (`K-APP-017`). Requires an explicit app-launch `AIScopeRef` — the bridge
   * forwards it verbatim and never infers it. Resolves with the typed Open
   * projection: a `blocked` open carries the distinct fail-closed `reasonCode`
   * and the step that blocked; it is never projected as launched.
   */
  open(input: RuntimeAppOpenInput): Promise<RuntimeAppOpenProjection>;
}

function requireJobId(jobId: string): string {
  const normalized = typeof jobId === 'string' ? jobId.trim() : '';
  if (!normalized) {
    // Fail closed before the RPC: a job read with no id can never resolve to
    // a real projection, and must not be papered over with a placeholder.
    throw asAppLifecycleNimiError(
      new Error('desktop apps lifecycle bridge requires a non-empty jobId'),
    );
  }
  return normalized;
}

/**
 * Construct the desktop App Lifecycle bridge. Exposed as a factory rather than
 * a singleton const so tests can inject a stub `RuntimeAppLifecycleModule`.
 */
export function createDesktopAppLifecycleBridge(deps?: {
  getModule?: () => RuntimeAppLifecycleModule;
}): DesktopAppLifecycleBridge {
  const getModule = deps?.getModule ?? appLifecycleModule;
  return {
    async install(input) {
      try {
        return await getModule().install(input, APP_LIFECYCLE_CALL_OPTIONS);
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async uninstall(input) {
      try {
        return await getModule().uninstall(input, APP_LIFECYCLE_CALL_OPTIONS);
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
      const filterAppId = typeof appId === 'string' ? appId.trim() : '';
      try {
        return await getModule().listJobs(
          filterAppId ? { appId: filterAppId } : {},
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
      const jobId = typeof input?.jobId === 'string' ? input.jobId.trim() : '';
      try {
        return await getModule().watchJobEvents(
          jobId ? { jobId } : {},
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
        return await getModule().update(input, APP_LIFECYCLE_CALL_OPTIONS);
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async healthRepair(input) {
      try {
        return await getModule().healthRepair(input, APP_LIFECYCLE_CALL_OPTIONS);
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
    async open(input) {
      try {
        return await getModule().open(input, APP_LIFECYCLE_CALL_OPTIONS);
      } catch (error) {
        throw asAppLifecycleNimiError(error);
      }
    },
  };
}

/**
 * Default desktop App Lifecycle bridge bound to the live platform client.
 * The Apps surface (T4-W4) consumes this; tests construct their own bridge
 * via `createDesktopAppLifecycleBridge` with an injected module stub.
 */
export const desktopAppLifecycleBridge: DesktopAppLifecycleBridge =
  createDesktopAppLifecycleBridge();
