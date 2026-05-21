// Desktop Apps panel projection (T4-W4).
//
// Composes the Apps card grid from three typed projections:
//   1. the Nimi App registry read-projection (`NimiAppClient.list`/`.status`)
//   2. the live runtime `RuntimeAppInstallJob` lifecycle projection
//      (`DesktopAppLifecycleBridge.listJobs`)
//   3. the card-state derivation (`deriveAppCardState`) that composes the SDK
//      `AppLaunchReadiness` floor WITH the live job.
//
// The renderer owns no parallel job/registry truth: every card field is read
// from an already-typed SDK projection. A missing/failed registry projection
// fails the whole panel closed; a per-app `status()` failure produces a typed
// `status_unavailable` bucket — that historical 12th state is preserved here
// for the W5 hard-cut and is intentionally NOT extended by W4.

import type {
  AppLaunchReadiness,
  NimiAppClient,
  NimiAppRow,
  NimiAppStatus,
} from '@nimiplatform/sdk/app';
import {
  CANONICAL_APP_CARD_STATES,
  deriveAppCardState,
  selectLatestJobForApp,
  type CanonicalAppCardState,
} from './apps-card-state.js';
import type { DesktopAppLifecycleBridge, RuntimeAppInstallJob } from './apps-lifecycle-bridge.js';

/**
 * The full Desktop Apps card-state vocabulary: the 11 canonical product states
 * plus the historical `status_unavailable` bucket.
 *
 * `status_unavailable` is NOT a canonical product state — it is the typed
 * fail-closed bucket produced only when the per-app `status()` RPC throws. The
 * preflight (§1.5 / Fork E) hard-cuts it in W5; W4 keeps it defined and does
 * not extend it, so a `status()` failure still resolves to a typed card rather
 * than dropping the row.
 */
export const DESKTOP_APPS_CARD_STATES = [
  ...CANONICAL_APP_CARD_STATES,
  'status_unavailable',
] as const;

export type DesktopAppsCardState = typeof DESKTOP_APPS_CARD_STATES[number];

/**
 * One projected Apps card entry. `job` is the live `RuntimeAppInstallJob` the
 * card state was derived from (when one exists) — the view reads its `phase`
 * for the install/uninstall progress label and its `reasonCode` for the
 * `install_failed` error detail.
 */
export interface DesktopAppsEntry {
  readonly app: NimiAppRow;
  readonly status?: NimiAppStatus;
  readonly job?: RuntimeAppInstallJob;
  readonly cardState: DesktopAppsCardState;
  readonly detail?: string;
}

export type DesktopAppsPanelProjection =
  | { readonly status: 'loaded'; readonly entries: readonly DesktopAppsEntry[] }
  | { readonly status: 'error'; readonly detail: string };

/**
 * Project the Apps panel.
 *
 * `client` is the read-projection floor. `lifecycle` is the W2d lifecycle
 * bridge — its `listJobs()` supplies the live `RuntimeAppInstallJob`
 * projection that the card-state derivation composes with the readiness floor.
 * `lifecycle` is optional so the first-paint can render the floor-only card
 * states before the job projection resolves; when omitted, the four
 * job-dependent states (`installing`/`update_available` refinement keeps
 * working from `status`, but `installing`/`uninstalling`/`install_failed`)
 * simply do not appear until a job projection is supplied.
 */
export async function projectAppsPanel(
  client: NimiAppClient,
  lifecycle?: DesktopAppLifecycleBridge,
): Promise<DesktopAppsPanelProjection> {
  if (!client) {
    return { status: 'error', detail: 'projectAppsPanel: nimiAppClient is required' };
  }

  let rows: readonly NimiAppRow[];
  try {
    rows = await client.list();
  } catch (error) {
    return { status: 'error', detail: `list failed: ${errorMessage(error)}` };
  }

  // The live lifecycle job projection. A failure here fails the panel closed
  // rather than silently dropping the job-dependent card states: the panel
  // must not render `installed_ready` for an app that is in fact mid-install.
  let jobs: readonly RuntimeAppInstallJob[] = [];
  if (lifecycle) {
    try {
      jobs = await lifecycle.listJobs();
    } catch (error) {
      return { status: 'error', detail: `lifecycle job projection failed: ${errorMessage(error)}` };
    }
  }

  const entries: DesktopAppsEntry[] = [];
  for (const app of rows) {
    let status: NimiAppStatus;
    try {
      status = await client.status(app.appId);
    } catch (error) {
      // Historical `status_unavailable` bucket (W5 hard-cut target). A typed
      // card, never a dropped row, never a collapsed "Unavailable" across
      // distinct reasons — the detail carries the exact failure.
      entries.push({
        app,
        cardState: 'status_unavailable',
        detail: `status failed: ${errorMessage(error)}`,
      });
      continue;
    }

    const job = selectLatestJobForApp(app.appId, jobs);
    const cardState = deriveAppCardState({
      readiness: status.launchReadiness,
      status,
      job,
    });
    entries.push({
      app,
      status,
      ...(job ? { job } : {}),
      cardState,
      ...(status.detail ? { detail: status.detail } : {}),
    });
  }

  return { status: 'loaded', entries };
}

/**
 * Legacy readiness-floor → card-state map.
 *
 * Retained as a thin delegate over the W4 derivation so existing callers and
 * tests keep a stable name. It maps the readiness floor with NO live job and
 * NO status refinement — i.e. it can only ever produce the 7 floor-reachable
 * states. The four job-dependent states (`installing`, `update_available`,
 * `install_failed`, `uninstalling`) require `deriveAppCardState` with a live
 * `RuntimeAppInstallJob` / `NimiAppStatus`.
 */
export function mapLaunchReadinessToAppsCardState(
  readiness: AppLaunchReadiness,
): CanonicalAppCardState {
  return deriveAppCardState({
    readiness,
    status: { appId: '', launchReadiness: readiness },
    job: undefined,
  });
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown error';
  }
  const cause = (error as { readonly cause?: unknown }).cause;
  if (cause instanceof Error && cause.message) {
    return `${error.message}: ${cause.message}`;
  }
  return error.message;
}
