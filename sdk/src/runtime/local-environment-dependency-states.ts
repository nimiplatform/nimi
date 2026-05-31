const LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_READY_STATES: ReadonlySet<string> = new Set([
  'ready_managed',
  'ready_system',
]);

const LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_STARTABLE_STATES: ReadonlySet<string> = new Set([
  'needs_confirmation',
  'failed',
  'cancelled',
]);

const LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_NEEDS_CONFIRMATION_STATES: ReadonlySet<string> = new Set([
  'needs_confirmation',
]);

const LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED_STATES: ReadonlySet<string> = new Set([
  'repair_required',
]);

const LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_UNSUPPORTED_STATES: ReadonlySet<string> = new Set([
  'unsupported',
]);

const LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_JOB_ACTIVE_STATES: ReadonlySet<string> = new Set([
  'queued',
  'downloading',
  'verifying',
  'installing',
]);

const LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_JOB_TRANSFERRING_STATES: ReadonlySet<string> = new Set([
  'downloading',
  'verifying',
]);

const LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_JOB_RETRYABLE_STATES: ReadonlySet<string> = new Set([
  'failed',
  'cancelled',
  'unsupported',
]);

const LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_JOB_FAILED_STATES: ReadonlySet<string> = new Set([
  'failed',
]);

const LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_JOB_CANCELLED_STATES: ReadonlySet<string> = new Set([
  'cancelled',
]);

function normalizeRuntimeState(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function clampPercent(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  if (parsed >= 100) return 100;
  return Math.round(parsed);
}

export type LocalRuntimeEnvironmentPlanDependencyProjection = {
  dependencyFamily: string;
  dependencyId: string;
  required: boolean;
  state: string;
  sourceKind: string;
  confirmationRequired: boolean;
  selectedSourceRecordId?: string;
  environmentKey: string;
  canonicalRoot?: string;
  reasonCode?: string;
  detail?: string;
};

export type LocalRuntimeEnvironmentPlanProjection = {
  planId: string;
  packId: string;
  productLabel: string;
  hostProfileId: string;
  platformTuple: string;
  runtimeDataRoot?: string;
  consumerScope?: string;
  cloudOnlyImpact?: string;
  state: string;
  reasonCode?: string;
  dependencies: LocalRuntimeEnvironmentPlanDependencyProjection[];
};

export type LocalRuntimeEnvironmentDependencyJobProjection = {
  jobId: string;
  environmentKey: string;
  dependencyFamily: string;
  dependencyId: string;
  state: string;
  sourceKind: string;
  canonicalRoot?: string;
  selectedSourceRecordId?: string;
  failureDetail?: string;
  retryable: boolean;
  createdAt?: string;
  updatedAt?: string;
  bytesReceived: number;
  bytesTotal: number;
  percent: number;
  speedBytesPerSec: number;
  etaSeconds: number;
};

export function parseLocalRuntimeEnvironmentPlanDependencyProjection(
  value: unknown,
): LocalRuntimeEnvironmentPlanDependencyProjection {
  const record = asRecord(value);
  return {
    dependencyFamily: asString(record.dependencyFamily),
    dependencyId: asString(record.dependencyId),
    required: Boolean(record.required),
    state: asString(record.state),
    sourceKind: asString(record.sourceKind),
    confirmationRequired: Boolean(record.confirmationRequired),
    selectedSourceRecordId: asString(record.selectedSourceRecordId) || undefined,
    environmentKey: asString(record.environmentKey),
    canonicalRoot: asString(record.canonicalRoot) || undefined,
    reasonCode: asString(record.reasonCode) || undefined,
    detail: asString(record.detail) || undefined,
  };
}

export function parseLocalRuntimeEnvironmentPlanProjection(
  value: unknown,
): LocalRuntimeEnvironmentPlanProjection {
  const record = asRecord(value);
  const dependencies = Array.isArray(record.dependencies)
    ? record.dependencies.map((item) => parseLocalRuntimeEnvironmentPlanDependencyProjection(item))
    : [];
  return {
    planId: asString(record.planId),
    packId: asString(record.packId),
    productLabel: asString(record.productLabel),
    hostProfileId: asString(record.hostProfileId),
    platformTuple: asString(record.platformTuple),
    runtimeDataRoot: asString(record.runtimeDataRoot) || undefined,
    consumerScope: asString(record.consumerScope) || undefined,
    cloudOnlyImpact: asString(record.cloudOnlyImpact) || undefined,
    state: asString(record.state),
    reasonCode: asString(record.reasonCode) || undefined,
    dependencies,
  };
}

export function parseLocalRuntimeEnvironmentDependencyJobProjection(
  value: unknown,
): LocalRuntimeEnvironmentDependencyJobProjection {
  const record = asRecord(value);
  return {
    jobId: asString(record.jobId),
    environmentKey: asString(record.environmentKey),
    dependencyFamily: asString(record.dependencyFamily),
    dependencyId: asString(record.dependencyId),
    state: asString(record.state),
    sourceKind: asString(record.sourceKind),
    canonicalRoot: asString(record.canonicalRoot) || undefined,
    selectedSourceRecordId: asString(record.selectedSourceRecordId) || undefined,
    failureDetail: asString(record.failureDetail) || undefined,
    retryable: Boolean(record.retryable),
    createdAt: asString(record.createdAt) || undefined,
    updatedAt: asString(record.updatedAt) || undefined,
    bytesReceived: nonNegativeNumber(record.bytesReceived),
    bytesTotal: nonNegativeNumber(record.bytesTotal),
    percent: clampPercent(record.percent),
    speedBytesPerSec: nonNegativeNumber(record.speedBytesPerSec),
    etaSeconds: nonNegativeNumber(record.etaSeconds),
  };
}

export function isLocalRuntimeEnvironmentDependencyReadyState(state: unknown): boolean {
  return LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_READY_STATES.has(normalizeRuntimeState(state));
}

export function isLocalRuntimeEnvironmentDependencyStartableState(state: unknown): boolean {
  return LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_STARTABLE_STATES.has(normalizeRuntimeState(state));
}

export function isLocalRuntimeEnvironmentDependencyNeedsConfirmationState(state: unknown): boolean {
  return LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_NEEDS_CONFIRMATION_STATES.has(normalizeRuntimeState(state));
}

export function isLocalRuntimeEnvironmentDependencyRepairRequiredState(state: unknown): boolean {
  return LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED_STATES.has(normalizeRuntimeState(state));
}

export function isLocalRuntimeEnvironmentDependencyUnsupportedState(state: unknown): boolean {
  return LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_UNSUPPORTED_STATES.has(normalizeRuntimeState(state));
}

export function isLocalRuntimeEnvironmentDependencyJobActiveState(state: unknown): boolean {
  return LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_JOB_ACTIVE_STATES.has(normalizeRuntimeState(state));
}

export function isLocalRuntimeEnvironmentDependencyJobTransferringState(state: unknown): boolean {
  return LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_JOB_TRANSFERRING_STATES.has(normalizeRuntimeState(state));
}

export function isLocalRuntimeEnvironmentDependencyJobRetryableState(state: unknown): boolean {
  return LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_JOB_RETRYABLE_STATES.has(normalizeRuntimeState(state));
}

export function isLocalRuntimeEnvironmentDependencyJobFailedState(state: unknown): boolean {
  return LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_JOB_FAILED_STATES.has(normalizeRuntimeState(state));
}

export function isLocalRuntimeEnvironmentDependencyJobCancelledState(state: unknown): boolean {
  return LOCAL_RUNTIME_ENVIRONMENT_DEPENDENCY_JOB_CANCELLED_STATES.has(normalizeRuntimeState(state));
}
