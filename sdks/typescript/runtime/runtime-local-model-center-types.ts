import type {
  RuntimeTypedCallOptions,
  RuntimeTypedClient,
} from '../core-generated/runtime-typed-client';
import type { JsonObject } from '../types';
import type {
  NimiRuntimeLocalAssetDeclaration,
  NimiRuntimeLocalAssetKindId,
  NimiRuntimeLocalAssetStatusId,
  NimiRuntimeLocalEngineRuntimeModeId,
  NimiRuntimeLocalProfileEntryKindId,
  NimiRuntimeLocalRunnableAssetKindId,
} from './local-asset-vocabulary';
import type {
  NimiRuntimeLocalCatalogRecommendation,
  NimiRuntimeLocalRecommendationFeed,
} from './runtime-local-recommendation';
import type {
  NimiRuntimeLocalProfileDescriptor,
  NimiRuntimeLocalProfileEntryDescriptor,
  NimiRuntimeLocalProfileEntryOverride,
  NimiRuntimeLocalProfileRequirementDescriptor,
} from './runtime-local-profile-manifest';

export type NimiRuntimeLocalAssetKind = NimiRuntimeLocalAssetKindId;
export type NimiRuntimeLocalAssetStatus = NimiRuntimeLocalAssetStatusId;
export type NimiRuntimeLocalCapabilityToken = NimiRuntimeLocalRunnableAssetKindId | string;
export type NimiRuntimeLocalIntegrityMode = 'verified' | 'local_unverified';
export type NimiRuntimeLocalDownloadState = 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';
export type NimiRuntimeLocalTransferSessionKind = 'download' | 'import' | string;
export type NimiRuntimeLocalSuggestionSource =
  | 'manifest'
  | 'folder'
  | 'download-metadata'
  | 'filename'
  | 'unknown'
  | string;
export type NimiRuntimeLocalSuggestionConfidence = 'high' | 'low' | string;
export type NimiRuntimeLocalExecutionEntryKindId = 'model' | 'service' | 'node';

export interface NimiRuntimeLocalProviderHints {
  readonly llama?: {
    readonly backend: string;
    readonly preferredAdapter: string;
    readonly multimodalProjector?: string;
  };
  readonly media?: {
    readonly backend: string;
    readonly preferredAdapter: string;
    readonly family?: string;
    readonly imageDriver?: string;
    readonly videoDriver?: string;
    readonly device?: string;
    readonly fallbackDriver?: string;
    readonly fallbackReason?: string;
    readonly policyGate?: string;
  };
  readonly speech?: {
    readonly backend: string;
    readonly preferredAdapter: string;
    readonly family?: string;
    readonly driver?: string;
    readonly device?: string;
    readonly voiceWorkflowDriver?: string;
    readonly policyGate?: string;
  };
  readonly sidecar?: {
    readonly preferredAdapter: string;
    readonly backend: string;
  };
  readonly extra?: Record<string, string>;
}

export interface NimiRuntimeLocalAssetRecord {
  readonly localAssetId: string;
  readonly assetId: string;
  readonly kind: NimiRuntimeLocalAssetKind;
  readonly engine: string;
  readonly engineRuntimeMode?: NimiRuntimeLocalEngineRuntimeModeId;
  readonly endpoint?: string;
  readonly entry: string;
  readonly files: readonly string[];
  readonly license: string;
  readonly source: {
    readonly repo: string;
    readonly revision: string;
  };
  readonly integrityMode: NimiRuntimeLocalIntegrityMode;
  readonly hashes: Record<string, string>;
  readonly status: NimiRuntimeLocalAssetStatus;
  readonly installedAt: string;
  readonly updatedAt: string;
  readonly reasonCode?: string;
  readonly capabilities?: readonly string[];
  readonly logicalModelId?: string;
  readonly family?: string;
  readonly artifactRoles?: readonly string[];
  readonly preferredEngine?: string;
  readonly fallbackEngines?: readonly string[];
  readonly engineConfig?: JsonObject;
  readonly recommendation?: NimiRuntimeLocalCatalogRecommendation;
  readonly metadata?: JsonObject;
}

export interface NimiRuntimeLocalVerifiedAssetDescriptor {
  readonly templateId: string;
  readonly title: string;
  readonly description: string;
  readonly installKind?: string;
  readonly assetId: string;
  readonly kind: NimiRuntimeLocalAssetKind;
  readonly logicalModelId?: string;
  readonly repo: string;
  readonly revision: string;
  readonly capabilities?: readonly string[];
  readonly engine: string;
  readonly entry: string;
  readonly files: readonly string[];
  readonly license: string;
  readonly hashes: Record<string, string>;
  readonly endpoint?: string;
  readonly fileCount: number;
  readonly totalSizeBytes?: number;
  readonly tags: readonly string[];
  readonly artifactRoles?: readonly string[];
  readonly preferredEngine?: string;
  readonly fallbackEngines?: readonly string[];
  readonly engineConfig?: JsonObject;
  readonly metadata?: JsonObject;
}

export interface NimiRuntimeLocalCatalogItemDescriptor {
  readonly itemId: string;
  readonly source: 'verified' | 'huggingface' | string;
  readonly title: string;
  readonly description: string;
  readonly modelId: string;
  readonly repo: string;
  readonly revision: string;
  readonly templateId?: string;
  readonly capabilities: readonly NimiRuntimeLocalCapabilityToken[];
  readonly engine: string;
  readonly engineRuntimeMode: NimiRuntimeLocalEngineRuntimeModeId;
  readonly installKind: string;
  readonly installAvailable: boolean;
  readonly endpoint?: string;
  readonly providerHints?: NimiRuntimeLocalProviderHints;
  readonly entry?: string;
  readonly files: readonly string[];
  readonly license?: string;
  readonly hashes: Record<string, string>;
  readonly tags: readonly string[];
  readonly downloads?: number;
  readonly likes?: number;
  readonly lastModified?: string;
  readonly verified: boolean;
  readonly engineConfig?: JsonObject;
  readonly recommendation?: NimiRuntimeLocalCatalogRecommendation;
}

export interface NimiRuntimeLocalCatalogVariantDescriptor {
  readonly filename: string;
  readonly entry: string;
  readonly files: readonly string[];
  readonly format?: string;
  readonly sizeBytes?: number;
  readonly sha256?: string;
  readonly recommendation?: NimiRuntimeLocalCatalogRecommendation;
}

export interface NimiRuntimeLocalInstallPlanDescriptor {
  readonly planId: string;
  readonly itemId: string;
  readonly source: 'verified' | 'huggingface' | string;
  readonly templateId?: string;
  readonly modelId: string;
  readonly repo: string;
  readonly revision: string;
  readonly capabilities: readonly NimiRuntimeLocalCapabilityToken[];
  readonly engine: string;
  readonly engineRuntimeMode: NimiRuntimeLocalEngineRuntimeModeId;
  readonly installKind: string;
  readonly installAvailable: boolean;
  readonly endpoint: string;
  readonly providerHints?: NimiRuntimeLocalProviderHints;
  readonly entry: string;
  readonly files: readonly string[];
  readonly license: string;
  readonly hashes: Record<string, string>;
  readonly warnings: readonly string[];
  readonly reasonCode?: string;
  readonly engineConfig?: JsonObject;
}

export interface NimiRuntimeLocalInstallPayload {
  readonly modelId: string;
  readonly kind: NimiRuntimeLocalAssetKind;
  readonly repo: string;
  readonly revision?: string;
  readonly capabilities?: readonly string[];
  readonly engine?: string;
  readonly entry?: string;
  readonly files?: readonly string[];
  readonly license?: string;
  readonly hashes?: Record<string, string>;
  readonly endpoint?: string;
  readonly engineConfig?: JsonObject;
}

export interface NimiRuntimeLocalDeviceProfile {
  readonly os: string;
  readonly arch: string;
  readonly totalRamBytes: number;
  readonly availableRamBytes: number;
  readonly diskFreeBytes: number;
  readonly ports: readonly {
    readonly port: number;
    readonly available: boolean;
  }[];
  readonly gpu: {
    readonly available: boolean;
    readonly vendor: string;
    readonly model: string;
    readonly totalVramBytes: number;
    readonly availableVramBytes: number;
    readonly memoryModel?: 'discrete' | 'unified';
  };
  readonly python: {
    readonly available: boolean;
    readonly version: string;
  };
  readonly npu: {
    readonly available: boolean;
    readonly ready: boolean;
    readonly vendor: string;
    readonly runtime: string;
    readonly detail: string;
  };
}

export interface NimiRuntimeLocalExecutionEntryDescriptor {
  readonly entryId: string;
  readonly kind: NimiRuntimeLocalExecutionEntryKindId;
  readonly capability: string;
  readonly required: boolean;
  readonly selected: boolean;
  readonly preferred: boolean;
  readonly modelId?: string;
  readonly repo?: string;
  readonly engine?: string;
  readonly serviceId?: string;
  readonly nodeId?: string;
  readonly reasonCode?: string;
  readonly warnings: readonly string[];
}

export interface NimiRuntimeLocalPreflightDecision {
  readonly entryId: string;
  readonly target: string;
  readonly check: string;
  readonly ok: boolean;
  readonly reasonCode?: string;
  readonly detail?: string;
}

export interface NimiRuntimeLocalExecutionStageResult {
  readonly stage: string;
  readonly ok: boolean;
  readonly reasonCode?: string;
  readonly detail?: string;
}

export interface NimiRuntimeLocalExecutionPlan {
  readonly planId: string;
  readonly targetId: string;
  readonly capability?: string;
  readonly deviceProfile: NimiRuntimeLocalDeviceProfile;
  readonly entries: readonly NimiRuntimeLocalExecutionEntryDescriptor[];
  readonly preflightDecisions: readonly NimiRuntimeLocalPreflightDecision[];
  readonly warnings: readonly string[];
  readonly reasonCode?: string;
}

export interface NimiRuntimeLocalExecutionApplyResult {
  readonly planId: string;
  readonly targetId: string;
  readonly entries: readonly NimiRuntimeLocalExecutionEntryDescriptor[];
  readonly installedAssets: readonly NimiRuntimeLocalAssetRecord[];
  readonly capabilities: readonly string[];
  readonly stageResults: readonly NimiRuntimeLocalExecutionStageResult[];
  readonly preflightDecisions: readonly NimiRuntimeLocalPreflightDecision[];
  readonly rollbackApplied: boolean;
  readonly warnings: readonly string[];
  readonly reasonCode?: string;
}

export interface NimiRuntimeLocalProfileResolutionPlan {
  readonly planId: string;
  readonly targetId: string;
  readonly profileId: string;
  readonly title: string;
  readonly description?: string;
  readonly recommended: boolean;
  readonly consumeCapabilities: readonly string[];
  readonly requirements?: NimiRuntimeLocalProfileRequirementDescriptor;
  readonly executionPlan: NimiRuntimeLocalExecutionPlan;
  readonly warnings: readonly string[];
  readonly reasonCode?: string;
}

export interface NimiRuntimeLocalProfileApplyResult {
  readonly planId: string;
  readonly targetId: string;
  readonly profileId: string;
  readonly executionResult: NimiRuntimeLocalExecutionApplyResult;
  readonly installedAssets: readonly NimiRuntimeLocalAssetRecord[];
  readonly warnings: readonly string[];
  readonly reasonCode?: string;
}

export interface NimiRuntimeLocalTransferProgressEvent {
  readonly installSessionId: string;
  readonly modelId: string;
  readonly localModelId?: string;
  readonly localAssetId?: string;
  readonly sessionKind: NimiRuntimeLocalTransferSessionKind;
  readonly phase: string;
  readonly bytesReceived: number;
  readonly bytesTotal?: number;
  readonly speedBytesPerSec?: number;
  readonly etaSeconds?: number;
  readonly message?: string;
  readonly state: NimiRuntimeLocalDownloadState;
  readonly reasonCode?: string;
  readonly retryable?: boolean;
  readonly done: boolean;
  readonly success: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface NimiRuntimeLocalTransferSessionSummary {
  readonly installSessionId: string;
  readonly modelId: string;
  readonly localModelId: string;
  readonly localAssetId: string;
  readonly sessionKind: NimiRuntimeLocalTransferSessionKind;
  readonly phase: string;
  readonly state: NimiRuntimeLocalDownloadState;
  readonly bytesReceived: number;
  readonly bytesTotal?: number;
  readonly speedBytesPerSec?: number;
  readonly etaSeconds?: number;
  readonly message?: string;
  readonly reasonCode?: string;
  readonly retryable: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NimiRuntimeLocalTransferAccepted {
  readonly installSessionId: string;
  readonly modelId: string;
  readonly localModelId: string;
  readonly localAssetId: string;
}

export interface NimiRuntimeLocalEnvironmentPlanDependency {
  readonly dependencyFamily: string;
  readonly dependencyId: string;
  readonly consumerScope: string;
  readonly required: boolean;
  readonly state: string;
  readonly sourceKind: string;
  readonly confirmationRequired: boolean;
  readonly selectedSourceRecordId?: string;
  readonly environmentKey: string;
  readonly canonicalRoot?: string;
  readonly reasonCode?: string;
  readonly detail?: string;
}

export interface NimiRuntimeLocalEnvironmentPlan {
  readonly planId: string;
  readonly packId: string;
  readonly productLabel: string;
  readonly hostProfileId: string;
  readonly platformTuple: string;
  readonly runtimeDataRoot: string;
  readonly consumerScope: string;
  readonly cloudOnlyImpact: string;
  readonly state: string;
  readonly reasonCode?: string;
  readonly dependencies: readonly NimiRuntimeLocalEnvironmentPlanDependency[];
}

export interface NimiRuntimeLocalEnvironmentDependencyJob {
  readonly jobId: string;
  readonly environmentKey: string;
  readonly dependencyFamily: string;
  readonly dependencyId: string;
  readonly consumerScope: string;
  readonly state: string;
  readonly sourceKind: string;
  readonly canonicalRoot?: string;
  readonly selectedSourceRecordId?: string;
  readonly failureDetail?: string;
  readonly retryable: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly reasonCode?: string;
  readonly recoveryDisposition?: string;
  readonly bytesReceived: number;
  readonly bytesTotal: number;
  readonly percent: number;
  readonly speedBytesPerSec: number;
  readonly etaSeconds: number;
}

export interface NimiRuntimeLocalUnregisteredAssetDescriptor {
  readonly filename: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly declaration?: NimiRuntimeLocalAssetDeclaration;
  readonly suggestionSource: NimiRuntimeLocalSuggestionSource;
  readonly confidence: NimiRuntimeLocalSuggestionConfidence;
  readonly autoImportable: boolean;
  readonly requiresManualReview: boolean;
  readonly folderName?: string;
}

export interface NimiRuntimeLocalSnapshot {
  readonly assets: readonly NimiRuntimeLocalAssetRecord[];
  readonly generatedAt: string;
}

export interface NimiRuntimeLocalListAssetsInput {
  readonly status?: NimiRuntimeLocalAssetStatus | string | null;
  readonly kind?: NimiRuntimeLocalAssetKind | string | null;
  readonly engine?: string | null;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

export interface NimiRuntimeLocalCatalogSearchInput {
  readonly query?: string;
  readonly capability?: NimiRuntimeLocalCapabilityToken;
  readonly limit?: number;
}

export interface NimiRuntimeLocalResolveInstallPlanInput {
  readonly itemId?: string;
  readonly source?: 'verified' | 'huggingface' | string;
  readonly templateId?: string;
  readonly modelId?: string;
  readonly repo?: string;
  readonly revision?: string;
  readonly capabilities?: readonly NimiRuntimeLocalCapabilityToken[];
  readonly engine?: string;
  readonly entry?: string;
  readonly files?: readonly string[];
  readonly license?: string;
  readonly hashes?: Record<string, string>;
  readonly endpoint?: string;
  readonly engineConfig?: JsonObject;
}

export interface NimiRuntimeLocalEnvironmentPlanInput {
  readonly packId: string;
  readonly consumerScope?: string;
  readonly runtimeDataRoot?: string;
  readonly assetId?: string;
  readonly localAssetId?: string;
  readonly companionAssetId?: string;
  readonly parentAssetId?: string;
  readonly installLevel?: string;
}

export interface NimiRuntimeLocalImageNativeAssetInput {
  readonly assetId?: string;
  readonly localAssetId?: string;
}

export type NimiRuntimeLocalImageNativeEnvironmentPlanInput = Omit<NimiRuntimeLocalEnvironmentPlanInput, 'consumerScope'> & {
  readonly packId: 'local-image-native';
  readonly consumerScope?: never;
};

export interface NimiRuntimeLocalImageNativeEnvironmentPlanRuntime {
  readonly resolveEnvironmentPlan: (input: NimiRuntimeLocalEnvironmentPlanInput) => Promise<NimiRuntimeLocalEnvironmentPlan>;
}

export interface NimiRuntimeLocalWriteOptions {
  readonly caller?: 'core' | 'builtin' | 'injected' | 'sideload' | string;
  readonly callOptions?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeLocalModelCenterClientOptions {
  readonly local: NimiRuntimeLocalModelCenterRpc | (() => NimiRuntimeLocalModelCenterRpc);
  readonly callOptions?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeLocalTransferWatchOptions {
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly onError?: (error: unknown) => void;
}

export type NimiRuntimeLocalModelCenterRpc = Pick<
  RuntimeTypedClient,
  | 'listLocalAssets'
  | 'removeLocalAsset'
  | 'startLocalAsset'
  | 'stopLocalAsset'
  | 'listVerifiedAssets'
  | 'searchCatalogModels'
  | 'listCatalogVariants'
  | 'getRecommendationFeed'
  | 'resolveModelInstallPlan'
  | 'installModelFromPlan'
  | 'installVerifiedAsset'
  | 'importLocalAsset'
  | 'importLocalAssetFile'
  | 'importLocalAssetBundle'
  | 'rescanLocalAssetBundle'
  | 'listLocalTransfers'
  | 'pauseLocalTransfer'
  | 'resumeLocalTransfer'
  | 'cancelLocalTransfer'
  | 'watchLocalTransfers'
  | 'collectDeviceProfile'
  | 'scanUnregisteredAssets'
  | 'scaffoldOrphanAsset'
  | 'resolveProfile'
  | 'applyProfile'
  | 'resolveLocalEnvironmentPlan'
  | 'listLocalEnvironmentDependencyJobs'
  | 'startLocalEnvironmentDependencyJob'
  | 'cancelLocalEnvironmentDependencyJob'
  | 'retryLocalEnvironmentDependencyJob'
  | 'repairLocalEnvironmentDependency'
>;

export interface NimiRuntimeLocalModelCenterClient {
  listAssets(input?: NimiRuntimeLocalListAssetsInput): Promise<readonly NimiRuntimeLocalAssetRecord[]>;
  listVerifiedAssets(input?: {
    readonly kind?: NimiRuntimeLocalAssetKind | string | null;
    readonly engine?: string | null;
    readonly pageSize?: number;
    readonly maxPages?: number;
  }): Promise<readonly NimiRuntimeLocalVerifiedAssetDescriptor[]>;
  snapshot(input?: NimiRuntimeLocalListAssetsInput): Promise<NimiRuntimeLocalSnapshot>;
  searchCatalog(input?: NimiRuntimeLocalCatalogSearchInput): Promise<readonly NimiRuntimeLocalCatalogItemDescriptor[]>;
  listCatalogVariants(repo: string): Promise<readonly NimiRuntimeLocalCatalogVariantDescriptor[]>;
  resolveInstallPlan(input: NimiRuntimeLocalResolveInstallPlanInput): Promise<NimiRuntimeLocalInstallPlanDescriptor>;
  install(plan: NimiRuntimeLocalInstallPlanDescriptor, options?: NimiRuntimeLocalWriteOptions):
    Promise<NimiRuntimeLocalAssetRecord>;
  installVerifiedAsset(input: { readonly templateId: string; readonly endpoint?: string }, options?: NimiRuntimeLocalWriteOptions):
    Promise<NimiRuntimeLocalAssetRecord>;
  importAsset(input: { readonly manifestPath: string; readonly endpoint?: string; readonly engineConfig?: JsonObject }, options?: NimiRuntimeLocalWriteOptions):
    Promise<NimiRuntimeLocalAssetRecord>;
  importAssetManifest(manifestPath: string, options?: NimiRuntimeLocalWriteOptions & { readonly endpoint?: string }):
    Promise<{ readonly asset: NimiRuntimeLocalAssetRecord }>;
  importAssetFile(input: {
    readonly filePath: string;
    readonly declaration: NimiRuntimeLocalAssetDeclaration;
    readonly assetName?: string;
    readonly endpoint?: string;
  }, options?: NimiRuntimeLocalWriteOptions): Promise<{ readonly asset: NimiRuntimeLocalAssetRecord }>;
  importFile(input: {
    readonly filePath: string;
    readonly assetName?: string;
    readonly kind: NimiRuntimeLocalAssetKind;
    readonly engine?: string;
    readonly endpoint?: string;
  }, options?: NimiRuntimeLocalWriteOptions): Promise<NimiRuntimeLocalAssetRecord>;
  importBundle(input: {
    readonly directoryPath: string;
    readonly modelName?: string;
    readonly capabilities?: readonly string[];
    readonly engine?: string;
    readonly endpoint?: string;
    /** Explicit ordered sharded-resource entries; empty keeps single-entry identity. */
    readonly orderedBundleEntries?: readonly string[];
  }, options?: NimiRuntimeLocalWriteOptions): Promise<NimiRuntimeLocalTransferAccepted>;
  rescanBundle(input: { readonly localAssetId: string }, options?: NimiRuntimeLocalWriteOptions):
    Promise<NimiRuntimeLocalTransferAccepted>;
  remove(localAssetId: string, options?: NimiRuntimeLocalWriteOptions): Promise<NimiRuntimeLocalAssetRecord>;
  start(localAssetId: string, options?: NimiRuntimeLocalWriteOptions): Promise<NimiRuntimeLocalAssetRecord>;
  stop(localAssetId: string, options?: NimiRuntimeLocalWriteOptions): Promise<NimiRuntimeLocalAssetRecord>;
  listTransfers(): Promise<readonly NimiRuntimeLocalTransferSessionSummary[]>;
  pauseTransfer(installSessionId: string, options?: NimiRuntimeLocalWriteOptions):
    Promise<NimiRuntimeLocalTransferSessionSummary>;
  resumeTransfer(installSessionId: string, options?: NimiRuntimeLocalWriteOptions):
    Promise<NimiRuntimeLocalTransferSessionSummary>;
  cancelTransfer(installSessionId: string, options?: NimiRuntimeLocalWriteOptions):
    Promise<NimiRuntimeLocalTransferSessionSummary>;
  watchTransferProgress(
    listener: (event: NimiRuntimeLocalTransferProgressEvent) => void,
    options?: NimiRuntimeLocalTransferWatchOptions,
  ): Promise<() => void>;
  collectDeviceProfile(input?: { readonly extraPorts?: readonly number[] }): Promise<NimiRuntimeLocalDeviceProfile>;
  getRecommendationFeed(input?: {
    readonly capability?: string;
    readonly pageSize?: number;
  }): Promise<NimiRuntimeLocalRecommendationFeed<NimiRuntimeLocalDeviceProfile>>;
  resolveProfile(input: {
    readonly targetId: string;
    readonly profile: NimiRuntimeLocalProfileDescriptor;
    readonly capability?: string;
    readonly deviceProfile?: NimiRuntimeLocalDeviceProfile;
    readonly entryOverrides?: readonly NimiRuntimeLocalProfileEntryOverride[];
  }): Promise<NimiRuntimeLocalProfileResolutionPlan>;
  applyProfile(plan: NimiRuntimeLocalProfileResolutionPlan, options?: NimiRuntimeLocalWriteOptions):
    Promise<NimiRuntimeLocalProfileApplyResult>;
  resolveEnvironmentPlan(input: NimiRuntimeLocalEnvironmentPlanInput): Promise<NimiRuntimeLocalEnvironmentPlan>;
  listEnvironmentDependencyJobs(input?: { readonly environmentKey?: string; readonly state?: string }):
    Promise<readonly NimiRuntimeLocalEnvironmentDependencyJob[]>;
  startEnvironmentDependencyJob(input: {
    readonly environmentKey: string;
    readonly dependencyFamily: string;
    readonly dependencyId: string;
    readonly sourceKind: string;
    readonly confirmed: boolean;
    readonly consumerScope: string;
  }, options?: NimiRuntimeLocalWriteOptions): Promise<NimiRuntimeLocalEnvironmentDependencyJob>;
  cancelEnvironmentDependencyJob(input: { readonly jobId: string }, options?: NimiRuntimeLocalWriteOptions):
    Promise<NimiRuntimeLocalEnvironmentDependencyJob>;
  retryEnvironmentDependencyJob(input: { readonly jobId: string; readonly confirmed: boolean }, options?: NimiRuntimeLocalWriteOptions):
    Promise<NimiRuntimeLocalEnvironmentDependencyJob>;
  repairEnvironmentDependency(input: {
    readonly environmentKey: string;
    readonly dependencyFamily: string;
    readonly dependencyId: string;
    readonly confirmed: boolean;
    readonly reasonCode?: string;
    readonly consumerScope: string;
  }, options?: NimiRuntimeLocalWriteOptions): Promise<NimiRuntimeLocalEnvironmentDependencyJob>;
  scanUnregisteredAssets(): Promise<readonly NimiRuntimeLocalUnregisteredAssetDescriptor[]>;
  scaffoldOrphanAsset(input: {
    readonly path: string;
    readonly kind: NimiRuntimeLocalAssetKind;
    readonly engine?: string;
    readonly endpoint?: string;
  }, options?: NimiRuntimeLocalWriteOptions): Promise<NimiRuntimeLocalAssetRecord>;
}
