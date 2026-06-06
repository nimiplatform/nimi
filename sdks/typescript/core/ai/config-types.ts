import type { NimiJsonObject, NimiJsonValue } from '../contracts';

export type NimiAIScopeKind = 'app' | 'module' | 'feature';
export type NimiBuiltInChatSurfaceId = 'nimi' | 'agent';

export interface NimiAIScopeRef {
  readonly kind: NimiAIScopeKind;
  readonly ownerId: string;
  readonly surfaceId?: string;
}

export type NimiAIConfigReadinessPolicy = 'required' | 'optional';
export type NimiAIConfigSliceContractState = 'declared' | 'proposed' | 'unsupported';
export type NimiAIProbeStatus = 'available' | 'unavailable' | 'degraded' | 'unknown';
export type NimiAIConfigApplyOutcome =
  | 'ready_to_apply'
  | 'setup_required_no_live_config'
  | 'unsupported_no_live_config'
  | 'invalid_profile'
  | 'stale_base'
  | 'failed';

export type NimiAISchedulingState =
  | 'runnable'
  | 'queue_required'
  | 'preemption_risk'
  | 'slowdown_risk'
  | 'denied'
  | 'unknown';

export interface NimiAISchedulingOccupancy {
  readonly globalUsed: number;
  readonly globalCap: number;
  readonly appUsed: number;
  readonly appCap: number;
}

export interface NimiAISchedulingResourceHint {
  readonly estimatedVramBytes?: string | number | bigint | null;
  readonly estimatedRamBytes?: string | number | bigint | null;
  readonly estimatedDiskBytes?: string | number | bigint | null;
  readonly engine?: string | null;
}

export interface NimiAISchedulingEvaluationTarget {
  readonly capability: string;
  readonly targetId?: string | null;
  readonly profileId?: string | null;
  readonly resourceHint?: NimiAISchedulingResourceHint | null;
}

export interface NimiAISchedulingTargetInput extends NimiAISchedulingEvaluationTarget {
  readonly targetRef?: NimiAIConfigTargetRef;
}

export interface NimiAISchedulingJudgement {
  readonly state: NimiAISchedulingState;
  readonly detail: string | null;
  readonly occupancy: NimiAISchedulingOccupancy | null;
  readonly resourceWarnings: readonly string[];
}

export interface NimiAISchedulingTargetJudgement {
  readonly target: NimiAISchedulingEvaluationTarget;
  readonly judgement: NimiAISchedulingJudgement;
}

export interface NimiAISchedulingProjection {
  readonly appId: string;
  readonly occupancy: NimiAISchedulingOccupancy | null;
  readonly aggregateJudgement: NimiAISchedulingJudgement | null;
  readonly targetJudgements: readonly NimiAISchedulingTargetJudgement[];
  readonly raw: unknown;
}

export interface NimiAIRuntimeEvidence {
  readonly schedulingJudgement: NimiAISchedulingJudgement | null;
}

export type NimiAIConfigTargetRef =
  | {
    readonly kind: 'profile-slice';
    readonly sourceProfileId: string;
    readonly sliceId: string;
  }
  | {
    readonly kind: 'local-runtime';
    readonly targetId?: string;
    readonly profileId?: string;
    readonly readinessRef?: string;
  }
  | {
    readonly kind: 'cloud-connector';
    readonly connectorId: string;
    readonly providerModelId: string;
    readonly provider?: string;
  };

export interface NimiAIProfileCapabilityIntent {
  readonly targetRef?: NimiAIConfigTargetRef | null;
  readonly params?: NimiJsonValue;
  readonly readinessPolicy?: NimiAIConfigReadinessPolicy;
  readonly contractState?: NimiAIConfigSliceContractState;
  readonly runtimeDescriptor?: NimiRuntimeProfileDescriptorSliceInput;
}

export interface NimiAIProfile {
  readonly profileId: string;
  readonly title: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly capabilities: Readonly<Record<string, NimiAIProfileCapabilityIntent | null | undefined>>;
}

export interface NimiAIConfig {
  readonly scopeRef: NimiAIScopeRef;
  readonly capabilities: {
    readonly targetRefs: Readonly<Record<string, NimiAIConfigTargetRef>>;
    readonly selectedParams: Readonly<Record<string, NimiJsonValue>>;
  };
  readonly profileOrigin: NimiAIProfileOriginRef | null;
}

export interface NimiAIProfileOriginRef {
  readonly profileId: string;
  readonly title: string;
  readonly appliedAt: string;
}

export interface NimiAIConfigSetupProjection {
  readonly outcome: Exclude<NimiAIConfigApplyOutcome, 'ready_to_apply' | 'invalid_profile' | 'stale_base' | 'failed'>;
  readonly blockingCapabilities: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly actionRefs: readonly string[];
}

export interface NimiAIProfileValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface NimiAIConfigFieldDiff {
  readonly path: string;
  readonly changeKind: 'added' | 'removed' | 'changed';
  readonly before: unknown;
  readonly after: unknown;
}

export interface NimiAIConfigDiff {
  readonly identical: boolean;
  readonly fields: readonly NimiAIConfigFieldDiff[];
}

export interface NimiAIProfilePreviewResult {
  readonly before: NimiAIConfig | null;
  readonly after: NimiAIConfig | null;
  readonly outcome: NimiAIConfigApplyOutcome;
  readonly setupProjection?: NimiAIConfigSetupProjection | null;
  readonly diff: NimiAIConfigDiff;
  readonly baseVersion: string;
  readonly probeWarnings: readonly string[];
}

export interface NimiAIProfileApplyResult {
  readonly success: boolean;
  readonly config: NimiAIConfig | null;
  readonly failureReason: string | null;
  readonly outcome: NimiAIConfigApplyOutcome;
  readonly setupProjection?: NimiAIConfigSetupProjection | null;
  readonly probeWarnings: readonly string[];
}

export interface NimiAIProfileApplyOptions {
  readonly expectedBaseVersion?: string;
}

export interface NimiAIConfigProbeResult {
  readonly status: NimiAIProbeStatus;
  readonly capabilityStatuses: Readonly<Record<string, NimiAIProbeStatus>>;
  readonly schedulingJudgement?: NimiAISchedulingJudgement | null;
}

export interface NimiRuntimeProfileDescriptorSliceInput {
  readonly sliceId?: string;
  readonly executionMode?: 'local' | 'cloud_connector';
  readonly contractState?: NimiAIConfigSliceContractState;
  readonly paramsRef?: string;
  readonly execution?: {
    readonly backend: string;
    readonly backendClass?: string;
    readonly backendFamily?: string;
  };
  readonly model?: {
    readonly family: string;
  };
  readonly provider?: string;
  readonly providerCapability?: string;
  readonly modelId?: string;
  readonly credentialPolicy?: string;
  readonly connectorSelector?: string;
  readonly paramsDigest?: string;
  readonly environmentDigest?: string;
}

export interface NimiAICapabilityRequirementSlice {
  readonly requirementSliceId: string;
  readonly capability: string;
  readonly profileSliceRef: string;
  readonly readinessPolicy: NimiAIConfigReadinessPolicy;
  readonly runtimeDescriptor?: NimiRuntimeProfileDescriptorSliceInput;
}

export interface NimiAICapabilityRequirementDeclaration {
  readonly requirementId: string;
  readonly scopeRef: NimiAIScopeRef;
  readonly requiredSlices: readonly NimiAICapabilityRequirementSlice[];
  readonly optionalSlices?: readonly NimiAICapabilityRequirementSlice[];
  readonly setupProjectionPolicy: string;
}

export interface NimiRuntimeProfileDescriptor {
  readonly schemaVersion: 1;
  readonly descriptorId: string;
  readonly profileRef: {
    readonly profileId: string;
    readonly title: string;
  };
  readonly sourceProfileDigest: string;
  readonly projectionOrigin: {
    readonly component: 'sdks.typescript.ai.formRuntimeDescriptor';
    readonly projectedAt: string;
  };
  readonly requirementRefs: readonly string[];
  readonly capabilitySlices: readonly NimiRuntimeProfileDescriptorCapabilitySlice[];
}

export interface NimiRuntimeProfileDescriptorCapabilitySlice {
  readonly sliceId: string;
  readonly capability: string;
  readonly executionMode: 'local' | 'cloud_connector';
  readonly contractState: NimiAIConfigSliceContractState;
  readonly readinessPolicy: NimiAIConfigReadinessPolicy;
  readonly paramsRef: string;
  readonly execution?: {
    readonly backend: string;
    readonly backendClass?: string;
    readonly backendFamily?: string;
  };
  readonly model?: {
    readonly family: string;
  };
  readonly provider?: string;
  readonly providerCapability?: string;
  readonly modelId?: string;
  readonly credentialPolicy?: string;
  readonly connectorSelector?: string;
  readonly paramsDigest?: string;
  readonly environmentDigest?: string;
}

export interface NimiAIConfigEvidence {
  readonly profileOrigin: NimiAIProfileOriginRef | null;
  readonly capabilityBindingKeys: readonly string[];
  readonly configSnapshot: NimiAIConfig;
  readonly configHash: string;
}

export interface NimiAIConversationExecutionSlice {
  readonly executionId: string;
  readonly createdAt: string;
  readonly capability: string;
  readonly selectedTargetRef: NimiAIConfigTargetRef | null;
  readonly resolvedTarget: unknown;
  readonly health: unknown;
  readonly metadata: unknown;
  readonly agentResolution: unknown;
}

export interface NimiAISnapshot {
  readonly executionId: string;
  readonly scopeRef: NimiAIScopeRef;
  readonly configEvidence: NimiAIConfigEvidence;
  readonly conversationCapabilitySlice: NimiAIConversationExecutionSlice;
  readonly runtimeEvidence: NimiAIRuntimeEvidence | null;
  readonly createdAt: string;
}

export interface NimiAIHostStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface NimiAIConfigStoreOptions {
  readonly storage?: () => NimiAIHostStorage | null;
  readonly indexKey?: string;
  readonly configKeyForScope?: (scopeKey: string) => string;
  readonly enableEphemeralStore?: boolean;
}

export interface NimiAISnapshotStoreOptions {
  readonly storage?: () => NimiAIHostStorage | null;
  readonly indexKey?: string;
  readonly snapshotKeyForExecution?: (executionId: string) => string;
  readonly latestKeyForScope?: (scopeKey: string) => string;
  readonly maxSnapshots?: number;
  readonly enableEphemeralStore?: boolean;
}

export interface NimiAIConfigSubscriptionRegistry {
  subscribe(scopeRef: NimiAIScopeRef, callback: (config: NimiAIConfig) => void): () => void;
  notify(config: NimiAIConfig): void;
}

export interface NimiAIConfigStore {
  has(scopeRef: NimiAIScopeRef): boolean;
  load(scopeRef: NimiAIScopeRef): NimiAIConfig;
  loadOrNull(scopeRef: NimiAIScopeRef): NimiAIConfig | null;
  save(config: NimiAIConfig): NimiAIConfig;
  listScopeRefs(): readonly NimiAIScopeRef[];
}

export interface NimiAISnapshotStore {
  record(snapshot: NimiAISnapshot): NimiAISnapshot;
  get(executionId: string): NimiAISnapshot | null;
  getLatest(scopeRef: NimiAIScopeRef): NimiAISnapshot | null;
}

export interface NimiAIHostSurface {
  readonly aiProfile: {
    list(): Promise<readonly NimiAIProfile[]>;
    get(profileId: string): Promise<NimiAIProfile | null>;
    validate(profile: NimiAIProfile): NimiAIProfileValidationResult;
    previewApply(scopeRef: NimiAIScopeRef, profileId: string): Promise<NimiAIProfilePreviewResult>;
    apply(scopeRef: NimiAIScopeRef, profileId: string, options?: NimiAIProfileApplyOptions): Promise<NimiAIProfileApplyResult>;
    formRuntimeDescriptor(input: {
      readonly profileId: string;
      readonly requirementDeclarations: readonly NimiAICapabilityRequirementDeclaration[];
      readonly descriptorId: string;
      readonly sourceProfileDigest: string;
      readonly projectedAt?: string;
    }): Promise<NimiRuntimeProfileDescriptor>;
  };
  readonly aiConfig: {
    get(scopeRef: NimiAIScopeRef): NimiAIConfig;
    update(scopeRef: NimiAIScopeRef, config: NimiAIConfig): NimiAIConfig;
    listScopes(): readonly NimiAIScopeRef[];
    subscribe(scopeRef: NimiAIScopeRef, callback: (config: NimiAIConfig) => void): () => void;
  };
  readonly aiSnapshot: {
    record(scopeRef: NimiAIScopeRef, snapshot: NimiAISnapshot): NimiAISnapshot;
    get(executionId: string): NimiAISnapshot | null;
    getLatest(scopeRef: NimiAIScopeRef): NimiAISnapshot | null;
  };
}

export interface CreateNimiAIHostSurfaceOptions {
  readonly profiles: readonly NimiAIProfile[];
  readonly configStore: NimiAIConfigStore;
  readonly snapshotStore?: NimiAISnapshotStore;
  readonly subscriptions?: NimiAIConfigSubscriptionRegistry;
  readonly now?: () => string;
}

export interface NimiAIProfileParseOptions {
  readonly label?: string;
  readonly allowMissingOptionalFields?: boolean;
}

export type NimiAccountProfileLibraryOrigin = 'account-default' | 'user' | 'imported';

export interface NimiAccountProfileLibraryProfile {
  readonly profileId: string;
  readonly origin: Exclude<NimiAccountProfileLibraryOrigin, 'account-default'>;
  readonly editable: boolean;
  readonly removable: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly profile: NimiAIProfile;
}

export interface NimiAccountProfileLibraryIndexEntry {
  readonly profileId: string;
  readonly title: string;
  readonly origin: NimiAccountProfileLibraryOrigin;
  readonly relativePath: string;
  readonly editable: boolean;
  readonly removable: boolean;
  readonly updatedAt: string;
}

export interface NimiAccountProfileLibraryProjection {
  readonly accountId: string;
  readonly libraryRef: string;
  readonly index: {
    readonly schemaVersion: number;
    readonly accountId: string;
    readonly updatedAt: string;
    readonly entries: readonly NimiAccountProfileLibraryIndexEntry[];
  };
  readonly profiles: readonly NimiAccountProfileLibraryProfile[];
}

export type NimiAppFirstLaunchProfileSource = 'recommended-profile' | 'account-default-profile';

export interface NimiAppManifestRequirementGap {
  readonly requirementId: string;
  readonly detail: string;
}

export interface NimiAppAIConfigSetupRepairPlan {
  readonly unmetRequirements: readonly NimiAppManifestRequirementGap[];
  readonly setupProjection?: NimiAIConfigSetupProjection | null;
}

export type NimiAppFirstLaunchAIConfigResult =
  | {
    readonly outcome: 'initialized';
    readonly scopeRef: NimiAIScopeRef;
    readonly config: NimiAIConfig;
    readonly profileSource: NimiAppFirstLaunchProfileSource;
    readonly profileId: string;
    readonly setupRepairPlan: NimiAppAIConfigSetupRepairPlan | null;
  }
  | {
    readonly outcome: 'already-initialized';
    readonly scopeRef: NimiAIScopeRef;
    readonly config: NimiAIConfig;
  }
  | {
    readonly outcome: 'setup-required-no-live-config';
    readonly scopeRef: NimiAIScopeRef;
    readonly config: null;
    readonly profileSource: NimiAppFirstLaunchProfileSource;
    readonly profileId: string;
    readonly setupRepairPlan: NimiAppAIConfigSetupRepairPlan;
  };

export interface NimiResolvedRecommendedAIProfile {
  readonly profile: NimiAIProfile;
  readonly manifestSatisfied: boolean;
}

type Awaitable<T> = T | Promise<T>;

export interface NimiEnsureAppFirstLaunchAIConfigOptions {
  readonly scopeRef: NimiAIScopeRef;
  readonly getExistingAppAIConfig: (scopeRef: NimiAIScopeRef) => Awaitable<NimiAIConfig | null>;
  readonly resolveRecommendedProfile: (scopeRef: NimiAIScopeRef) => Awaitable<NimiResolvedRecommendedAIProfile | null>;
  readonly resolveAccountDefaultProfile: () => Awaitable<NimiAIProfile | null>;
  readonly applyHostAIConfig: (scopeRef: NimiAIScopeRef, config: NimiAIConfig) => Awaitable<NimiAIConfig>;
  readonly validateManifestRequirements?: (
    scopeRef: NimiAIScopeRef,
    config: NimiAIConfig,
  ) => Awaitable<readonly NimiAppManifestRequirementGap[]>;
  readonly now?: () => string;
}
