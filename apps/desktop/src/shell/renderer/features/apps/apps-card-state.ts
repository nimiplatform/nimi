// Desktop Apps read-only state projection.
//
// 0K deliberately separates inventory presence, access posture, and immutable
// package readiness. Keeping those dimensions distinct prevents the renderer
// from turning catalog/account visibility into install or launch truth.

import type {
  NimiAppInventoryEntry,
  NimiAppInventorySourceStatus,
  NimiAppOpenReadiness,
} from '@nimiplatform/sdk/app';

export const APP_INVENTORY_PRESENCE_STATES = [
  'catalog_only',
  'account_visible',
  'local_record_active',
  'local_record_dormant',
  'local_record_removed',
] as const;

export type AppInventoryPresenceState = typeof APP_INVENTORY_PRESENCE_STATES[number];

export const APP_ACCESS_STATES = [
  'ready',
  'sign_in_required',
  'permission_required',
  'package_unavailable',
  'local_record_dormant',
  'blocked_by_policy',
  'unsupported',
] as const;

export type AppAccessState = typeof APP_ACCESS_STATES[number];

export type AppImmutablePackageState = 'immutable_package_unavailable';

const INVENTORY_SOURCE_KEYS: ReadonlyArray<keyof NimiAppInventoryEntry['sources']> = [
  'catalog',
  'account',
  'localRecord',
  'packageReadiness',
];

export interface AppCardState {
  readonly inventory: AppInventoryPresenceState;
  readonly access: AppAccessState;
  readonly immutablePackage: AppImmutablePackageState;
  readonly packageProjectionStatus: NimiAppInventorySourceStatus;
  readonly degradedSources: ReadonlyArray<keyof NimiAppInventoryEntry['sources']>;
}

export type AppCardPosture = 'normal' | 'warning' | 'disabled';

export function deriveAppCardState(entry: NimiAppInventoryEntry): AppCardState {
  return {
    inventory: deriveInventoryPresence(entry),
    access: deriveAccessState(entry.openReadiness),
    immutablePackage: 'immutable_package_unavailable',
    packageProjectionStatus: entry.sources.packageReadiness.status,
    degradedSources: INVENTORY_SOURCE_KEYS.filter((key) => entry.sources[key].status === 'degraded'),
  };
}

export function postureForAppCardState(state: AppCardState): AppCardPosture {
  switch (state.access) {
    case 'ready':
      return state.inventory === 'local_record_active' ? 'normal' : 'disabled';
    case 'sign_in_required':
    case 'permission_required':
    case 'local_record_dormant':
      return 'warning';
    case 'package_unavailable':
    case 'blocked_by_policy':
    case 'unsupported':
      return 'disabled';
    default: {
      const exhaustive: never = state.access;
      return exhaustive;
    }
  }
}

function deriveInventoryPresence(entry: NimiAppInventoryEntry): AppInventoryPresenceState {
  const localRecord = entry.sources.localRecord.value;
  if (entry.sources.localRecord.status === 'present' && localRecord) {
    switch (localRecord.recordState) {
      case 'active':
        return 'local_record_active';
      case 'dormant':
        return 'local_record_dormant';
      case 'removed':
        return 'local_record_removed';
      default: {
        const exhaustive: never = localRecord.recordState;
        return exhaustive;
      }
    }
  }
  if (entry.sources.account.status === 'present') {
    return 'account_visible';
  }
  return 'catalog_only';
}

function deriveAccessState(readiness: NimiAppOpenReadiness): AppAccessState {
  switch (readiness) {
    case 'ready':
      return 'ready';
    case 'sign-in-required':
      return 'sign_in_required';
    case 'permission-required':
      return 'permission_required';
    case 'package-unavailable':
      return 'package_unavailable';
    case 'local-record-dormant':
      return 'local_record_dormant';
    case 'blocked-by-master-gate':
      return 'blocked_by_policy';
    case 'unsupported':
      return 'unsupported';
    default: {
      const exhaustive: never = readiness;
      return exhaustive;
    }
  }
}
