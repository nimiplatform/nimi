export const AGENT_CENTER_LOCAL_CONFIG_SCHEMA_VERSION = 1;
export const AGENT_CENTER_LOCAL_CONFIG_KIND = 'agent_center_local_config';

export const AGENT_CENTER_LOCAL_CONFIG_MODULE_IDS = [
  'appearance',
  'avatar_package',
  'local_history',
  'ui',
] as const;

export type AgentCenterLocalConfigModuleId = typeof AGENT_CENTER_LOCAL_CONFIG_MODULE_IDS[number];

export type AgentCenterLocalConfigSectionId =
  | 'overview'
  | 'appearance'
  | 'chat_behavior'
  | 'model'
  | 'cognition'
  | 'advanced';

export type AgentCenterAvatarPackageKind = 'live2d' | 'vrm';

export type AgentCenterSelectedAvatarPackage = {
  kind: AgentCenterAvatarPackageKind;
  package_id: string;
};

export type AgentCenterAppearanceModule = {
  schema_version: 1;
  background_asset_id: string | null;
  motion: 'system' | 'reduced' | 'full';
};

export type AgentCenterAvatarPackageModule = {
  schema_version: 1;
  selected_package: AgentCenterSelectedAvatarPackage | null;
  last_validated_at: string | null;
  last_launch_package_id: string | null;
};

export type AgentCenterLocalHistoryModule = {
  schema_version: 1;
  last_cleared_at: string | null;
};

export type AgentCenterUiModule = {
  schema_version: 1;
  last_section: AgentCenterLocalConfigSectionId;
};

export type AgentCenterLocalConfig = {
  schema_version: 1;
  config_kind: typeof AGENT_CENTER_LOCAL_CONFIG_KIND;
  account_id: string;
  agent_id: string;
  modules: {
    appearance: AgentCenterAppearanceModule;
    avatar_package: AgentCenterAvatarPackageModule;
    local_history: AgentCenterLocalHistoryModule;
    ui: AgentCenterUiModule;
  };
};

export type AgentCenterLocalConfigValidationResult =
  | { ok: true; config: AgentCenterLocalConfig }
  | { ok: false; errors: string[] };

export type AgentCenterAvatarPackageValidationStatus =
  | 'valid'
  | 'invalid_manifest'
  | 'missing_files'
  | 'permission_denied'
  | 'path_rejected'
  | 'unsupported_kind'
  | 'package_missing';

export type AgentCenterValidationIssueSeverity = 'error' | 'warning';

export type AgentCenterValidationIssue = {
  code: string;
  message: string;
  path: string | null;
  severity: AgentCenterValidationIssueSeverity;
};

export type AgentCenterAvatarPackageValidationResult = {
  schema_version: 1;
  package_id: string;
  checked_at: string;
  status: AgentCenterAvatarPackageValidationStatus;
  errors: AgentCenterValidationIssue[];
  warnings: AgentCenterValidationIssue[];
};

export type AgentCenterAvatarPackageValidationParseResult =
  | { ok: true; result: AgentCenterAvatarPackageValidationResult }
  | { ok: false; errors: string[] };

export type AgentCenterAvatarPackageImportResult = {
  package_id: string;
  kind: AgentCenterAvatarPackageKind;
  selected: boolean;
  validation: AgentCenterAvatarPackageValidationResult;
};

export type AgentCenterAvatarPackageImportParseResult =
  | { ok: true; result: AgentCenterAvatarPackageImportResult }
  | { ok: false; errors: string[] };

export type AgentCenterLocalResourceRemoveResult = {
  resource_kind: 'avatar_package' | 'background' | 'agent_local_resources' | 'account_local_resources';
  resource_id: string;
  quarantined: boolean;
  operation_id: string;
  status: 'completed';
};

export type AgentCenterLocalResourceRemoveParseResult =
  | { ok: true; result: AgentCenterLocalResourceRemoveResult }
  | { ok: false; errors: string[] };

export type AgentCenterBackgroundValidationStatus =
  | 'valid'
  | 'invalid_manifest'
  | 'missing_image'
  | 'permission_denied'
  | 'path_rejected'
  | 'unsupported_mime'
  | 'asset_missing'
  | 'digest_mismatch';

export type AgentCenterBackgroundValidationResult = {
  schema_version: 1;
  background_asset_id: string;
  checked_at: string;
  status: AgentCenterBackgroundValidationStatus;
  errors: AgentCenterValidationIssue[];
  warnings: AgentCenterValidationIssue[];
};

export type AgentCenterBackgroundValidationParseResult =
  | { ok: true; result: AgentCenterBackgroundValidationResult }
  | { ok: false; errors: string[] };

export type AgentCenterBackgroundImportResult = {
  background_asset_id: string;
  selected: boolean;
  validation: AgentCenterBackgroundValidationResult;
};

export type AgentCenterBackgroundImportParseResult =
  | { ok: true; result: AgentCenterBackgroundImportResult }
  | { ok: false; errors: string[] };

export type AgentCenterBackgroundAssetResult = {
  background_asset_id: string;
  file_url: string;
  validation: AgentCenterBackgroundValidationResult;
};

export type AgentCenterBackgroundAssetParseResult =
  | { ok: true; result: AgentCenterBackgroundAssetResult }
  | { ok: false; errors: string[] };

const NORMALIZED_ID_PATTERN = /^(?=.*[A-Za-z0-9])(?!\.{1,2}$)(?!.*:\/\/)[A-Za-z0-9._~:@+-]{1,256}$/u;
const BACKGROUND_ID_PATTERN = /^bg_[a-f0-9]{12}$/u;
const PACKAGE_ID_PATTERN = /^(live2d|vrm)_[a-f0-9]{12}$/u;
const OPERATION_ID_PATTERN = /^(op|tx)_[a-f0-9]{12}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

const ROOT_KEYS = ['schema_version', 'config_kind', 'account_id', 'agent_id', 'modules'] as const;
const MODULES_KEYS = AGENT_CENTER_LOCAL_CONFIG_MODULE_IDS;
const APPEARANCE_KEYS = ['schema_version', 'background_asset_id', 'motion'] as const;
const AVATAR_PACKAGE_KEYS = ['schema_version', 'selected_package', 'last_validated_at', 'last_launch_package_id'] as const;
const SELECTED_PACKAGE_KEYS = ['kind', 'package_id'] as const;
const LOCAL_HISTORY_KEYS = ['schema_version', 'last_cleared_at'] as const;
const UI_KEYS = ['schema_version', 'last_section'] as const;

const MOTION_VALUES = new Set(['system', 'reduced', 'full']);
const PACKAGE_KIND_VALUES = new Set(['live2d', 'vrm']);
const SECTION_VALUES = new Set(['overview', 'appearance', 'chat_behavior', 'model', 'cognition', 'advanced']);
const VALIDATION_STATUS_VALUES = new Set([
  'valid',
  'invalid_manifest',
  'missing_files',
  'permission_denied',
  'path_rejected',
  'unsupported_kind',
  'package_missing',
]);
const VALIDATION_SEVERITY_VALUES = new Set(['error', 'warning']);
const BACKGROUND_VALIDATION_STATUS_VALUES = new Set([
  'valid',
  'invalid_manifest',
  'missing_image',
  'permission_denied',
  'path_rejected',
  'unsupported_mime',
  'asset_missing',
  'digest_mismatch',
]);
const LOCAL_RESOURCE_KIND_VALUES = new Set([
  'avatar_package',
  'background',
  'agent_local_resources',
  'account_local_resources',
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
  if (value.schema_version !== AGENT_CENTER_LOCAL_CONFIG_SCHEMA_VERSION) {
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

function validateBackgroundId(value: unknown, path: string, errors: string[]): string | null {
  const id = readNullableString(value, path, errors);
  if (id !== null && !BACKGROUND_ID_PATTERN.test(id)) {
    errors.push(`${path}: invalid background id`);
  }
  return id;
}

function validatePackageId(value: unknown, path: string, errors: string[]): string | null {
  const id = readNullableString(value, path, errors);
  if (id !== null && !PACKAGE_ID_PATTERN.test(id)) {
    errors.push(`${path}: invalid package id`);
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

function validateAppearanceModule(value: unknown, errors: string[]): AgentCenterAppearanceModule {
  const path = 'modules.appearance';
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, APPEARANCE_KEYS, path, errors);
  requireSchemaVersion(record, path, errors);

  const motion = readString(record.motion, `${path}.motion`, errors);
  if (motion && !MOTION_VALUES.has(motion)) {
    errors.push(`${path}.motion: invalid motion value`);
  }

  return {
    schema_version: 1,
    background_asset_id: validateBackgroundId(record.background_asset_id, `${path}.background_asset_id`, errors),
    motion: MOTION_VALUES.has(motion || '') ? motion as AgentCenterAppearanceModule['motion'] : 'system',
  };
}

function validateSelectedPackage(value: unknown, path: string, errors: string[]): AgentCenterSelectedAvatarPackage | null {
  if (value === null) {
    return null;
  }
  const record = requireRecord(value, path, errors);
  if (!record) {
    return null;
  }
  collectUnknownKeys(record, SELECTED_PACKAGE_KEYS, path, errors);
  const kind = readString(record.kind, `${path}.kind`, errors);
  if (kind && !PACKAGE_KIND_VALUES.has(kind)) {
    errors.push(`${path}.kind: invalid package kind`);
  }
  const packageId = validatePackageId(record.package_id, `${path}.package_id`, errors);
  if (kind && packageId && !packageId.startsWith(`${kind}_`)) {
    errors.push(`${path}.package_id: package id must match kind`);
  }
  return {
    kind: PACKAGE_KIND_VALUES.has(kind || '') ? kind as AgentCenterAvatarPackageKind : 'live2d',
    package_id: packageId || '',
  };
}

function validateAvatarPackageModule(value: unknown, errors: string[]): AgentCenterAvatarPackageModule {
  const path = 'modules.avatar_package';
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, AVATAR_PACKAGE_KEYS, path, errors);
  requireSchemaVersion(record, path, errors);

  return {
    schema_version: 1,
    selected_package: validateSelectedPackage(record.selected_package, `${path}.selected_package`, errors),
    last_validated_at: validateTimestamp(record.last_validated_at, `${path}.last_validated_at`, errors),
    last_launch_package_id: validatePackageId(record.last_launch_package_id, `${path}.last_launch_package_id`, errors),
  };
}

function validateLocalHistoryModule(value: unknown, errors: string[]): AgentCenterLocalHistoryModule {
  const path = 'modules.local_history';
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, LOCAL_HISTORY_KEYS, path, errors);
  requireSchemaVersion(record, path, errors);
  return {
    schema_version: 1,
    last_cleared_at: validateTimestamp(record.last_cleared_at, `${path}.last_cleared_at`, errors),
  };
}

function validateUiModule(value: unknown, errors: string[]): AgentCenterUiModule {
  const path = 'modules.ui';
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, UI_KEYS, path, errors);
  requireSchemaVersion(record, path, errors);

  const lastSection = readString(record.last_section, `${path}.last_section`, errors);
  if (lastSection && !SECTION_VALUES.has(lastSection)) {
    errors.push(`${path}.last_section: invalid section`);
  }

  return {
    schema_version: 1,
    last_section: SECTION_VALUES.has(lastSection || '') ? lastSection as AgentCenterLocalConfigSectionId : 'overview',
  };
}

export function validateAgentCenterLocalConfig(value: unknown): AgentCenterLocalConfigValidationResult {
  const errors: string[] = [];
  const root = requireRecord(value, 'config', errors);
  if (!root) {
    return { ok: false, errors };
  }

  collectUnknownKeys(root, ROOT_KEYS, 'config', errors);
  requireSchemaVersion(root, 'config', errors);
  if (root.config_kind !== AGENT_CENTER_LOCAL_CONFIG_KIND) {
    errors.push('config.config_kind: expected agent_center_local_config');
  }

  const modules = requireRecord(root.modules, 'config.modules', errors) ?? {};
  collectUnknownKeys(modules, MODULES_KEYS, 'config.modules', errors);
  for (const moduleId of MODULES_KEYS) {
    if (!(moduleId in modules)) {
      errors.push(`config.modules.${moduleId}: missing module`);
    }
  }

  const config: AgentCenterLocalConfig = {
    schema_version: 1,
    config_kind: AGENT_CENTER_LOCAL_CONFIG_KIND,
    account_id: validateNormalizedId(root.account_id, 'config.account_id', errors),
    agent_id: validateNormalizedId(root.agent_id, 'config.agent_id', errors),
    modules: {
      appearance: validateAppearanceModule(modules.appearance, errors),
      avatar_package: validateAvatarPackageModule(modules.avatar_package, errors),
      local_history: validateLocalHistoryModule(modules.local_history, errors),
      ui: validateUiModule(modules.ui, errors),
    },
  };

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, config };
}

export function createDefaultAgentCenterLocalConfig(input: { accountId: string; agentId: string }): AgentCenterLocalConfig {
  return {
    schema_version: 1,
    config_kind: AGENT_CENTER_LOCAL_CONFIG_KIND,
    account_id: input.accountId,
    agent_id: input.agentId,
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: null,
        motion: 'system',
      },
      avatar_package: {
        schema_version: 1,
        selected_package: null,
        last_validated_at: null,
        last_launch_package_id: null,
      },
      local_history: {
        schema_version: 1,
        last_cleared_at: null,
      },
      ui: {
        schema_version: 1,
        last_section: 'overview',
      },
    },
  };
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

export function validateAgentCenterAvatarPackageValidationResult(
  value: unknown,
): AgentCenterAvatarPackageValidationParseResult {
  const errors: string[] = [];
  const root = requireRecord(value, 'validation', errors);
  if (!root) {
    return { ok: false, errors };
  }

  collectUnknownKeys(root, ['schema_version', 'package_id', 'checked_at', 'status', 'errors', 'warnings'], 'validation', errors);
  requireSchemaVersion(root, 'validation', errors);
  const packageId = validatePackageId(root.package_id, 'validation.package_id', errors) || '';
  const checkedAt = validateTimestamp(root.checked_at, 'validation.checked_at', errors) || '';
  const status = readString(root.status, 'validation.status', errors);
  if (status && !VALIDATION_STATUS_VALUES.has(status)) {
    errors.push('validation.status: invalid status');
  }
  const validationErrors = validateValidationIssues(root.errors, 'validation.errors', errors);
  const warnings = validateValidationIssues(root.warnings, 'validation.warnings', errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    result: {
      schema_version: 1,
      package_id: packageId,
      checked_at: checkedAt,
      status: status as AgentCenterAvatarPackageValidationStatus,
      errors: validationErrors,
      warnings,
    },
  };
}

export function validateAgentCenterAvatarPackageImportResult(
  value: unknown,
): AgentCenterAvatarPackageImportParseResult {
  const errors: string[] = [];
  const root = requireRecord(value, 'importResult', errors);
  if (!root) {
    return { ok: false, errors };
  }
  collectUnknownKeys(root, ['package_id', 'kind', 'selected', 'validation'], 'importResult', errors);
  const packageId = validatePackageId(root.package_id, 'importResult.package_id', errors) || '';
  const kind = readString(root.kind, 'importResult.kind', errors);
  if (kind && !PACKAGE_KIND_VALUES.has(kind)) {
    errors.push('importResult.kind: invalid package kind');
  }
  if (kind && packageId && !packageId.startsWith(`${kind}_`)) {
    errors.push('importResult.package_id: package id must match kind');
  }
  if (typeof root.selected !== 'boolean') {
    errors.push('importResult.selected: expected boolean');
  }
  const validation = validateAgentCenterAvatarPackageValidationResult(root.validation);
  if (!validation.ok) {
    errors.push(...validation.errors.map((error) => `importResult.${error}`));
  }
  if (errors.length > 0 || !validation.ok) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    result: {
      package_id: packageId,
      kind: kind as AgentCenterAvatarPackageKind,
      selected: root.selected as boolean,
      validation: validation.result,
    },
  };
}

export function validateAgentCenterLocalResourceRemoveResult(
  value: unknown,
): AgentCenterLocalResourceRemoveParseResult {
  const errors: string[] = [];
  const root = requireRecord(value, 'removeResult', errors);
  if (!root) {
    return { ok: false, errors };
  }
  collectUnknownKeys(root, ['resource_kind', 'resource_id', 'quarantined', 'operation_id', 'status'], 'removeResult', errors);
  const resourceKind = readString(root.resource_kind, 'removeResult.resource_kind', errors);
  if (resourceKind && !LOCAL_RESOURCE_KIND_VALUES.has(resourceKind)) {
    errors.push('removeResult.resource_kind: invalid resource kind');
  }
  const resourceId = readString(root.resource_id, 'removeResult.resource_id', errors) || '';
  if (resourceKind === 'avatar_package' && !PACKAGE_ID_PATTERN.test(resourceId)) {
    errors.push('removeResult.resource_id: invalid avatar package id');
  }
  if (resourceKind === 'background' && !BACKGROUND_ID_PATTERN.test(resourceId)) {
    errors.push('removeResult.resource_id: invalid background id');
  }
  if (
    (resourceKind === 'agent_local_resources' || resourceKind === 'account_local_resources')
    && !NORMALIZED_ID_PATTERN.test(resourceId)
  ) {
    errors.push('removeResult.resource_id: invalid normalized id');
  }
  if (typeof root.quarantined !== 'boolean') {
    errors.push('removeResult.quarantined: expected boolean');
  }
  const operationId = readString(root.operation_id, 'removeResult.operation_id', errors) || '';
  if (operationId && !OPERATION_ID_PATTERN.test(operationId)) {
    errors.push('removeResult.operation_id: invalid operation id');
  }
  const status = readString(root.status, 'removeResult.status', errors);
  if (status !== 'completed') {
    errors.push('removeResult.status: expected completed');
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    result: {
      resource_kind: resourceKind as AgentCenterLocalResourceRemoveResult['resource_kind'],
      resource_id: resourceId,
      quarantined: root.quarantined as boolean,
      operation_id: operationId,
      status: 'completed',
    },
  };
}

export function validateAgentCenterBackgroundValidationResult(
  value: unknown,
): AgentCenterBackgroundValidationParseResult {
  const errors: string[] = [];
  const root = requireRecord(value, 'validation', errors);
  if (!root) {
    return { ok: false, errors };
  }

  collectUnknownKeys(root, ['schema_version', 'background_asset_id', 'checked_at', 'status', 'errors', 'warnings'], 'validation', errors);
  requireSchemaVersion(root, 'validation', errors);
  const backgroundAssetId = validateBackgroundId(root.background_asset_id, 'validation.background_asset_id', errors) || '';
  const checkedAt = validateTimestamp(root.checked_at, 'validation.checked_at', errors) || '';
  const status = readString(root.status, 'validation.status', errors);
  if (status && !BACKGROUND_VALIDATION_STATUS_VALUES.has(status)) {
    errors.push('validation.status: invalid status');
  }
  const validationErrors = validateValidationIssues(root.errors, 'validation.errors', errors);
  const warnings = validateValidationIssues(root.warnings, 'validation.warnings', errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    result: {
      schema_version: 1,
      background_asset_id: backgroundAssetId,
      checked_at: checkedAt,
      status: status as AgentCenterBackgroundValidationStatus,
      errors: validationErrors,
      warnings,
    },
  };
}

export function validateAgentCenterBackgroundImportResult(
  value: unknown,
): AgentCenterBackgroundImportParseResult {
  const errors: string[] = [];
  const root = requireRecord(value, 'backgroundImportResult', errors);
  if (!root) {
    return { ok: false, errors };
  }
  collectUnknownKeys(root, ['background_asset_id', 'selected', 'validation'], 'backgroundImportResult', errors);
  const backgroundAssetId = validateBackgroundId(root.background_asset_id, 'backgroundImportResult.background_asset_id', errors) || '';
  if (typeof root.selected !== 'boolean') {
    errors.push('backgroundImportResult.selected: expected boolean');
  }
  const validation = validateAgentCenterBackgroundValidationResult(root.validation);
  if (!validation.ok) {
    errors.push(...validation.errors.map((error) => `backgroundImportResult.${error}`));
  }
  if (errors.length > 0 || !validation.ok) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    result: {
      background_asset_id: backgroundAssetId,
      selected: root.selected as boolean,
      validation: validation.result,
    },
  };
}

export function validateAgentCenterBackgroundAssetResult(
  value: unknown,
): AgentCenterBackgroundAssetParseResult {
  const errors: string[] = [];
  const root = requireRecord(value, 'backgroundAssetResult', errors);
  if (!root) {
    return { ok: false, errors };
  }
  collectUnknownKeys(root, ['background_asset_id', 'file_url', 'validation'], 'backgroundAssetResult', errors);
  const backgroundAssetId = validateBackgroundId(root.background_asset_id, 'backgroundAssetResult.background_asset_id', errors) || '';
  const fileUrl = readString(root.file_url, 'backgroundAssetResult.file_url', errors) || '';
  const validation = validateAgentCenterBackgroundValidationResult(root.validation);
  if (!validation.ok) {
    errors.push(...validation.errors.map((error) => `backgroundAssetResult.${error}`));
  }
  if (errors.length > 0 || !validation.ok) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    result: {
      background_asset_id: backgroundAssetId,
      file_url: fileUrl,
      validation: validation.result,
    },
  };
}
