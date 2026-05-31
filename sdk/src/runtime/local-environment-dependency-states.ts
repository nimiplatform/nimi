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
