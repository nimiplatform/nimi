import type { AgentCenterHostScope } from './types.js';

type AgentCenterRecord = Record<string, unknown>;

export type AgentCenterAvatarBackendKind =
  | 'live2d'
  | 'vrm'
  | 'sprite2d'
  | 'canvas2d'
  | 'video';

export type AgentCenterValidationState =
  | 'valid'
  | 'invalid'
  | 'checking'
  | 'not_checked';

export interface AgentCenterAvatarAssetImportResult {
  readonly hostScope?: AgentCenterHostScope;
  readonly avatarAssetRef: string;
  readonly backendKind: AgentCenterAvatarBackendKind;
  readonly validationStatus?: AgentCenterValidationState;
  readonly validationMessage?: string | null;
  readonly backendCapabilityProfileRef?: string | null;
}

export interface AgentCenterAvatarAssetValidateResult {
  readonly avatarAssetRef: string;
  readonly backendKind: AgentCenterAvatarBackendKind;
  readonly validationStatus: AgentCenterValidationState;
  readonly validationMessage?: string | null;
  readonly backendCapabilityProfileRef?: string | null;
  readonly validationIssueRows?: readonly string[];
}

export interface AgentCenterBackgroundImportResult {
  readonly hostScope?: AgentCenterHostScope;
  readonly backgroundAssetRef: string;
  readonly validationStatus?: AgentCenterValidationState;
  readonly validationMessage?: string | null;
}

export interface AgentCenterBackgroundValidateResult {
  readonly backgroundAssetRef: string;
  readonly validationStatus: AgentCenterValidationState;
  readonly validationMessage?: string | null;
}

export interface AgentCenterLive2dSidecarImportResult {
  readonly avatarAssetRef: string;
  readonly live2dAdapterManifestRef: string;
  readonly live2dAdapterManifestSource: 'embedded_creator_manifest' | 'external_sidecar_manifest';
}

export interface AgentCenterResourceRemovalResult {
  readonly removed: boolean;
  readonly hostScope?: AgentCenterHostScope;
  readonly avatarAssetRef?: string | null;
  readonly backgroundAssetRef?: string | null;
  readonly live2dAdapterManifestRef?: string | null;
}

export interface AgentCenterAvatarPreviewResolveResult {
  readonly avatarAssetRef: string;
  readonly backendKind: AgentCenterAvatarBackendKind;
  readonly previewArtifactRef: string;
  readonly previewImageRef?: string | null;
  readonly validationStatus?: AgentCenterValidationState;
  readonly validationMessage?: string | null;
  readonly warnings?: readonly string[];
}

const HOST_SCOPES = new Set<AgentCenterHostScope>(['account', 'local-agent']);
const BACKEND_KINDS = new Set<AgentCenterAvatarBackendKind>(['live2d', 'vrm', 'sprite2d', 'canvas2d', 'video']);
const VALIDATION_STATES = new Set<AgentCenterValidationState>(['valid', 'invalid', 'checking', 'not_checked']);

const FORBIDDEN_KEYS = new Set([
  'assetBytes',
  'backendCompatibilityTier',
  'backendCompatibilityTiers',
  'calibrationPayload',
  'carrierProofRef',
  'fileUrl',
  'file_url',
  'launchPayload',
  'packageDescriptor',
  'packageDescriptors',
  'providerRoute',
  'rawPath',
  'runtimeTruth',
  'session',
  'sessionId',
  'transcript',
]);

function assertPlainRecord(value: unknown, label: string): AgentCenterRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as AgentCenterRecord;
}

function assertNoForbiddenFields(record: AgentCenterRecord, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} includes unsupported field ${key}.`);
    }
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`${label} includes forbidden field ${key}.`);
    }
  }
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function assertOpaqueRef(value: unknown, field: string): string {
  const ref = normalizeString(value);
  if (!ref) {
    throw new Error(`${field} is required.`);
  }
  if (
    ref.startsWith('file:')
    || ref.startsWith('data:')
    || /^[A-Za-z]:[\\/]/u.test(ref)
    || ref.startsWith('/')
    || ref.startsWith('\\\\')
  ) {
    throw new Error(`${field} must be an opaque managed ref, not a raw path, file URL, or inline asset.`);
  }
  return ref;
}

function optionalOpaqueRef(record: AgentCenterRecord, field: string): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    return undefined;
  }
  const value = record[field];
  if (value == null || normalizeString(value) === '') {
    return null;
  }
  return assertOpaqueRef(value, field);
}

function optionalString(record: AgentCenterRecord, field: string): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    return undefined;
  }
  const value = record[field];
  return value == null ? null : normalizeString(value);
}

function assertHostScope(value: unknown): AgentCenterHostScope {
  const scope = normalizeString(value) as AgentCenterHostScope;
  if (!HOST_SCOPES.has(scope)) {
    throw new Error('hostScope is required and must be account or local-agent.');
  }
  return scope;
}

function assertBackendKind(value: unknown): AgentCenterAvatarBackendKind {
  const backendKind = normalizeString(value) as AgentCenterAvatarBackendKind;
  if (!BACKEND_KINDS.has(backendKind)) {
    throw new Error('backendKind is required and must be an admitted avatar backend.');
  }
  return backendKind;
}

function assertValidationState(value: unknown, field: string): AgentCenterValidationState {
  const state = normalizeString(value) as AgentCenterValidationState;
  if (!VALIDATION_STATES.has(state)) {
    throw new Error(`${field} must be a supported validation state.`);
  }
  return state;
}

function optionalValidationState(record: AgentCenterRecord, field = 'validationStatus'): AgentCenterValidationState | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    return undefined;
  }
  return assertValidationState(record[field], field);
}

function optionalStringArray(record: AgentCenterRecord, field: string): readonly string[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    return undefined;
  }
  const value = record[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be a string array.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function compact<T extends AgentCenterRecord>(record: T): T {
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) {
      delete record[key];
    }
  }
  return record;
}

export function validateAgentCenterAvatarAssetImportResult(value: unknown): AgentCenterAvatarAssetImportResult {
  const record = assertPlainRecord(value, 'AgentCenterAvatarAssetImportResult');
  assertNoForbiddenFields(record, new Set([
    'hostScope',
    'avatarAssetRef',
    'backendKind',
    'validationStatus',
    'validationMessage',
    'backendCapabilityProfileRef',
  ]), 'AgentCenterAvatarAssetImportResult');
  return compact({
    hostScope: Object.prototype.hasOwnProperty.call(record, 'hostScope') ? assertHostScope(record.hostScope) : undefined,
    avatarAssetRef: assertOpaqueRef(record.avatarAssetRef, 'avatarAssetRef'),
    backendKind: assertBackendKind(record.backendKind),
    validationStatus: optionalValidationState(record),
    validationMessage: optionalString(record, 'validationMessage'),
    backendCapabilityProfileRef: optionalOpaqueRef(record, 'backendCapabilityProfileRef'),
  });
}

export function validateAgentCenterAvatarAssetValidateResult(value: unknown): AgentCenterAvatarAssetValidateResult {
  const record = assertPlainRecord(value, 'AgentCenterAvatarAssetValidateResult');
  assertNoForbiddenFields(record, new Set([
    'avatarAssetRef',
    'backendKind',
    'validationStatus',
    'validationMessage',
    'backendCapabilityProfileRef',
    'validationIssueRows',
  ]), 'AgentCenterAvatarAssetValidateResult');
  return compact({
    avatarAssetRef: assertOpaqueRef(record.avatarAssetRef, 'avatarAssetRef'),
    backendKind: assertBackendKind(record.backendKind),
    validationStatus: assertValidationState(record.validationStatus, 'validationStatus'),
    validationMessage: optionalString(record, 'validationMessage'),
    backendCapabilityProfileRef: optionalOpaqueRef(record, 'backendCapabilityProfileRef'),
    validationIssueRows: optionalStringArray(record, 'validationIssueRows'),
  });
}

export function validateAgentCenterBackgroundImportResult(value: unknown): AgentCenterBackgroundImportResult {
  const record = assertPlainRecord(value, 'AgentCenterBackgroundImportResult');
  assertNoForbiddenFields(record, new Set([
    'hostScope',
    'backgroundAssetRef',
    'validationStatus',
    'validationMessage',
  ]), 'AgentCenterBackgroundImportResult');
  return compact({
    hostScope: Object.prototype.hasOwnProperty.call(record, 'hostScope') ? assertHostScope(record.hostScope) : undefined,
    backgroundAssetRef: assertOpaqueRef(record.backgroundAssetRef, 'backgroundAssetRef'),
    validationStatus: optionalValidationState(record),
    validationMessage: optionalString(record, 'validationMessage'),
  });
}

export function validateAgentCenterBackgroundValidateResult(value: unknown): AgentCenterBackgroundValidateResult {
  const record = assertPlainRecord(value, 'AgentCenterBackgroundValidateResult');
  assertNoForbiddenFields(record, new Set([
    'backgroundAssetRef',
    'validationStatus',
    'validationMessage',
  ]), 'AgentCenterBackgroundValidateResult');
  return compact({
    backgroundAssetRef: assertOpaqueRef(record.backgroundAssetRef, 'backgroundAssetRef'),
    validationStatus: assertValidationState(record.validationStatus, 'validationStatus'),
    validationMessage: optionalString(record, 'validationMessage'),
  });
}

export function validateAgentCenterLive2dSidecarImportResult(value: unknown): AgentCenterLive2dSidecarImportResult {
  const record = assertPlainRecord(value, 'AgentCenterLive2dSidecarImportResult');
  assertNoForbiddenFields(record, new Set([
    'avatarAssetRef',
    'live2dAdapterManifestRef',
    'live2dAdapterManifestSource',
  ]), 'AgentCenterLive2dSidecarImportResult');
  const source = normalizeString(record.live2dAdapterManifestSource);
  if (source !== 'embedded_creator_manifest' && source !== 'external_sidecar_manifest') {
    throw new Error('live2dAdapterManifestSource must be an admitted sidecar source.');
  }
  return {
    avatarAssetRef: assertOpaqueRef(record.avatarAssetRef, 'avatarAssetRef'),
    live2dAdapterManifestRef: assertOpaqueRef(record.live2dAdapterManifestRef, 'live2dAdapterManifestRef'),
    live2dAdapterManifestSource: source,
  };
}

export function validateAgentCenterResourceRemovalResult(value: unknown): AgentCenterResourceRemovalResult {
  const record = assertPlainRecord(value, 'AgentCenterResourceRemovalResult');
  assertNoForbiddenFields(record, new Set([
    'removed',
    'hostScope',
    'avatarAssetRef',
    'backgroundAssetRef',
    'live2dAdapterManifestRef',
  ]), 'AgentCenterResourceRemovalResult');
  if (typeof record.removed !== 'boolean') {
    throw new Error('removed must be boolean.');
  }
  return compact({
    removed: record.removed,
    hostScope: Object.prototype.hasOwnProperty.call(record, 'hostScope') ? assertHostScope(record.hostScope) : undefined,
    avatarAssetRef: optionalOpaqueRef(record, 'avatarAssetRef'),
    backgroundAssetRef: optionalOpaqueRef(record, 'backgroundAssetRef'),
    live2dAdapterManifestRef: optionalOpaqueRef(record, 'live2dAdapterManifestRef'),
  });
}

export function validateAgentCenterAvatarPreviewResolveResult(value: unknown): AgentCenterAvatarPreviewResolveResult {
  const record = assertPlainRecord(value, 'AgentCenterAvatarPreviewResolveResult');
  assertNoForbiddenFields(record, new Set([
    'avatarAssetRef',
    'backendKind',
    'previewArtifactRef',
    'previewImageRef',
    'validationStatus',
    'validationMessage',
    'warnings',
  ]), 'AgentCenterAvatarPreviewResolveResult');
  return compact({
    avatarAssetRef: assertOpaqueRef(record.avatarAssetRef, 'avatarAssetRef'),
    backendKind: assertBackendKind(record.backendKind),
    previewArtifactRef: assertOpaqueRef(record.previewArtifactRef, 'previewArtifactRef'),
    previewImageRef: optionalOpaqueRef(record, 'previewImageRef'),
    validationStatus: optionalValidationState(record),
    validationMessage: optionalString(record, 'validationMessage'),
    warnings: optionalStringArray(record, 'warnings'),
  });
}
