import { createNimiError } from '../../types';
import type {
  NimiAppAccountInstallState,
  NimiAppAccountInventoryState,
} from './account-inventory.js';

export type TrustTierId = 'nimi-first-party' | 'nimi-verified-partner' | 'nimi-community';
export type NimiAppInventoryTrustTier = TrustTierId | 'local-explicit' | 'local-developer' | 'unknown';
export type AppKind = 'nimi-app';
export type NimiAppOrdinaryVisibility =
  | 'ordinary-visible'
  | 'hidden-internal'
  | 'developer-only'
  | 'not-admitted-visible';
export type AppLaunchReadiness =
  | 'ready'
  | 'install-required'
  | 'update-required'
  | 'repair-required'
  | 'permission-required'
  | 'blocked-by-master-gate'
  | 'unsupported';
export type NimiAppOpenReadiness = AppLaunchReadiness | 'sign-in-required' | 'connect-required';
export type NimiAppInventoryInstallState =
  | 'not-installed'
  | 'installed'
  | 'adopted-local'
  | 'installing'
  | 'updating'
  | 'repair-required'
  | 'removed'
  | 'unknown';
export type NimiAppInventorySourceStatus = 'present' | 'absent' | 'degraded';
export type NimiAppInventoryNextAction =
  | 'install'
  | 'open'
  | 'connect-local'
  | 'review-permissions'
  | 'repair'
  | 'update'
  | 'uninstall'
  | 'remove-local-adoption'
  | 'sign-in';

export const CANONICAL_TRUST_TIERS: readonly TrustTierId[] = [
  'nimi-first-party',
  'nimi-verified-partner',
  'nimi-community',
];
export const CANONICAL_APP_KINDS: readonly AppKind[] = ['nimi-app'];
export const CANONICAL_ORDINARY_VISIBILITY: readonly NimiAppOrdinaryVisibility[] = [
  'ordinary-visible',
  'hidden-internal',
  'developer-only',
  'not-admitted-visible',
];
export const CANONICAL_LAUNCH_READINESS: readonly AppLaunchReadiness[] = [
  'ready',
  'install-required',
  'update-required',
  'repair-required',
  'permission-required',
  'blocked-by-master-gate',
  'unsupported',
];
export const CANONICAL_APP_INVENTORY_SOURCE_STATUSES: readonly NimiAppInventorySourceStatus[] = [
  'present',
  'absent',
  'degraded',
];
export const CANONICAL_APP_INVENTORY_INSTALL_STATES: readonly NimiAppInventoryInstallState[] = [
  'not-installed',
  'installed',
  'adopted-local',
  'installing',
  'updating',
  'repair-required',
  'removed',
  'unknown',
];
export const CANONICAL_APP_OPEN_READINESS: readonly NimiAppOpenReadiness[] = [
  ...CANONICAL_LAUNCH_READINESS,
  'sign-in-required',
  'connect-required',
];
export const CANONICAL_APP_INVENTORY_NEXT_ACTIONS: readonly NimiAppInventoryNextAction[] = [
  'install',
  'open',
  'connect-local',
  'review-permissions',
  'repair',
  'update',
  'uninstall',
  'remove-local-adoption',
  'sign-in',
];

export interface NimiAppRow {
  readonly appId: string;
  readonly appKind: AppKind;
  readonly displayName: string;
  readonly trustTier: TrustTierId;
  readonly ordinaryVisibility?: NimiAppOrdinaryVisibility;
  readonly publisher: string;
  readonly aiProfileSelectionRef: string;
  readonly capabilitySet: readonly string[];
  readonly releaseDescriptorRef: string;
  readonly installStoragePolicyRef: string;
  readonly sourceRule: string;
}

export interface NimiAppAccountInventorySourceRow {
  readonly appId: string;
  readonly accountState: NimiAppAccountInventoryState;
  readonly installState: NimiAppAccountInstallState;
  readonly lastOpenedAt?: string;
  readonly dataPolicy: string;
  readonly verifiedAt?: string;
  readonly source?: string;
  readonly detail?: string;
}

export interface NimiAppLocalAdoptionRow {
  readonly appId: string;
  readonly rootPath: string;
  readonly manifestPath: string;
  readonly displayName: string;
  readonly version: string;
  readonly entryRef: string;
  readonly permissionScopeRef: string;
  readonly storagePolicyRef: string;
  readonly state: 'adopted' | 'repair-required' | 'removed';
  readonly trust: 'explicit-local' | 'developer-local';
  readonly adoptedAt?: string;
  readonly updatedAt?: string;
  readonly reasonCode?: string;
  readonly detail?: string;
}

export interface NimiAppInventorySource<T> {
  readonly status: NimiAppInventorySourceStatus;
  readonly value?: T;
  readonly reasonCode?: string;
  readonly detail?: string;
}

export interface NimiAppInventoryJobSummary {
  readonly jobId: string;
  readonly appId: string;
  readonly kind: 'install' | 'update' | 'repair' | 'uninstall';
  readonly state: string;
  readonly phase?: string;
  readonly reasonCode?: string;
  readonly detail?: string;
}

export interface NimiAppInventorySources {
  readonly catalog: NimiAppInventorySource<NimiAppRow>;
  readonly account: NimiAppInventorySource<NimiAppAccountInventorySourceRow>;
  readonly local: NimiAppInventorySource<NimiAppLocalAdoptionRow>;
  readonly packageReadiness: NimiAppInventorySource<NimiAppPackageReadinessRow>;
}

export interface NimiAppInventoryEntry {
  readonly appId: string;
  readonly displayName: string;
  readonly appKind?: AppKind;
  readonly publisher?: string;
  readonly aiProfileSelectionRef?: string;
  readonly releaseDescriptorRef?: string;
  readonly installStoragePolicyRef?: string;
  readonly trustTier: NimiAppInventoryTrustTier;
  readonly capabilitySet: readonly string[];
  readonly sources: NimiAppInventorySources;
  readonly installState: NimiAppInventoryInstallState;
  readonly openReadiness: NimiAppOpenReadiness;
  readonly activeJobs: readonly NimiAppInventoryJobSummary[];
  readonly nextActions: readonly NimiAppInventoryNextAction[];
  readonly reasonCode?: string;
  readonly detail?: string;
}

export interface NimiAppStatus {
  readonly appId: string;
  readonly launchReadiness: AppLaunchReadiness;
  readonly releaseDescriptorRef?: string;
  readonly installStoragePolicyRef?: string;
  readonly storageRoots?: NimiAppStorageRoots;
  readonly verificationState?: NimiAppInstallVerificationState;
  readonly installedVersion?: string;
  readonly availableVersion?: string;
  readonly detail?: string;
}

export type NimiAppReleaseDescriptorClass =
  | 'bundled-with-nimi'
  | 'external-immutable-artifact';

export type NimiAppReleaseSourceKind =
  | 'nimi-bundle'
  | 'github-release'
  | 'github-commit'
  | 'npm-package'
  | 'admission-sandbox-https-artifact';

export interface NimiAppReleaseDescriptorRow {
  readonly descriptorId: string;
  readonly appId: string;
  readonly version: string;
  readonly descriptorClass: NimiAppReleaseDescriptorClass;
  readonly sourceKind: NimiAppReleaseSourceKind;
  readonly sourceRef: string;
  readonly artifactLocator: string;
  readonly digestAlgorithm: 'sha256';
  readonly sha256: string;
  readonly size: string;
  readonly provenanceRef: string;
  readonly packageKind: AppKind;
  readonly entryRef: string;
  readonly sandboxRef: string;
  readonly permissionsRef: string;
  readonly storagePolicyRef: string;
  readonly admissionPath: string;
  readonly mutableSourceAllowed: boolean;
  readonly installDigestVerificationRequired: string;
  readonly sourceRule: string;
}

export type NimiAppInstallVerificationState =
  | 'not-installed'
  | 'digest-verified'
  | 'bundled-source'
  | 'digest-mismatch'
  | 'blocked'
  | 'unsupported';

export type NimiAppPackageReadinessState =
  | 'ready'
  | 'install_required'
  | 'update_required'
  | 'repair_required'
  | 'blocked';

export interface NimiAppPackageReadinessRow {
  readonly appId: string;
  readonly releaseDescriptorRef: string;
  readonly storagePolicyRef: string;
  readonly expectedVersion?: string;
  readonly activeVersion?: string;
  readonly installedVersion?: string;
  readonly sha256?: string;
  readonly verificationState?: string;
  readonly state: NimiAppPackageReadinessState;
  readonly reasonCode?: string;
  readonly detail?: string;
}

export interface NimiAppStorageRoots {
  readonly releaseRoot: string;
  readonly dataRoot: string;
  readonly cacheRoot: string;
  readonly tempRoot: string;
}

export interface NimiAppTransport {
  list(): Promise<readonly NimiAppInventoryEntry[]>;
  get(appId: string): Promise<NimiAppInventoryEntry>;
  status(appId: string): Promise<NimiAppStatus>;
}

export function isCanonicalTrustTier(value: unknown): value is TrustTierId {
  return typeof value === 'string' && CANONICAL_TRUST_TIERS.includes(value as TrustTierId);
}

export function isCanonicalAppKind(value: unknown): value is AppKind {
  return typeof value === 'string' && CANONICAL_APP_KINDS.includes(value as AppKind);
}

export function isCanonicalLaunchReadiness(value: unknown): value is AppLaunchReadiness {
  return typeof value === 'string' && CANONICAL_LAUNCH_READINESS.includes(value as AppLaunchReadiness);
}

export function isCanonicalAppOpenReadiness(value: unknown): value is NimiAppOpenReadiness {
  return typeof value === 'string' && CANONICAL_APP_OPEN_READINESS.includes(value as NimiAppOpenReadiness);
}

export function validateNimiAppInventoryEntry(entry: NimiAppInventoryEntry | null | undefined): void {
  if (!entry || typeof entry !== 'object') {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app inventory entry is missing', 'fix_app_transport_response');
  }
  const appId = requireText(
    entry.appId,
    'Nimi app inventory entry missing appId',
    'SDK_APP_RESPONSE_INVALID',
    'fix_app_inventory_entry',
  );
  requireText(
    entry.displayName,
    'Nimi app inventory entry missing displayName',
    'SDK_APP_RESPONSE_INVALID',
    'fix_app_inventory_entry',
  );
  if (!CANONICAL_APP_INVENTORY_INSTALL_STATES.includes(entry.installState)) {
    appError(
      'SDK_APP_RESPONSE_INVALID',
      `installState "${String(entry.installState)}" is not canonical`,
      'fix_app_inventory_entry',
    );
  }
  if (!isCanonicalAppOpenReadiness(entry.openReadiness)) {
    appError(
      'SDK_APP_RESPONSE_INVALID',
      `openReadiness "${String(entry.openReadiness)}" is not canonical`,
      'fix_app_inventory_entry',
    );
  }
  if (!entry.sources || typeof entry.sources !== 'object') {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app inventory entry missing sources', 'fix_app_inventory_entry');
  }
  validateInventorySource(entry.sources.catalog, 'catalog');
  validateInventorySource(entry.sources.account, 'account');
  validateInventorySource(entry.sources.local, 'local');
  validateInventorySource(entry.sources.packageReadiness, 'packageReadiness');
  if (entry.sources.catalog.status === 'present') {
    validateNimiAppRow(entry.sources.catalog.value);
    if (entry.sources.catalog.value?.appId !== appId) {
      appError('SDK_APP_RESPONSE_INVALID', 'catalog source appId does not match inventory appId', 'fix_app_inventory_entry');
    }
  }
  if (entry.sources.account.status === 'present' && entry.sources.account.value?.appId !== appId) {
    appError('SDK_APP_RESPONSE_INVALID', 'account source appId does not match inventory appId', 'fix_app_inventory_entry');
  }
  if (entry.sources.local.status === 'present' && entry.sources.local.value?.appId !== appId) {
    appError('SDK_APP_RESPONSE_INVALID', 'local source appId does not match inventory appId', 'fix_app_inventory_entry');
  }
  if (entry.sources.packageReadiness.status === 'present' && entry.sources.packageReadiness.value?.appId !== appId) {
    appError('SDK_APP_RESPONSE_INVALID', 'package readiness source appId does not match inventory appId', 'fix_app_inventory_entry');
  }
  if (!Array.isArray(entry.capabilitySet)) {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app inventory entry capabilitySet must be an array', 'fix_app_inventory_entry');
  }
  if (!Array.isArray(entry.activeJobs)) {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app inventory entry activeJobs must be an array', 'fix_app_inventory_entry');
  }
  for (const [index, job] of entry.activeJobs.entries()) {
    requireText(job?.jobId, `activeJobs[${index}].jobId is required`, 'SDK_APP_RESPONSE_INVALID', 'fix_app_inventory_entry');
    if (normalizeText(job?.appId) !== appId) {
      appError('SDK_APP_RESPONSE_INVALID', `activeJobs[${index}].appId does not match inventory appId`, 'fix_app_inventory_entry');
    }
  }
  if (!Array.isArray(entry.nextActions)) {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app inventory entry nextActions must be an array', 'fix_app_inventory_entry');
  }
  for (const action of entry.nextActions) {
    if (!CANONICAL_APP_INVENTORY_NEXT_ACTIONS.includes(action)) {
      appError('SDK_APP_RESPONSE_INVALID', `nextAction "${String(action)}" is not canonical`, 'fix_app_inventory_entry');
    }
  }
}

export function validateNimiAppStatus(status: NimiAppStatus | null | undefined, expectedAppId: string): void {
  if (!status || typeof status !== 'object') {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app status is missing', 'fix_app_transport_response');
  }
  if (normalizeText(status.appId) !== expectedAppId) {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app status appId does not match request', 'fix_app_transport_response');
  }
  if (!isCanonicalLaunchReadiness(status.launchReadiness)) {
    appError(
      'SDK_APP_RESPONSE_INVALID',
      `launchReadiness "${String(status.launchReadiness)}" is not canonical`,
      'fix_app_status_projection',
    );
  }
}

function validateNimiAppRow(row: NimiAppRow | null | undefined): void {
  if (!row || typeof row !== 'object') {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app row is missing', 'fix_app_transport_response');
  }
  requireText(row.appId, 'Nimi app row missing appId', 'SDK_APP_RESPONSE_INVALID', 'fix_app_registry_row');
  requireText(row.displayName, 'Nimi app row missing displayName', 'SDK_APP_RESPONSE_INVALID', 'fix_app_registry_row');
  if (!isCanonicalAppKind(row.appKind)) {
    appError('SDK_APP_KIND_INVALID', `Nimi app kind "${String(row.appKind)}" is not admitted`, 'use_admitted_nimi_app_kind');
  }
  if (!isCanonicalTrustTier(row.trustTier)) {
    appError('SDK_APP_RESPONSE_INVALID', `Nimi app trust tier "${String(row.trustTier)}" is not canonical`, 'fix_app_registry_row');
  }
  if (row.ordinaryVisibility !== undefined && !CANONICAL_ORDINARY_VISIBILITY.includes(row.ordinaryVisibility)) {
    appError(
      'SDK_APP_RESPONSE_INVALID',
      `Nimi app ordinaryVisibility "${String(row.ordinaryVisibility)}" is not canonical`,
      'fix_app_registry_row',
    );
  }
  for (const [field, value] of [
    ['publisher', row.publisher],
    ['aiProfileSelectionRef', row.aiProfileSelectionRef],
    ['releaseDescriptorRef', row.releaseDescriptorRef],
    ['installStoragePolicyRef', row.installStoragePolicyRef],
    ['sourceRule', row.sourceRule],
  ] as const) {
    requireText(value, `Nimi app row missing ${field}`, 'SDK_APP_RESPONSE_INVALID', 'fix_app_registry_row');
  }
  if (!Array.isArray(row.capabilitySet) || row.capabilitySet.length === 0) {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app row missing capabilitySet', 'fix_app_registry_row');
  }
  for (const [index, capability] of row.capabilitySet.entries()) {
    requireText(
      capability,
      `Nimi app row capabilitySet[${index}] is empty`,
      'SDK_APP_RESPONSE_INVALID',
      'fix_app_registry_row',
    );
  }
}

function validateInventorySource<T>(source: NimiAppInventorySource<T> | null | undefined, name: string): void {
  if (!source || typeof source !== 'object') {
    appError('SDK_APP_RESPONSE_INVALID', `Nimi app inventory source ${name} is missing`, 'fix_app_inventory_entry');
  }
  if (!CANONICAL_APP_INVENTORY_SOURCE_STATUSES.includes(source.status)) {
    appError('SDK_APP_RESPONSE_INVALID', `Nimi app inventory source ${name} has invalid status`, 'fix_app_inventory_entry');
  }
  if (source.status === 'present' && source.value === undefined) {
    appError('SDK_APP_RESPONSE_INVALID', `Nimi app inventory source ${name} is present without a value`, 'fix_app_inventory_entry');
  }
  if (source.status !== 'present' && source.value !== undefined) {
    appError('SDK_APP_RESPONSE_INVALID', `Nimi app inventory source ${name} is ${source.status} with a value`, 'fix_app_inventory_entry');
  }
  if (source.status === 'degraded' && !normalizeText(source.reasonCode)) {
    appError('SDK_APP_RESPONSE_INVALID', `Nimi app inventory source ${name} is degraded without reasonCode`, 'fix_app_inventory_entry');
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireText(value: unknown, message: string, code: string, actionHint: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    appError(code, message, actionHint);
  }
  return normalized;
}

function appError(code: string, message: string, actionHint: string, cause?: unknown): never {
  throw createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
    details: cause === undefined ? undefined : { cause: String(cause instanceof Error ? cause.message : cause) },
  });
}
