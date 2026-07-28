import { createNimiError } from '../../types';

export type NimiAppLocalTrustClass = 'local_development';
export type AppLaunchReadiness = 'ready' | 'local-record-dormant' | 'unsupported';
export type NimiAppOpenReadiness = AppLaunchReadiness | 'sign-in-required';
export type NimiAppLocalRecordState = 'active' | 'dormant' | 'removed' | 'unknown';
export type NimiAppInventorySourceStatus = 'present' | 'absent' | 'degraded';
export type NimiAppInventoryNextAction = 'open' | 'sign-in';

export const CANONICAL_LAUNCH_READINESS: readonly AppLaunchReadiness[] = [
  'ready',
  'local-record-dormant',
  'unsupported',
];
export const CANONICAL_APP_INVENTORY_SOURCE_STATUSES: readonly NimiAppInventorySourceStatus[] = [
  'present',
  'absent',
  'degraded',
];
export const CANONICAL_APP_LOCAL_RECORD_STATES: readonly NimiAppLocalRecordState[] = [
  'active',
  'dormant',
  'removed',
  'unknown',
];
export const CANONICAL_APP_OPEN_READINESS: readonly NimiAppOpenReadiness[] = [
  ...CANONICAL_LAUNCH_READINESS,
  'sign-in-required',
];
export const CANONICAL_APP_INVENTORY_NEXT_ACTIONS: readonly NimiAppInventoryNextAction[] = [
  'open',
  'sign-in',
];

export interface NimiAppLocalRecordRow {
  readonly appId: string;
  readonly displayName: string;
  readonly trustClass: NimiAppLocalTrustClass;
  readonly recordState: Exclude<NimiAppLocalRecordState, 'unknown'>;
  readonly sessionState?:
    | 'session-bound'
    | 'action-required'
    | 'revoked'
    | 'process-replaced'
    | 'account-changed'
    | 'runtime-restarted'
    | 'unavailable';
  readonly reasonCode?: string;
  readonly detail?: string;
}

export interface NimiAppInventorySource<T> {
  readonly status: NimiAppInventorySourceStatus;
  readonly value?: T;
  readonly reasonCode?: string;
  readonly detail?: string;
}

export interface NimiAppInventoryEntry {
  readonly appId: string;
  readonly displayName: string;
  readonly trustClass: NimiAppLocalTrustClass | 'unknown';
  readonly source: NimiAppInventorySource<NimiAppLocalRecordRow>;
  readonly localRecordState: NimiAppLocalRecordState;
  readonly openReadiness: NimiAppOpenReadiness;
  readonly nextActions: readonly NimiAppInventoryNextAction[];
  readonly reasonCode?: string;
  readonly detail?: string;
}

export interface NimiAppStatus {
  readonly appId: string;
  readonly launchReadiness: AppLaunchReadiness;
  readonly reasonCode?: string;
  readonly detail?: string;
}

export interface NimiAppTransport {
  list(): Promise<readonly NimiAppInventoryEntry[]>;
  get(appId: string): Promise<NimiAppInventoryEntry>;
  status(appId: string): Promise<NimiAppStatus>;
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
  const appId = requireText(entry.appId, 'Nimi app inventory entry missing appId', 'SDK_APP_RESPONSE_INVALID', 'fix_app_inventory_entry');
  requireText(entry.displayName, 'Nimi app inventory entry missing displayName', 'SDK_APP_RESPONSE_INVALID', 'fix_app_inventory_entry');
  if (!CANONICAL_APP_LOCAL_RECORD_STATES.includes(entry.localRecordState)) {
    appError('SDK_APP_RESPONSE_INVALID', `localRecordState "${String(entry.localRecordState)}" is not canonical`, 'fix_app_inventory_entry');
  }
  if (!isCanonicalAppOpenReadiness(entry.openReadiness)) {
    appError('SDK_APP_RESPONSE_INVALID', `openReadiness "${String(entry.openReadiness)}" is not canonical`, 'fix_app_inventory_entry');
  }
  validateInventorySource(entry.source, 'localRecord');
  if (entry.source.status === 'present') {
    validateLocalRecord(entry.source.value, appId);
  }
  if (!Array.isArray(entry.nextActions)) {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app inventory entry nextActions must be an array', 'fix_app_inventory_entry');
  }
  for (const action of entry.nextActions) {
    if (!CANONICAL_APP_INVENTORY_NEXT_ACTIONS.includes(action)) {
      appError('SDK_APP_RESPONSE_INVALID', `nextAction "${String(action)}" is not canonical`, 'remove_package_lifecycle_action');
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
    appError('SDK_APP_RESPONSE_INVALID', `launchReadiness "${String(status.launchReadiness)}" is not canonical`, 'fix_app_status_projection');
  }
}

function validateLocalRecord(row: NimiAppLocalRecordRow | undefined, expectedAppId: string): void {
  if (!row || typeof row !== 'object') {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app local record is missing', 'fix_app_inventory_entry');
  }
  if (normalizeText(row.appId) !== expectedAppId) {
    appError('SDK_APP_RESPONSE_INVALID', 'local record appId does not match inventory appId', 'fix_app_inventory_entry');
  }
  requireText(row.displayName, 'Nimi app local record missing displayName', 'SDK_APP_RESPONSE_INVALID', 'fix_app_inventory_entry');
  if (row.trustClass !== 'local_development') {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app local record trustClass must be local_development', 'fix_app_inventory_entry');
  }
  if (!['active', 'dormant', 'removed'].includes(row.recordState)) {
    appError('SDK_APP_RESPONSE_INVALID', 'Nimi app local record state is invalid', 'fix_app_inventory_entry');
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
  if (!normalized) appError(code, message, actionHint);
  return normalized;
}

function appError(code: string, message: string, actionHint: string): never {
  throw createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
  });
}
