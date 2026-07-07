export type AgentCenterAvatarAssetKind = 'live2d' | 'vrm';
export type AvatarImportState =
  | 'valid'
  | 'invalid_manifest'
  | 'missing_entry'
  | 'permission_denied'
  | 'path_rejected'
  | 'unsupported_kind'
  | 'asset_missing'
  | 'digest_mismatch';
export type BackgroundImportState =
  | 'valid'
  | 'invalid_manifest'
  | 'missing_image'
  | 'permission_denied'
  | 'path_rejected'
  | 'unsupported_mime'
  | 'asset_missing'
  | 'digest_mismatch';

export type LocalConfigScope = {
  accountId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
};

export type AgentCenterLocalConfig = {
  schema_version: 1;
  config_kind: 'agent_center_local_config';
  account_id: string;
  owner_user_id: string;
  runtime_source_ref: string;
  local_agent_ref: string;
  modules: {
    appearance: {
      schema_version: 1;
      background_asset_id: string | null;
      motion: 'system' | 'reduced' | 'full';
    };
    avatar_asset: {
      schema_version: 1;
      conversation_anchor_scope: 'current_anchor' | 'explicit_debug_anchor' | 'no_anchor';
      local_avatar_asset_ref: string | null;
      live2d_adapter_manifest_source: 'none' | 'embedded_creator_manifest' | 'external_sidecar_manifest';
      live2d_adapter_manifest_ref: string | null;
      live2d_calibration_ref: string | null;
      avatar_instance_policy: 'reuse_active_instance' | 'launch_new_instance' | 'require_user_selection';
      backend_kind: 'live2d' | 'vrm' | 'future';
      backend_capability_profile_ref: string | null;
      generated_motion_provider_policy: 'require_profile_support' | 'disable_generated_motion' | 'debug_only';
      launch_mode: 'manual' | 'debug_session' | 'start_with_chat';
      debug_profile: 'standard' | 'strict_backend_evidence' | 'route_matrix';
      updated_at: string;
      provenance: {
        source: 'user_selection' | 'import_validation' | 'runtime_projection' | 'avatar_backend_evidence';
        evidence_ref: string;
      };
    };
    local_history: {
      schema_version: 1;
      last_cleared_at: string | null;
    };
    voice: {
      schema_version: 1;
      avatar_autoplay: boolean;
    };
    ui: {
      schema_version: 1;
      last_section: 'overview' | 'appearance' | 'chat_behavior' | 'model' | 'cognition' | 'advanced';
    };
  };
};

export type ValidationIssue = {
  code: string;
  message: string;
  path: string | null;
  severity: 'error' | 'warning';
};

export type AvatarValidationResult = {
  schema_version: 1;
  local_asset_id: string;
  checked_at: string;
  status: AvatarImportState;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type BackgroundValidationResult = {
  schema_version: 1;
  background_asset_id: string;
  checked_at: string;
  status: BackgroundImportState;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

const NORMALIZED_ID_PATTERN = /^(?=.*[A-Za-z0-9])(?!\.{1,2}$)(?!.*:\/\/)[A-Za-z0-9._~:@+-]{1,256}$/u;
const AVATAR_ID_PATTERN = /^(live2d|vrm)_[a-f0-9]{12}$/u;
const BACKGROUND_ID_PATTERN = /^bg_[a-f0-9]{12}$/u;
const ADAPTER_ID_PATTERN = /^live2d_adapter_[a-f0-9]{12}$/u;
const LIVE2D_CALIBRATION_REF_PATTERN = /^live2d_calibration_[a-f0-9]{12}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

const ROOT_KEYS = [
  'schema_version',
  'config_kind',
  'account_id',
  'owner_user_id',
  'runtime_source_ref',
  'local_agent_ref',
  'modules',
] as const;
const MODULE_KEYS = ['appearance', 'avatar_asset', 'local_history', 'voice', 'ui'] as const;
const APPEARANCE_KEYS = ['schema_version', 'background_asset_id', 'motion'] as const;
const AVATAR_ASSET_KEYS = [
  'schema_version',
  'conversation_anchor_scope',
  'local_avatar_asset_ref',
  'live2d_adapter_manifest_source',
  'live2d_adapter_manifest_ref',
  'live2d_calibration_ref',
  'avatar_instance_policy',
  'backend_kind',
  'backend_capability_profile_ref',
  'generated_motion_provider_policy',
  'launch_mode',
  'debug_profile',
  'updated_at',
  'provenance',
] as const;
const PROVENANCE_KEYS = ['source', 'evidence_ref'] as const;
const LOCAL_HISTORY_KEYS = ['schema_version', 'last_cleared_at'] as const;
const VOICE_KEYS = ['schema_version', 'avatar_autoplay'] as const;
const UI_KEYS = ['schema_version', 'last_section'] as const;

export function parseScope(value: Record<string, unknown>): LocalConfigScope {
  const scope = {
    accountId: parseNormalizedId(value.accountId, 'accountId'),
    ownerUserId: parseNormalizedId(value.ownerUserId, 'ownerUserId'),
    runtimeSourceRef: parseNormalizedId(value.runtimeSourceRef, 'runtimeSourceRef'),
    localAgentRef: parseNormalizedId(value.localAgentRef, 'localAgentRef'),
  };
  if (!scope.localAgentRef.startsWith('local-agent:')) {
    throw new Error('localAgentRef must start with local-agent:.');
  }
  if (scope.localAgentRef === scope.runtimeSourceRef) {
    throw new Error('localAgentRef must not equal runtimeSourceRef.');
  }
  return scope;
}

export function parseConfig(value: unknown): AgentCenterLocalConfig {
  const record = asRecord(value, 'Agent Center local config');
  assertKnownKeys(record, ROOT_KEYS, 'config');
  if (record.schema_version !== 1 || record.config_kind !== 'agent_center_local_config') {
    throw new Error('Agent Center local config has an unsupported schema or kind.');
  }
  const scope = {
    accountId: parseNormalizedId(record.account_id, 'config.account_id'),
    ownerUserId: parseNormalizedId(record.owner_user_id, 'config.owner_user_id'),
    runtimeSourceRef: parseNormalizedId(record.runtime_source_ref, 'config.runtime_source_ref'),
    localAgentRef: parseNormalizedId(record.local_agent_ref, 'config.local_agent_ref'),
  };
  parseScope({
    accountId: scope.accountId,
    ownerUserId: scope.ownerUserId,
    runtimeSourceRef: scope.runtimeSourceRef,
    localAgentRef: scope.localAgentRef,
  });

  const modules = asRecord(record.modules, 'Agent Center local config modules');
  assertKnownKeys(modules, MODULE_KEYS, 'modules');
  for (const moduleId of MODULE_KEYS) {
    if (!(moduleId in modules)) {
      throw new Error(`modules.${moduleId} is required.`);
    }
  }
  const appearance = asRecord(modules.appearance, 'Agent Center appearance module');
  const avatarAsset = asRecord(modules.avatar_asset, 'Agent Center avatar asset module');
  const localHistory = asRecord(modules.local_history, 'Agent Center local history module');
  const voice = asRecord(modules.voice, 'Agent Center voice module');
  const ui = asRecord(modules.ui, 'Agent Center UI module');
  assertKnownKeys(appearance, APPEARANCE_KEYS, 'modules.appearance');
  assertKnownKeys(avatarAsset, AVATAR_ASSET_KEYS, 'modules.avatar_asset');
  assertKnownKeys(localHistory, LOCAL_HISTORY_KEYS, 'modules.local_history');
  assertKnownKeys(voice, VOICE_KEYS, 'modules.voice');
  assertKnownKeys(ui, UI_KEYS, 'modules.ui');
  parseSchemaVersion(appearance, 'modules.appearance');
  parseSchemaVersion(avatarAsset, 'modules.avatar_asset');
  parseSchemaVersion(localHistory, 'modules.local_history');
  parseSchemaVersion(voice, 'modules.voice');
  parseSchemaVersion(ui, 'modules.ui');

  const backendKind = parseEnum(avatarAsset.backend_kind, ['live2d', 'vrm', 'future'], 'modules.avatar_asset.backend_kind');
  const localAvatarAssetRef = parseNullablePattern(avatarAsset.local_avatar_asset_ref, AVATAR_ID_PATTERN, 'modules.avatar_asset.local_avatar_asset_ref');
  if (localAvatarAssetRef) {
    if (backendKind === 'future') {
      throw new Error('modules.avatar_asset.backend_kind cannot be future for a selected local Avatar asset.');
    }
    if (!localAvatarAssetRef.startsWith(`${backendKind}_`)) {
      throw new Error('modules.avatar_asset.backend_kind must match local Avatar asset id prefix.');
    }
  }

  const manifestSource = parseEnum(
    avatarAsset.live2d_adapter_manifest_source,
    ['none', 'embedded_creator_manifest', 'external_sidecar_manifest'],
    'modules.avatar_asset.live2d_adapter_manifest_source',
  );
  const manifestRef = parseNullablePattern(avatarAsset.live2d_adapter_manifest_ref, ADAPTER_ID_PATTERN, 'modules.avatar_asset.live2d_adapter_manifest_ref');
  if (manifestSource !== 'none' && backendKind !== 'live2d') {
    throw new Error('modules.avatar_asset.live2d_adapter_manifest_source requires live2d backend.');
  }
  if (manifestSource === 'external_sidecar_manifest' && !manifestRef) {
    throw new Error('modules.avatar_asset.live2d_adapter_manifest_ref is required for external sidecar manifest source.');
  }
  if (manifestSource !== 'external_sidecar_manifest' && manifestRef) {
    throw new Error('modules.avatar_asset.live2d_adapter_manifest_ref requires external sidecar manifest source.');
  }

  const calibrationRef = parseNullablePattern(avatarAsset.live2d_calibration_ref, LIVE2D_CALIBRATION_REF_PATTERN, 'modules.avatar_asset.live2d_calibration_ref');
  if (calibrationRef && backendKind !== 'live2d') {
    throw new Error('modules.avatar_asset.live2d_calibration_ref requires live2d backend.');
  }
  const provenance = asRecord(avatarAsset.provenance, 'modules.avatar_asset.provenance');
  assertKnownKeys(provenance, PROVENANCE_KEYS, 'modules.avatar_asset.provenance');

  return {
    schema_version: 1,
    config_kind: 'agent_center_local_config',
    account_id: scope.accountId,
    owner_user_id: scope.ownerUserId,
    runtime_source_ref: scope.runtimeSourceRef,
    local_agent_ref: scope.localAgentRef,
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: parseNullablePattern(appearance.background_asset_id, BACKGROUND_ID_PATTERN, 'modules.appearance.background_asset_id'),
        motion: parseEnum(appearance.motion, ['system', 'reduced', 'full'], 'modules.appearance.motion'),
      },
      avatar_asset: {
        schema_version: 1,
        conversation_anchor_scope: parseEnum(avatarAsset.conversation_anchor_scope, ['current_anchor', 'explicit_debug_anchor', 'no_anchor'], 'modules.avatar_asset.conversation_anchor_scope'),
        local_avatar_asset_ref: localAvatarAssetRef,
        live2d_adapter_manifest_source: manifestSource,
        live2d_adapter_manifest_ref: manifestRef,
        live2d_calibration_ref: calibrationRef,
        avatar_instance_policy: parseEnum(avatarAsset.avatar_instance_policy, ['reuse_active_instance', 'launch_new_instance', 'require_user_selection'], 'modules.avatar_asset.avatar_instance_policy'),
        backend_kind: backendKind,
        backend_capability_profile_ref: parseNullableNormalizedId(avatarAsset.backend_capability_profile_ref, 'modules.avatar_asset.backend_capability_profile_ref'),
        generated_motion_provider_policy: parseEnum(avatarAsset.generated_motion_provider_policy, ['require_profile_support', 'disable_generated_motion', 'debug_only'], 'modules.avatar_asset.generated_motion_provider_policy'),
        launch_mode: parseEnum(avatarAsset.launch_mode, ['manual', 'debug_session', 'start_with_chat'], 'modules.avatar_asset.launch_mode'),
        debug_profile: parseEnum(avatarAsset.debug_profile, ['standard', 'strict_backend_evidence', 'route_matrix'], 'modules.avatar_asset.debug_profile'),
        updated_at: parseRequiredTimestamp(avatarAsset.updated_at, 'modules.avatar_asset.updated_at'),
        provenance: {
          source: parseEnum(provenance.source, ['user_selection', 'import_validation', 'runtime_projection', 'avatar_backend_evidence'], 'modules.avatar_asset.provenance.source'),
          evidence_ref: parseNormalizedId(provenance.evidence_ref, 'modules.avatar_asset.provenance.evidence_ref'),
        },
      },
      local_history: {
        schema_version: 1,
        last_cleared_at: parseNullableTimestamp(localHistory.last_cleared_at, 'modules.local_history.last_cleared_at'),
      },
      voice: {
        schema_version: 1,
        avatar_autoplay: parseRequiredBoolean(voice.avatar_autoplay, 'modules.voice.avatar_autoplay'),
      },
      ui: {
        schema_version: 1,
        last_section: parseEnum(ui.last_section, ['overview', 'appearance', 'chat_behavior', 'model', 'cognition', 'advanced'], 'modules.ui.last_section'),
      },
    },
  };
}

export function createDefaultConfig(scope: LocalConfigScope): AgentCenterLocalConfig {
  return {
    schema_version: 1,
    config_kind: 'agent_center_local_config',
    account_id: scope.accountId,
    owner_user_id: scope.ownerUserId,
    runtime_source_ref: scope.runtimeSourceRef,
    local_agent_ref: scope.localAgentRef,
    modules: {
      appearance: {
        schema_version: 1,
        background_asset_id: null,
        motion: 'system',
      },
      avatar_asset: {
        schema_version: 1,
        conversation_anchor_scope: 'current_anchor',
        local_avatar_asset_ref: null,
        live2d_adapter_manifest_source: 'none',
        live2d_adapter_manifest_ref: null,
        live2d_calibration_ref: null,
        avatar_instance_policy: 'reuse_active_instance',
        backend_kind: 'live2d',
        backend_capability_profile_ref: null,
        generated_motion_provider_policy: 'require_profile_support',
        launch_mode: 'manual',
        debug_profile: 'standard',
        updated_at: new Date().toISOString(),
        provenance: {
          source: 'runtime_projection',
          evidence_ref: 'zhiyu-agent-center-avatar-config-default',
        },
      },
      local_history: {
        schema_version: 1,
        last_cleared_at: null,
      },
      voice: {
        schema_version: 1,
        avatar_autoplay: false,
      },
      ui: {
        schema_version: 1,
        last_section: 'overview',
      },
    },
  };
}

export function assertSameScope(config: AgentCenterLocalConfig, scope: LocalConfigScope): void {
  if (
    config.account_id !== scope.accountId
    || config.owner_user_id !== scope.ownerUserId
    || config.runtime_source_ref !== scope.runtimeSourceRef
    || config.local_agent_ref !== scope.localAgentRef
  ) {
    throw new Error('Agent Center local config scope does not match requested scope.');
  }
}

export function parseRequiredString(value: unknown, field: string): string {
  const text = normalizeText(value);
  if (!text) {
    throw new Error(`${field} is required.`);
  }
  if (text.normalize('NFC') !== text) {
    throw new Error(`${field} must be NFC normalized.`);
  }
  return text;
}

export function parseNormalizedId(value: unknown, field: string): string {
  const text = parseRequiredString(value, field);
  if (!NORMALIZED_ID_PATTERN.test(text)) {
    throw new Error(`${field} is not a normalized id.`);
  }
  return text;
}

export function parseAvatarKind(value: unknown): AgentCenterAvatarAssetKind {
  return parseEnum(value, ['live2d', 'vrm'], 'kind');
}

export function parseAvatarAssetId(value: unknown, field: string): string {
  const assetId = parseNullablePattern(value, AVATAR_ID_PATTERN, field);
  if (!assetId) {
    throw new Error(`${field} is required.`);
  }
  return assetId;
}

export function parseBackgroundAssetId(value: unknown, field: string): string {
  const assetId = parseNullablePattern(value, BACKGROUND_ID_PATTERN, field);
  if (!assetId) {
    throw new Error(`${field} is required.`);
  }
  return assetId;
}

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function assertKnownKeys(value: Record<string, unknown>, allowedKeys: readonly string[], label: string): void {
  const allowed = new Set<string>(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${label}.${key} is not admitted in Agent Center local config.`);
    }
  }
}

function parseSchemaVersion(value: Record<string, unknown>, label: string): void {
  if (value.schema_version !== 1) {
    throw new Error(`${label}.schema_version must be 1.`);
  }
}

function parseNullableNormalizedId(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return parseNormalizedId(value, field);
}

function parseRequiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be a boolean.`);
  }
  return value;
}

function parseNullableTimestamp(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return parseRequiredTimestamp(value, field);
}

function parseRequiredTimestamp(value: unknown, field: string): string {
  const text = parseRequiredString(value, field);
  if (!ISO_TIMESTAMP_PATTERN.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`${field} must be an ISO timestamp.`);
  }
  return text;
}

function parseNullablePattern(value: unknown, pattern: RegExp, field: string): string | null {
  if (value === null) {
    return null;
  }
  const text = parseRequiredString(value, field);
  if (!pattern.test(text)) {
    throw new Error(`${field} has invalid format.`);
  }
  return text;
}

function parseEnum<TValue extends string>(value: unknown, allowed: readonly TValue[], field: string): TValue {
  const text = parseRequiredString(value, field);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new Error(`${field} is invalid.`);
  }
  return text as TValue;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}
