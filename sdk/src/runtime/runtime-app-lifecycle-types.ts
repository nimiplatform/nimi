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
  | 'cancelled'
  | 'uninstalled';

/** Terminal / in-flight job state. Mirrors `AppInstallJobState`. */
export type RuntimeAppInstallJobState =
  | 'queued'
  | 'in_progress'
  | 'installed'
  | 'failed'
  | 'cancelled'
  | 'uninstalled';

/** Lifecycle operation that produced a job. Mirrors `AppLifecycleJobKind`. */
export type RuntimeAppLifecycleJobKind =
  | 'install'
  | 'update'
  | 'repair'
  | 'uninstall';

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
  /**
   * The watchable uninstall lifecycle job (kind=`uninstall`). It is the
   * single live-job truth source for the `uninstalling` card state and can be
   * followed via `watchJobEvents`.
   */
  job: RuntimeAppInstallJob;
};

/**
 * Explicit canonical app-launch AIConfig scope (`P-AISC-007`). It is the
 * app-shape `AIScopeRef`: `kind` is always `app`; `ownerId` is the admitted
 * Nimi App id being opened; `surfaceId` is set only when the app's manifest
 * declares a stable AI feature surface. `open` requires this scope and never
 * infers it (`S-APP-003` / `K-APP-017`).
 */
export type RuntimeAppOpenScopeRef = {
  kind: 'app';
  ownerId: string;
  surfaceId?: string;
};

/** Typed Open-flow step. Mirrors `AppOpenFlowStep` (K-APP-017). */
export type RuntimeAppOpenFlowStep =
  | 'resolve_registry'
  | 'verify_package'
  | 'verify_library'
  | 'verify_app_data'
  | 'verify_permissions'
  | 'ensure_aiconfig'
  | 'validate_manifest'
  | 'launch';

/** Terminal Open-flow state. Mirrors `AppOpenState`. */
export type RuntimeAppOpenState = 'launched' | 'blocked';

/**
 * Typed Open-flow projection. On a `blocked` open, `reasonCode` carries the
 * distinct fail-closed reason and `reachedStep` names the exact step that
 * blocked — it is never collapsed and never projected as launched.
 */
export type RuntimeAppOpenProjection = {
  appId: string;
  state: RuntimeAppOpenState;
  reachedStep: RuntimeAppOpenFlowStep;
  launched: boolean;
  /** Active release version the launch resolved. Empty when blocked early. */
  activeVersion?: string;
  /** The resolved app-launch AIConfig scope. */
  scope?: RuntimeAppOpenScopeRef;
  /** Typed reason on a blocked open; `ACTION_EXECUTED` on a launched open. */
  reasonCode?: string;
  detail?: string;
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

export type RuntimeAppOpenInput = {
  /** Admitted Nimi App registry id to open. */
  appId: string;
  /**
   * Mandatory explicit app-launch AIConfig scope (`S-APP-003` / `K-APP-017`).
   * `open` never infers the launch scope.
   */
  scope: RuntimeAppOpenScopeRef;
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
  /**
   * Open (launch) an admitted Nimi App through the Runtime Open flow
   * (`K-APP-017`). It requires an explicit app-launch `AIScopeRef` and never
   * infers launch scope. Returns the typed Open projection: a `blocked` open
   * carries the distinct fail-closed `reasonCode` and the step that blocked;
   * it is never projected as launched.
   */
  open(
    input: RuntimeAppOpenInput,
    options?: RuntimeCallOptions,
  ): Promise<RuntimeAppOpenProjection>;
};
