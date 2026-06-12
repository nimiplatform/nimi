import { createNimiError, ReasonCode } from '../types';

// Host-typed logical surface for the Desktop-owned Agent Chat Settings avatar
// configuration record (D-LLM-079). The record's semantic owner is
// desktop_control_surface: reads and writes go through a caller-injected host
// persistence adapter and never become daemon RPC truth, matching the
// S-AICONF-005 / S-RUNTIME-120 host-surface pattern.

export type NimiAvatarConversationAnchorScope =
  | 'current_anchor'
  | 'explicit_debug_anchor'
  | 'no_anchor';

export type NimiAvatarLive2dAdapterManifestSource =
  | 'none'
  | 'embedded_creator_manifest'
  | 'external_sidecar_manifest';

export type NimiAvatarInstancePolicy =
  | 'reuse_active_instance'
  | 'launch_new_instance'
  | 'require_user_selection';

export type NimiAvatarBackendKind = 'vrm' | 'live2d' | 'future';

export type NimiAvatarGeneratedMotionProviderPolicy =
  | 'require_profile_support'
  | 'disable_generated_motion'
  | 'debug_only';

export type NimiAvatarLaunchMode = 'manual' | 'debug_session' | 'start_with_chat';

export type NimiAvatarDebugProfile = 'standard' | 'strict_backend_evidence' | 'route_matrix';

export type NimiAvatarConfigurationProvenanceSource =
  | 'user_selection'
  | 'import_validation'
  | 'runtime_projection'
  | 'avatar_backend_evidence';

export interface NimiAvatarConfigurationProvenance {
  readonly source: NimiAvatarConfigurationProvenanceSource;
  readonly evidenceRef: string;
}

export interface NimiAvatarConfigurationRecord {
  readonly agentId: string;
  readonly conversationAnchorScope: NimiAvatarConversationAnchorScope;
  readonly localAvatarAssetRef?: string;
  readonly live2dAdapterManifestSource: NimiAvatarLive2dAdapterManifestSource;
  readonly live2dAdapterManifestRef?: string;
  readonly avatarInstancePolicy: NimiAvatarInstancePolicy;
  readonly backendKind: NimiAvatarBackendKind;
  readonly backendCapabilityProfileRef?: string;
  readonly generatedMotionProviderPolicy?: NimiAvatarGeneratedMotionProviderPolicy;
  readonly launchMode: NimiAvatarLaunchMode;
  readonly debugProfile: NimiAvatarDebugProfile;
  readonly updatedAt: string;
  readonly provenance: NimiAvatarConfigurationProvenance;
}

export interface NimiAvatarConfigurationGetInput {
  readonly agentId: string;
  readonly conversationAnchorScope?: NimiAvatarConversationAnchorScope;
}

export interface NimiHostAvatarConfigurationStore {
  load(input: NimiAvatarConfigurationGetInput): Promise<NimiAvatarConfigurationRecord | undefined>;
  save(record: NimiAvatarConfigurationRecord): Promise<void>;
}

export interface NimiHostAvatarConfigurationSurface {
  get(input: NimiAvatarConfigurationGetInput): Promise<NimiAvatarConfigurationRecord | undefined>;
  upsert(record: NimiAvatarConfigurationRecord): Promise<NimiAvatarConfigurationRecord>;
}

const CONVERSATION_ANCHOR_SCOPES: readonly NimiAvatarConversationAnchorScope[] = [
  'current_anchor',
  'explicit_debug_anchor',
  'no_anchor',
];
const MANIFEST_SOURCES: readonly NimiAvatarLive2dAdapterManifestSource[] = [
  'none',
  'embedded_creator_manifest',
  'external_sidecar_manifest',
];
const INSTANCE_POLICIES: readonly NimiAvatarInstancePolicy[] = [
  'reuse_active_instance',
  'launch_new_instance',
  'require_user_selection',
];
const BACKEND_KINDS: readonly NimiAvatarBackendKind[] = ['vrm', 'live2d', 'future'];
const GENERATED_MOTION_POLICIES: readonly NimiAvatarGeneratedMotionProviderPolicy[] = [
  'require_profile_support',
  'disable_generated_motion',
  'debug_only',
];
const LAUNCH_MODES: readonly NimiAvatarLaunchMode[] = ['manual', 'debug_session', 'start_with_chat'];
const DEBUG_PROFILES: readonly NimiAvatarDebugProfile[] = [
  'standard',
  'strict_backend_evidence',
  'route_matrix',
];
const PROVENANCE_SOURCES: readonly NimiAvatarConfigurationProvenanceSource[] = [
  'user_selection',
  'import_validation',
  'runtime_projection',
  'avatar_backend_evidence',
];

const LIVE2D_ADAPTER_MANIFEST_REF_PATTERN = /^live2d_adapter_[a-f0-9]{12}$/;
const ISO8601_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

// D-LLM-079 closed field set: the camelCase projection of every admitted schema
// field. Any other key on the record fails closed (record-closure check).
const ADMITTED_RECORD_FIELDS: ReadonlySet<string> = new Set([
  'agentId',
  'conversationAnchorScope',
  'localAvatarAssetRef',
  'live2dAdapterManifestSource',
  'live2dAdapterManifestRef',
  'avatarInstancePolicy',
  'backendKind',
  'backendCapabilityProfileRef',
  'generatedMotionProviderPolicy',
  'launchMode',
  'debugProfile',
  'updatedAt',
  'provenance',
]);

// D-LLM-079 forbidden fields: their presence on an input record (any casing
// convention) must fail closed instead of being silently dropped.
const FORBIDDEN_RECORD_FIELDS: readonly string[] = [
  'package_descriptor',
  'packageDescriptor',
  'package_path',
  'packagePath',
  'launch_local_asset_id',
  'launchLocalAssetId',
  'live2d_adapter_manifest_payload',
  'live2dAdapterManifestPayload',
  'live2d_adapter_manifest_path',
  'live2dAdapterManifestPath',
  'live2d_adapter_manifest_absolute_path',
  'live2dAdapterManifestAbsolutePath',
  'compatibility_tier',
  'compatibilityTier',
  'avatar_compatibility_diagnostics',
  'avatarCompatibilityDiagnostics',
  'carrier_registry_id',
  'carrierRegistryId',
  'scoped_avatar_binding_id',
  'scopedAvatarBindingId',
  'account_id',
  'accountId',
  'user_id',
  'userId',
  'realm_url',
  'realmUrl',
  'token',
  'refresh_token',
  'refreshToken',
  'jwt',
  'auth_payload',
  'authPayload',
  'raw_apml',
  'rawApml',
  'raw_mcp',
  'rawMcp',
  'raw_a2a',
  'rawA2a',
  'raw_provider_output',
  'rawProviderOutput',
  'backend_command',
  'backendCommand',
];

export function createNimiHostAvatarConfigurationSurface(options: {
  readonly store: NimiHostAvatarConfigurationStore;
}): NimiHostAvatarConfigurationSurface {
  const store = options?.store;
  if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') {
    throw avatarConfigurationError(
      ReasonCode.SDK_AVATAR_CONFIGURATION_STORE_REQUIRED,
      'Avatar configuration surface requires an explicit host store adapter with load and save.',
      'provide_avatar_configuration_host_store',
    );
  }
  return {
    async get(input) {
      if (!normalizeText(input?.agentId)) {
        throw avatarConfigurationError(
          ReasonCode.SDK_AVATAR_CONFIGURATION_RECORD_INVALID,
          'avatarConfiguration.get requires agentId.',
          'provide_agent_id',
        );
      }
      if (input.conversationAnchorScope !== undefined
        && !CONVERSATION_ANCHOR_SCOPES.includes(input.conversationAnchorScope)) {
        throw avatarConfigurationError(
          ReasonCode.SDK_AVATAR_CONFIGURATION_RECORD_INVALID,
          `avatarConfiguration.get scope ${String(input.conversationAnchorScope)} is not an admitted conversation anchor scope.`,
          'use_admitted_conversation_anchor_scope',
        );
      }
      const record = await store.load(input);
      if (record === undefined) {
        return undefined;
      }
      // Fail closed on corrupt host state: a stored record that no longer
      // satisfies the closed schema must not be projected as configuration.
      validateAvatarConfigurationRecord(record);
      return record;
    },
    async upsert(record) {
      validateAvatarConfigurationRecord(record);
      await store.save(record);
      return record;
    },
  };
}

export function validateAvatarConfigurationRecord(record: NimiAvatarConfigurationRecord): void {
  if (!record || typeof record !== 'object') {
    throw avatarConfigurationError(
      ReasonCode.SDK_AVATAR_CONFIGURATION_RECORD_INVALID,
      'avatar configuration record is missing.',
      'provide_avatar_configuration_record',
    );
  }
  const raw = record as unknown as Record<string, unknown>;
  for (const forbidden of FORBIDDEN_RECORD_FIELDS) {
    if (forbidden in raw) {
      throw avatarConfigurationError(
        ReasonCode.SDK_AVATAR_CONFIGURATION_FORBIDDEN_FIELD,
        `avatar configuration record carries forbidden field "${forbidden}" (D-LLM-079).`,
        'remove_forbidden_avatar_configuration_field',
      );
    }
  }
  // D-LLM-079: the record field set is closed. Any key outside the admitted set
  // fails closed rather than being silently persisted, even when not on the
  // explicit forbidden list.
  for (const key of Object.keys(raw)) {
    if (!ADMITTED_RECORD_FIELDS.has(key)) {
      throw avatarConfigurationError(
        ReasonCode.SDK_AVATAR_CONFIGURATION_RECORD_INVALID,
        `avatar configuration record carries unadmitted field "${key}"; the D-LLM-079 record is closed.`,
        'remove_unadmitted_avatar_configuration_field',
      );
    }
  }
  requireText(record.agentId, 'agentId');
  requireOptionalText(record.localAvatarAssetRef, 'localAvatarAssetRef');
  requireOptionalText(record.backendCapabilityProfileRef, 'backendCapabilityProfileRef');
  requireEnum(record.conversationAnchorScope, CONVERSATION_ANCHOR_SCOPES, 'conversationAnchorScope');
  requireEnum(record.live2dAdapterManifestSource, MANIFEST_SOURCES, 'live2dAdapterManifestSource');
  requireEnum(record.avatarInstancePolicy, INSTANCE_POLICIES, 'avatarInstancePolicy');
  requireEnum(record.backendKind, BACKEND_KINDS, 'backendKind');
  requireEnum(record.launchMode, LAUNCH_MODES, 'launchMode');
  requireEnum(record.debugProfile, DEBUG_PROFILES, 'debugProfile');
  if (record.generatedMotionProviderPolicy !== undefined) {
    requireEnum(record.generatedMotionProviderPolicy, GENERATED_MOTION_POLICIES, 'generatedMotionProviderPolicy');
  }
  if (!ISO8601_UTC_PATTERN.test(String(record.updatedAt ?? ''))) {
    throw avatarConfigurationError(
      ReasonCode.SDK_AVATAR_CONFIGURATION_RECORD_INVALID,
      'avatar configuration updatedAt must be an ISO-8601 UTC timestamp.',
      'provide_iso8601_utc_updated_at',
    );
  }
  if (!record.provenance || typeof record.provenance !== 'object') {
    throw avatarConfigurationError(
      ReasonCode.SDK_AVATAR_CONFIGURATION_RECORD_INVALID,
      'avatar configuration provenance is required.',
      'provide_avatar_configuration_provenance',
    );
  }
  requireEnum(record.provenance.source, PROVENANCE_SOURCES, 'provenance.source');
  requireText(record.provenance.evidenceRef, 'provenance.evidenceRef');
  requireOptionalText(record.live2dAdapterManifestRef, 'live2dAdapterManifestRef');
  // The manifest-ref opaque-pattern (schema.yaml field-level constraint) holds
  // whenever a ref is present, independent of the source; required only when the
  // source selects an external sidecar manifest.
  const manifestRef = normalizeText(record.live2dAdapterManifestRef);
  if (record.live2dAdapterManifestSource === 'external_sidecar_manifest' && !manifestRef) {
    throw avatarConfigurationError(
      ReasonCode.SDK_AVATAR_CONFIGURATION_RECORD_INVALID,
      'live2dAdapterManifestRef is required when live2dAdapterManifestSource is external_sidecar_manifest.',
      'provide_live2d_adapter_manifest_ref',
    );
  }
  if (manifestRef && !LIVE2D_ADAPTER_MANIFEST_REF_PATTERN.test(manifestRef)) {
    throw avatarConfigurationError(
      ReasonCode.SDK_AVATAR_CONFIGURATION_RECORD_INVALID,
      'live2dAdapterManifestRef must match the opaque control-ref pattern live2d_adapter_<12 hex>.',
      'use_opaque_live2d_adapter_manifest_ref',
    );
  }
}

function requireText(value: unknown, label: string): void {
  if (!normalizeText(value)) {
    throw avatarConfigurationError(
      ReasonCode.SDK_AVATAR_CONFIGURATION_RECORD_INVALID,
      `avatar configuration ${label} is required.`,
      `provide_${label.replace(/\W+/g, '_').toLowerCase()}`,
    );
  }
}

function requireOptionalText(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw avatarConfigurationError(
      ReasonCode.SDK_AVATAR_CONFIGURATION_RECORD_INVALID,
      `avatar configuration ${label} must be a string when present.`,
      `fix_${label.replace(/\W+/g, '_').toLowerCase()}`,
    );
  }
}

function requireEnum<TValue extends string>(value: unknown, admitted: readonly TValue[], label: string): void {
  if (!admitted.includes(value as TValue)) {
    throw avatarConfigurationError(
      ReasonCode.SDK_AVATAR_CONFIGURATION_RECORD_INVALID,
      `avatar configuration ${label} value ${String(value)} is not admitted.`,
      `use_admitted_${label.replace(/\W+/g, '_').toLowerCase()}`,
    );
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function avatarConfigurationError(reasonCode: string, message: string, actionHint: string): Error {
  return createNimiError({
    message,
    code: reasonCode,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}
