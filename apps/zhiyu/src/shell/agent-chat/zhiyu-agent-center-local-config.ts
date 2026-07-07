export type ZhiyuAgentCenterAvatarAssetKind = 'live2d' | 'vrm';

export type ZhiyuAgentCenterLocalConfigScope = {
  readonly accountId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
};

export type ZhiyuAgentCenterAvatarAssetModule = {
  readonly schema_version: 1;
  readonly conversation_anchor_scope: 'current_anchor' | 'explicit_debug_anchor' | 'no_anchor';
  readonly local_avatar_asset_ref: string | null;
  readonly live2d_adapter_manifest_source: 'none' | 'embedded_creator_manifest' | 'external_sidecar_manifest';
  readonly live2d_adapter_manifest_ref: string | null;
  readonly live2d_calibration_ref: string | null;
  readonly avatar_instance_policy: 'reuse_active_instance' | 'launch_new_instance' | 'require_user_selection';
  readonly backend_kind: 'live2d' | 'vrm' | 'future';
  readonly backend_capability_profile_ref: string | null;
  readonly generated_motion_provider_policy: 'require_profile_support' | 'disable_generated_motion' | 'debug_only';
  readonly launch_mode: 'manual' | 'debug_session' | 'start_with_chat';
  readonly debug_profile: 'standard' | 'strict_backend_evidence' | 'route_matrix';
  readonly updated_at: string;
  readonly provenance: {
    readonly source: 'user_selection' | 'import_validation' | 'runtime_projection' | 'avatar_backend_evidence';
    readonly evidence_ref: string;
  };
};

export type ZhiyuAgentCenterLocalConfig = {
  readonly schema_version: 1;
  readonly config_kind: 'agent_center_local_config';
  readonly account_id: string;
  readonly owner_user_id: string;
  readonly runtime_source_ref: string;
  readonly local_agent_ref: string;
  readonly modules: {
    readonly appearance: {
      readonly schema_version: 1;
      readonly background_asset_id: string | null;
      readonly motion: 'system' | 'reduced' | 'full';
    };
    readonly avatar_asset: ZhiyuAgentCenterAvatarAssetModule;
    readonly local_history: {
      readonly schema_version: 1;
      readonly last_cleared_at: string | null;
    };
    readonly voice: {
      readonly schema_version: 1;
      readonly avatar_autoplay: boolean;
    };
    readonly ui: {
      readonly schema_version: 1;
      readonly last_section: 'overview' | 'appearance' | 'chat_behavior' | 'model' | 'cognition' | 'advanced';
    };
  };
};

export type ZhiyuAgentCenterLocalConfigBridge = {
  readonly invoke: (command: string, payload: Record<string, unknown>) => Promise<unknown>;
};

export type ZhiyuAgentCenterLocalConfigValidationResult =
  | { readonly ok: true; readonly config: ZhiyuAgentCenterLocalConfig }
  | { readonly ok: false; readonly errors: readonly string[] };

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

const MOTION_VALUES = ['system', 'reduced', 'full'] as const;
const ANCHOR_VALUES = ['current_anchor', 'explicit_debug_anchor', 'no_anchor'] as const;
const ADAPTER_SOURCE_VALUES = ['none', 'embedded_creator_manifest', 'external_sidecar_manifest'] as const;
const INSTANCE_POLICY_VALUES = ['reuse_active_instance', 'launch_new_instance', 'require_user_selection'] as const;
const BACKEND_KIND_VALUES = ['live2d', 'vrm', 'future'] as const;
const GENERATED_MOTION_VALUES = ['require_profile_support', 'disable_generated_motion', 'debug_only'] as const;
const LAUNCH_MODE_VALUES = ['manual', 'debug_session', 'start_with_chat'] as const;
const DEBUG_PROFILE_VALUES = ['standard', 'strict_backend_evidence', 'route_matrix'] as const;
const PROVENANCE_SOURCE_VALUES = ['user_selection', 'import_validation', 'runtime_projection', 'avatar_backend_evidence'] as const;
const SECTION_VALUES = ['overview', 'appearance', 'chat_behavior', 'model', 'cognition', 'advanced'] as const;

declare global {
  interface Window {
    readonly __nimiZhiyuAgentCenterLocalConfig?: ZhiyuAgentCenterLocalConfigBridge;
  }
}

export function hasZhiyuAgentCenterLocalConfigBridge(): boolean {
  return Boolean(agentCenterBridge());
}

export async function getZhiyuAgentCenterLocalConfig(
  scope: ZhiyuAgentCenterLocalConfigScope,
): Promise<ZhiyuAgentCenterLocalConfig> {
  return assertConfig(await invokeAgentCenter('config.get', scope));
}

export async function putZhiyuAgentCenterLocalConfig(
  config: ZhiyuAgentCenterLocalConfig,
): Promise<ZhiyuAgentCenterLocalConfig> {
  return assertConfig(await invokeAgentCenter('config.put', { config }));
}

export async function importZhiyuAgentCenterAvatarAsset(input: {
  readonly scope: ZhiyuAgentCenterLocalConfigScope;
  readonly kind: ZhiyuAgentCenterAvatarAssetKind;
}): Promise<boolean> {
  const sourcePath = await invokeAgentCenter(
    input.kind === 'live2d' ? 'avatar.pickLive2dSource' : 'avatar.pickVrmSource',
    {},
  );
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    return false;
  }
  await invokeAgentCenter('avatar.import', {
    ...input.scope,
    kind: input.kind,
    sourcePath,
    select: true,
  });
  return true;
}

export async function importZhiyuAgentCenterLive2dAdapterManifest(input: {
  readonly scope: ZhiyuAgentCenterLocalConfigScope;
  readonly localAssetId: string;
}): Promise<boolean> {
  const sourcePath = await invokeAgentCenter('avatar.pickLive2dAdapterManifest', {});
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    return false;
  }
  await invokeAgentCenter('avatar.importLive2dAdapterManifest', {
    ...input.scope,
    localAssetId: input.localAssetId,
    sourcePath,
    select: true,
  });
  return true;
}

export async function importZhiyuAgentCenterBackground(
  scope: ZhiyuAgentCenterLocalConfigScope,
): Promise<boolean> {
  const sourcePath = await invokeAgentCenter('background.pickSource', {});
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    return false;
  }
  await invokeAgentCenter('background.import', {
    ...scope,
    sourcePath,
    select: true,
  });
  return true;
}

export async function clearZhiyuAgentCenterAvatarAsset(
  config: ZhiyuAgentCenterLocalConfig,
): Promise<ZhiyuAgentCenterLocalConfig> {
  return putZhiyuAgentCenterLocalConfig({
    ...config,
    modules: {
      ...config.modules,
      avatar_asset: {
        ...config.modules.avatar_asset,
        local_avatar_asset_ref: null,
        live2d_adapter_manifest_source: 'none',
        live2d_adapter_manifest_ref: null,
        live2d_calibration_ref: null,
        backend_capability_profile_ref: null,
        updated_at: new Date().toISOString(),
        provenance: {
          source: 'user_selection',
          evidence_ref: 'zhiyu-agent-center-avatar-selection-cleared',
        },
      },
    },
  });
}

export async function clearZhiyuAgentCenterBackground(
  scope: ZhiyuAgentCenterLocalConfigScope,
  backgroundAssetId: string,
): Promise<void> {
  await invokeAgentCenter('background.remove', {
    ...scope,
    backgroundAssetId,
  });
}

async function invokeAgentCenter(command: string, payload: Record<string, unknown>): Promise<unknown> {
  const bridge = agentCenterBridge();
  if (!bridge) {
    throw new Error('Zhiyu Agent Center local config bridge is unavailable.');
  }
  return bridge.invoke(command, payload);
}

function agentCenterBridge(): ZhiyuAgentCenterLocalConfigBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__nimiZhiyuAgentCenterLocalConfig ?? null;
}

export function validateZhiyuAgentCenterLocalConfig(value: unknown): ZhiyuAgentCenterLocalConfigValidationResult {
  const errors: string[] = [];
  const root = requireRecord(value, 'config', errors);
  if (!root) {
    return { ok: false, errors };
  }

  collectUnknownKeys(root, ROOT_KEYS, 'config', errors);
  requireSchemaVersion(root, 'config', errors);
  if (root.config_kind !== 'agent_center_local_config') {
    errors.push('config.config_kind: expected agent_center_local_config');
  }
  const accountId = validateNormalizedId(root.account_id, 'config.account_id', errors);
  const ownerUserId = validateNormalizedId(root.owner_user_id, 'config.owner_user_id', errors);
  const runtimeSourceRef = validateNormalizedId(root.runtime_source_ref, 'config.runtime_source_ref', errors);
  const localAgentRef = validateNormalizedId(root.local_agent_ref, 'config.local_agent_ref', errors);
  if (localAgentRef && !localAgentRef.startsWith('local-agent:')) {
    errors.push('config.local_agent_ref: must start with local-agent:');
  }
  if (localAgentRef && runtimeSourceRef && localAgentRef === runtimeSourceRef) {
    errors.push('config.local_agent_ref: must not equal runtime_source_ref');
  }

  const modules = requireRecord(root.modules, 'config.modules', errors) ?? {};
  collectUnknownKeys(modules, MODULE_KEYS, 'config.modules', errors);
  for (const moduleId of MODULE_KEYS) {
    if (!(moduleId in modules)) {
      errors.push(`config.modules.${moduleId}: missing module`);
    }
  }

  const appearance = validateAppearanceModule(modules.appearance, errors);
  const avatarAsset = validateAvatarAssetModule(modules.avatar_asset, errors);
  const config: ZhiyuAgentCenterLocalConfig = {
    schema_version: 1,
    config_kind: 'agent_center_local_config',
    account_id: accountId,
    owner_user_id: ownerUserId,
    runtime_source_ref: runtimeSourceRef,
    local_agent_ref: localAgentRef,
    modules: {
      appearance,
      avatar_asset: avatarAsset,
      local_history: validateLocalHistoryModule(modules.local_history, errors),
      voice: validateVoiceModule(modules.voice, errors),
      ui: validateUiModule(modules.ui, errors),
    },
  };

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, config };
}

function assertConfig(value: unknown): ZhiyuAgentCenterLocalConfig {
  const result = validateZhiyuAgentCenterLocalConfig(value);
  if (!result.ok) {
    throw new Error(`Zhiyu Agent Center local config response is invalid: ${result.errors.join('; ')}`);
  }
  return result.config;
}

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
  return value === null ? null : readString(value, path, errors);
}

function readBoolean(value: unknown, path: string, errors: string[]): boolean {
  if (typeof value !== 'boolean') {
    errors.push(`${path}: expected boolean`);
    return false;
  }
  return value;
}

function validateNormalizedId(value: unknown, path: string, errors: string[]): string {
  const id = readString(value, path, errors);
  if (!id || !NORMALIZED_ID_PATTERN.test(id)) {
    errors.push(`${path}: invalid normalized id`);
    return '';
  }
  return id;
}

function validateNullableNormalizedId(value: unknown, path: string, errors: string[]): string | null {
  const id = readNullableString(value, path, errors);
  if (id !== null && !NORMALIZED_ID_PATTERN.test(id)) {
    errors.push(`${path}: invalid normalized id`);
  }
  return id;
}

function validateNullablePattern(value: unknown, pattern: RegExp, path: string, errors: string[], label: string): string | null {
  const id = readNullableString(value, path, errors);
  if (id !== null && !pattern.test(id)) {
    errors.push(`${path}: ${label}`);
  }
  return id;
}

function validateTimestamp(value: unknown, path: string, errors: string[]): string | null {
  const timestamp = readNullableString(value, path, errors);
  if (timestamp !== null && (!ISO_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp)))) {
    errors.push(`${path}: invalid ISO timestamp`);
  }
  return timestamp;
}

function validateRequiredTimestamp(value: unknown, path: string, errors: string[]): string {
  const timestamp = readString(value, path, errors);
  if (!timestamp || !ISO_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    errors.push(`${path}: invalid ISO timestamp`);
    return '';
  }
  return timestamp;
}

function validateEnum<const TValues extends readonly string[]>(
  value: unknown,
  values: TValues,
  path: string,
  errors: string[],
  fallback: TValues[number],
): TValues[number] {
  const raw = readString(value, path, errors);
  if (raw && !(values as readonly string[]).includes(raw)) {
    errors.push(`${path}: invalid value`);
  }
  return raw && (values as readonly string[]).includes(raw) ? raw : fallback;
}

function validateAppearanceModule(value: unknown, errors: string[]): ZhiyuAgentCenterLocalConfig['modules']['appearance'] {
  const path = 'modules.appearance';
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, APPEARANCE_KEYS, path, errors);
  requireSchemaVersion(record, path, errors);
  return {
    schema_version: 1,
    background_asset_id: validateNullablePattern(record.background_asset_id, BACKGROUND_ID_PATTERN, `${path}.background_asset_id`, errors, 'invalid background id'),
    motion: validateEnum(record.motion, MOTION_VALUES, `${path}.motion`, errors, 'system') as ZhiyuAgentCenterLocalConfig['modules']['appearance']['motion'],
  };
}

function validateAvatarAssetModule(value: unknown, errors: string[]): ZhiyuAgentCenterAvatarAssetModule {
  const path = 'modules.avatar_asset';
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, AVATAR_ASSET_KEYS, path, errors);
  requireSchemaVersion(record, path, errors);
  const backendKind = validateEnum(record.backend_kind, BACKEND_KIND_VALUES, `${path}.backend_kind`, errors, 'live2d') as ZhiyuAgentCenterAvatarAssetModule['backend_kind'];
  const localAvatarAssetRef = validateNullablePattern(record.local_avatar_asset_ref, AVATAR_ID_PATTERN, `${path}.local_avatar_asset_ref`, errors, 'invalid local Avatar asset id');
  if (localAvatarAssetRef) {
    if (backendKind === 'future') {
      errors.push(`${path}.backend_kind: future backend cannot be selected for a local Avatar asset`);
    } else if (!localAvatarAssetRef.startsWith(`${backendKind}_`)) {
      errors.push(`${path}.backend_kind: must match local Avatar asset id prefix`);
    }
  }
  const manifestSource = validateEnum(record.live2d_adapter_manifest_source, ADAPTER_SOURCE_VALUES, `${path}.live2d_adapter_manifest_source`, errors, 'none') as ZhiyuAgentCenterAvatarAssetModule['live2d_adapter_manifest_source'];
  const manifestRef = validateNullablePattern(record.live2d_adapter_manifest_ref, ADAPTER_ID_PATTERN, `${path}.live2d_adapter_manifest_ref`, errors, 'invalid Live2D adapter manifest ref');
  if (manifestSource !== 'none' && backendKind !== 'live2d') {
    errors.push(`${path}.live2d_adapter_manifest_source: requires live2d backend`);
  }
  if (manifestSource === 'external_sidecar_manifest' && !manifestRef) {
    errors.push(`${path}.live2d_adapter_manifest_ref: required for external sidecar manifest source`);
  }
  if (manifestSource !== 'external_sidecar_manifest' && manifestRef) {
    errors.push(`${path}.live2d_adapter_manifest_ref: requires external sidecar manifest source`);
  }
  const calibrationRef = validateNullablePattern(record.live2d_calibration_ref, LIVE2D_CALIBRATION_REF_PATTERN, `${path}.live2d_calibration_ref`, errors, 'invalid Live2D calibration ref');
  if (calibrationRef && backendKind !== 'live2d') {
    errors.push(`${path}.live2d_calibration_ref: requires live2d backend`);
  }
  return {
    schema_version: 1,
    conversation_anchor_scope: validateEnum(record.conversation_anchor_scope, ANCHOR_VALUES, `${path}.conversation_anchor_scope`, errors, 'current_anchor') as ZhiyuAgentCenterAvatarAssetModule['conversation_anchor_scope'],
    local_avatar_asset_ref: localAvatarAssetRef,
    live2d_adapter_manifest_source: manifestSource,
    live2d_adapter_manifest_ref: manifestRef,
    live2d_calibration_ref: calibrationRef,
    avatar_instance_policy: validateEnum(record.avatar_instance_policy, INSTANCE_POLICY_VALUES, `${path}.avatar_instance_policy`, errors, 'reuse_active_instance') as ZhiyuAgentCenterAvatarAssetModule['avatar_instance_policy'],
    backend_kind: backendKind,
    backend_capability_profile_ref: validateNullableNormalizedId(record.backend_capability_profile_ref, `${path}.backend_capability_profile_ref`, errors),
    generated_motion_provider_policy: validateEnum(record.generated_motion_provider_policy, GENERATED_MOTION_VALUES, `${path}.generated_motion_provider_policy`, errors, 'require_profile_support') as ZhiyuAgentCenterAvatarAssetModule['generated_motion_provider_policy'],
    launch_mode: validateEnum(record.launch_mode, LAUNCH_MODE_VALUES, `${path}.launch_mode`, errors, 'manual') as ZhiyuAgentCenterAvatarAssetModule['launch_mode'],
    debug_profile: validateEnum(record.debug_profile, DEBUG_PROFILE_VALUES, `${path}.debug_profile`, errors, 'standard') as ZhiyuAgentCenterAvatarAssetModule['debug_profile'],
    updated_at: validateRequiredTimestamp(record.updated_at, `${path}.updated_at`, errors),
    provenance: validateAvatarConfigProvenance(record.provenance, `${path}.provenance`, errors),
  };
}

function validateAvatarConfigProvenance(value: unknown, path: string, errors: string[]): ZhiyuAgentCenterAvatarAssetModule['provenance'] {
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, PROVENANCE_KEYS, path, errors);
  return {
    source: validateEnum(record.source, PROVENANCE_SOURCE_VALUES, `${path}.source`, errors, 'runtime_projection') as ZhiyuAgentCenterAvatarAssetModule['provenance']['source'],
    evidence_ref: validateNormalizedId(record.evidence_ref, `${path}.evidence_ref`, errors),
  };
}

function validateLocalHistoryModule(value: unknown, errors: string[]): ZhiyuAgentCenterLocalConfig['modules']['local_history'] {
  const path = 'modules.local_history';
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, LOCAL_HISTORY_KEYS, path, errors);
  requireSchemaVersion(record, path, errors);
  return {
    schema_version: 1,
    last_cleared_at: validateTimestamp(record.last_cleared_at, `${path}.last_cleared_at`, errors),
  };
}

function validateVoiceModule(value: unknown, errors: string[]): ZhiyuAgentCenterLocalConfig['modules']['voice'] {
  const path = 'modules.voice';
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, VOICE_KEYS, path, errors);
  requireSchemaVersion(record, path, errors);
  return {
    schema_version: 1,
    avatar_autoplay: readBoolean(record.avatar_autoplay, `${path}.avatar_autoplay`, errors),
  };
}

function validateUiModule(value: unknown, errors: string[]): ZhiyuAgentCenterLocalConfig['modules']['ui'] {
  const path = 'modules.ui';
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, UI_KEYS, path, errors);
  requireSchemaVersion(record, path, errors);
  return {
    schema_version: 1,
    last_section: validateEnum(record.last_section, SECTION_VALUES, `${path}.last_section`, errors, 'overview') as ZhiyuAgentCenterLocalConfig['modules']['ui']['last_section'],
  };
}
