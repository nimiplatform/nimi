import { createNimiError, type JsonObject, type NimiError } from '../../types/index.js';
import {
  areNimiAIScopeRefsEqual,
  diffNimiAIConfigs,
  formNimiRuntimeProfileDescriptor,
  projectNimiRuntimeLocalAgentAIScopeRef,
  toNimiRuntimeProfileDescriptorWire,
  validateNimiAIProfile,
  versionNimiAIProfile,
  type NimiAICapabilityRequirementDeclaration,
  type NimiAIConfig,
  type NimiAIConfigApplyOutcome,
  type NimiAIConfigComponentSelection,
  type NimiAIConfigSetupProjection,
  type NimiAIProfile,
  type NimiAIProfileApplyResult,
  type NimiAIProfileOriginRef,
  type NimiAIProfilePreviewResult,
} from '../ai/index.js';
import type { NimiJsonObject } from '../contracts/index.js';
import type { NimiLocalAppAgentHandle } from './permission-types.js';
import {
  asRecord,
  assertExactKeys,
  assertExactMethodNamespace,
  assertExactProjectionKeys,
  assertNoAIConfigPrivateIdentity,
  assertNoAuthorityMaterial,
  assertSafeProjection,
  canonicalString,
  decimalCursor,
  localAppError,
  localAppProjectionError,
  nonNegativeInteger,
  projectTimestamp,
  projectionText,
  requireText,
} from './local-app-runtime-platform-validation.js';

export type NimiLocalAppAgentRoutePolicy = 'local' | 'cloud';
export type NimiLocalAppAgentReadinessState =
  | 'ready'
  | 'blocked'
  | 'unavailable'
  | 'failed'
  | 'configured_unverified';
export type NimiLocalAppAgentRouteOptionAvailability = 'ready' | 'installed';
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

export interface NimiLocalAppTimestampProfileOrigin {
  readonly profileId: string;
  readonly title: string;
  readonly appliedAt: NimiLocalAppTimestamp;
}

export interface NimiLocalAppAgentAIConfigIntent {
  readonly capability: string;
  readonly provider: string;
  readonly logicalModelId: string;
  readonly routePolicy: NimiLocalAppAgentRoutePolicy;
  readonly selectedComponents?: readonly Omit<NimiAIConfigComponentSelection, 'targetRef'>[];
  readonly selectedParams?: NimiJsonObject;
}

export interface NimiLocalAppAgentCapabilityReadiness {
  readonly capability: string;
  readonly state: NimiLocalAppAgentReadinessState;
  readonly reason: string;
  readonly observedAt?: NimiLocalAppTimestamp;
}

export interface NimiLocalAppAgentRouteOption {
  readonly capability: string;
  readonly provider: string;
  readonly logicalModelId: string;
  readonly routePolicy: NimiLocalAppAgentRoutePolicy;
  readonly label: string;
  readonly availability: NimiLocalAppAgentRouteOptionAvailability;
}

export interface NimiLocalAppAgentAIConfigProjection {
  readonly aiConfig: NimiAIConfig;
  readonly capabilities: readonly string[];
  readonly intents: readonly NimiLocalAppAgentAIConfigIntent[];
  readonly readiness: readonly NimiLocalAppAgentCapabilityReadiness[];
  readonly configurationRevision: NimiLocalAppRevision;
  readonly routeOptions: readonly NimiLocalAppAgentRouteOption[];
}

export interface NimiLocalAppAgentReadinessProjection {
  readonly capabilities: readonly NimiLocalAppAgentCapabilityReadiness[];
  readonly configurationRevision: NimiLocalAppRevision;
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
  | 'AGENT_AI_CONFIG_REVISION_CONFLICT'
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
  | 'configuration-revision-conflict'
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

export interface NimiLocalAppConfigurationConflict {
  readonly outcome: 'conflict';
  readonly conflict: NimiLocalAppConfigureError & {
    readonly reasonCode: 'AGENT_AI_CONFIG_REVISION_CONFLICT';
    readonly category: 'configuration-revision-conflict';
  };
}

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

export type NimiLocalAppConfigurationUpdateResult =
  | { readonly outcome: 'updated'; readonly projection: NimiLocalAppAgentAIConfigProjection }
  | NimiLocalAppConfigurationConflict;
export type NimiLocalAppAutonomyUpdateResult =
  | { readonly outcome: 'updated'; readonly projection: NimiLocalAppAgentAutonomyProjection }
  | NimiLocalAppAutonomyConflict;
export interface NimiLocalAppPresentationValidationFailure {
  readonly outcome: 'validation-failed';
  readonly failure: NimiLocalAppConfigureError & {
    readonly reasonCode: Exclude<NimiLocalAppConfigureReasonCode,
      | 'LOCAL_APP_PERMISSION_REQUIRED' | 'LOCAL_APP_PERMISSION_DENIED' | 'LOCAL_APP_PERMISSION_REVOKED'
      | 'LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED' | 'LOCAL_APP_PERMISSION_UNKNOWN'
      | 'AGENT_AI_CONFIG_REVISION_CONFLICT' | 'AGENT_AUTONOMY_REVISION_CONFLICT'
      | 'AGENT_PRESENTATION_REVISION_CONFLICT'>;
  };
}

export type NimiLocalAppPresentationCommitResult =
  | { readonly outcome: 'committed'; readonly projection: NimiLocalAppAgentPresentationProjection }
  | NimiLocalAppPresentationConflict
  | NimiLocalAppPresentationValidationFailure;

export interface NimiLocalAppConfigurationSnapshotInput {
  readonly agentHandle: NimiLocalAppAgentHandle;
}
export interface NimiLocalAppUpdateConfigurationInput extends NimiLocalAppConfigurationSnapshotInput {
  readonly expectedConfigurationRevision: NimiLocalAppRevision;
  readonly config: NimiAIConfig;
  readonly routes: readonly {
    readonly capability: string;
    readonly provider: string;
    readonly routePolicy: NimiLocalAppAgentRoutePolicy;
  }[];
}
export interface NimiLocalAppAIProfilePreviewInput extends NimiLocalAppConfigurationSnapshotInput {
  readonly scopeRef: NimiAIConfig['scopeRef'];
  readonly profile: NimiAIProfile;
  readonly requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[];
}
export interface NimiLocalAppAIProfileApplyInput extends NimiLocalAppAIProfilePreviewInput {
  readonly expectedBaseVersion?: string;
}
export type NimiLocalAppReadinessSnapshotInput = NimiLocalAppConfigurationSnapshotInput;
export type NimiLocalAppAutonomySnapshotInput = NimiLocalAppConfigurationSnapshotInput;
export interface NimiLocalAppUpdateAutonomyInput extends NimiLocalAppConfigurationSnapshotInput {
  readonly expectedAutonomyRevision: NimiLocalAppRevision;
  readonly intent: NimiLocalAppAgentAutonomyIntent;
}
export type NimiLocalAppPresentationSnapshotInput = NimiLocalAppConfigurationSnapshotInput;
export interface NimiLocalAppCommitPresentationInput extends NimiLocalAppConfigurationSnapshotInput {
  readonly expectedPresentationRevision: NimiLocalAppRevision;
  readonly intent: NimiLocalAppAgentPresentationIntent;
  readonly importedAssets: readonly NimiLocalAppAgentPresentationAssetMaterial[];
}

export interface NimiLocalAppAgentConfigureShell {
  configurationSnapshot(input: { readonly agentHandle: string }): Promise<unknown>;
  updateConfiguration(input: {
    readonly agentHandle: string;
    readonly expectedConfigurationRevision: string;
    readonly intents: readonly NimiLocalAppAgentAIConfigIntent[];
    readonly profileOrigin: NimiLocalAppTimestampProfileOrigin | null;
  }): Promise<unknown>;
  readinessSnapshot(input: { readonly agentHandle: string }): Promise<unknown>;
  aiProfilePreview(input: {
    readonly agentHandle: string;
    readonly profile: NimiAIProfile;
    readonly runtimeDescriptor: unknown;
  }): Promise<unknown>;
  aiProfileApply(input: {
    readonly agentHandle: string;
    readonly expectedConfigurationRevision: string;
    readonly profile: NimiAIProfile;
    readonly runtimeDescriptor: unknown;
  }): Promise<unknown>;
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
  configurationSnapshot(input: NimiLocalAppConfigurationSnapshotInput): Promise<NimiLocalAppAgentAIConfigProjection>;
  updateConfiguration(input: NimiLocalAppUpdateConfigurationInput): Promise<NimiLocalAppConfigurationUpdateResult>;
  readinessSnapshot(input: NimiLocalAppReadinessSnapshotInput): Promise<NimiLocalAppAgentReadinessProjection>;
  previewAIProfile(input: NimiLocalAppAIProfilePreviewInput): Promise<NimiAIProfilePreviewResult>;
  applyAIProfile(input: NimiLocalAppAIProfileApplyInput): Promise<NimiAIProfileApplyResult>;
  autonomySnapshot(input: NimiLocalAppAutonomySnapshotInput): Promise<NimiLocalAppAgentAutonomyProjection>;
  updateAutonomy(input: NimiLocalAppUpdateAutonomyInput): Promise<NimiLocalAppAutonomyUpdateResult>;
  presentationSnapshot(input: NimiLocalAppPresentationSnapshotInput): Promise<NimiLocalAppAgentPresentationProjection>;
  commitPresentation(input: NimiLocalAppCommitPresentationInput): Promise<NimiLocalAppPresentationCommitResult>;
}

const CONFIGURE_METHODS = [
  'configurationSnapshot',
  'updateConfiguration',
  'readinessSnapshot',
  'aiProfilePreview',
  'aiProfileApply',
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
  return Object.freeze({
    configurationSnapshot: async (input: NimiLocalAppConfigurationSnapshotInput) => {
      const agentHandle = configureHandle(input, ['agentHandle'], 'configuration snapshot');
      return projectConfiguration(await invoke(() => carrier.configurationSnapshot({ agentHandle })));
    },
    updateConfiguration: async (input: NimiLocalAppUpdateConfigurationInput) => {
      assertExactKeys(input, ['agentHandle', 'expectedConfigurationRevision', 'config', 'routes'], 'configuration update');
      assertNoAuthorityMaterial(input);
      const intents = inputIntentsFromAIConfig(input.config, input.routes);
      const request = {
        agentHandle: requireText(input.agentHandle, 'agentHandle'),
        expectedConfigurationRevision: positiveRevision(input.expectedConfigurationRevision, 'expectedConfigurationRevision'),
        intents,
        profileOrigin: input.config.profileOrigin
          ? inputProfileOrigin(input.config.profileOrigin)
          : null,
      };
      try {
        return Object.freeze({ outcome: 'updated', projection: projectConfiguration(await carrier.updateConfiguration(request)) });
      } catch (error) {
        const mapped = mapNimiLocalAppConfigureError(error);
        if (mapped.reasonCode === 'AGENT_AI_CONFIG_REVISION_CONFLICT') {
          return Object.freeze({ outcome: 'conflict', conflict: mapped }) as NimiLocalAppConfigurationConflict;
        }
        throw mapped;
      }
    },
    readinessSnapshot: async (input: NimiLocalAppReadinessSnapshotInput) => {
      const agentHandle = configureHandle(input, ['agentHandle'], 'readiness snapshot');
      return projectReadiness(await invoke(() => carrier.readinessSnapshot({ agentHandle })));
    },
    previewAIProfile: async (input: NimiLocalAppAIProfilePreviewInput) => {
      assertExactKeys(input, ['agentHandle', 'scopeRef', 'profile', 'requirementDeclarations'], 'AIProfile preview');
      assertNoAuthorityMaterial(input);
      const agentHandle = requireText(input.agentHandle, 'agentHandle');
      const current = projectConfiguration(await invoke(() => carrier.configurationSnapshot({ agentHandle })));
      assertLocalAppAIProfileScope(input.scopeRef, current.aiConfig);
      const payload = localAppAIProfilePayload(input.profile, input.requirementDeclarations);
      const response = projectAIProfilePreviewResponse(await invoke(() => carrier.aiProfilePreview({
        agentHandle,
        ...payload,
      })));
      if (!areNimiAIScopeRefsEqual(response.before?.scopeRef ?? input.scopeRef, input.scopeRef)) {
        return localAppProjectionError('AIProfile preview scope');
      }
      return response;
    },
    applyAIProfile: async (input: NimiLocalAppAIProfileApplyInput) => {
      assertExactKeys(input, ['agentHandle', 'scopeRef', 'profile', 'requirementDeclarations', 'expectedBaseVersion'], 'AIProfile apply');
      assertNoAuthorityMaterial(input);
      const agentHandle = requireText(input.agentHandle, 'agentHandle');
      const current = projectConfiguration(await invoke(() => carrier.configurationSnapshot({ agentHandle })));
      assertLocalAppAIProfileScope(input.scopeRef, current.aiConfig);
      const expectedConfigurationRevision = input.expectedBaseVersion
        ? parseLocalAppAIProfileBaseVersion(input.expectedBaseVersion)
        : current.configurationRevision;
      const payload = localAppAIProfilePayload(input.profile, input.requirementDeclarations);
      return projectAIProfileApplyResponse(await invoke(() => carrier.aiProfileApply({
        agentHandle,
        expectedConfigurationRevision,
        ...payload,
      })));
    },
    autonomySnapshot: async (input: NimiLocalAppAutonomySnapshotInput) => {
      const agentHandle = configureHandle(input, ['agentHandle'], 'autonomy snapshot');
      return projectAutonomy(await invoke(() => carrier.autonomySnapshot({ agentHandle })));
    },
    updateAutonomy: async (input: NimiLocalAppUpdateAutonomyInput) => {
      assertExactKeys(input, ['agentHandle', 'expectedAutonomyRevision', 'intent'], 'autonomy update');
      assertNoAuthorityMaterial(input);
      const request = {
        agentHandle: requireText(input.agentHandle, 'agentHandle'),
        expectedAutonomyRevision: positiveRevision(input.expectedAutonomyRevision, 'expectedAutonomyRevision'),
        intent: validateAutonomyIntent(input.intent),
      };
      try {
        return Object.freeze({ outcome: 'updated', projection: projectAutonomy(await carrier.updateAutonomy(request)) });
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
      assertExactKeys(input, ['agentHandle', 'expectedPresentationRevision', 'intent', 'importedAssets'], 'presentation commit');
      assertNoAuthorityMaterial(input);
      const request = {
        agentHandle: requireText(input.agentHandle, 'agentHandle'),
        expectedPresentationRevision: decimalCursor(input.expectedPresentationRevision, 'expectedPresentationRevision'),
        intent: validatePresentationIntent(input.intent),
        importedAssets: validatePresentationAssetMaterials(input.importedAssets),
      };
      try {
        return Object.freeze({ outcome: 'committed', projection: projectPresentation(await carrier.commitPresentation(request)) });
      } catch (error) {
        const mapped = mapNimiLocalAppConfigureError(error);
        if (mapped.reasonCode === 'AGENT_PRESENTATION_REVISION_CONFLICT') {
          return Object.freeze({ outcome: 'conflict', conflict: mapped }) as NimiLocalAppPresentationConflict;
        }
        if (mapped.category.startsWith('presentation-')) {
          return Object.freeze({ outcome: 'validation-failed', failure: mapped }) as NimiLocalAppPresentationValidationFailure;
        }
        throw mapped;
      }
    },
  });
}

export function mapNimiLocalAppConfigureError(error: unknown): NimiLocalAppConfigureError {
  const direct = asRecord(error) ?? {};
  const envelope = asRecord(direct.envelope) ?? {};
  const details = asRecord(envelope.details) ?? asRecord(direct.details) ?? {};
  const rawReason = firstText(direct.reasonCode, direct.reason_code, envelope.reasonCode, envelope.reason_code, direct.code);
  const reasonCode = configureReasonCode(rawReason);
  if (!reasonCode) throw error;
  const category = configureErrorCategory(reasonCode);
  const reasonMetadata = publicReasonMetadata(details);
  const permissionId = 'agents.configure' as const;
  const actionHint = firstText(direct.actionHint, envelope.actionHint) || configureActionHint(category);
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

const LOCAL_APP_AI_PROFILE_BASE_VERSION_PREFIX = 'runtime-agent-revision:';

function assertLocalAppAIProfileScope(
  scopeRef: NimiAIConfig['scopeRef'],
  current: NimiAIConfig,
): void {
  if (!areNimiAIScopeRefsEqual(scopeRef, current.scopeRef)) {
    return localAppError(
      'Local-app AIProfile scopeRef does not match the Runtime-issued Agent handle.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'use_runtime_projected_ai_config_scope',
    );
  }
}

function localAppAIProfilePayload(
  profile: NimiAIProfile,
  requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[],
): {
  readonly profile: NimiAIProfile;
  readonly runtimeDescriptor: unknown;
} {
  const validation = validateNimiAIProfile(profile);
  if (!validation.valid) {
    return localAppError(
      `Local-app AIProfile is invalid: ${validation.issues.map((issue) => `${issue.code}:${issue.path}`).join('; ')}`,
      'SDK_LOCAL_APP_INPUT_INVALID',
      'fix_ai_profile_contract',
    );
  }
  const digest = versionNimiAIProfile(profile);
  const descriptor = formNimiRuntimeProfileDescriptor({
    profile,
    requirementDeclarations,
    descriptorId: `runtime-agent-ai-profile:${profile.profileId}:${digest}`,
    sourceProfileDigest: digest,
  });
  return {
    profile,
    runtimeDescriptor: toNimiRuntimeProfileDescriptorWire(descriptor),
  };
}

function localAppAIProfileBaseVersion(revision: NimiLocalAppRevision): string {
  return `${LOCAL_APP_AI_PROFILE_BASE_VERSION_PREFIX}${positiveRevision(revision, 'profile base revision')}`;
}

function parseLocalAppAIProfileBaseVersion(value: unknown): NimiLocalAppRevision {
  const normalized = canonicalString(value, 'expectedBaseVersion');
  if (!normalized.startsWith(LOCAL_APP_AI_PROFILE_BASE_VERSION_PREFIX)) {
    return localAppError(
      'Local-app AIProfile expectedBaseVersion is not a Runtime-issued preview version.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'preview_ai_profile_before_apply',
    );
  }
  return positiveRevision(
    normalized.slice(LOCAL_APP_AI_PROFILE_BASE_VERSION_PREFIX.length),
    'expectedBaseVersion',
  );
}

function projectAIProfileOutcome(value: unknown): NimiAIConfigApplyOutcome {
  return enumText(value, [
    'ready_to_apply',
    'setup_required_no_live_config',
    'unsupported_no_live_config',
    'invalid_profile',
    'stale_base',
    'failed',
  ], 'AIProfile outcome');
}

function projectAIProfileStrings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) return localAppProjectionError(label);
  const projected = value.map((entry) => projectionText(entry, label));
  return Object.freeze([...new Set(projected)].sort());
}

function projectAIProfileSetup(
  outcome: NimiAIConfigApplyOutcome,
  response: {
    readonly blockingCapabilities: readonly string[];
    readonly reasonCodes: readonly string[];
    readonly actionRefs: readonly string[];
  },
): NimiAIConfigSetupProjection | null {
  if (outcome !== 'setup_required_no_live_config' && outcome !== 'unsupported_no_live_config') {
    return null;
  }
  return Object.freeze({
    outcome,
    blockingCapabilities: response.blockingCapabilities,
    reasonCodes: response.reasonCodes,
    actionRefs: response.actionRefs,
  });
}

function projectAIProfilePreviewResponse(value: unknown): NimiAIProfilePreviewResult {
  const record = asRecord(value);
  assertExactProjectionKeys(record, [
    'before', 'after', 'outcome', 'baseRevision', 'blockingCapabilities',
    'reasonCodes', 'actionRefs', 'probeWarnings',
  ], 'AIProfile preview');
  const beforeProjection = record.before === null ? null : projectConfiguration(record.before, true);
  const afterProjection = record.after === null ? null : projectConfiguration(record.after, true);
  const outcome = projectAIProfileOutcome(record.outcome);
  const baseVersion = localAppAIProfileBaseVersion(
    positiveRevisionProjection(record.baseRevision, 'profile base revision'),
  );
  if (beforeProjection && baseVersion !== localAppAIProfileBaseVersion(beforeProjection.configurationRevision)) {
    return localAppProjectionError('AIProfile preview base revision');
  }
  if ((outcome === 'ready_to_apply') !== Boolean(afterProjection)) {
    return localAppProjectionError('AIProfile preview outcome');
  }
  const setupInput = {
    blockingCapabilities: projectAIProfileStrings(record.blockingCapabilities, 'blocking capability'),
    reasonCodes: projectAIProfileStrings(record.reasonCodes, 'AIProfile reason code'),
    actionRefs: projectAIProfileStrings(record.actionRefs, 'AIProfile action ref'),
  };
  const setupProjection = projectAIProfileSetup(outcome, setupInput);
  const before = beforeProjection?.aiConfig ?? null;
  const after = afterProjection?.aiConfig ?? null;
  return Object.freeze({
    before,
    after,
    outcome,
    ...(setupProjection ? { setupProjection } : {}),
    diff: diffNimiAIConfigs(before, after),
    baseVersion,
    probeWarnings: projectAIProfileStrings(record.probeWarnings, 'AIProfile probe warning'),
  });
}

function projectAIProfileApplyResponse(value: unknown): NimiAIProfileApplyResult {
  const record = asRecord(value);
  assertExactProjectionKeys(record, [
    'projection', 'outcome', 'blockingCapabilities', 'reasonCodes', 'actionRefs', 'probeWarnings',
  ], 'AIProfile apply');
  const projection = record.projection === null ? null : projectConfiguration(record.projection, true);
  const outcome = projectAIProfileOutcome(record.outcome);
  if ((outcome === 'ready_to_apply') !== Boolean(projection)) {
    return localAppProjectionError('AIProfile apply outcome');
  }
  const setupInput = {
    blockingCapabilities: projectAIProfileStrings(record.blockingCapabilities, 'blocking capability'),
    reasonCodes: projectAIProfileStrings(record.reasonCodes, 'AIProfile reason code'),
    actionRefs: projectAIProfileStrings(record.actionRefs, 'AIProfile action ref'),
  };
  const setupProjection = projectAIProfileSetup(outcome, setupInput);
  return Object.freeze({
    success: outcome === 'ready_to_apply',
    config: projection?.aiConfig ?? null,
    failureReason: outcome === 'ready_to_apply'
      ? null
      : setupInput.reasonCodes.join(',') || outcome,
    outcome,
    ...(setupProjection ? { setupProjection } : {}),
    probeWarnings: projectAIProfileStrings(record.probeWarnings, 'AIProfile probe warning'),
  });
}

function inputIntentsFromAIConfig(
  config: NimiAIConfig,
  routes: NimiLocalAppUpdateConfigurationInput['routes'],
): readonly NimiLocalAppAgentAIConfigIntent[] {
  if (!config || config.scopeRef?.kind !== 'local-agent' || config.scopeRef.surfaceId !== undefined) {
    return localAppError(
      'Local-app AIConfig update requires a Runtime-issued local-agent scope.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'use_runtime_projected_ai_config',
    );
  }
  if (Object.keys(config.capabilities.targetRefs || {}).length > 0) {
    return localAppError(
      'Local-app AIConfig cannot carry Runtime-private target refs.',
      'SDK_LOCAL_APP_AUTHORITY_FIELD_FORBIDDEN',
      'remove_runtime_private_target_refs',
    );
  }
  if (!Array.isArray(routes) || routes.length === 0) {
    return localAppError(
      'Local-app AIConfig update requires route selections.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_ai_config_routes',
    );
  }
  const routeByCapability = new Map<string, NimiLocalAppUpdateConfigurationInput['routes'][number]>();
  for (const route of routes) {
    assertExactKeys(route, ['capability', 'provider', 'routePolicy'], 'AIConfig route');
    const capability = requireText(route.capability, 'capability');
    const provider = canonicalString(route.provider, 'provider');
    const routePolicy = enumText(route.routePolicy, ['local', 'cloud'], 'route policy');
    if (routeByCapability.has(capability)
      || (routePolicy === 'local' && provider)
      || (routePolicy === 'cloud' && !provider)) {
      return localAppError(
        'Local-app AIConfig route is not canonical.',
        'SDK_LOCAL_APP_INPUT_INVALID',
        'repair_ai_config_route',
      );
    }
    routeByCapability.set(capability, { capability, provider, routePolicy });
  }
  const intents = Object.entries(config.capabilities.logicalModelIds || {}).map(([rawCapability, rawModel]) => {
    const capability = requireText(rawCapability, 'capability');
    const logicalModelId = requireText(rawModel, 'logicalModelId');
    const route = routeByCapability.get(capability);
    if (!route) {
      return localAppError(
        `Local-app AIConfig route is missing for ${capability}.`,
        'SDK_LOCAL_APP_INPUT_INVALID',
        'provide_ai_config_route',
      );
    }
    const rawParams = config.capabilities.selectedParams?.[capability];
    const rawComponents = config.capabilities.selectedComponents?.[capability] ?? [];
    if (rawComponents.some((selection) => selection.targetRef !== undefined)) {
      return localAppError(
        `Local-app AIConfig components for ${capability} cannot carry Runtime-private target refs.`,
        'SDK_LOCAL_APP_AUTHORITY_FIELD_FORBIDDEN',
        'remove_runtime_private_component_target_refs',
      );
    }
    const selectedComponents = projectLocalAppComponentSelections(
      rawComponents,
      true,
      capability,
    );
    let selectedParams: NimiJsonObject | null = null;
    if (rawParams !== undefined) {
      assertSafeProjection(rawParams);
      assertNoAIConfigPrivateIdentity(rawParams, `AIConfig selectedParams for ${capability}`, true);
      const params = asRecord(rawParams);
      if (!params) {
        return localAppError(
          `Local-app AIConfig selectedParams for ${capability} must be an object.`,
          'SDK_LOCAL_APP_INPUT_INVALID',
          'repair_selected_params',
        );
      }
      selectedParams = { ...params } as NimiJsonObject;
    }
    return {
      capability,
      provider: route.provider,
      logicalModelId,
      routePolicy: route.routePolicy,
      selectedComponents,
      selectedParams,
    };
  });
  if (intents.length === 0 || intents.length !== routeByCapability.size) {
    return localAppError(
      'Local-app AIConfig logical models and routes must cover the same capabilities.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'align_ai_config_routes',
    );
  }
  return projectAIConfigIntents(intents, true);
}

function inputProfileOrigin(origin: NimiAIProfileOriginRef): NimiLocalAppTimestampProfileOrigin {
  const profileId = requireText(origin.profileId, 'profileOrigin.profileId');
  const title = requireText(origin.title, 'profileOrigin.title');
  const milliseconds = Date.parse(origin.appliedAt);
  if (!Number.isFinite(milliseconds)) {
    return localAppError(
      'Local-app AIConfig profileOrigin.appliedAt is invalid.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'repair_profile_origin',
    );
  }
  const seconds = Math.floor(milliseconds / 1_000);
  const nanos = (milliseconds - seconds * 1_000) * 1_000_000;
  return {
    profileId,
    title,
    appliedAt: { seconds: String(seconds), nanos },
  };
}

function projectProfileOrigin(value: unknown): NimiAIProfileOriginRef | null {
  if (value === null || value === undefined) {
    return null;
  }
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['profileId', 'title', 'appliedAt'], 'AIConfig profile origin');
  const appliedAt = projectTimestamp(record.appliedAt, 'profileOrigin.appliedAt');
  if (!appliedAt) {
    return localAppProjectionError('profileOrigin.appliedAt');
  }
  const milliseconds = Number(BigInt(appliedAt.seconds) * 1_000n)
    + Math.floor(appliedAt.nanos / 1_000_000);
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    return localAppProjectionError('profileOrigin.appliedAt');
  }
  return Object.freeze({
    profileId: projectionText(record.profileId, 'profileOrigin.profileId'),
    title: projectionText(record.title, 'profileOrigin.title'),
    appliedAt: date.toISOString(),
  });
}

function projectConfiguration(
  value: unknown,
  allowEmptyRouteOptions = false,
): NimiLocalAppAgentAIConfigProjection {
  const record = asRecord(value);
  assertExactProjectionKeys(record, [
    'capabilities', 'intents', 'readiness', 'configurationRevision', 'routeOptions',
    'scopeOwnerId', 'profileOrigin',
  ], 'configuration');
  if (!Array.isArray(record.capabilities) || !Array.isArray(record.readiness)) localAppProjectionError('configuration');
  const capabilities = record.capabilities.map((entry) => projectionText(entry, 'capability'));
  if (new Set(capabilities).size !== capabilities.length) localAppProjectionError('configuration capabilities');
  const scopeOwnerId = projectionText(record.scopeOwnerId, 'AIConfig scope owner');
  const intents = projectAIConfigIntents(record.intents, false);
  const logicalModelIds = Object.fromEntries(
    intents.map((intent) => [intent.capability, intent.logicalModelId]),
  );
  const selectedParams = Object.fromEntries(
    intents
      .filter((intent) => intent.selectedParams !== undefined)
      .map((intent) => [intent.capability, intent.selectedParams!]),
  );
  const selectedComponents = Object.fromEntries(
    intents
      .filter((intent) => (intent.selectedComponents?.length ?? 0) > 0)
      .map((intent) => [intent.capability, intent.selectedComponents!]),
  );
  return Object.freeze({
    aiConfig: Object.freeze({
      scopeRef: projectNimiRuntimeLocalAgentAIScopeRef(scopeOwnerId),
      capabilities: Object.freeze({
        logicalModelIds: Object.freeze(logicalModelIds),
        targetRefs: Object.freeze({}),
        selectedComponents: Object.freeze(selectedComponents),
        selectedParams: Object.freeze(selectedParams),
      }),
      profileOrigin: projectProfileOrigin(record.profileOrigin),
    }),
    capabilities: Object.freeze(capabilities),
    intents,
    readiness: Object.freeze(record.readiness.map(projectCapabilityReadiness)),
    configurationRevision: positiveRevisionProjection(record.configurationRevision, 'configurationRevision'),
    routeOptions: projectRouteOptions(record.routeOptions, allowEmptyRouteOptions),
  });
}

function projectRouteOptions(
  value: unknown,
  allowEmpty = false,
): readonly NimiLocalAppAgentRouteOption[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) localAppProjectionError('route options');
  const seen = new Set<string>();
  return Object.freeze(value.map((entry) => {
    const record = asRecord(entry);
    assertExactProjectionKeys(record, [
      'capability', 'provider', 'logicalModelId', 'routePolicy', 'label', 'availability',
    ], 'route option');
    const capability = projectionText(record.capability, 'route option capability');
    const provider = canonicalString(record.provider, 'route option provider');
    const logicalModelId = projectionText(record.logicalModelId, 'route option logical model');
    const routePolicy = enumText(record.routePolicy, ['local', 'cloud'], 'route option policy');
    const label = projectionText(record.label, 'route option label');
    const availability = enumText(record.availability, ['ready', 'installed'], 'route option availability');
    const key = `${capability}\u0000${routePolicy}\u0000${provider}\u0000${logicalModelId}`;
    if (seen.has(key) || (routePolicy === 'local' && provider) || (routePolicy === 'cloud' && !provider)) {
      localAppProjectionError('route option');
    }
    seen.add(key);
    return Object.freeze({ capability, provider, logicalModelId, routePolicy, label, availability });
  }));
}

function projectReadiness(value: unknown): NimiLocalAppAgentReadinessProjection {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['capabilities', 'configurationRevision'], 'readiness');
  if (!Array.isArray(record.capabilities)) localAppProjectionError('readiness capabilities');
  return Object.freeze({
    capabilities: Object.freeze(record.capabilities.map(projectCapabilityReadiness)),
    configurationRevision: positiveRevisionProjection(record.configurationRevision, 'configurationRevision'),
  });
}

function projectCapabilityReadiness(value: unknown): NimiLocalAppAgentCapabilityReadiness {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['capability', 'state', 'reason', 'observedAt'], 'capability readiness');
  const observedAt = projectTimestamp(record.observedAt, 'observedAt');
  return Object.freeze({
    capability: projectionText(record.capability, 'capability'),
    state: enumText(
      record.state,
      ['ready', 'blocked', 'unavailable', 'failed', 'configured_unverified'],
      'readiness state',
    ),
    reason: canonicalString(record.reason, 'readiness reason'),
    ...(observedAt ? { observedAt } : {}),
  });
}

function projectAIConfigIntents(value: unknown, input: boolean): readonly NimiLocalAppAgentAIConfigIntent[] {
  if (!Array.isArray(value) || value.length === 0) {
    if (input) return localAppError('Configuration update requires route intents.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_route_intents');
    return localAppProjectionError('route intents');
  }
  const seen = new Set<string>();
  return Object.freeze(value.map((entry) => {
    const record = asRecord(entry);
    assertRequiredAndOptionalKeys(
      record,
      ['capability', 'provider', 'logicalModelId', 'routePolicy', 'selectedParams'],
      ['selectedComponents'],
      'AIConfig intent',
      input,
    );
    if (input) assertNoAuthorityMaterial(record);
    const capability = input ? requireText(record?.capability, 'capability') : projectionText(record?.capability, 'capability');
    const provider = canonicalString(record?.provider, 'provider');
    const logicalModelId = input
      ? requireText(record?.logicalModelId, 'logicalModelId')
      : projectionText(record?.logicalModelId, 'logicalModelId');
    const routePolicy = enumText(record?.routePolicy, ['local', 'cloud'], 'route policy');
    if (seen.has(capability) || (routePolicy === 'local' && provider) || (routePolicy === 'cloud' && !provider)) {
      return input
        ? localAppError('Route intent is not canonical.', 'SDK_LOCAL_APP_INPUT_INVALID', 'repair_route_intent')
        : localAppProjectionError('route intent');
    }
    seen.add(capability);
    let selectedParams: NimiJsonObject | undefined;
    const selectedComponents = projectLocalAppComponentSelections(
      record.selectedComponents,
      input,
      capability,
    );
    if (record.selectedParams !== null && record.selectedParams !== undefined) {
      assertSafeProjection(record.selectedParams);
      assertNoAIConfigPrivateIdentity(record.selectedParams, `AIConfig selectedParams for ${capability}`, input);
      const params = asRecord(record.selectedParams);
      if (!params) {
        return input
          ? localAppError('AIConfig selectedParams must be an object.', 'SDK_LOCAL_APP_INPUT_INVALID', 'repair_selected_params')
          : localAppProjectionError('AIConfig selectedParams');
      }
      selectedParams = Object.freeze({ ...params }) as NimiJsonObject;
    }
    return Object.freeze({
      capability,
      provider,
      logicalModelId,
      routePolicy,
      ...(selectedComponents.length > 0 ? { selectedComponents } : {}),
      ...(selectedParams ? { selectedParams } : {}),
    });
  }));
}

function projectLocalAppComponentSelections(
  value: unknown,
  input: boolean,
  capability: string,
): readonly Omit<NimiAIConfigComponentSelection, 'targetRef'>[] {
  if (value === null || value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    return input
      ? localAppError(
        `AIConfig selectedComponents for ${capability} must be an array.`,
        'SDK_LOCAL_APP_INPUT_INVALID',
        'repair_selected_components',
      )
      : localAppProjectionError('AIConfig selectedComponents');
  }
  const occurrenceIds = new Set<string>();
  const orders = new Set<number>();
  let priorOrder = -1;
  return Object.freeze(value.map((entry, index) => {
    const record = asRecord(entry);
    const keys = [
      'occurrenceId', 'order', 'role', 'componentKind', 'logicalModelId',
      'required', 'weight', 'options',
    ];
    assertRequiredAndOptionalKeys(
      record,
      keys.slice(0, 6),
      keys.slice(6),
      'AIConfig component selection',
      input,
    );
    if (input) assertNoAuthorityMaterial(record);
    const occurrenceId = input
      ? requireText(record.occurrenceId, 'occurrenceId')
      : projectionText(record.occurrenceId, 'occurrenceId');
    const order = nonNegativeInteger(record.order, 'component order');
    const role = input ? requireText(record.role, 'role') : projectionText(record.role, 'role');
    const componentKind = input
      ? requireText(record.componentKind, 'componentKind')
      : projectionText(record.componentKind, 'componentKind');
    const logicalModelId = input
      ? requireText(record.logicalModelId, 'logicalModelId')
      : projectionText(record.logicalModelId, 'logicalModelId');
    if (occurrenceIds.has(occurrenceId) || orders.has(order) || order <= priorOrder ||
        typeof record.required !== 'boolean') {
      return input
        ? localAppError(
          `AIConfig component ${index} for ${capability} is not canonical.`,
          'SDK_LOCAL_APP_INPUT_INVALID',
          'repair_selected_components',
        )
        : localAppProjectionError('AIConfig component selection');
    }
    const weight = record.weight === null || record.weight === undefined
      ? ''
      : canonicalString(record.weight, 'component weight');
    let options: NimiJsonObject | undefined;
    if (record.options !== null && record.options !== undefined) {
      assertSafeProjection(record.options);
      assertNoAIConfigPrivateIdentity(record.options, `AIConfig component ${occurrenceId} options for ${capability}`, input);
      const optionRecord = asRecord(record.options);
      if (!optionRecord) {
        return input
          ? localAppError(
            `AIConfig component ${occurrenceId} options for ${capability} must be an object.`,
            'SDK_LOCAL_APP_INPUT_INVALID',
            'repair_selected_components',
          )
          : localAppProjectionError('AIConfig component selection options');
      }
      options = Object.freeze({ ...optionRecord }) as NimiJsonObject;
    }
    occurrenceIds.add(occurrenceId);
    orders.add(order);
    priorOrder = order;
    return Object.freeze({
      occurrenceId,
      order,
      role,
      componentKind,
      logicalModelId,
      required: record.required,
      ...(weight ? { weight } : {}),
      ...(options ? { options } : {}),
    });
  }));
}

function assertRequiredAndOptionalKeys(
  record: Record<string, unknown> | null | undefined,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  field: string,
  input: boolean,
): asserts record is Record<string, unknown> {
  const expectedKeys = [
    ...requiredKeys,
    ...optionalKeys.filter((key) => Object.hasOwn(record ?? {}, key)),
  ];
  if (input) {
    assertExactKeys(record, expectedKeys, field);
  } else {
    assertExactProjectionKeys(record, expectedKeys, field);
  }
}

function projectAutonomy(value: unknown): NimiLocalAppAgentAutonomyProjection {
  const record = asRecord(value);
  assertExactProjectionKeys(record, [
    'enabled', 'config', 'usedTokensInWindow', 'windowStartedAt', 'budgetExhausted', 'suspendedUntil', 'autonomyRevision',
  ], 'autonomy');
  if (typeof record.enabled !== 'boolean' || typeof record.budgetExhausted !== 'boolean') localAppProjectionError('autonomy');
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
    return localAppError('Autonomy intent is empty.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_autonomy_intent');
  }
  if (record.enabled !== undefined && typeof record.enabled !== 'boolean') localAppError('Autonomy enabled is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_autonomy_enabled');
  return Object.freeze({
    ...(typeof record.enabled === 'boolean' ? { enabled: record.enabled } : {}),
    ...(record.config === undefined ? {} : { config: projectAutonomyConfig(record.config, true) }),
  });
}

function projectAutonomyConfig(value: unknown, input: boolean): NimiLocalAppAgentAutonomyConfig {
  const record = asRecord(value);
  const keys = ['dailyTokenBudget', 'maxTokensPerHook', 'minHookInterval', 'suspendUntil', 'mode'];
  input ? assertExactKeys(record, keys, 'autonomy config') : assertExactProjectionKeys(record, keys, 'autonomy config');
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
  assertExactProjectionKeys(record, ['profile', 'previousProfile', 'defaultVoiceReference', 'presentationRevision'], 'presentation');
  return Object.freeze({
    profile: record.profile === null ? null : projectPresentationProfile(record.profile),
    previousProfile: record.previousProfile === null ? null : projectPresentationProfile(record.previousProfile),
    defaultVoiceReference: canonicalString(record.defaultVoiceReference, 'defaultVoiceReference'),
    presentationRevision: decimalCursor(record.presentationRevision, 'presentationRevision'),
  });
}

function projectPresentationProfile(value: unknown): NimiLocalAppAgentPresentationProfile {
  const record = asRecord(value);
  assertExactProjectionKeys(record, [
    'backendKind', 'avatarAssetRef', 'expressionProfileRef', 'idlePreset', 'interactionPolicyRef',
    'defaultVoiceReference', 'avatarAutoplay', 'backgroundAssetRef', 'revision',
  ], 'presentation profile');
  if (typeof record.avatarAutoplay !== 'boolean') localAppProjectionError('avatarAutoplay');
  return Object.freeze({
    backendKind: enumText(record.backendKind, ['vrm', 'live2d', 'sprite2d', 'canvas2d', 'video'], 'backendKind'),
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
    'backendKind', 'avatarAssetRef', 'expressionProfileRef', 'idlePreset', 'interactionPolicyRef',
    'defaultVoiceReference', 'avatarAutoplay', 'backgroundAssetRef',
  ], 'presentation intent');
  assertNoAuthorityMaterial(record);
  if (typeof record?.avatarAutoplay !== 'boolean') localAppError('Presentation autoplay is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_avatar_autoplay');
  return Object.freeze({
    backendKind: enumText(record?.backendKind, ['vrm', 'live2d', 'sprite2d', 'canvas2d', 'video'], 'backendKind'),
    avatarAssetRef: canonicalString(record?.avatarAssetRef, 'avatarAssetRef'),
    expressionProfileRef: canonicalString(record?.expressionProfileRef, 'expressionProfileRef'),
    idlePreset: canonicalString(record?.idlePreset, 'idlePreset'),
    interactionPolicyRef: canonicalString(record?.interactionPolicyRef, 'interactionPolicyRef'),
    defaultVoiceReference: canonicalString(record?.defaultVoiceReference, 'defaultVoiceReference'),
    avatarAutoplay: record.avatarAutoplay,
    backgroundAssetRef: canonicalString(record?.backgroundAssetRef, 'backgroundAssetRef'),
  });
}

function validatePresentationAssetMaterials(value: unknown): readonly NimiLocalAppAgentPresentationAssetMaterial[] {
  if (!Array.isArray(value) || value.length > 2) {
    return localAppError('Presentation imported assets are invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_imported_presentation_assets');
  }
  const roles = new Set<string>();
  return Object.freeze(value.map((entry) => {
    const record = asRecord(entry);
    assertExactKeys(record, ['role', 'fileName', 'mediaType', 'content', 'sha256'], 'presentation asset material');
    assertNoAuthorityMaterial(record);
    const role = enumText(record?.role, ['avatar', 'background'], 'presentation asset role');
    if (roles.has(role) || !(record?.content instanceof Uint8Array) || record.content.byteLength === 0) {
      return localAppError('Presentation asset material is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_imported_presentation_assets');
    }
    roles.add(role);
    const sha256 = requireText(record.sha256, 'sha256');
    if (!/^[a-f0-9]{64}$/u.test(sha256)) {
      return localAppError('Presentation asset sha256 is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_presentation_asset_sha256');
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
  if (revision === '0') localAppError(`${field} must be positive.`, 'SDK_LOCAL_APP_INPUT_INVALID', `provide_${field}`);
  return revision;
}

function positiveRevisionProjection(value: unknown, field: string): string {
  const revision = decimalCursor(value, field);
  if (revision === '0') localAppProjectionError(field);
  return revision;
}

function enumText<const T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) localAppProjectionError(field);
  return value as T;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
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
    '670': 'AGENT_AI_CONFIG_REVISION_CONFLICT',
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
    'LOCAL_APP_PERMISSION_REQUIRED', 'LOCAL_APP_PERMISSION_DENIED', 'LOCAL_APP_PERMISSION_REVOKED',
    'LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED', 'LOCAL_APP_PERMISSION_UNKNOWN',
    'AGENT_AI_CONFIG_REVISION_CONFLICT', 'AGENT_AUTONOMY_REVISION_CONFLICT',
    'AGENT_PRESENTATION_REVISION_CONFLICT',
    'AGENT_PRESENTATION_ASSET_TYPE_INVALID', 'AGENT_PRESENTATION_ASSET_TOO_LARGE',
    'AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID', 'AGENT_PRESENTATION_ASSET_DEPENDENCY_MISSING',
    'AGENT_PRESENTATION_ASSET_INTEGRITY_MISMATCH', 'AGENT_PRESENTATION_BACKEND_INCOMPATIBLE',
    'AGENT_PRESENTATION_ASSET_NOT_VALIDATED',
  ].includes(candidate) ? candidate as NimiLocalAppConfigureReasonCode : null;
}

function configureErrorCategory(reason: NimiLocalAppConfigureReasonCode): NimiLocalAppConfigureErrorCategory {
  switch (reason) {
    case 'LOCAL_APP_PERMISSION_REQUIRED': return 'not-granted';
    case 'LOCAL_APP_PERMISSION_DENIED': return 'denied';
    case 'LOCAL_APP_PERMISSION_REVOKED': return 'not-granted';
    case 'LOCAL_APP_PERMISSION_RESERVED_NOT_ADMITTED': return 'reserved-not-admitted';
    case 'LOCAL_APP_PERMISSION_UNKNOWN': return 'unknown-permission';
    case 'AGENT_AI_CONFIG_REVISION_CONFLICT': return 'configuration-revision-conflict';
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
    case 'configuration-revision-conflict': return 'refresh_configuration_snapshot';
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
    'permission_id', 'permission_reason', 'permission_admission', 'diagnostic_stage', 'local_development_reason_code',
    'validation_category', 'asset_role', 'media_type', 'backend_kind', 'expected_revision', 'committed_revision',
  ];
  return Object.fromEntries(allowed.flatMap((key) => {
    const text = typeof value[key] === 'string' ? value[key].trim() : '';
    return text && new TextEncoder().encode(text).byteLength <= 2048 ? [[key, text]] : [];
  }));
}
