import { createNimiError, type JsonObject, type NimiError } from '../../types/index.js';
import {
  parseNimiPortableAIProfile,
  serializeNimiPortableAIProfile,
  type NimiPortableAIProfile,
  type NimiPortableAIProfileInput,
} from '../ai/config-profile.js';
import type {
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
} from '../ai/capability-configuration.js';
import type { NimiLocalAppAgentHandle } from './permission-types.js';
import {
  asRecord,
  assertExactKeys,
  assertExactMethodNamespace,
  assertExactProjectionKeys,
  assertNoAuthorityMaterial,
  assertSafeProjection,
  canonicalString,
  decimalCursor,
  localAppError,
  localAppProjectionError,
  nonNegativeInteger,
  normalizeFieldName,
  projectTimestamp,
  requireText,
} from './local-app-runtime-platform-validation.js';

const MAX_AI_PROFILE_JSON_BYTES = 4 * 1024 * 1024;

export type NimiLocalAppAgentAutonomyMode = 'off' | 'low' | 'medium' | 'high';
export type NimiLocalAppAgentPresentationBackendKind = 'vrm' | 'live2d' | 'sprite2d' | 'canvas2d' | 'video';
export type NimiLocalAppRevision = string;

export interface NimiLocalAppTimestamp {
  readonly seconds: string;
  readonly nanos: number;
}

export interface NimiLocalAppDuration {
  readonly seconds: string;
  readonly nanos: number;
}

export interface NimiLocalAppSharedLocalAgentAIProfilePreview {
  readonly source: NimiPortableAIProfile;
  readonly before: NimiCapabilityAIConfig | null;
  readonly after: NimiCapabilityAIConfig;
  readonly identical: boolean;
}

export interface NimiLocalAppSharedLocalAgentAIConfigClient {
  get(): Promise<NimiCapabilityAIConfig>;
  overwrite(
    capabilities: readonly NimiCapabilityAIConfigIntent[],
  ): Promise<NimiCapabilityAIConfig>;
}

export interface NimiLocalAppSharedLocalAgentAIProfileClient {
  preview(
    profile: NimiPortableAIProfileInput,
  ): Promise<NimiLocalAppSharedLocalAgentAIProfilePreview>;
  apply(profile: NimiPortableAIProfileInput): Promise<NimiCapabilityAIConfig>;
}

export interface NimiLocalAppAgentAutonomyConfig {
  readonly dailyTokenBudget: number;
  readonly maxTokensPerHook: number;
  readonly minHookInterval?: NimiLocalAppDuration;
  readonly suspendUntil?: NimiLocalAppTimestamp;
  readonly mode: NimiLocalAppAgentAutonomyMode;
}

export interface NimiLocalAppAgentAutonomyProjection {
  readonly enabled: boolean;
  readonly config: NimiLocalAppAgentAutonomyConfig | null;
  readonly usedTokensInWindow: number;
  readonly windowStartedAt?: NimiLocalAppTimestamp;
  readonly budgetExhausted: boolean;
  readonly suspendedUntil?: NimiLocalAppTimestamp;
  readonly autonomyRevision: NimiLocalAppRevision;
}

export interface NimiLocalAppAgentAutonomyIntent {
  readonly enabled?: boolean;
  readonly config?: NimiLocalAppAgentAutonomyConfig;
}

export interface NimiLocalAppAgentPresentationProfile {
  readonly backendKind: NimiLocalAppAgentPresentationBackendKind;
  readonly avatarAssetRef: string;
  readonly expressionProfileRef: string;
  readonly idlePreset: string;
  readonly interactionPolicyRef: string;
  readonly defaultVoiceReference: string;
  readonly avatarAutoplay: boolean;
  readonly backgroundAssetRef: string;
  readonly revision: NimiLocalAppRevision;
}

export interface NimiLocalAppAgentPresentationProjection {
  readonly profile: NimiLocalAppAgentPresentationProfile | null;
  readonly previousProfile: NimiLocalAppAgentPresentationProfile | null;
  readonly defaultVoiceReference: string;
  readonly presentationRevision: NimiLocalAppRevision;
}

export interface NimiLocalAppAgentPresentationAssetMaterial {
  readonly role: 'avatar' | 'background';
  readonly fileName: string;
  readonly mediaType: string;
  readonly content: Uint8Array;
  readonly sha256: string;
}

export interface NimiLocalAppAgentPresentationIntent {
  readonly backendKind: NimiLocalAppAgentPresentationBackendKind;
  readonly avatarAssetRef: string;
  readonly expressionProfileRef: string;
  readonly idlePreset: string;
  readonly interactionPolicyRef: string;
  readonly defaultVoiceReference: string;
  readonly avatarAutoplay: boolean;
  readonly backgroundAssetRef: string;
}

export type NimiLocalAppConfigureReasonCode =
  | 'LOCAL_APP_PERMISSION_REQUIRED'
  | 'LOCAL_APP_PERMISSION_DENIED'
  | 'LOCAL_APP_PERMISSION_REVOKED'
  | 'LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED'
  | 'LOCAL_APP_PERMISSION_UNKNOWN'
  | 'AGENT_AUTONOMY_REVISION_CONFLICT'
  | 'AGENT_PRESENTATION_REVISION_CONFLICT'
  | 'AGENT_PRESENTATION_ASSET_TYPE_INVALID'
  | 'AGENT_PRESENTATION_ASSET_TOO_LARGE'
  | 'AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID'
  | 'AGENT_PRESENTATION_ASSET_DEPENDENCY_MISSING'
  | 'AGENT_PRESENTATION_ASSET_INTEGRITY_MISMATCH'
  | 'AGENT_PRESENTATION_BACKEND_INCOMPATIBLE'
  | 'AGENT_PRESENTATION_ASSET_NOT_VALIDATED';

export type NimiLocalAppConfigureErrorCategory =
  | 'not-granted'
  | 'denied'
  | 'reserved-not-admitted'
  | 'unknown-permission'
  | 'autonomy-revision-conflict'
  | 'presentation-revision-conflict'
  | 'presentation-type'
  | 'presentation-size'
  | 'presentation-structure'
  | 'presentation-dependency'
  | 'presentation-integrity'
  | 'presentation-backend-compat'
  | 'presentation-not-validated';

export type NimiLocalAppConfigureError = NimiError & {
  readonly reasonCode: NimiLocalAppConfigureReasonCode;
  readonly permissionId: 'agents.configure';
  readonly reasonMetadata: Readonly<Record<string, string>>;
  readonly category: NimiLocalAppConfigureErrorCategory;
};

export interface NimiLocalAppAutonomyConflict {
  readonly outcome: 'conflict';
  readonly conflict: NimiLocalAppConfigureError & {
    readonly reasonCode: 'AGENT_AUTONOMY_REVISION_CONFLICT';
    readonly category: 'autonomy-revision-conflict';
  };
}

export interface NimiLocalAppPresentationConflict {
  readonly outcome: 'conflict';
  readonly conflict: NimiLocalAppConfigureError & {
    readonly reasonCode: 'AGENT_PRESENTATION_REVISION_CONFLICT';
    readonly category: 'presentation-revision-conflict';
  };
}

export type NimiLocalAppAutonomyUpdateResult =
  | { readonly outcome: 'updated'; readonly projection: NimiLocalAppAgentAutonomyProjection }
  | NimiLocalAppAutonomyConflict;

export interface NimiLocalAppPresentationValidationFailure {
  readonly outcome: 'validation-failed';
  readonly failure: NimiLocalAppConfigureError & {
    readonly reasonCode: Exclude<NimiLocalAppConfigureReasonCode,
      | 'LOCAL_APP_PERMISSION_REQUIRED' | 'LOCAL_APP_PERMISSION_DENIED'
      | 'LOCAL_APP_PERMISSION_REVOKED' | 'LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED'
      | 'LOCAL_APP_PERMISSION_UNKNOWN' | 'AGENT_AUTONOMY_REVISION_CONFLICT'
      | 'AGENT_PRESENTATION_REVISION_CONFLICT'>;
  };
}

export type NimiLocalAppPresentationCommitResult =
  | { readonly outcome: 'committed'; readonly projection: NimiLocalAppAgentPresentationProjection }
  | NimiLocalAppPresentationConflict
  | NimiLocalAppPresentationValidationFailure;

export interface NimiLocalAppAgentScopedInput {
  readonly agentHandle: NimiLocalAppAgentHandle;
}

export type NimiLocalAppAutonomySnapshotInput = NimiLocalAppAgentScopedInput;
export interface NimiLocalAppUpdateAutonomyInput extends NimiLocalAppAgentScopedInput {
  readonly expectedAutonomyRevision: NimiLocalAppRevision;
  readonly intent: NimiLocalAppAgentAutonomyIntent;
}
export type NimiLocalAppPresentationSnapshotInput = NimiLocalAppAgentScopedInput;
export interface NimiLocalAppCommitPresentationInput extends NimiLocalAppAgentScopedInput {
  readonly expectedPresentationRevision: NimiLocalAppRevision;
  readonly intent: NimiLocalAppAgentPresentationIntent;
  readonly importedAssets: readonly NimiLocalAppAgentPresentationAssetMaterial[];
}

export interface NimiLocalAppAgentConfigureShell {
  sharedAgentAIConfigGet(): Promise<unknown>;
  sharedAgentAIConfigOverwrite(
    capabilities: readonly NimiCapabilityAIConfigIntent[],
  ): Promise<unknown>;
  sharedAgentAIProfilePreview(profileJson: string): Promise<unknown>;
  sharedAgentAIProfileApply(profileJson: string): Promise<unknown>;
  autonomySnapshot(input: { readonly agentHandle: string }): Promise<unknown>;
  updateAutonomy(input: {
    readonly agentHandle: string;
    readonly expectedAutonomyRevision: string;
    readonly intent: NimiLocalAppAgentAutonomyIntent;
  }): Promise<unknown>;
  presentationSnapshot(input: { readonly agentHandle: string }): Promise<unknown>;
  commitPresentation(input: {
    readonly agentHandle: string;
    readonly expectedPresentationRevision: string;
    readonly intent: NimiLocalAppAgentPresentationIntent;
    readonly importedAssets: readonly NimiLocalAppAgentPresentationAssetMaterial[];
  }): Promise<unknown>;
}

export interface NimiLocalAppAgentConfigureClient {
  readonly sharedAIConfig: NimiLocalAppSharedLocalAgentAIConfigClient;
  readonly sharedAIProfile: NimiLocalAppSharedLocalAgentAIProfileClient;
  autonomySnapshot(input: NimiLocalAppAutonomySnapshotInput): Promise<NimiLocalAppAgentAutonomyProjection>;
  updateAutonomy(input: NimiLocalAppUpdateAutonomyInput): Promise<NimiLocalAppAutonomyUpdateResult>;
  presentationSnapshot(input: NimiLocalAppPresentationSnapshotInput): Promise<NimiLocalAppAgentPresentationProjection>;
  commitPresentation(input: NimiLocalAppCommitPresentationInput): Promise<NimiLocalAppPresentationCommitResult>;
}

const CONFIGURE_METHODS = [
  'sharedAgentAIConfigGet',
  'sharedAgentAIConfigOverwrite',
  'sharedAgentAIProfilePreview',
  'sharedAgentAIProfileApply',
  'autonomySnapshot',
  'updateAutonomy',
  'presentationSnapshot',
  'commitPresentation',
] as const;

export function createNimiLocalAppAgentConfigureClient(
  shell: NimiLocalAppAgentConfigureShell,
): NimiLocalAppAgentConfigureClient {
  if (!shell) {
    return localAppError(
      'The local-app agents.configure carrier is unavailable.',
      'SDK_LOCAL_APP_CARRIER_UNAVAILABLE',
      'install_local_app_configure_carrier',
    );
  }
  assertExactMethodNamespace(shell, CONFIGURE_METHODS, 'agentConfigure');
  const carrier = shell;

  const sharedAIConfig: NimiLocalAppSharedLocalAgentAIConfigClient = Object.freeze({
    async get() {
      return projectSharedAIConfig(await invoke(() => carrier.sharedAgentAIConfigGet()));
    },
    async overwrite(capabilities: readonly NimiCapabilityAIConfigIntent[]) {
      validateCapabilityIntents(capabilities);
      return projectSharedAIConfig(await invoke(() => (
        carrier.sharedAgentAIConfigOverwrite(capabilities)
      )));
    },
  });

  const sharedAIProfile: NimiLocalAppSharedLocalAgentAIProfileClient = Object.freeze({
    async preview(profile: NimiPortableAIProfileInput) {
      const encoded = encodePortableAIProfile(profile);
      const projection = projectSharedAIProfilePreview(await invoke(() => (
        carrier.sharedAgentAIProfilePreview(encoded.profileJson)
      )));
      return Object.freeze({
        source: encoded.source,
        before: projection.before,
        after: projection.after,
        identical: projection.before !== null
          && canonicalAIConfig(projection.before) === canonicalAIConfig(projection.after),
      });
    },
    async apply(profile: NimiPortableAIProfileInput) {
      const encoded = encodePortableAIProfile(profile);
      return projectSharedAIConfig(await invoke(() => (
        carrier.sharedAgentAIProfileApply(encoded.profileJson)
      )));
    },
  });

  return Object.freeze({
    sharedAIConfig,
    sharedAIProfile,
    autonomySnapshot: async (input: NimiLocalAppAutonomySnapshotInput) => {
      const agentHandle = configureHandle(input, ['agentHandle'], 'autonomy snapshot');
      return projectAutonomy(await invoke(() => carrier.autonomySnapshot({ agentHandle })));
    },
    updateAutonomy: async (input: NimiLocalAppUpdateAutonomyInput) => {
      assertExactKeys(input, ['agentHandle', 'expectedAutonomyRevision', 'intent'], 'autonomy update');
      assertNoAuthorityMaterial(input);
      const request = {
        agentHandle: requireText(input.agentHandle, 'agentHandle'),
        expectedAutonomyRevision: positiveRevision(
          input.expectedAutonomyRevision,
          'expectedAutonomyRevision',
        ),
        intent: validateAutonomyIntent(input.intent),
      };
      try {
        return Object.freeze({
          outcome: 'updated',
          projection: projectAutonomy(await carrier.updateAutonomy(request)),
        });
      } catch (error) {
        const mapped = mapNimiLocalAppConfigureError(error);
        if (mapped.reasonCode === 'AGENT_AUTONOMY_REVISION_CONFLICT') {
          return Object.freeze({ outcome: 'conflict', conflict: mapped }) as NimiLocalAppAutonomyConflict;
        }
        throw mapped;
      }
    },
    presentationSnapshot: async (input: NimiLocalAppPresentationSnapshotInput) => {
      const agentHandle = configureHandle(input, ['agentHandle'], 'presentation snapshot');
      return projectPresentation(await invoke(() => carrier.presentationSnapshot({ agentHandle })));
    },
    commitPresentation: async (input: NimiLocalAppCommitPresentationInput) => {
      assertExactKeys(
        input,
        ['agentHandle', 'expectedPresentationRevision', 'intent', 'importedAssets'],
        'presentation commit',
      );
      assertNoAuthorityMaterial(input);
      const request = {
        agentHandle: requireText(input.agentHandle, 'agentHandle'),
        expectedPresentationRevision: decimalCursor(
          input.expectedPresentationRevision,
          'expectedPresentationRevision',
        ),
        intent: validatePresentationIntent(input.intent),
        importedAssets: validatePresentationAssetMaterials(input.importedAssets),
      };
      try {
        return Object.freeze({
          outcome: 'committed',
          projection: projectPresentation(await carrier.commitPresentation(request)),
        });
      } catch (error) {
        const mapped = mapNimiLocalAppConfigureError(error);
        if (mapped.reasonCode === 'AGENT_PRESENTATION_REVISION_CONFLICT') {
          return Object.freeze({ outcome: 'conflict', conflict: mapped }) as NimiLocalAppPresentationConflict;
        }
        if (mapped.category.startsWith('presentation-')) {
          return Object.freeze({
            outcome: 'validation-failed',
            failure: mapped,
          }) as NimiLocalAppPresentationValidationFailure;
        }
        throw mapped;
      }
    },
  });
}

export function mapNimiLocalAppConfigureError(error: unknown): NimiLocalAppConfigureError {
  const direct = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};
  const envelope = asRecord(direct.envelope) ?? {};
  const details = asRecord(envelope.details) ?? asRecord(direct.details) ?? {};
  const rawReason = firstText(
    direct.reasonCode,
    direct.reason_code,
    envelope.reasonCode,
    envelope.reason_code,
    direct.code,
  );
  const reasonCode = configureReasonCode(rawReason);
  if (!reasonCode) throw error;
  const category = configureErrorCategory(reasonCode);
  const reasonMetadata = publicReasonMetadata(details);
  const permissionId = 'agents.configure' as const;
  const actionHint = firstText(direct.actionHint, envelope.actionHint)
    || configureActionHint(category);
  const message = error instanceof Error && error.message.trim() ? error.message : reasonCode;
  const mapped = createNimiError({
    message,
    code: reasonCode,
    reasonCode,
    actionHint,
    retryable: Boolean(direct.retryable),
    source: 'sdk',
    details: { ...reasonMetadata, permission_id: permissionId } as JsonObject,
  }) as NimiLocalAppConfigureError;
  Object.assign(mapped, {
    permissionId,
    reasonMetadata: Object.freeze({ ...reasonMetadata, permission_id: permissionId }),
    category,
  });
  return mapped;
}

async function invoke<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapNimiLocalAppConfigureError(error);
  }
}

function configureHandle(input: unknown, keys: readonly string[], label: string): string {
  assertExactKeys(input, keys, label);
  assertNoAuthorityMaterial(input);
  return requireText((input as { readonly agentHandle?: unknown }).agentHandle, 'agentHandle');
}

function validateCapabilityIntents(
  capabilities: readonly NimiCapabilityAIConfigIntent[],
): void {
  if (!Array.isArray(capabilities)) {
    return localAppError(
      'Shared LocalAgent AIConfig capabilities must be an array.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_canonical_shared_local_agent_ai_config_capabilities',
    );
  }
  assertNoAuthorityMaterial(capabilities);
  rejectAIConfigOwnerFields(capabilities);
  capabilities.forEach((intent, index) => {
    assertExactKeys(
      intent,
      ['capabilityContract', 'requiredFeatures', 'defaults', 'route'],
      `shared LocalAgent AIConfig capability ${index}`,
    );
    requireText(intent.capabilityContract, `ai_config_capability_${index}`);
    if (!Array.isArray(intent.requiredFeatures)
      || intent.requiredFeatures.some((feature) => typeof feature !== 'string'
        || !feature.trim()
        || feature.trim() !== feature)) {
      invalidCapabilityIntent(`capability ${index} requiredFeatures`);
    }
    if (intent.defaults !== undefined && !asRecord(intent.defaults)) {
      invalidCapabilityIntent(`capability ${index} defaults`);
    }
    const route = asRecord(intent.route);
    if (!route || (route.oneofKind !== 'local' && route.oneofKind !== 'cloud')) {
      invalidCapabilityIntent(`capability ${index} route`);
    }
    if (route.oneofKind === 'local') {
      assertExactKeys(
        route,
        ['oneofKind', 'local'],
        `shared LocalAgent AIConfig capability ${index} route`,
      );
      const local = asRecord(route.local);
      if (!local || Object.keys(local).length !== 0) {
        invalidCapabilityIntent(`capability ${index} local route`);
      }
      return;
    }
    assertExactKeys(
      route,
      ['oneofKind', 'cloud'],
      `shared LocalAgent AIConfig capability ${index} route`,
    );
    const cloud = asRecord(route.cloud);
    assertExactKeys(
      cloud,
      ['implementation', 'providerModelTarget', 'connectorGrantId'],
      `shared LocalAgent AIConfig capability ${index} cloud route`,
    );
    const implementation = asRecord(cloud.implementation);
    assertExactKeys(
      implementation,
      ['implementationId', 'driverId', 'driverDialect'],
      `shared LocalAgent AIConfig capability ${index} implementation`,
    );
    requireText(implementation.implementationId, `ai_config_implementation_${index}`);
    requireText(implementation.driverId, `ai_config_driver_${index}`);
    requireText(implementation.driverDialect, `ai_config_driver_dialect_${index}`);
    if (cloud.providerModelTarget !== undefined && !asRecord(cloud.providerModelTarget)) {
      invalidCapabilityIntent(`capability ${index} providerModelTarget`);
    }
    if (typeof cloud.connectorGrantId !== 'string'
      || cloud.connectorGrantId.trim() !== cloud.connectorGrantId) {
      invalidCapabilityIntent(`capability ${index} connectorGrantId`);
    }
  });
}

function rejectAIConfigOwnerFields(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => rejectAIConfigOwnerFields(entry, seen));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeFieldName(key);
    if (normalized === 'owner' || normalized === 'appid') {
      return localAppError(
        `Shared LocalAgent AIConfig cannot carry ${key}.`,
        'SDK_LOCAL_APP_AUTHORITY_FIELD_FORBIDDEN',
        'remove_shared_local_agent_ai_config_owner_input',
      );
    }
    rejectAIConfigOwnerFields(entry, seen);
  }
}

function invalidCapabilityIntent(field: string): never {
  return localAppError(
    `Shared LocalAgent AIConfig ${field} is invalid.`,
    'SDK_LOCAL_APP_INPUT_INVALID',
    'provide_canonical_shared_local_agent_ai_config_capabilities',
  );
}

function projectSharedAIConfig(value: unknown): NimiCapabilityAIConfig {
  const config = asRecord(value);
  assertExactProjectionKeys(config, ['owner', 'capabilities'], 'shared LocalAgent AIConfig');
  assertSafeProjection(config);
  const owner = asRecord(config.owner);
  assertExactProjectionKeys(owner, ['owner'], 'shared LocalAgent AIConfig owner');
  const ownerVariant = asRecord(owner.owner);
  assertExactProjectionKeys(
    ownerVariant,
    ['oneofKind', 'runtimeLocalAgentSubsystem'],
    'shared LocalAgent AIConfig owner variant',
  );
  if (ownerVariant.oneofKind !== 'runtimeLocalAgentSubsystem') {
    localAppProjectionError('shared LocalAgent AIConfig owner variant');
  }
  const marker = asRecord(ownerVariant.runtimeLocalAgentSubsystem);
  assertExactProjectionKeys(marker, [], 'shared LocalAgent AIConfig owner marker');
  if (!Array.isArray(config.capabilities)) {
    localAppProjectionError('shared LocalAgent AIConfig capabilities');
  }
  return config as unknown as NimiCapabilityAIConfig;
}

function projectSharedAIProfilePreview(value: unknown): {
  readonly before: NimiCapabilityAIConfig | null;
  readonly after: NimiCapabilityAIConfig;
} {
  const projection = asRecord(value);
  assertExactProjectionKeys(
    projection,
    ['before', 'after'],
    'shared LocalAgent AIProfile preview',
  );
  return Object.freeze({
    before: projection.before === null ? null : projectSharedAIConfig(projection.before),
    after: projectSharedAIConfig(projection.after),
  });
}

function encodePortableAIProfile(profile: NimiPortableAIProfileInput): {
  readonly source: NimiPortableAIProfile;
  readonly profileJson: string;
} {
  const source = parseNimiPortableAIProfile(profile);
  const profileJson = serializeNimiPortableAIProfile(source);
  if (new TextEncoder().encode(profileJson).byteLength > MAX_AI_PROFILE_JSON_BYTES) {
    return localAppError(
      'Shared LocalAgent AIProfile exceeds the carrier byte bound.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_bounded_portable_ai_profile',
    );
  }
  return { source, profileJson };
}

function canonicalAIConfig(config: NimiCapabilityAIConfig): string {
  return JSON.stringify(config);
}

function projectAutonomy(value: unknown): NimiLocalAppAgentAutonomyProjection {
  const record = asRecord(value);
  assertExactProjectionKeys(record, [
    'enabled', 'config', 'usedTokensInWindow', 'windowStartedAt', 'budgetExhausted',
    'suspendedUntil', 'autonomyRevision',
  ], 'autonomy');
  if (typeof record.enabled !== 'boolean' || typeof record.budgetExhausted !== 'boolean') {
    localAppProjectionError('autonomy');
  }
  const windowStartedAt = projectTimestamp(record.windowStartedAt, 'windowStartedAt');
  const suspendedUntil = projectTimestamp(record.suspendedUntil, 'suspendedUntil');
  return Object.freeze({
    enabled: record.enabled,
    config: record.config === null ? null : projectAutonomyConfig(record.config, false),
    usedTokensInWindow: nonNegativeInteger(record.usedTokensInWindow, 'usedTokensInWindow'),
    ...(windowStartedAt ? { windowStartedAt } : {}),
    budgetExhausted: record.budgetExhausted,
    ...(suspendedUntil ? { suspendedUntil } : {}),
    autonomyRevision: positiveRevisionProjection(record.autonomyRevision, 'autonomyRevision'),
  });
}

function validateAutonomyIntent(value: unknown): NimiLocalAppAgentAutonomyIntent {
  assertExactKeys(value, ['enabled', 'config'], 'autonomy intent');
  assertNoAuthorityMaterial(value);
  const record = value as Record<string, unknown>;
  if (record.enabled === undefined && record.config === undefined) {
    return localAppError(
      'Autonomy intent is empty.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_autonomy_intent',
    );
  }
  if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
    localAppError(
      'Autonomy enabled is invalid.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_autonomy_enabled',
    );
  }
  return Object.freeze({
    ...(typeof record.enabled === 'boolean' ? { enabled: record.enabled } : {}),
    ...(record.config === undefined ? {} : { config: projectAutonomyConfig(record.config, true) }),
  });
}

function projectAutonomyConfig(
  value: unknown,
  input: boolean,
): NimiLocalAppAgentAutonomyConfig {
  const record = asRecord(value);
  const keys = ['dailyTokenBudget', 'maxTokensPerHook', 'minHookInterval', 'suspendUntil', 'mode'];
  if (input) assertExactKeys(record, keys, 'autonomy config');
  else assertExactProjectionKeys(record, keys, 'autonomy config');
  const minHookInterval = projectDuration(record?.minHookInterval, 'minHookInterval');
  const suspendUntil = projectTimestamp(record?.suspendUntil, 'suspendUntil');
  return Object.freeze({
    dailyTokenBudget: nonNegativeInteger(record?.dailyTokenBudget, 'dailyTokenBudget'),
    maxTokensPerHook: nonNegativeInteger(record?.maxTokensPerHook, 'maxTokensPerHook'),
    ...(minHookInterval ? { minHookInterval } : {}),
    ...(suspendUntil ? { suspendUntil } : {}),
    mode: enumText(record?.mode, ['off', 'low', 'medium', 'high'], 'autonomy mode'),
  });
}

function projectDuration(value: unknown, field: string): NimiLocalAppDuration | undefined {
  return projectTimestamp(value, field);
}

function projectPresentation(value: unknown): NimiLocalAppAgentPresentationProjection {
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    ['profile', 'previousProfile', 'defaultVoiceReference', 'presentationRevision'],
    'presentation',
  );
  return Object.freeze({
    profile: record.profile === null ? null : projectPresentationProfile(record.profile),
    previousProfile: record.previousProfile === null
      ? null
      : projectPresentationProfile(record.previousProfile),
    defaultVoiceReference: canonicalString(record.defaultVoiceReference, 'defaultVoiceReference'),
    presentationRevision: decimalCursor(record.presentationRevision, 'presentationRevision'),
  });
}

function projectPresentationProfile(value: unknown): NimiLocalAppAgentPresentationProfile {
  const record = asRecord(value);
  assertExactProjectionKeys(record, [
    'backendKind', 'avatarAssetRef', 'expressionProfileRef', 'idlePreset',
    'interactionPolicyRef', 'defaultVoiceReference', 'avatarAutoplay',
    'backgroundAssetRef', 'revision',
  ], 'presentation profile');
  if (typeof record.avatarAutoplay !== 'boolean') localAppProjectionError('avatarAutoplay');
  return Object.freeze({
    backendKind: enumText(
      record.backendKind,
      ['vrm', 'live2d', 'sprite2d', 'canvas2d', 'video'],
      'backendKind',
    ),
    avatarAssetRef: canonicalString(record.avatarAssetRef, 'avatarAssetRef'),
    expressionProfileRef: canonicalString(record.expressionProfileRef, 'expressionProfileRef'),
    idlePreset: canonicalString(record.idlePreset, 'idlePreset'),
    interactionPolicyRef: canonicalString(record.interactionPolicyRef, 'interactionPolicyRef'),
    defaultVoiceReference: canonicalString(record.defaultVoiceReference, 'defaultVoiceReference'),
    avatarAutoplay: record.avatarAutoplay,
    backgroundAssetRef: canonicalString(record.backgroundAssetRef, 'backgroundAssetRef'),
    revision: decimalCursor(record.revision, 'presentation profile revision'),
  });
}

function validatePresentationIntent(value: unknown): NimiLocalAppAgentPresentationIntent {
  const record = asRecord(value);
  assertExactKeys(record, [
    'backendKind', 'avatarAssetRef', 'expressionProfileRef', 'idlePreset',
    'interactionPolicyRef', 'defaultVoiceReference', 'avatarAutoplay', 'backgroundAssetRef',
  ], 'presentation intent');
  assertNoAuthorityMaterial(record);
  if (typeof record?.avatarAutoplay !== 'boolean') {
    localAppError(
      'Presentation autoplay is invalid.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_avatar_autoplay',
    );
  }
  return Object.freeze({
    backendKind: enumText(
      record?.backendKind,
      ['vrm', 'live2d', 'sprite2d', 'canvas2d', 'video'],
      'backendKind',
    ),
    avatarAssetRef: canonicalString(record?.avatarAssetRef, 'avatarAssetRef'),
    expressionProfileRef: canonicalString(record?.expressionProfileRef, 'expressionProfileRef'),
    idlePreset: canonicalString(record?.idlePreset, 'idlePreset'),
    interactionPolicyRef: canonicalString(record?.interactionPolicyRef, 'interactionPolicyRef'),
    defaultVoiceReference: canonicalString(record?.defaultVoiceReference, 'defaultVoiceReference'),
    avatarAutoplay: record.avatarAutoplay,
    backgroundAssetRef: canonicalString(record?.backgroundAssetRef, 'backgroundAssetRef'),
  });
}

function validatePresentationAssetMaterials(
  value: unknown,
): readonly NimiLocalAppAgentPresentationAssetMaterial[] {
  if (!Array.isArray(value) || value.length > 2) {
    return localAppError(
      'Presentation imported assets are invalid.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_imported_presentation_assets',
    );
  }
  const roles = new Set<string>();
  return Object.freeze(value.map((entry) => {
    const record = asRecord(entry);
    assertExactKeys(
      record,
      ['role', 'fileName', 'mediaType', 'content', 'sha256'],
      'presentation asset material',
    );
    assertNoAuthorityMaterial(record);
    const role = enumText(record?.role, ['avatar', 'background'], 'presentation asset role');
    if (roles.has(role)
      || !(record?.content instanceof Uint8Array)
      || record.content.byteLength === 0) {
      return localAppError(
        'Presentation asset material is invalid.',
        'SDK_LOCAL_APP_INPUT_INVALID',
        'provide_imported_presentation_assets',
      );
    }
    roles.add(role);
    const sha256 = requireText(record.sha256, 'sha256');
    if (!/^[a-f0-9]{64}$/u.test(sha256)) {
      return localAppError(
        'Presentation asset sha256 is invalid.',
        'SDK_LOCAL_APP_INPUT_INVALID',
        'provide_presentation_asset_sha256',
      );
    }
    return Object.freeze({
      role,
      fileName: requireText(record.fileName, 'fileName'),
      mediaType: requireText(record.mediaType, 'mediaType').toLowerCase(),
      content: new Uint8Array(record.content),
      sha256,
    });
  }));
}

function positiveRevision(value: unknown, field: string): string {
  const revision = decimalCursor(value, field);
  if (revision === '0') {
    localAppError(
      `${field} must be positive.`,
      'SDK_LOCAL_APP_INPUT_INVALID',
      `provide_${field}`,
    );
  }
  return revision;
}

function positiveRevisionProjection(value: unknown, field: string): string {
  const revision = decimalCursor(value, field);
  if (revision === '0') localAppProjectionError(field);
  return revision;
}

function enumText<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    localAppProjectionError(field);
  }
  return value as T;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = typeof value === 'string' || typeof value === 'number'
      ? String(value).trim()
      : '';
    if (text) return text;
  }
  return '';
}

function configureReasonCode(value: string): NimiLocalAppConfigureReasonCode | null {
  const normalized = value.trim().replace(/-/gu, '_').toUpperCase();
  const numeric: Record<string, NimiLocalAppConfigureReasonCode> = {
    '614': 'AGENT_PRESENTATION_REVISION_CONFLICT',
    '651': 'LOCAL_APP_PERMISSION_REQUIRED',
    '652': 'LOCAL_APP_PERMISSION_DENIED',
    '653': 'LOCAL_APP_PERMISSION_REVOKED',
    '668': 'LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED',
    '669': 'LOCAL_APP_PERMISSION_UNKNOWN',
    '671': 'AGENT_AUTONOMY_REVISION_CONFLICT',
    '672': 'AGENT_PRESENTATION_ASSET_TYPE_INVALID',
    '673': 'AGENT_PRESENTATION_ASSET_TOO_LARGE',
    '674': 'AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID',
    '675': 'AGENT_PRESENTATION_ASSET_DEPENDENCY_MISSING',
    '676': 'AGENT_PRESENTATION_ASSET_INTEGRITY_MISMATCH',
    '677': 'AGENT_PRESENTATION_BACKEND_INCOMPATIBLE',
    '678': 'AGENT_PRESENTATION_ASSET_NOT_VALIDATED',
  };
  const aliases: Record<string, NimiLocalAppConfigureReasonCode> = {
    PERMISSION_REQUIRED: 'LOCAL_APP_PERMISSION_REQUIRED',
    PERMISSION_DENIED: 'LOCAL_APP_PERMISSION_DENIED',
    PERMISSION_REVOKED: 'LOCAL_APP_PERMISSION_REVOKED',
    PERMISSION_RESERVED_NOT_ADMITTED: 'LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED',
    PERMISSION_UNKNOWN: 'LOCAL_APP_PERMISSION_UNKNOWN',
  };
  const candidate = numeric[normalized] ?? aliases[normalized] ?? normalized;
  return [
    'LOCAL_APP_PERMISSION_REQUIRED', 'LOCAL_APP_PERMISSION_DENIED',
    'LOCAL_APP_PERMISSION_REVOKED', 'LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED',
    'LOCAL_APP_PERMISSION_UNKNOWN', 'AGENT_AUTONOMY_REVISION_CONFLICT',
    'AGENT_PRESENTATION_REVISION_CONFLICT', 'AGENT_PRESENTATION_ASSET_TYPE_INVALID',
    'AGENT_PRESENTATION_ASSET_TOO_LARGE', 'AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID',
    'AGENT_PRESENTATION_ASSET_DEPENDENCY_MISSING',
    'AGENT_PRESENTATION_ASSET_INTEGRITY_MISMATCH',
    'AGENT_PRESENTATION_BACKEND_INCOMPATIBLE', 'AGENT_PRESENTATION_ASSET_NOT_VALIDATED',
  ].includes(candidate) ? candidate as NimiLocalAppConfigureReasonCode : null;
}

function configureErrorCategory(
  reason: NimiLocalAppConfigureReasonCode,
): NimiLocalAppConfigureErrorCategory {
  switch (reason) {
    case 'LOCAL_APP_PERMISSION_REQUIRED': return 'not-granted';
    case 'LOCAL_APP_PERMISSION_DENIED': return 'denied';
    case 'LOCAL_APP_PERMISSION_REVOKED': return 'not-granted';
    case 'LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED': return 'reserved-not-admitted';
    case 'LOCAL_APP_PERMISSION_UNKNOWN': return 'unknown-permission';
    case 'AGENT_AUTONOMY_REVISION_CONFLICT': return 'autonomy-revision-conflict';
    case 'AGENT_PRESENTATION_REVISION_CONFLICT': return 'presentation-revision-conflict';
    case 'AGENT_PRESENTATION_ASSET_TYPE_INVALID': return 'presentation-type';
    case 'AGENT_PRESENTATION_ASSET_TOO_LARGE': return 'presentation-size';
    case 'AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID': return 'presentation-structure';
    case 'AGENT_PRESENTATION_ASSET_DEPENDENCY_MISSING': return 'presentation-dependency';
    case 'AGENT_PRESENTATION_ASSET_INTEGRITY_MISMATCH': return 'presentation-integrity';
    case 'AGENT_PRESENTATION_BACKEND_INCOMPATIBLE': return 'presentation-backend-compat';
    case 'AGENT_PRESENTATION_ASSET_NOT_VALIDATED': return 'presentation-not-validated';
  }
}

function configureActionHint(category: NimiLocalAppConfigureErrorCategory): string {
  switch (category) {
    case 'reserved-not-admitted': return 'wait_for_permission_admission';
    case 'unknown-permission': return 'use_known_permission_id';
    case 'autonomy-revision-conflict': return 'refresh_autonomy_snapshot';
    case 'presentation-revision-conflict': return 'refresh_presentation_snapshot';
    case 'presentation-type': return 'select_supported_presentation_asset';
    case 'presentation-size': return 'select_smaller_presentation_asset';
    case 'presentation-structure': return 'select_valid_presentation_asset';
    case 'presentation-dependency': return 'repair_live2d_package_dependencies';
    case 'presentation-integrity': return 'select_presentation_asset_again';
    case 'presentation-backend-compat': return 'select_matching_avatar_backend';
    case 'presentation-not-validated': return 'import_asset_through_protected_shell';
    default: return 'request_or_restore_agents_configure_permission';
  }
}

function publicReasonMetadata(value: Record<string, unknown>): Record<string, string> {
  const allowed = [
    'permission_id', 'permission_reason', 'permission_admission', 'diagnostic_stage',
    'local_development_reason_code', 'validation_category', 'asset_role', 'media_type',
    'backend_kind', 'expected_revision', 'committed_revision',
  ];
  return Object.fromEntries(allowed.flatMap((key) => {
    const text = typeof value[key] === 'string' ? value[key].trim() : '';
    return text && new TextEncoder().encode(text).byteLength <= 2048 ? [[key, text]] : [];
  }));
}
