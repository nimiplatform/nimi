import type {
  AgentCenterAvatarAssetImportParseResult,
  AgentCenterAvatarAssetKind,
  AgentCenterAvatarAssetListParseResult,
  AgentCenterAvatarAssetRecord,
  AgentCenterAvatarAssetValidationParseResult,
  AgentCenterAvatarAssetValidationStatus,
  AgentCenterValidationIssue,
  AgentCenterValidationIssueSeverity,
} from './chat-agent-center-local-config-result-types';

const NORMALIZED_ID_PATTERN = /^(?=.*[A-Za-z0-9])(?!\.{1,2}$)(?!.*:\/\/)[A-Za-z0-9._~:@+-]{1,256}$/u;
const PACKAGE_ID_PATTERN = /^(live2d|vrm)_[a-f0-9]{12}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

const AVATAR_ASSET_KIND_VALUES = new Set(['live2d', 'vrm']);
const VALIDATION_SEVERITY_VALUES = new Set(['error', 'warning']);
const AVATAR_ASSET_VALIDATION_STATUS_VALUES = new Set([
  'valid',
  'invalid_manifest',
  'missing_entry',
  'permission_denied',
  'path_rejected',
  'unsupported_backend',
  'asset_missing',
  'digest_mismatch',
  'selection_missing',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectUnknownKeys(value: Record<string, unknown>, allowedKeys: readonly string[], path: string, errors: string[]): void {
  const allowed = new Set<string>(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${path}.${key}: unknown field`);
    }
  }
}

function requireRecord(value: unknown, path: string, errors: string[]): Record<string, unknown> | null {
  if (!isRecord(value)) {
    errors.push(`${path}: expected object`);
    return null;
  }
  return value;
}

function requireSchemaVersion(value: Record<string, unknown>, path: string, errors: string[]): void {
  if (value.schema_version !== 1) {
    errors.push(`${path}.schema_version: expected 1`);
  }
}

function readString(value: unknown, path: string, errors: string[]): string | null {
  if (typeof value !== 'string') {
    errors.push(`${path}: expected string`);
    return null;
  }
  if (value.normalize('NFC') !== value) {
    errors.push(`${path}: must be NFC normalized`);
    return null;
  }
  return value;
}

function readNullableString(value: unknown, path: string, errors: string[]): string | null {
  if (value === null) {
    return null;
  }
  return readString(value, path, errors);
}

function validateNormalizedId(value: unknown, path: string, errors: string[]): string {
  const id = readString(value, path, errors);
  if (!id || !NORMALIZED_ID_PATTERN.test(id)) {
    errors.push(`${path}: invalid normalized id`);
    return '';
  }
  return id;
}

function validatePackageId(value: unknown, path: string, errors: string[]): string | null {
  const id = readNullableString(value, path, errors);
  if (id !== null && !PACKAGE_ID_PATTERN.test(id)) {
    errors.push(`${path}: invalid local Avatar asset id`);
  }
  return id;
}

function validateTimestamp(value: unknown, path: string, errors: string[]): string | null {
  const timestamp = readNullableString(value, path, errors);
  if (timestamp !== null) {
    const parsed = Date.parse(timestamp);
    if (!ISO_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(parsed)) {
      errors.push(`${path}: invalid ISO timestamp`);
    }
  }
  return timestamp;
}

function validateValidationIssue(value: unknown, path: string, errors: string[]): AgentCenterValidationIssue {
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, ['code', 'message', 'path', 'severity'], path, errors);
  const code = readString(record.code, `${path}.code`, errors) || '';
  const message = readString(record.message, `${path}.message`, errors) || '';
  const issuePath = readNullableString(record.path, `${path}.path`, errors);
  const severity = readString(record.severity, `${path}.severity`, errors);
  if (severity && !VALIDATION_SEVERITY_VALUES.has(severity)) {
    errors.push(`${path}.severity: invalid severity`);
  }
  return {
    code,
    message,
    path: issuePath,
    severity: VALIDATION_SEVERITY_VALUES.has(severity || '')
      ? severity as AgentCenterValidationIssueSeverity
      : 'error',
  };
}

function validateValidationIssues(value: unknown, path: string, errors: string[]): AgentCenterValidationIssue[] {
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected array`);
    return [];
  }
  return value.map((item, index) => validateValidationIssue(item, `${path}.${index}`, errors));
}

export function validateAgentCenterAvatarAssetImportResult(
  value: unknown,
): AgentCenterAvatarAssetImportParseResult {
  const errors: string[] = [];
  const root = requireRecord(value, 'avatarAssetImportResult', errors);
  if (!root) {
    return { ok: false, errors };
  }
  collectUnknownKeys(root, [
    'local_asset_id',
    'backend_kind',
    'backend_capability_profile_ref',
    'selected',
    'manifest_sha256',
    'asset_bytes',
    'file_count',
    'imported_at',
  ], 'avatarAssetImportResult', errors);
  const localAssetId = validatePackageId(root.local_asset_id, 'avatarAssetImportResult.local_asset_id', errors) || '';
  const backendKind = readString(root.backend_kind, 'avatarAssetImportResult.backend_kind', errors) || '';
  if (backendKind && !AVATAR_ASSET_KIND_VALUES.has(backendKind)) {
    errors.push('avatarAssetImportResult.backend_kind: invalid backend kind');
  }
  if (backendKind && localAssetId && !localAssetId.startsWith(`${backendKind}_`)) {
    errors.push('avatarAssetImportResult.local_asset_id: backend kind mismatch');
  }
  const backendCapabilityProfileRef = root.backend_capability_profile_ref === null
    ? null
    : validateNormalizedId(
      root.backend_capability_profile_ref,
      'avatarAssetImportResult.backend_capability_profile_ref',
      errors,
    );
  if (typeof root.selected !== 'boolean') {
    errors.push('avatarAssetImportResult.selected: expected boolean');
  }
  const manifestSha256 = readString(root.manifest_sha256, 'avatarAssetImportResult.manifest_sha256', errors) || '';
  if (manifestSha256 && !/^[a-f0-9]{64}$/u.test(manifestSha256)) {
    errors.push('avatarAssetImportResult.manifest_sha256: invalid sha256');
  }
  if (typeof root.asset_bytes !== 'number' || !Number.isSafeInteger(root.asset_bytes) || root.asset_bytes <= 0) {
    errors.push('avatarAssetImportResult.asset_bytes: expected positive integer');
  }
  if (typeof root.file_count !== 'number' || !Number.isSafeInteger(root.file_count) || root.file_count <= 0) {
    errors.push('avatarAssetImportResult.file_count: expected positive integer');
  }
  const importedAt = validateTimestamp(root.imported_at, 'avatarAssetImportResult.imported_at', errors) || '';
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    result: {
      local_asset_id: localAssetId,
      backend_kind: backendKind as AgentCenterAvatarAssetKind,
      backend_capability_profile_ref: backendCapabilityProfileRef,
      selected: root.selected as boolean,
      manifest_sha256: manifestSha256,
      asset_bytes: root.asset_bytes as number,
      file_count: root.file_count as number,
      imported_at: importedAt,
    },
  };
}

export function validateAgentCenterAvatarAssetValidationResult(
  value: unknown,
): AgentCenterAvatarAssetValidationParseResult {
  const errors: string[] = [];
  const root = requireRecord(value, 'avatarAssetValidation', errors);
  if (!root) {
    return { ok: false, errors };
  }
  collectUnknownKeys(root, [
    'schema_version',
    'local_asset_id',
    'backend_kind',
    'backend_capability_profile_ref',
    'checked_at',
    'status',
    'errors',
    'warnings',
  ], 'avatarAssetValidation', errors);
  requireSchemaVersion(root, 'avatarAssetValidation', errors);
  const localAssetId = validatePackageId(root.local_asset_id, 'avatarAssetValidation.local_asset_id', errors);
  const backendKind = readNullableString(root.backend_kind, 'avatarAssetValidation.backend_kind', errors);
  if (backendKind !== null && !AVATAR_ASSET_KIND_VALUES.has(backendKind)) {
    errors.push('avatarAssetValidation.backend_kind: invalid backend kind');
  }
  const backendCapabilityProfileRef = root.backend_capability_profile_ref === null
    ? null
    : validateNormalizedId(root.backend_capability_profile_ref, 'avatarAssetValidation.backend_capability_profile_ref', errors);
  const checkedAt = validateTimestamp(root.checked_at, 'avatarAssetValidation.checked_at', errors) || '';
  const status = readString(root.status, 'avatarAssetValidation.status', errors);
  if (status && !AVATAR_ASSET_VALIDATION_STATUS_VALUES.has(status)) {
    errors.push('avatarAssetValidation.status: invalid status');
  }
  const validationErrors = validateValidationIssues(root.errors, 'avatarAssetValidation.errors', errors);
  const warnings = validateValidationIssues(root.warnings, 'avatarAssetValidation.warnings', errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    result: {
      schema_version: 1,
      local_asset_id: localAssetId,
      backend_kind: backendKind as AgentCenterAvatarAssetKind | null,
      backend_capability_profile_ref: backendCapabilityProfileRef,
      checked_at: checkedAt,
      status: status as AgentCenterAvatarAssetValidationStatus,
      errors: validationErrors,
      warnings,
    },
  };
}

function validateAgentCenterAvatarAssetRecord(
  value: unknown,
  path: string,
  errors: string[],
): AgentCenterAvatarAssetRecord {
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, [
    'local_asset_id',
    'backend_kind',
    'display_name',
    'source_label',
    'backend_capability_profile_ref',
    'asset_bytes',
    'file_count',
    'imported_at',
    'selected',
    'validation',
  ], path, errors);
  const localAssetId = validatePackageId(record.local_asset_id, `${path}.local_asset_id`, errors) || '';
  const backendKind = readString(record.backend_kind, `${path}.backend_kind`, errors) || '';
  if (backendKind && !AVATAR_ASSET_KIND_VALUES.has(backendKind)) {
    errors.push(`${path}.backend_kind: invalid backend kind`);
  }
  if (backendKind && localAssetId && !localAssetId.startsWith(`${backendKind}_`)) {
    errors.push(`${path}.local_asset_id: backend kind mismatch`);
  }
  const displayName = readString(record.display_name, `${path}.display_name`, errors) || '';
  const sourceLabel = readString(record.source_label, `${path}.source_label`, errors) || '';
  const backendCapabilityProfileRef = record.backend_capability_profile_ref === null
    ? null
    : validateNormalizedId(
      record.backend_capability_profile_ref,
      `${path}.backend_capability_profile_ref`,
      errors,
    );
  if (typeof record.asset_bytes !== 'number' || !Number.isSafeInteger(record.asset_bytes) || record.asset_bytes <= 0) {
    errors.push(`${path}.asset_bytes: expected positive integer`);
  }
  if (typeof record.file_count !== 'number' || !Number.isSafeInteger(record.file_count) || record.file_count <= 0) {
    errors.push(`${path}.file_count: expected positive integer`);
  }
  const importedAt = validateTimestamp(record.imported_at, `${path}.imported_at`, errors) || '';
  if (typeof record.selected !== 'boolean') {
    errors.push(`${path}.selected: expected boolean`);
  }
  const validation = validateAgentCenterAvatarAssetValidationResult(record.validation);
  if (!validation.ok) {
    errors.push(...validation.errors.map((error) => `${path}.validation.${error}`));
  } else {
    if (validation.result.local_asset_id !== localAssetId) {
      errors.push(`${path}.validation.local_asset_id: must match record local_asset_id`);
    }
    if (validation.result.backend_kind !== backendKind) {
      errors.push(`${path}.validation.backend_kind: must match record backend_kind`);
    }
  }
  return {
    local_asset_id: localAssetId,
    backend_kind: backendKind as AgentCenterAvatarAssetKind,
    display_name: displayName,
    source_label: sourceLabel,
    backend_capability_profile_ref: backendCapabilityProfileRef,
    asset_bytes: record.asset_bytes as number,
    file_count: record.file_count as number,
    imported_at: importedAt,
    selected: record.selected as boolean,
    validation: validation.ok
      ? validation.result
      : {
          schema_version: 1,
          local_asset_id: localAssetId || null,
          backend_kind: AVATAR_ASSET_KIND_VALUES.has(backendKind) ? backendKind as AgentCenterAvatarAssetKind : null,
          backend_capability_profile_ref: backendCapabilityProfileRef || null,
          checked_at: '',
          status: 'invalid_manifest',
          errors: [],
          warnings: [],
        },
  };
}

export function validateAgentCenterAvatarAssetListResult(
  value: unknown,
): AgentCenterAvatarAssetListParseResult {
  const errors: string[] = [];
  const root = requireRecord(value, 'avatarAssetList', errors);
  if (!root) {
    return { ok: false, errors };
  }
  collectUnknownKeys(root, ['selected_local_asset_id', 'assets'], 'avatarAssetList', errors);
  const selectedLocalAssetId = validatePackageId(root.selected_local_asset_id, 'avatarAssetList.selected_local_asset_id', errors);
  if (!Array.isArray(root.assets)) {
    errors.push('avatarAssetList.assets: expected array');
  }
  const assets = Array.isArray(root.assets)
    ? root.assets.map((item, index) => validateAgentCenterAvatarAssetRecord(item, `avatarAssetList.assets.${index}`, errors))
    : [];
  if (selectedLocalAssetId) {
    const selectedAsset = assets.find((asset) => asset.local_asset_id === selectedLocalAssetId);
    if (selectedAsset && !selectedAsset.selected) {
      errors.push('avatarAssetList.selected_local_asset_id: matching asset must be marked selected');
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    result: {
      selected_local_asset_id: selectedLocalAssetId,
      assets,
    },
  };
}
