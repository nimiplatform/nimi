// First-Run Setup Checklist — pure projection of the real Runtime
// materialization progression onto the calm Phase 3 sub-step checklist.
//
// The Setup phase folds four product-control states
// (`local_ai_profile_selected_assets_missing`,
// `local_ai_profile_selected_environment_not_ready`,
// `local_ai_assets_downloaded_environment_not_ready`, `local_ai_ready`) into
// one progress screen. The checklist sub-steps below project the real
// underlying Runtime materialization job/state progression — they are not
// renderer-invented progress. Each sub-step status is derived from the
// `FirstRunMaterializationProjection` (or the finalization phase) so the
// happy path stays calm and a failing sub-step surfaces the typed action
// exactly where it failed.

import type { ProductControlState } from '@renderer/bridge';
import {
  isLocalRuntimeEnvironmentDependencyJobActiveState,
  isLocalRuntimeEnvironmentDependencyJobCancelledState,
  isLocalRuntimeEnvironmentDependencyJobFailedState,
  isLocalRuntimeEnvironmentDependencyNeedsConfirmationState,
  isLocalRuntimeEnvironmentDependencyReadyState,
  isLocalRuntimeEnvironmentDependencyRepairRequiredState,
  isLocalRuntimeEnvironmentDependencyUnsupportedState,
} from '@nimiplatform/sdk/runtime';
import {
  aggregateMaterializationDownloadProgress,
  type FirstRunMaterializationDependencyProjection,
  type FirstRunMaterializationDownloadProgress,
  type FirstRunMaterializationProjection,
} from './runtime-materialization.js';

/**
 * The four design sub-steps. Ordering matches the materialization →
	 * backend baseline preparation → finalization progression.
 *
 * - `download`  — Downloading local models (assets job phase)
 * - `verify`    — Verifying files (asset verification phase)
	 * - `environment` — Preparing local environment (Runtime dependencies ready)
 * - `finalize`  — Finalizing your AI profile (product-control finalization)
 */
export type FirstRunSetupStepId = 'download' | 'verify' | 'environment' | 'finalize';

export const FIRST_RUN_SETUP_STEP_IDS: readonly FirstRunSetupStepId[] = [
  'download',
  'verify',
  'environment',
  'finalize',
];

export type FirstRunSetupStepStatus = 'pending' | 'active' | 'done' | 'failed';

export type FirstRunSetupStep = {
  readonly id: FirstRunSetupStepId;
  readonly status: FirstRunSetupStepStatus;
  /**
   * The failing dependency row, present only when `status === 'failed'`. The
   * checklist row binds the Retry / Repair / Cancel affordances to it.
   */
  readonly failingDependency: FirstRunMaterializationDependencyProjection | null;
  /** Whether the failing row's job can be retried. */
  readonly canRetry: boolean;
  /** Whether the failing row's dependency can be repaired. */
  readonly canRepair: boolean;
  /** Whether the failing/active row's job can be cancelled. */
  readonly canCancel: boolean;
  /**
   * The aggregate K-RPC-025 download-progress projection for this step, present
   * only on an `active` step whose jobs are actively transferring bytes (the
   * `download` step). It is a faithful projection of Runtime job progress — the
   * row renders a concrete %/rate/ETA from it and never invents an estimate.
   * `null` when the step is not actively downloading.
   */
  readonly downloadProgress: FirstRunMaterializationDownloadProgress | null;
};

export type FirstRunSetupChecklist = {
  readonly steps: readonly FirstRunSetupStep[];
  /** 0..100 progress for the slim bar; derived from completed sub-steps. */
  readonly progressPercent: number;
  /** True when a sub-step is in a typed failure state. */
  readonly hasFailure: boolean;
};

/**
 * Builds the setup checklist for a materialization projection.
 *
	 * `download` + `verify` cover the asset materialization jobs; `environment`
	 * covers the backend-owned local AI prepare/admission handoff; `finalize` covers product-control finalization
 * and is only marked done once the state machine itself reports
 * `ready_for_use` (handled by {@link projectSetupChecklist}).
 */
function projectFromMaterialization(
  materialization: FirstRunMaterializationProjection,
): FirstRunSetupChecklist {
  const deps = materialization.dependencies;
  const failingDep = deps.find(
    (item) =>
      isLocalRuntimeEnvironmentDependencyJobFailedState(item.job?.state)
      || isLocalRuntimeEnvironmentDependencyJobCancelledState(item.job?.state)
      || isLocalRuntimeEnvironmentDependencyRepairRequiredState(item.job?.state)
      || isLocalRuntimeEnvironmentDependencyUnsupportedState(item.job?.state)
      || isLocalRuntimeEnvironmentDependencyRepairRequiredState(item.dependency.state)
      || isLocalRuntimeEnvironmentDependencyUnsupportedState(item.dependency.state),
  ) ?? null;
  const allAssetsReady = deps.length > 0
    && deps.every((item) => isLocalRuntimeEnvironmentDependencyReadyState(item.dependency.state));

  // The materialization status is the authoritative phase signal; the four
  // sub-step statuses are a faithful projection of it.
  const status = materialization.status;
  const failed = status === 'failed' || status === 'repair_required'
    || status === 'cancelled' || status === 'blocked' || status === 'unsupported';

  let download: FirstRunSetupStepStatus;
  let verify: FirstRunSetupStepStatus;
  let environment: FirstRunSetupStepStatus;

  // An environment-level block can surface after the assets are already
  // present; an asset-level failure stops at the download/verify rows.
  const environmentBlock = status === 'blocked' || status === 'unsupported';

  if (failed) {
    if (environmentBlock && allAssetsReady) {
      download = 'done';
      verify = 'done';
      environment = 'failed';
    } else {
      // Materialization stopped at the asset rows; the failing row marks the
      // sub-step where it stopped.
      download = 'failed';
      verify = 'pending';
      environment = 'pending';
    }
  } else if (status === 'local_ai_ready') {
    download = 'done';
    verify = 'done';
    environment = 'done';
  } else if (status === 'activation_pending') {
    download = 'done';
    verify = 'done';
    environment = 'active';
  } else if (allAssetsReady) {
    download = 'done';
    verify = 'done';
    environment = 'active';
  } else {
    // Assets are still being materialized — download is the active sub-step.
    download = 'active';
    verify = 'pending';
    environment = 'pending';
  }

  const failingStepId: FirstRunSetupStepId | null = failed
    ? (environment === 'failed' ? 'environment' : 'download')
    : null;

  const canCancel = failingDep?.job
    ? isLocalRuntimeEnvironmentDependencyNeedsConfirmationState(failingDep.job.state)
      || isLocalRuntimeEnvironmentDependencyJobActiveState(failingDep.job.state)
    : false;
  const canRetry = failingDep?.job
    ? Boolean(failingDep.job.retryable)
      || isLocalRuntimeEnvironmentDependencyJobFailedState(failingDep.job.state)
      || isLocalRuntimeEnvironmentDependencyJobCancelledState(failingDep.job.state)
    : false;
  const canRepair = failingDep
    ? isLocalRuntimeEnvironmentDependencyRepairRequiredState(failingDep.dependency.state)
      || isLocalRuntimeEnvironmentDependencyJobFailedState(failingDep.job?.state)
      || isLocalRuntimeEnvironmentDependencyRepairRequiredState(failingDep.job?.state)
    : false;

  const baseStatuses: Record<FirstRunSetupStepId, FirstRunSetupStepStatus> = {
    download,
    verify,
    environment,
    finalize: 'pending',
  };

  // The concrete download-progress projection is meaningful only while assets
  // are actively being fetched — it is attached to the `download` step while
  // it is the active step. Verifying jobs roll up into the same transferring
  // aggregate, so the bar keeps moving across download → verify.
  const downloadProgress = aggregateMaterializationDownloadProgress(deps);

  const steps = FIRST_RUN_SETUP_STEP_IDS.map((id) => {
    const isFailing = failed && id === failingStepId;
    return {
      id,
      status: baseStatuses[id],
      failingDependency: isFailing ? failingDep : null,
      canRetry: isFailing ? canRetry : false,
      canRepair: isFailing ? canRepair : false,
      canCancel: isFailing ? canCancel : false,
      downloadProgress: id === 'download' && baseStatuses[id] === 'active'
        ? downloadProgress
        : null,
    } satisfies FirstRunSetupStep;
  });

  return {
    steps,
    progressPercent: computeProgress(steps),
    hasFailure: failed,
  };
}

function computeProgress(steps: readonly FirstRunSetupStep[]): number {
  const total = steps.length;
  if (total === 0) return 0;
  let earned = 0;
  for (const step of steps) {
    if (step.status === 'done') earned += 1;
    else if (step.status === 'active') earned += 0.5;
  }
  return Math.round((earned / total) * 100);
}

/**
 * Builds the Setup-phase checklist for the current product-control state and
 * the latest materialization projection.
 *
 * At `local_ai_ready` the materialization phase is already complete; the
 * first three sub-steps are done and `finalize` is the in-progress step. The
 * `finalize` step is only ever marked `done` by the terminal `ready_for_use`
 * screen, never inside the Setup phase — the renderer does not declare
 * product readiness.
 */
export function projectSetupChecklist(
  state: ProductControlState,
  materialization: FirstRunMaterializationProjection | null,
): FirstRunSetupChecklist {
  if (state === 'local_ai_ready') {
    const steps = FIRST_RUN_SETUP_STEP_IDS.map((id) => ({
      id,
      status: (id === 'finalize' ? 'active' : 'done') as FirstRunSetupStepStatus,
      failingDependency: null,
      canRetry: false,
      canRepair: false,
      canCancel: false,
      downloadProgress: null,
    } satisfies FirstRunSetupStep));
    return { steps, progressPercent: computeProgress(steps), hasFailure: false };
  }
  if (!materialization) {
    // No projection yet — the Setup phase is initializing. All sub-steps
    // pending except the first, which is the entry-active step.
    const steps = FIRST_RUN_SETUP_STEP_IDS.map((id, index) => ({
      id,
      status: (index === 0 ? 'active' : 'pending') as FirstRunSetupStepStatus,
      failingDependency: null,
      canRetry: false,
      canRepair: false,
      canCancel: false,
      downloadProgress: null,
    } satisfies FirstRunSetupStep));
    return { steps, progressPercent: computeProgress(steps), hasFailure: false };
  }
  return projectFromMaterialization(materialization);
}
