import {
  AVATAR_BACKEND_KIND_VALUES,
  AVATAR_CONFIG_PROVENANCE_SOURCE_VALUES,
  AVATAR_CONVERSATION_ANCHOR_SCOPE_VALUES,
  AVATAR_DEBUG_PROFILE_VALUES,
  AVATAR_INSTANCE_POLICY_VALUES,
  AVATAR_LAUNCH_MODE_VALUES,
  GENERATED_MOTION_PROVIDER_POLICY_VALUES,
  LIVE2D_ADAPTER_MANIFEST_SOURCE_VALUES,
} from './chat-agent-center-avatar-config-types';
import type {
  AgentCenterAvatarBackendKind,
  AgentCenterAvatarConfigProvenance,
  AgentCenterAvatarConfigProvenanceSource,
  AgentCenterAvatarConversationAnchorScope,
  AgentCenterAvatarDebugProfile,
  AgentCenterAvatarInstancePolicy,
  AgentCenterAvatarLaunchMode,
  AgentCenterAvatarAssetModule,
  AgentCenterGeneratedMotionProviderPolicy,
  AgentCenterLive2dAdapterManifestSource,
} from './chat-agent-center-avatar-config-types';

const NORMALIZED_ID_PATTERN = /^(?=.*[A-Za-z0-9])(?!\.{1,2}$)(?!.*:\/\/)[A-Za-z0-9._~:@+-]{1,256}$/u;
const LIVE2D_ADAPTER_MANIFEST_REF_PATTERN = /^live2d_adapter_[a-f0-9]{12}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const AVATAR_CONFIG_PROVENANCE_KEYS = ['source', 'evidence_ref'] as const;
const AVATAR_ASSET_KEYS = [
  'schema_version',
  'conversation_anchor_scope',
  'local_avatar_asset_ref',
  'live2d_adapter_manifest_source',
  'live2d_adapter_manifest_ref',
  'avatar_instance_policy',
  'backend_kind',
  'backend_capability_profile_ref',
  'generated_motion_provider_policy',
  'launch_mode',
  'debug_profile',
  'updated_at',
  'provenance',
] as const;

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

function validateLive2dAdapterManifestRef(value: unknown, path: string, errors: string[]): string | null {
  const id = readNullableString(value, path, errors);
  if (id !== null && !LIVE2D_ADAPTER_MANIFEST_REF_PATTERN.test(id)) {
    errors.push(`${path}: invalid Live2D adapter manifest ref`);
  }
  return id;
}

function validateRequiredTimestamp(value: unknown, path: string, errors: string[]): string {
  const timestamp = readString(value, path, errors);
  if (!timestamp || !ISO_TIMESTAMP_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    errors.push(`${path}: invalid ISO timestamp`);
    return '';
  }
  return timestamp;
}

function validateEnum<T extends string>(
  value: unknown,
  path: string,
  errors: string[],
  values: ReadonlySet<string>,
  fallback: T,
  errorLabel = 'invalid value',
): T {
  const raw = readString(value, path, errors);
  if (raw && !values.has(raw)) {
    errors.push(`${path}: ${errorLabel}`);
  }
  return values.has(raw || '') ? raw as T : fallback;
}

function validateAvatarConfigProvenance(value: unknown, path: string, errors: string[]): AgentCenterAvatarConfigProvenance {
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, AVATAR_CONFIG_PROVENANCE_KEYS, path, errors);
  const source = validateEnum<AgentCenterAvatarConfigProvenanceSource>(
    record.source,
    `${path}.source`,
    errors,
    new Set(AVATAR_CONFIG_PROVENANCE_SOURCE_VALUES),
    'runtime_projection',
    'invalid provenance source',
  );
  return {
    source,
    evidence_ref: validateNormalizedId(record.evidence_ref, `${path}.evidence_ref`, errors),
  };
}

export function validateAvatarAssetModule(value: unknown, errors: string[]): AgentCenterAvatarAssetModule {
  const path = 'modules.avatar_asset';
  const record = requireRecord(value, path, errors) ?? {};
  collectUnknownKeys(record, AVATAR_ASSET_KEYS, path, errors);
  if (record.schema_version !== 1) {
    errors.push(`${path}.schema_version: expected 1`);
  }
  const backendKind = validateEnum<AgentCenterAvatarBackendKind>(
    record.backend_kind,
    `${path}.backend_kind`,
    errors,
    new Set(AVATAR_BACKEND_KIND_VALUES),
    'live2d',
    'invalid backend kind',
  );
  const localAvatarAssetRef = validateNullableNormalizedId(record.local_avatar_asset_ref, `${path}.local_avatar_asset_ref`, errors);
  const manifestSource = validateEnum<AgentCenterLive2dAdapterManifestSource>(
    record.live2d_adapter_manifest_source,
    `${path}.live2d_adapter_manifest_source`,
    errors,
    new Set(LIVE2D_ADAPTER_MANIFEST_SOURCE_VALUES),
    'none',
    'invalid Live2D adapter manifest source',
  );
  const manifestRef = validateLive2dAdapterManifestRef(record.live2d_adapter_manifest_ref, `${path}.live2d_adapter_manifest_ref`, errors);
  if (manifestSource !== 'none' && backendKind !== 'live2d') {
    errors.push(`${path}.live2d_adapter_manifest_source: requires live2d backend`);
  }
  if (manifestSource === 'external_sidecar_manifest' && !manifestRef) {
    errors.push(`${path}.live2d_adapter_manifest_ref: required for external sidecar manifest source`);
  }
  if (manifestSource !== 'external_sidecar_manifest' && manifestRef) {
    errors.push(`${path}.live2d_adapter_manifest_ref: requires external sidecar manifest source`);
  }

  return {
    schema_version: 1,
    conversation_anchor_scope: validateEnum<AgentCenterAvatarConversationAnchorScope>(record.conversation_anchor_scope, `${path}.conversation_anchor_scope`, errors, new Set(AVATAR_CONVERSATION_ANCHOR_SCOPE_VALUES), 'current_anchor', 'invalid anchor scope'),
    local_avatar_asset_ref: localAvatarAssetRef,
    live2d_adapter_manifest_source: manifestSource,
    live2d_adapter_manifest_ref: manifestRef,
    avatar_instance_policy: validateEnum<AgentCenterAvatarInstancePolicy>(record.avatar_instance_policy, `${path}.avatar_instance_policy`, errors, new Set(AVATAR_INSTANCE_POLICY_VALUES), 'reuse_active_instance', 'invalid avatar instance policy'),
    backend_kind: backendKind,
    backend_capability_profile_ref: validateNullableNormalizedId(record.backend_capability_profile_ref, `${path}.backend_capability_profile_ref`, errors),
    generated_motion_provider_policy: validateEnum<AgentCenterGeneratedMotionProviderPolicy>(record.generated_motion_provider_policy, `${path}.generated_motion_provider_policy`, errors, new Set(GENERATED_MOTION_PROVIDER_POLICY_VALUES), 'require_profile_support', 'invalid generated motion provider policy'),
    launch_mode: validateEnum<AgentCenterAvatarLaunchMode>(record.launch_mode, `${path}.launch_mode`, errors, new Set(AVATAR_LAUNCH_MODE_VALUES), 'manual', 'invalid launch mode'),
    debug_profile: validateEnum<AgentCenterAvatarDebugProfile>(record.debug_profile, `${path}.debug_profile`, errors, new Set(AVATAR_DEBUG_PROFILE_VALUES), 'standard', 'invalid debug profile'),
    updated_at: validateRequiredTimestamp(record.updated_at, `${path}.updated_at`, errors),
    provenance: validateAvatarConfigProvenance(record.provenance, `${path}.provenance`, errors),
  };
}
