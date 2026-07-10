// Desktop Apps panel projection (T4-W4, status-failure hard-cut T4-W5).
//
// Composes the Apps card grid from three typed projections:
//   1. the Nimi App unified inventory projection (`NimiAppClient.list`)
//   2. the live runtime `NimiRuntimeAppInstallJob` lifecycle projection
//      (`DesktopAppLifecycleBridge.listJobs`)
//   3. the card-state derivation (`deriveAppCardState`) that composes the SDK
//      inventory-derived `AppLaunchReadiness` floor WITH the live job.
//
// The renderer owns no parallel job/registry truth: every card field is read
// from an already-typed SDK projection. A missing/failed registry projection
// fails the whole panel closed.
//
// Hard-cut: `client.status()` is no longer startup readiness authority. It may
// refine version/detail/package-health fields only; `app.openReadiness` from
// the unified inventory projection is the only launch readiness floor.

import type {
  AppLaunchReadiness,
  NimiAppClient,
  NimiAppInventoryEntry,
  NimiAppOpenReadiness,
  NimiAppOrdinaryVisibility,
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
import type { DesktopAppLifecycleBridge, NimiRuntimeAppInstallJob } from './apps-lifecycle-bridge.js';

/**
 * The full Desktop Apps card-state vocabulary: the 11 canonical product states
 * — exactly the canonical set, with no 12th value. The historical
 * `status_unavailable` bucket stays hard-cut, but `status()` no longer decides
 * the card readiness floor.
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
  readonly app: NimiAppInventoryEntry;
  readonly status?: NimiAppStatus;
  readonly job?: NimiRuntimeAppInstallJob;
  readonly cardState: DesktopAppsCardState;
  readonly detail?: string;
  readonly catalogDiscoveryProof: DesktopAppsCatalogDiscoveryProof;
}

export interface DesktopAppsCatalogDiscoveryProof {
  readonly admittedCatalogDiscovery: boolean;
  readonly ordinaryVisibility: NimiAppOrdinaryVisibility | 'absent';
  readonly required: {
    readonly catalog: 'present';
    readonly ordinaryVisibility: 'ordinary-visible';
    readonly local: 'absent';
  };
  readonly sources: {
    readonly catalog: NimiAppInventoryEntry['sources']['catalog']['status'];
    readonly account: NimiAppInventoryEntry['sources']['account']['status'];
    readonly local: NimiAppInventoryEntry['sources']['local']['status'];
  };
}

export type DesktopAppsPanelProjection =
  | { readonly status: 'loaded'; readonly entries: readonly DesktopAppsEntry[] }
  | { readonly status: 'error'; readonly detail: string };

/**
 * Project the Apps panel.
 *
 * `client.list()` is the unified inventory floor. `lifecycle` is the W2d
 * lifecycle bridge — its per-app `listJobs(appId)` supplies the live
 * `NimiRuntimeAppInstallJob` projection that the card-state derivation composes
 * with the inventory readiness floor.
 * `lifecycle` is optional so the first-paint can render the floor-only card
 * states before the job projection resolves; when omitted, the four
 * job-dependent states (`installing`/`uninstalling`/`install_failed`) simply do
 * not appear until a job projection is supplied. `update_available` may still
 * refine from `status()` version detail, but readiness never does.
 */
export async function projectAppsPanel(
  client: NimiAppClient,
  lifecycle?: DesktopAppLifecycleBridge,
): Promise<DesktopAppsPanelProjection> {
  if (!client) {
    return { status: 'error', detail: 'projectAppsPanel: nimiAppClient is required' };
  }

  let inventory: readonly NimiAppInventoryEntry[];
  try {
    inventory = await client.list();
  } catch (error) {
    return { status: 'error', detail: `list failed: ${errorMessage(error)}` };
  }

  const entries: DesktopAppsEntry[] = [];
  for (const app of inventory) {
    let status = statusFromInventory(app);
    if (app.sources.catalog.status !== 'absent') {
      try {
        status = mergeInventoryStatusWithPackageRefinement(status, await client.status(app.appId));
      } catch (error) {
        status = {
          ...status,
          detail: status.detail || `status refinement failed: ${errorMessage(error)}`,
        };
      }
    }

    let jobs: readonly NimiRuntimeAppInstallJob[] = [];
    if (lifecycle) {
      try {
        jobs = await lifecycle.listJobs(app.appId);
      } catch (error) {
        return { status: 'error', detail: `lifecycle job projection failed for ${app.appId}: ${errorMessage(error)}` };
      }
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
    const readiness = launchReadinessFromInventory(app.openReadiness);
    const cardState = deriveAppCardState({
      readiness,
      status: statusWithRuntimeStorage,
      job,
    });
    entries.push({
      app,
      status: statusWithRuntimeStorage,
      ...(job ? { job } : {}),
      cardState,
      catalogDiscoveryProof: catalogDiscoveryProof(app),
      ...(statusWithRuntimeStorage.detail ? { detail: statusWithRuntimeStorage.detail } : {}),
    });
  }

  return { status: 'loaded', entries };
}

function catalogDiscoveryProof(app: NimiAppInventoryEntry): DesktopAppsCatalogDiscoveryProof {
  const sources = {
    catalog: app.sources.catalog.status,
    account: app.sources.account.status,
    local: app.sources.local.status,
  };
  const ordinaryVisibility = app.sources.catalog.value?.ordinaryVisibility ?? 'absent';
  return {
    admittedCatalogDiscovery:
      sources.catalog === 'present'
      && ordinaryVisibility === 'ordinary-visible'
      && sources.local === 'absent',
    ordinaryVisibility,
    required: {
      catalog: 'present',
      ordinaryVisibility: 'ordinary-visible',
      local: 'absent',
    },
    sources,
  };
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
        surfaceId: 'desktop.apps',
      },
    },
  });
}

/**
 * Readiness-floor → card-state map.
 *
 * Kept as a thin delegate over the W4 derivation so callers and tests share the
 * same card-state mapping. It maps the readiness floor with NO live job and
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

function statusFromInventory(app: NimiAppInventoryEntry): NimiAppStatus {
  const packageReadiness = app.sources.packageReadiness.value;
  return {
    appId: app.appId,
    launchReadiness: launchReadinessFromInventory(app.openReadiness),
    ...(app.releaseDescriptorRef ? { releaseDescriptorRef: app.releaseDescriptorRef } : {}),
    ...(app.installStoragePolicyRef ? { installStoragePolicyRef: app.installStoragePolicyRef } : {}),
    ...(packageReadiness?.verificationState ? { verificationState: packageReadiness.verificationState as NimiAppStatus['verificationState'] } : {}),
    ...(packageReadiness?.installedVersion ? { installedVersion: packageReadiness.installedVersion } : {}),
    ...(packageReadiness?.expectedVersion ? { availableVersion: packageReadiness.expectedVersion } : {}),
    ...(app.detail ? { detail: app.detail } : {}),
  };
}

function mergeInventoryStatusWithPackageRefinement(
  inventoryStatus: NimiAppStatus,
  refinement: NimiAppStatus,
): NimiAppStatus {
  return {
    ...refinement,
    appId: inventoryStatus.appId,
    launchReadiness: inventoryStatus.launchReadiness,
    ...(inventoryStatus.releaseDescriptorRef ? { releaseDescriptorRef: inventoryStatus.releaseDescriptorRef } : {}),
    ...(inventoryStatus.installStoragePolicyRef ? { installStoragePolicyRef: inventoryStatus.installStoragePolicyRef } : {}),
    ...(inventoryStatus.detail ? { detail: inventoryStatus.detail } : refinement.detail ? { detail: refinement.detail } : {}),
  };
}

function launchReadinessFromInventory(readiness: NimiAppOpenReadiness): AppLaunchReadiness {
  switch (readiness) {
    case 'ready':
    case 'install-required':
    case 'update-required':
    case 'repair-required':
    case 'permission-required':
    case 'blocked-by-master-gate':
    case 'unsupported':
      return readiness;
    case 'sign-in-required':
      return 'blocked-by-master-gate';
    case 'connect-required':
      return 'install-required';
    default: {
      const exhaustive: never = readiness;
      throw new Error(`unhandled NimiAppOpenReadiness: ${String(exhaustive)}`);
    }
  }
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
