// Desktop Apps panel projection (T4-W4, status-failure hard-cut T4-W5).
//
// Composes the Apps card grid from three typed projections:
//   1. the Nimi App registry read-projection (`NimiAppClient.list`/`.status`)
//   2. the live runtime `NimiRuntimeAppInstallJob` lifecycle projection
//      (`DesktopAppLifecycleBridge.listJobs`)
//   3. the card-state derivation (`deriveAppCardState`) that composes the SDK
//      `AppLaunchReadiness` floor WITH the live job.
//
// The renderer owns no parallel job/registry truth: every card field is read
// from an already-typed SDK projection. A missing/failed registry projection
// fails the whole panel closed.
//
// W5 hard-cut: there is no longer a 12th `status_unavailable` card state. A
// per-app `client.status()` failure resolves to one of the 11 canonical
// product card states via `resolveAppStatusFailure` (per-reason-code mapping,
// `repair_required` default) — `P-NAPP-008` / manual line 962 forbid
// collapsing distinct failures into a single "Unavailable" card.

import type {
  AppLaunchReadiness,
  NimiAppClient,
  NimiAppRow,
  NimiAppStorageRoots,
  NimiAppStatus,
} from '@nimiplatform/sdk/app';
import { resolveNimiRuntimeAppActiveStorageRoots } from '@nimiplatform/sdk/runtime';
import {
  CANONICAL_APP_CARD_STATES,
  deriveAppCardState,
  selectLatestJobForApp,
  type CanonicalAppCardState,
} from './apps-card-state.js';
import { resolveAppStatusFailure } from './apps-status-failure.js';
import type { DesktopAppLifecycleBridge, NimiRuntimeAppInstallJob } from './apps-lifecycle-bridge.js';

/**
 * The full Desktop Apps card-state vocabulary: the 11 canonical product states
 * — exactly the canonical set, with no 12th value.
 *
 * The historical `status_unavailable` bucket was hard-cut in T4-W5: a
 * `status()` failure now resolves through `resolveAppStatusFailure` to one of
 * these 11 canonical states.
 */
export const DESKTOP_APPS_CARD_STATES = CANONICAL_APP_CARD_STATES;

export type DesktopAppsCardState = CanonicalAppCardState;

/**
 * One projected Apps card entry. `job` is the live `NimiRuntimeAppInstallJob` the
 * card state was derived from (when one exists) — the view reads its `phase`
 * for the install/uninstall progress label and its `reasonCode` for the
 * `install_failed` error detail.
 */
export interface DesktopAppsEntry {
  readonly app: NimiAppRow;
  readonly status?: NimiAppStatus;
  readonly job?: NimiRuntimeAppInstallJob;
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
 * bridge — its `listJobs()` supplies the live `NimiRuntimeAppInstallJob`
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
  let jobs: readonly NimiRuntimeAppInstallJob[] = [];
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
      // W5 hard-cut: a `status()` failure resolves to one of the 11 canonical
      // card states via the per-reason-code mapping (`repair_required`
      // default). Never a dropped row, never a 12th bucket, never a collapsed
      // "Unavailable" — the detail carries the exact typed failure.
      const resolution = resolveAppStatusFailure(error);
      entries.push({
        app,
        cardState: resolution.cardState,
        detail: resolution.detail,
      });
      continue;
    }

    const job = selectLatestJobForApp(app.appId, jobs);
    let storageRoots: NimiAppStorageRoots | undefined;
    if (lifecycle) {
      try {
        storageRoots = await resolveRuntimeStatusStorageRoots(lifecycle, app.appId);
      } catch (error) {
        return { status: 'error', detail: `storage projection failed: ${errorMessage(error)}` };
      }
    }
    const statusWithRuntimeStorage = storageRoots
      ? { ...status, storageRoots }
      : status;
    const cardState = deriveAppCardState({
      readiness: statusWithRuntimeStorage.launchReadiness,
      status: statusWithRuntimeStorage,
      job,
    });
    entries.push({
      app,
      status: statusWithRuntimeStorage,
      ...(job ? { job } : {}),
      cardState,
      ...(statusWithRuntimeStorage.detail ? { detail: statusWithRuntimeStorage.detail } : {}),
    });
  }

  return { status: 'loaded', entries };
}

async function resolveRuntimeStatusStorageRoots(
  lifecycle: DesktopAppLifecycleBridge,
  appId: string,
): Promise<NimiAppStorageRoots | undefined> {
  return resolveNimiRuntimeAppActiveStorageRoots({
    appLifecycle: lifecycle,
    appId,
    label: 'desktop Apps app',
    options: {
      metadata: {
        callerKind: 'desktop-core',
        callerId: 'desktop.apps.storage',
        surfaceId: 'desktop.apps',
      },
    },
  });
}

/**
 * Legacy readiness-floor → card-state map.
 *
 * Retained as a thin delegate over the W4 derivation so existing callers and
 * tests keep a stable name. It maps the readiness floor with NO live job and
 * NO status refinement — i.e. it can only ever produce the 7 floor-reachable
 * states. The four job-dependent states (`installing`, `update_available`,
 * `install_failed`, `uninstalling`) require `deriveAppCardState` with a live
 * `NimiRuntimeAppInstallJob` / `NimiAppStatus`.
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
  const detailsCause = (error as { readonly details?: { readonly cause?: unknown } }).details?.cause;
  if (typeof detailsCause === 'string' && detailsCause.trim()) {
    return `${error.message}: ${detailsCause.trim()}`;
  }
  return error.message;
}
