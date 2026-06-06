// Apps card-state derivation (T4-W4).
//
// The 11 canonical product card states (manual `#### Canonical Card States`,
// `product-manual-full-authority.md` lines 945-962) are NOT a one-to-one
// projection of the SDK `AppLaunchReadiness` floor. The manual is explicit:
// the product state *refines* the 7-value readiness floor with package
// progress, update compatibility, and error details — those signals live in
// the runtime-owned `NimiRuntimeAppInstallJob` projection, not in the readiness
// floor. Four states (`installing`, `update_available`, `install_failed`,
// `uninstalling`) are unreachable from readiness alone.
//
// This module is the single derivation seam: it composes the
// `AppLaunchReadiness` floor WITH the live `NimiRuntimeAppInstallJob` for the same
// app. It is a pure function over already-typed projections — it never reads
// app-local spec files, never owns a parallel job/registry truth, and never
// collapses a distinct failure into a generic bucket (`P-NAPP-008`).
//
// Authority:
//   - manual Apps `#### Canonical Card States` (11 states, verbatim)
//   - P-NAPP-008 (no collapsed `unavailable` card)
//   - K-APP-011..K-APP-016 (NimiRuntimeAppInstallJob lifecycle)

import type { AppLaunchReadiness, NimiAppStatus } from '@nimiplatform/sdk/app';
import type {
  NimiRuntimeAppInstallJob,
  NimiRuntimeAppLifecycleJobKind,
} from './apps-lifecycle-bridge.js';

/**
 * The 11 canonical product card states, verbatim from the manual. This is the
 * exact, complete set — there is no 12th state. The historical
 * `status_unavailable` value in `apps-panel-projection.ts` is a separate
 * `status()`-failure bucket scheduled for the W5 hard-cut and is intentionally
 * NOT a member of this canonical set.
 */
export const CANONICAL_APP_CARD_STATES = [
  'not_installed_installable',
  'installing',
  'installed_ready',
  'update_available',
  'update_required',
  'permission_required',
  'repair_required',
  'unsupported_on_this_device',
  'blocked_by_policy',
  'install_failed',
  'uninstalling',
] as const;

export type CanonicalAppCardState = typeof CANONICAL_APP_CARD_STATES[number];

/**
 * The visual posture for each canonical card state, verbatim from the manual
 * `#### Canonical Card States` table `Visual posture` column.
 */
export type AppCardPosture =
  | 'greyed-selectable'
  | 'progress'
  | 'normal'
  | 'normal-badge'
  | 'warning'
  | 'disabled'
  | 'error';

const CARD_POSTURE: Record<CanonicalAppCardState, AppCardPosture> = {
  not_installed_installable: 'greyed-selectable',
  installing: 'progress',
  installed_ready: 'normal',
  update_available: 'normal-badge',
  update_required: 'warning',
  permission_required: 'warning',
  repair_required: 'warning',
  unsupported_on_this_device: 'disabled',
  blocked_by_policy: 'disabled',
  install_failed: 'error',
  uninstalling: 'progress',
};

export function postureForCardState(state: CanonicalAppCardState): AppCardPosture {
  return CARD_POSTURE[state];
}

/**
 * The live lifecycle job picked for an app's card-state derivation. The Apps
 * panel may hold several historical jobs per app; the derivation only ever
 * considers the single most-recent job (the live truth), passed here already
 * selected so this module stays a pure function.
 */
export type AppCardJobInput = NimiRuntimeAppInstallJob | undefined;

/**
 * The composed inputs for one app's card state. `readiness` is the SDK floor;
 * `status` carries the version signals; `job` is the live `NimiRuntimeAppInstallJob`
 * (already narrowed to the most recent job for this app).
 */
export interface AppCardStateInput {
  readonly readiness: AppLaunchReadiness;
  readonly status: NimiAppStatus;
  readonly job: AppCardJobInput;
}

/**
 * Derive the canonical product card state by composing the readiness floor
 * with the live `NimiRuntimeAppInstallJob`.
 *
 * Derivation order (the live job wins over the floor while it is in flight or
 * terminal-failed, because the floor cannot represent progress/error):
 *
 *  1. A live in-flight job pins the card to a progress state by `kind`:
 *     `install` -> `installing`, `update`/`repair` -> `installing` posture
 *     is not used; an in-flight `update` keeps `update_required` semantics is
 *     wrong — instead the manual gives `installing` only the install kind a
 *     Progress card. `update`/`repair` in-flight reuse the `installing`
 *     Progress posture under their own product state below.
 *  2. A terminal `failed` install/update/repair job -> `install_failed`.
 *  3. A terminal `cancelled` job is not a card state on its own — the floor
 *     re-resolves it (a cancelled install falls back to
 *     `not_installed_installable`).
 *  4. With no in-flight job, the readiness floor maps 1:1, except `ready`
 *     which is refined to `update_available` when `status` reports a
 *     different non-empty `availableVersion`.
 */
export function deriveAppCardState(input: AppCardStateInput): CanonicalAppCardState {
  const { readiness, status, job } = input;

  // (1)/(2) The live job overrides the floor: progress and terminal-failure
  // states have no readiness-floor representation.
  if (job) {
    const jobState = liveJobCardState(job);
    if (jobState) {
      return jobState;
    }
  }

  // (4) No live job overriding the card: map the readiness floor, refining
  // `ready` to `update_available` when a newer compatible version is offered.
  return mapReadinessFloor(readiness, status);
}

/**
 * Map a live `NimiRuntimeAppInstallJob` to its product card state, or `undefined`
 * when the job does not override the readiness floor (a terminal-success or
 * terminal-cancelled job lets the floor re-resolve).
 */
function liveJobCardState(job: NimiRuntimeAppInstallJob): CanonicalAppCardState | undefined {
  switch (job.state) {
    case 'queued':
    case 'in_progress':
      return inFlightCardState(job.kind);
    case 'failed':
      // A failed install/update/repair is a recoverable error card. The job
      // carries the typed `reasonCode`; the card surface renders Retry.
      return 'install_failed';
    case 'installed':
    case 'cancelled':
    case 'uninstalled':
      // Terminal success / cancellation: the readiness floor is now the
      // authority. (`uninstalled` -> floor resolves `not_installed_installable`;
      // `installed` -> floor resolves `installed_ready`/`update_available`.)
      return undefined;
    default: {
      // Exhaustiveness guard — a new job state must be handled explicitly,
      // never silently collapsed.
      const exhaustive: never = job.state;
      throw new Error(`unhandled NimiRuntimeAppInstallJob state: ${String(exhaustive)}`);
    }
  }
}

/**
 * The Progress card state for an in-flight (`queued`/`in_progress`) job.
 * `install` and `update`/`repair` all surface as `installing` (the manual's
 * single Progress-with-phase card for forward lifecycle work); `uninstall`
 * surfaces as the distinct `uninstalling` Progress card.
 */
function inFlightCardState(kind: NimiRuntimeAppLifecycleJobKind): CanonicalAppCardState {
  switch (kind) {
    case 'install':
    case 'update':
    case 'repair':
      return 'installing';
    case 'uninstall':
      return 'uninstalling';
    default: {
      const exhaustive: never = kind;
      throw new Error(`unhandled NimiRuntimeAppLifecycleJobKind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Map the SDK `AppLaunchReadiness` floor to a card state, refining `ready`
 * into `update_available` when `status` advertises a different non-empty
 * `availableVersion`. Every floor value maps explicitly — the switch is
 * exhaustive so an added floor value fails the type-check rather than
 * silently collapsing.
 */
function mapReadinessFloor(
  readiness: AppLaunchReadiness,
  status: NimiAppStatus,
): CanonicalAppCardState {
  switch (readiness) {
    case 'ready':
      return hasNonBreakingUpdate(status) ? 'update_available' : 'installed_ready';
    case 'install-required':
      return 'not_installed_installable';
    case 'update-required':
      return 'update_required';
    case 'repair-required':
      return 'repair_required';
    case 'permission-required':
      return 'permission_required';
    case 'blocked-by-master-gate':
      return 'blocked_by_policy';
    case 'unsupported':
      return 'unsupported_on_this_device';
    default: {
      const exhaustive: never = readiness;
      throw new Error(`unhandled AppLaunchReadiness: ${String(exhaustive)}`);
    }
  }
}

/**
 * A non-breaking update is available when the status projection reports an
 * `availableVersion` that is present, non-empty, and different from the
 * `installedVersion`. The readiness floor stays `ready` for a non-breaking
 * update (a breaking/required update is `update-required` instead), so this
 * is the only signal that distinguishes `update_available` from
 * `installed_ready`.
 */
function hasNonBreakingUpdate(status: NimiAppStatus): boolean {
  const available = typeof status.availableVersion === 'string' ? status.availableVersion.trim() : '';
  const installed = typeof status.installedVersion === 'string' ? status.installedVersion.trim() : '';
  return available.length > 0 && available !== installed;
}

/**
 * Select the single most-recent lifecycle job for an app from the typed job
 * list. The runtime is the job-truth owner; this is a deterministic pick over
 * the typed projection, not a renderer-local job store.
 *
 * Ordering: by `updatedAt` (ISO-8601, lexicographically sortable) descending,
 * with `createdAt` as the tiebreaker, then `jobId` as a final stable
 * tiebreaker. A job with neither timestamp sorts last.
 */
export function selectLatestJobForApp(
  appId: string,
  jobs: readonly NimiRuntimeAppInstallJob[],
): NimiRuntimeAppInstallJob | undefined {
  const normalizedAppId = appId.trim();
  const candidates = jobs.filter((job) => job.appId === normalizedAppId);
  if (candidates.length === 0) {
    return undefined;
  }
  return [...candidates].sort(compareJobRecency)[0];
}

function compareJobRecency(a: NimiRuntimeAppInstallJob, b: NimiRuntimeAppInstallJob): number {
  const aKey = a.updatedAt ?? a.createdAt ?? '';
  const bKey = b.updatedAt ?? b.createdAt ?? '';
  if (aKey !== bKey) {
    // Descending — most recent first. An empty key sorts last.
    return aKey < bKey ? 1 : -1;
  }
  // Stable tiebreaker so the pick is deterministic when timestamps collide.
  return a.jobId < b.jobId ? 1 : a.jobId > b.jobId ? -1 : 0;
}
