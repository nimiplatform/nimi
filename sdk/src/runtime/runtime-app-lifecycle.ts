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
import { toIsoFromTimestamp } from './helpers.js';
import {
  AppHealthRepairAction,
  AppInstallJobPhase as ProtoAppInstallJobPhase,
  AppInstallJobState as ProtoAppInstallJobState,
  AppInstallSourceKind as ProtoAppInstallSourceKind,
  AppLifecycleJobKind as ProtoAppLifecycleJobKind,
} from './generated/runtime/v1/app.js';
import type {
  AppInstallJob as ProtoAppInstallJob,
  AppInstallJobEvent as ProtoAppInstallJobEvent,
  AppInstallStorageProjection as ProtoAppInstallStorageProjection,
  AppUninstallResult as ProtoAppUninstallResult,
} from './generated/runtime/v1/app.js';
import { ReasonCode as RuntimeReasonCode } from './generated/runtime/v1/common.js';
import type { RuntimeInternalContext } from './internal-context.js';
import type { RuntimeCallOptions, RuntimeStreamCallOptions } from './types.js';

// ── Typed projection enums (stable string unions) ──────────────────────

/**
 * Concrete install/update/repair pipeline phase. Mirrors
 * `AppInstallJobPhase`; the consumer renders the exact step rather than a
 * generic spinner. Phase is never inferred from transfer/process state.
 */
export type RuntimeAppInstallJobPhase =
  | 'queued'
  | 'resolve_descriptor'
  | 'download'
  | 'verify'
  | 'materialize'
  | 'unpack'
  | 'evidence'
  | 'installed'
  | 'swap'
  | 'failed'
  | 'cancelled';

/** Terminal / in-flight job state. Mirrors `AppInstallJobState`. */
export type RuntimeAppInstallJobState =
  | 'queued'
  | 'in_progress'
  | 'installed'
  | 'failed'
  | 'cancelled';

/** Lifecycle operation that produced a job. Mirrors `AppLifecycleJobKind`. */
export type RuntimeAppLifecycleJobKind = 'install' | 'update' | 'repair';

/** Install artifact source. Mirrors `AppInstallSourceKind`. */
export type RuntimeAppInstallSourceKind = 'bundled' | 'external_artifact';

/** Health/repair action token. Mirrors `AppHealthRepairAction` (S-APP-002). */
export type RuntimeAppHealthRepairAction =
  | 'cancel'
  | 'retry'
  | 'repair'
  | 'reinstall';

// ── Typed projections ──────────────────────────────────────────────────

/** Runtime-owned absolute app storage roots (P-NAPP-015 / S-APP-011). */
export type RuntimeAppInstallStorage = {
  appRoot: string;
  releaseRoot: string;
  durableDataRoot: string;
  cacheRoot: string;
  tempRoot: string;
};

/**
 * Typed lifecycle job projection. Covers install / update / repair jobs;
 * `kind` distinguishes the operation so it is never inferred from `phase`.
 * On a `failed` / `cancelled` job, `reasonCode` / `failureDetail` /
 * `retryable` carry the fail-closed recovery contract.
 */
export type RuntimeAppInstallJob = {
  jobId: string;
  appId: string;
  kind: RuntimeAppLifecycleJobKind;
  releaseDescriptorRef: string;
  installedVersion: string;
  /** Active release version before an update/repair job ran. Empty for install. */
  previousVersion?: string;
  state: RuntimeAppInstallJobState;
  phase: RuntimeAppInstallJobPhase;
  sourceKind: RuntimeAppInstallSourceKind;
  /** sha256 over the artifact bytes. Present only after the verify phase. */
  sha256?: string;
  artifactBytes: number;
  storage: RuntimeAppInstallStorage;
  /** Typed fail-closed reason on a failed/cancelled job. */
  reasonCode?: string;
  failureDetail?: string;
  retryable: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** One typed progress frame from the WatchAppInstallJobEvents stream. */
export type RuntimeAppInstallJobEvent = {
  sequence: number;
  job: RuntimeAppInstallJob;
  timestamp?: string;
};

/** Typed uninstall projection. */
export type RuntimeAppUninstallResult = {
  appId: string;
  releaseRemoved: boolean;
  durableDataRemoved: boolean;
  storage: RuntimeAppInstallStorage;
  reasonCode?: string;
};

// ── Request inputs ─────────────────────────────────────────────────────

export type RuntimeAppInstallInput = {
  /** Admitted Nimi App registry id. */
  appId: string;
  /**
   * Records that the user confirmed the install requirement preview
   * (size, data roots, AI/profile requirements, permissions).
   */
  confirmed: boolean;
};

export type RuntimeAppUninstallInput = {
  appId: string;
  /**
   * When true, additionally removes the durable app data root. Requires
   * `destructiveDataDeleteConfirmed`.
   */
  deleteDurableData?: boolean;
  /**
   * Explicit user confirmation of the separate destructive
   * "Delete app data" flow with impact preview.
   */
  destructiveDataDeleteConfirmed?: boolean;
};

export type RuntimeAppUpdateInput = {
  appId: string;
  /**
   * Records that the user confirmed the update impact preview. Required for
   * a required (breaking) update; ignored for a non-breaking update.
   */
  confirmed: boolean;
};

export type RuntimeAppHealthRepairInput = {
  appId: string;
  /** Typed repair action. Only the four S-APP-002 tokens are accepted. */
  action: RuntimeAppHealthRepairAction;
  /**
   * Optionally targets a specific lifecycle job for cancel/retry. When
   * omitted, cancel/retry resolve the most recent recoverable job.
   */
  jobId?: string;
};

// ── Module surface ─────────────────────────────────────────────────────

export type RuntimeAppLifecycleModule = {
  /**
   * Trigger the Runtime-owned install lifecycle for an admitted app.
   * Returns the initial typed `AppInstallJob` projection.
   */
  install(
    input: RuntimeAppInstallInput,
    options?: RuntimeCallOptions,
  ): Promise<RuntimeAppInstallJob>;
  /** Uninstall an app's release payload (durable data kept unless confirmed). */
  uninstall(
    input: RuntimeAppUninstallInput,
    options?: RuntimeCallOptions,
  ): Promise<RuntimeAppUninstallResult>;
  /** Read a single lifecycle job's typed projection by id. */
  getJob(
    input: { jobId: string },
    options?: RuntimeCallOptions,
  ): Promise<RuntimeAppInstallJob>;
  /** List lifecycle job projections, optionally filtered to a single app. */
  listJobs(
    input?: { appId?: string },
    options?: RuntimeCallOptions,
  ): Promise<RuntimeAppInstallJob[]>;
  /**
   * Subscribe to the typed progress stream. Each frame carries a monotonic
   * sequence and the full job snapshot at that moment.
   */
  watchJobEvents(
    input?: { jobId?: string },
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<RuntimeAppInstallJobEvent>>;
  /**
   * Trigger the Runtime-owned atomic update lifecycle. Returns the typed
   * update job projection (kind=`update`).
   */
  update(
    input: RuntimeAppUpdateInput,
    options?: RuntimeCallOptions,
  ): Promise<RuntimeAppInstallJob>;
  /**
   * Trigger the Runtime-owned health/repair lifecycle. `cancel` returns the
   * cancelled job; `retry`/`repair`/`reinstall` return the new in-flight job.
   */
  healthRepair(
    input: RuntimeAppHealthRepairInput,
    options?: RuntimeCallOptions,
  ): Promise<RuntimeAppInstallJob>;
};

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

// ── Proto → typed decode (fail-closed) ─────────────────────────────────

function decodeError(message: string, reasonCode: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint: 'check_runtime_app_lifecycle_projection',
    source: 'runtime',
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function decodePhase(value: ProtoAppInstallJobPhase): RuntimeAppInstallJobPhase {
  switch (value) {
    case ProtoAppInstallJobPhase.QUEUED:
      return 'queued';
    case ProtoAppInstallJobPhase.RESOLVE_DESCRIPTOR:
      return 'resolve_descriptor';
    case ProtoAppInstallJobPhase.DOWNLOAD:
      return 'download';
    case ProtoAppInstallJobPhase.VERIFY:
      return 'verify';
    case ProtoAppInstallJobPhase.MATERIALIZE:
      return 'materialize';
    case ProtoAppInstallJobPhase.UNPACK:
      return 'unpack';
    case ProtoAppInstallJobPhase.EVIDENCE:
      return 'evidence';
    case ProtoAppInstallJobPhase.INSTALLED:
      return 'installed';
    case ProtoAppInstallJobPhase.SWAP:
      return 'swap';
    case ProtoAppInstallJobPhase.FAILED:
      return 'failed';
    case ProtoAppInstallJobPhase.CANCELLED:
      return 'cancelled';
    default:
      return decodeError(
        `runtime app install job has unspecified phase: ${String(value)}`,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
  }
}

function decodeState(value: ProtoAppInstallJobState): RuntimeAppInstallJobState {
  switch (value) {
    case ProtoAppInstallJobState.QUEUED:
      return 'queued';
    case ProtoAppInstallJobState.IN_PROGRESS:
      return 'in_progress';
    case ProtoAppInstallJobState.INSTALLED:
      return 'installed';
    case ProtoAppInstallJobState.FAILED:
      return 'failed';
    case ProtoAppInstallJobState.CANCELLED:
      return 'cancelled';
    default:
      return decodeError(
        `runtime app install job has unspecified state: ${String(value)}`,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
  }
}

function decodeKind(value: ProtoAppLifecycleJobKind): RuntimeAppLifecycleJobKind {
  switch (value) {
    case ProtoAppLifecycleJobKind.INSTALL:
      return 'install';
    case ProtoAppLifecycleJobKind.UPDATE:
      return 'update';
    case ProtoAppLifecycleJobKind.REPAIR:
      return 'repair';
    default:
      return decodeError(
        `runtime app install job has unspecified kind: ${String(value)}`,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
  }
}

function decodeSourceKind(
  value: ProtoAppInstallSourceKind,
): RuntimeAppInstallSourceKind {
  switch (value) {
    case ProtoAppInstallSourceKind.BUNDLED:
      return 'bundled';
    case ProtoAppInstallSourceKind.EXTERNAL_ARTIFACT:
      return 'external_artifact';
    default:
      return decodeError(
        `runtime app install job has unspecified source kind: ${String(value)}`,
        ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      );
  }
}

/**
 * Map a runtime-owned numeric `ReasonCode` to its stable string name. An
 * unknown / unspecified code fail-closes — it is never collapsed silently.
 */
function decodeReasonCode(value: number): string | undefined {
  if (!Number.isFinite(value) || value === RuntimeReasonCode.REASON_CODE_UNSPECIFIED) {
    return undefined;
  }
  const name = RuntimeReasonCode[value as RuntimeReasonCode];
  if (!name) {
    return decodeError(
      `runtime app lifecycle job carries an unknown reason code: ${String(value)}`,
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  return String(name).trim();
}

function decodeStorage(
  storage: ProtoAppInstallStorageProjection | undefined,
): RuntimeAppInstallStorage {
  if (!storage) {
    return decodeError(
      'runtime app lifecycle projection is missing the storage roots',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  return {
    appRoot: storage.appRoot,
    releaseRoot: storage.releaseRoot,
    durableDataRoot: storage.durableDataRoot,
    cacheRoot: storage.cacheRoot,
    tempRoot: storage.tempRoot,
  };
}

function toBytes(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toSequence(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return decodeError(
      `runtime app install job event has an invalid sequence: ${String(value)}`,
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  return parsed;
}

/**
 * Decode a proto `AppInstallJob` into the typed projection. A missing job
 * fail-closes — the consumer never receives a synthesized placeholder.
 */
export function decodeAppInstallJob(
  job: ProtoAppInstallJob | undefined,
): RuntimeAppInstallJob {
  if (!job) {
    return decodeError(
      'runtime app lifecycle response is missing the job projection',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const jobId = optionalString(job.jobId);
  if (!jobId) {
    return decodeError(
      'runtime app install job is missing a job id',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const appId = optionalString(job.appId);
  if (!appId) {
    return decodeError(
      'runtime app install job is missing an app id',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const state = decodeState(job.state);
  const reasonCode = decodeReasonCode(job.reasonCode as unknown as number);
  // A failed / cancelled job must always carry a typed reason code so the
  // consumer never has to invent one — fail-close if the runtime omits it.
  if ((state === 'failed' || state === 'cancelled') && !reasonCode) {
    return decodeError(
      `runtime app install job ${jobId} is ${state} without a typed reason code`,
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  return {
    jobId,
    appId,
    kind: decodeKind(job.kind),
    releaseDescriptorRef: job.releaseDescriptorRef,
    installedVersion: job.installedVersion,
    ...(optionalString(job.previousVersion)
      ? { previousVersion: optionalString(job.previousVersion) }
      : {}),
    state,
    phase: decodePhase(job.phase),
    sourceKind: decodeSourceKind(job.sourceKind),
    ...(optionalString(job.sha256) ? { sha256: optionalString(job.sha256) } : {}),
    artifactBytes: toBytes(job.artifactBytes),
    storage: decodeStorage(job.storage),
    ...(reasonCode ? { reasonCode } : {}),
    ...(optionalString(job.failureDetail)
      ? { failureDetail: optionalString(job.failureDetail) }
      : {}),
    retryable: job.retryable,
    ...(optionalString(job.createdAt) ? { createdAt: optionalString(job.createdAt) } : {}),
    ...(optionalString(job.updatedAt) ? { updatedAt: optionalString(job.updatedAt) } : {}),
  };
}

function decodeUninstallResult(
  result: ProtoAppUninstallResult | undefined,
): RuntimeAppUninstallResult {
  if (!result) {
    return decodeError(
      'runtime uninstall response is missing the result projection',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const appId = optionalString(result.appId);
  if (!appId) {
    return decodeError(
      'runtime uninstall result is missing an app id',
      ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    );
  }
  const reasonCode = decodeReasonCode(result.reasonCode as unknown as number);
  return {
    appId,
    releaseRemoved: result.releaseRemoved,
    durableDataRemoved: result.durableDataRemoved,
    storage: decodeStorage(result.storage),
    ...(reasonCode ? { reasonCode } : {}),
  };
}

function decodeJobEvent(
  event: ProtoAppInstallJobEvent,
): RuntimeAppInstallJobEvent {
  const timestamp = toIsoFromTimestamp(event.timestamp);
  return {
    sequence: toSequence(event.sequence),
    job: decodeAppInstallJob(event.job),
    ...(timestamp ? { timestamp } : {}),
  };
}

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
      return decodeUninstallResult(response.result);
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
  };
}
