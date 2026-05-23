import { localRuntime, type LocalRuntimeEnvironmentDependencyJob, type LocalRuntimeEnvironmentPlanDependency, type LocalRuntimeFacade } from '../../../runtime/local-runtime/index.js';
import type { PlatformAIProfileFactoryRow } from '../../../runtime/platform-catalog/index.js';
import type { ProductControlState } from '@renderer/bridge';

export const FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE = 'first-run';

export type FirstRunMaterializationStatus =
  | 'needs_confirmation'
  | 'starting'
  | 'in_progress'
  | 'activation_pending'
  | 'local_ai_ready'
  | 'repair_required'
  | 'failed'
  | 'cancelled'
  | 'unsupported'
  | 'blocked';

export type FirstRunMaterializationProductState = Extract<
  ProductControlState,
  | 'local_ai_profile_selected_assets_missing'
  | 'local_ai_profile_selected_environment_not_ready'
  | 'local_ai_assets_downloaded_environment_not_ready'
  | 'local_ai_ready'
  | 'repair_required'
  | 'blocked'
>;

export type FirstRunMaterializationDependencyProjection = {
  readonly packId: string;
  readonly dependency: LocalRuntimeEnvironmentPlanDependency;
  readonly job: LocalRuntimeEnvironmentDependencyJob | null;
};

export type FirstRunMaterializationProjection = {
  readonly status: FirstRunMaterializationStatus;
  readonly productState: FirstRunMaterializationProductState;
  readonly reason: string;
  readonly missingDependencyFamilies: readonly string[];
  readonly dependencies: readonly FirstRunMaterializationDependencyProjection[];
};

export type FirstRunMaterializationInput = {
  readonly profile: PlatformAIProfileFactoryRow;
  readonly runtimeDataRoot?: string | null;
  // installLevel is the user's first-run Minimal/Recommended choice. It is
  // relayed to Runtime's ResolveLocalEnvironmentPlan so Runtime resolves the
  // pack's model.asset / model.companion-asset dependencies internally via the
  // K-MCAT-034 deterministic resolver — the desktop never receives or relays
  // model identity (design/05 desktop passthrough).
  readonly installLevel?: string | null;
  readonly runtime?: Pick<
    LocalRuntimeFacade,
    | 'resolveEnvironmentPlan'
    | 'listEnvironmentDependencyJobs'
    | 'startEnvironmentDependencyJob'
    | 'cancelEnvironmentDependencyJob'
    | 'retryEnvironmentDependencyJob'
    | 'repairEnvironmentDependency'
  >;
};

function normalizeState(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function latestJob(
  jobs: readonly LocalRuntimeEnvironmentDependencyJob[],
  dependency: LocalRuntimeEnvironmentPlanDependency,
): LocalRuntimeEnvironmentDependencyJob | null {
  return jobs
    .filter((job) =>
      job.environmentKey === dependency.environmentKey
      && job.dependencyFamily === dependency.dependencyFamily
      && job.dependencyId === dependency.dependencyId,
    )
    .sort((left, right) => String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')))[0] ?? null;
}

function dependencyReady(dependency: LocalRuntimeEnvironmentPlanDependency): boolean {
  const state = normalizeState(dependency.state);
  // Runtime materializer authority defines dependency readiness as verified
  // ready_system or ready_managed. A selected source record id or candidate
  // state is not readiness; backend first-run admission remains the final
  // product local_ai_ready evidence.
  return state === 'ready_system' || state === 'ready_managed';
}

function dependencyNeedsConfirmation(dependency: LocalRuntimeEnvironmentPlanDependency): boolean {
  return normalizeState(dependency.state) === 'needs_confirmation'
    && dependency.confirmationRequired === true;
}

function dependencyStartable(
  dependency: LocalRuntimeEnvironmentPlanDependency,
  job: LocalRuntimeEnvironmentDependencyJob | null,
): boolean {
  if (dependencyReady(dependency) || !dependencyNeedsConfirmation(dependency) || jobActive(job)) return false;
  const jobState = normalizeState(job?.state);
  return !job && jobState !== 'failed' && jobState !== 'cancelled' && jobState !== 'unsupported' && jobState !== 'repair_required';
}

function jobActive(job: LocalRuntimeEnvironmentDependencyJob | null): boolean {
  const state = normalizeState(job?.state);
  return state === 'needs_confirmation'
    || state === 'queued'
    || state === 'starting'
    || state === 'running'
    || state === 'in_progress'
    || state === 'downloading'
    || state === 'verifying'
    || state === 'installing';
}

/**
 * Job states for which the K-RPC-025 download-progress projection is
 * meaningful — the job is actively streaming artifact bytes. A consumer must
 * gate any %/rate/ETA display on these states; for every other state the
 * progress fields are zero/absent and a percentage must not be rendered.
 */
const JOB_TRANSFERRING_STATES = new Set(['downloading', 'verifying']);

/**
 * The aggregate download-progress projection across the materialization jobs
 * that are actively transferring bytes. It is a faithful projection of the
 * Runtime job-progress fields — never a renderer-invented estimate.
 *
 * `percent` is the byte-weighted completion across transferring jobs and is
 * only defined when at least one job reports a known `bytesTotal`; when no
 * total is known it is `null` and the consumer renders an indeterminate state.
 * `speedBytesPerSec` / `etaSeconds` are `null` unless Runtime projected a
 * concrete rate — they are never fabricated.
 */
export type FirstRunMaterializationDownloadProgress = {
  readonly bytesReceived: number;
  readonly bytesTotal: number;
  readonly percent: number | null;
  readonly speedBytesPerSec: number | null;
  readonly etaSeconds: number | null;
};

/**
 * Aggregates the download-progress projection across the jobs that are
 * actively transferring bytes. Returns `null` when no job is transferring
 * (nothing to render a concrete progress for).
 */
export function aggregateMaterializationDownloadProgress(
  dependencies: readonly FirstRunMaterializationDependencyProjection[],
): FirstRunMaterializationDownloadProgress | null {
  const transferring = dependencies
    .map(({ job }) => job)
    .filter((job): job is LocalRuntimeEnvironmentDependencyJob =>
      Boolean(job) && JOB_TRANSFERRING_STATES.has(normalizeState(job?.state)));
  if (transferring.length === 0) return null;

  let bytesReceived = 0;
  let bytesTotal = 0;
  let speed = 0;
  let speedKnown = false;
  let knownTotalCount = 0;
  for (const job of transferring) {
    const received = Math.max(0, Number(job.bytesReceived) || 0);
    const total = Math.max(0, Number(job.bytesTotal) || 0);
    bytesReceived += received;
    if (total > 0) {
      bytesTotal += total;
      knownTotalCount += 1;
    }
    const jobSpeed = Math.max(0, Number(job.speedBytesPerSec) || 0);
    if (jobSpeed > 0) {
      speed += jobSpeed;
      speedKnown = true;
    }
  }
  // A percentage is projected only when every transferring job's total is
  // known — a partial total would understate completion and read as a stall.
  const percent = knownTotalCount === transferring.length && bytesTotal > 0
    ? Math.min(100, Math.round((bytesReceived / bytesTotal) * 100))
    : null;
  const speedBytesPerSec = speedKnown ? speed : null;
  // ETA is projected only when the remaining bytes and a rate are both known.
  const etaSeconds = percent !== null && speedBytesPerSec !== null && bytesReceived < bytesTotal
    ? Math.max(0, Math.round((bytesTotal - bytesReceived) / speedBytesPerSec))
    : null;
  return { bytesReceived, bytesTotal, percent, speedBytesPerSec, etaSeconds };
}

function statusFor(
  missingDependencyFamilies: readonly string[],
  dependencies: readonly FirstRunMaterializationDependencyProjection[],
): FirstRunMaterializationStatus {
  if (missingDependencyFamilies.length > 0 || dependencies.length === 0) return 'blocked';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency)
    && (normalizeState(dependency.state) === 'unsupported' || normalizeState(job?.state) === 'unsupported'),
  )) return 'unsupported';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency)
    && (normalizeState(dependency.state) === 'repair_required' || normalizeState(job?.state) === 'repair_required'),
  )) return 'repair_required';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency) && normalizeState(job?.state) === 'failed',
  )) return 'failed';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency) && normalizeState(job?.state) === 'cancelled',
  )) return 'cancelled';
  if (dependencies.some(({ dependency, job }) =>
    !dependencyReady(dependency) && dependencyNeedsConfirmation(dependency) && !job,
  )) return 'needs_confirmation';
  if (dependencies.some(({ job }) => jobActive(job))) return 'in_progress';
  if (dependencies.every(({ dependency }) => dependencyReady(dependency))) return 'local_ai_ready';
  return 'activation_pending';
}

export function productStateForMaterializationStatus(
  status: FirstRunMaterializationStatus,
): FirstRunMaterializationProductState {
  if (status === 'blocked' || status === 'unsupported') return 'blocked';
  if (status === 'failed' || status === 'repair_required' || status === 'cancelled') {
    return 'local_ai_profile_selected_environment_not_ready';
  }
  if (status === 'activation_pending') return 'local_ai_profile_selected_environment_not_ready';
  if (status === 'local_ai_ready') return 'local_ai_ready';
  return 'local_ai_profile_selected_assets_missing';
}

export function shouldResumeConfirmedFirstRunMaterialization(
  productState: ProductControlState,
  projection: FirstRunMaterializationProjection,
): boolean {
  if (projection.status !== 'needs_confirmation') return false;
  return productState === 'local_ai_profile_selected_assets_missing'
    || productState === 'local_ai_profile_selected_environment_not_ready'
    || productState === 'local_ai_assets_downloaded_environment_not_ready'
    || productState === 'local_ai_ready';
}

function isConfirmedFirstRunSetupState(productState: ProductControlState): boolean {
  return productState === 'local_ai_profile_selected_assets_missing'
    || productState === 'local_ai_profile_selected_environment_not_ready'
    || productState === 'local_ai_assets_downloaded_environment_not_ready'
    || productState === 'local_ai_ready';
}

function dependencyInMaterializationScope(
  dependency: LocalRuntimeEnvironmentPlanDependency,
  profileDependencyFamilies: readonly string[],
): boolean {
  if (dependency.required) return true;
  return profileDependencyFamilies.includes(dependency.dependencyFamily);
}

function isAutoRecoverableMaterializationFailure(job: LocalRuntimeEnvironmentDependencyJob): boolean {
  const family = normalizeState(job.dependencyFamily);
  const state = normalizeState(job.state);
  if (state !== 'failed' && state !== 'cancelled') return false;
  if (!job.retryable) return false;
  const detail = normalizeState(job.failureDetail);
  const interrupted = detail.includes('local_environment_dependency_job_interrupted')
    || detail.includes('unexpected eof')
    || detail.includes('client.timeout')
    || detail.includes('context deadline exceeded')
    || detail.includes('connection reset')
    || detail.includes('connection refused')
    || detail.includes('broken pipe')
    || detail.includes('tls handshake timeout')
    || detail.includes('timeout while reading body');
  if (family === 'model.asset' || family === 'model.companion-asset') return interrupted;
  if (
    family === 'python.runtime'
    || family === 'python.venv'
    || family === 'python.package-set'
    || family === 'python.torch-wheel'
  ) {
    return interrupted
      || detail.includes('no virtual environment or system python installation found')
      || detail.includes('system cannot find the path specified')
      || detail.includes('cannot find the path specified')
      || detail.includes('no such file or directory')
      || detail.includes('waiting for lock on uv cache');
  }
  return false;
}

export function retryableInterruptedFirstRunMaterializationJobs(
  productState: ProductControlState,
  projection: FirstRunMaterializationProjection,
): readonly LocalRuntimeEnvironmentDependencyJob[] {
  if (!isConfirmedFirstRunSetupState(productState)) return [];
  if (projection.status !== 'failed' && projection.status !== 'cancelled') return [];
  return projection.dependencies
    .filter(({ dependency }) => !dependencyReady(dependency))
    .map(({ job }) => job)
    .filter((job): job is LocalRuntimeEnvironmentDependencyJob =>
      job !== null && isAutoRecoverableMaterializationFailure(job));
}

export function repairableConfirmedFirstRunMaterializationDependencies(
  productState: ProductControlState,
  projection: FirstRunMaterializationProjection,
): readonly FirstRunMaterializationDependencyProjection[] {
  if (!isConfirmedFirstRunSetupState(productState)) return [];
  if (projection.status !== 'repair_required') return [];
  return projection.dependencies.filter(({ dependency, job }) =>
    !dependencyReady(dependency)
    && (normalizeState(dependency.state) === 'repair_required'
    || normalizeState(job?.state) === 'repair_required'));
}

function reasonForStatus(
  status: FirstRunMaterializationStatus,
  missingDependencyFamilies: readonly string[],
): string {
  if (missingDependencyFamilies.length > 0) {
    return `missing_dependency_families:${missingDependencyFamilies.join(',')}`;
  }
  switch (status) {
    case 'needs_confirmation': return 'materialization_requires_confirmation';
    case 'starting': return 'runtime_materialization_jobs_started';
    case 'in_progress': return 'runtime_materialization_jobs_in_progress';
    case 'activation_pending': return 'runtime_activation_gate_not_ready';
    case 'local_ai_ready': return 'runtime_local_ai_ready_evidence_projected';
    case 'repair_required': return 'runtime_materialization_repair_required';
    case 'failed': return 'runtime_materialization_job_failed';
    case 'cancelled': return 'runtime_materialization_job_cancelled';
    case 'unsupported': return 'runtime_materialization_unsupported';
    case 'blocked': return 'runtime_materialization_blocked';
  }
}

export async function resolveFirstRunMaterializationProjection(
  input: FirstRunMaterializationInput,
): Promise<FirstRunMaterializationProjection> {
  const runtime = input.runtime ?? localRuntime;
  const packIds = unique(input.profile.localComputePackRefs);
  const requiredFamilies = unique(input.profile.dependencyFamilyRefs);
  const plans = await Promise.all(packIds.map((packId) =>
    runtime.resolveEnvironmentPlan({
      packId,
      consumerScope: FIRST_RUN_MATERIALIZATION_CONSUMER_SCOPE,
      runtimeDataRoot: input.runtimeDataRoot || undefined,
      installLevel: input.installLevel || undefined,
    }),
  ));
  const dependencyByKey = new Map<string, FirstRunMaterializationDependencyProjection>();
  for (const plan of plans) {
    for (const dependency of plan.dependencies) {
      if (!dependencyInMaterializationScope(dependency, requiredFamilies)) continue;
      dependencyByKey.set(`${dependency.environmentKey}:${dependency.dependencyFamily}:${dependency.dependencyId}`, {
        packId: plan.packId,
        dependency,
        job: null,
      });
    }
  }
  const dependencies = await Promise.all(Array.from(dependencyByKey.values()).map(async (item) => {
    const jobs = await runtime.listEnvironmentDependencyJobs({ environmentKey: item.dependency.environmentKey });
    return { ...item, job: latestJob(jobs, item.dependency) };
  }));
  const foundFamilies = new Set(dependencies.map(({ dependency }) => dependency.dependencyFamily));
  const missingDependencyFamilies = requiredFamilies.filter((family) => !foundFamilies.has(family));
  const status = statusFor(missingDependencyFamilies, dependencies);
  return {
    status,
    productState: productStateForMaterializationStatus(status),
    reason: reasonForStatus(status, missingDependencyFamilies),
    missingDependencyFamilies,
    dependencies,
  };
}

export async function startFirstRunMaterialization(
  input: FirstRunMaterializationInput & { readonly confirmed: boolean },
): Promise<FirstRunMaterializationProjection> {
  const runtime = input.runtime ?? localRuntime;
  const before = await resolveFirstRunMaterializationProjection({ ...input, runtime });
  if (input.profile.materializationConfirmationRequired && !input.confirmed) {
    return {
      ...before,
      status: 'needs_confirmation',
      productState: productStateForMaterializationStatus('needs_confirmation'),
      reason: 'materialization_requires_confirmation',
    };
  }
  const startable = before.dependencies.filter(({ dependency, job }) => dependencyStartable(dependency, job));
  await Promise.all(startable.map(({ dependency }) =>
    runtime.startEnvironmentDependencyJob({
      environmentKey: dependency.environmentKey,
      dependencyFamily: dependency.dependencyFamily,
      dependencyId: dependency.dependencyId,
      sourceKind: dependency.sourceKind,
      confirmed: input.confirmed,
    }, { caller: 'core' }),
  ));
  const after = await resolveFirstRunMaterializationProjection({ ...input, runtime });
  return startable.length > 0
    ? {
        ...after,
        status: after.status === 'needs_confirmation' ? 'starting' : after.status,
        productState: productStateForMaterializationStatus(after.status === 'needs_confirmation' ? 'starting' : after.status),
        reason: 'runtime_materialization_jobs_started',
      }
    : after;
}

export async function cancelFirstRunMaterializationJob(
  input: FirstRunMaterializationInput & { readonly jobId: string },
): Promise<FirstRunMaterializationProjection> {
  const runtime = input.runtime ?? localRuntime;
  await runtime.cancelEnvironmentDependencyJob({ jobId: input.jobId }, { caller: 'core' });
  return resolveFirstRunMaterializationProjection({ ...input, runtime });
}

export async function retryFirstRunMaterializationJob(
  input: FirstRunMaterializationInput & { readonly jobId: string; readonly confirmed: boolean },
): Promise<FirstRunMaterializationProjection> {
  const runtime = input.runtime ?? localRuntime;
  await runtime.retryEnvironmentDependencyJob({ jobId: input.jobId, confirmed: input.confirmed }, { caller: 'core' });
  return resolveFirstRunMaterializationProjection({ ...input, runtime });
}

export async function repairFirstRunMaterializationDependency(
  input: FirstRunMaterializationInput & {
    readonly dependency: LocalRuntimeEnvironmentPlanDependency;
    readonly confirmed: boolean;
    readonly reasonCode?: string;
  },
): Promise<FirstRunMaterializationProjection> {
  const runtime = input.runtime ?? localRuntime;
  await runtime.repairEnvironmentDependency({
    environmentKey: input.dependency.environmentKey,
    dependencyFamily: input.dependency.dependencyFamily,
    dependencyId: input.dependency.dependencyId,
    confirmed: input.confirmed,
    reasonCode: input.reasonCode,
  }, { caller: 'core' });
  return resolveFirstRunMaterializationProjection({ ...input, runtime });
}
