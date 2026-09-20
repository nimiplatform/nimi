import type {
  RuntimeTypedCallOptions,
  RuntimeTypedClient,
} from '../core-generated/runtime-typed-client';
import type { JsonObject } from '../types';
import type {
  NimiRuntimeLocalAssetKindId,
  NimiRuntimeLocalEngineRuntimeModeId,
  NimiRuntimeLocalRunnableAssetKindId,
} from './local-asset-vocabulary';
import type {
  NimiRuntimeFactoryProfileRecommendation,
  NimiRuntimeFeaturedModelAssets,
  NimiRuntimeModelAssetCatalogSearchResult,
  NimiRuntimeModelAssetMarketCandidate,
} from './runtime-local-recommendation';

export type NimiRuntimeLocalAssetKind = NimiRuntimeLocalAssetKindId;
export type NimiRuntimeLocalCapabilityToken = NimiRuntimeLocalRunnableAssetKindId | string;
export type NimiRuntimeLocalDownloadState = 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';
export type NimiRuntimeLocalTransferSessionKind = 'download' | 'import' | string;
/**
 * Whether a completed acquisition created a new ModelAsset or committed a
 * reuse of the existing equivalent distribution. Undefined until committed.
 */
export type NimiRuntimeLocalTransferDisposition = 'created' | 'reused';
/**
 * Runtime-projected control actions valid for a transfer right now. Only
 * these are rendered; every invocation re-authorizes and re-checks state.
 */
export type NimiRuntimeLocalTransferAction = 'pause' | 'resume' | 'cancel' | 'reimport' | 'check_sync' | 'view_related_transfer';

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

export type NimiRuntimeModelAssetCatalogVerification = 'matched' | 'not_matched' | 'unknown';

export interface NimiRuntimeModelAssetFile {
  readonly relativePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly nonExecutableContent: boolean;
}

export interface NimiRuntimeModelAssetRecord {
  readonly modelAssetId: string;
  readonly contentId: string;
  readonly displayName: string;
  readonly entry: string;
  readonly files: readonly NimiRuntimeModelAssetFile[];
  readonly totalSizeBytes: number;
  readonly contentVerified: true;
  readonly catalogVerification: NimiRuntimeModelAssetCatalogVerification;
  readonly catalogVerified: boolean;
  readonly unclassified: boolean;
  readonly boundedFingerprint?: JsonObject;
  readonly provenance?: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly latestIntegrityCheckedAt: string;
  readonly duplicateContent: boolean;
  readonly containsNonExecutableCode: boolean;
}

export interface NimiRuntimeModelAssetRemovalInspection {
  readonly asset: NimiRuntimeModelAssetRecord;
  readonly referencingLoadoutIds: readonly string[];
  readonly confirmationRequired: boolean;
}

export interface NimiRuntimeModelAssetRemovalResult extends NimiRuntimeModelAssetRemovalInspection {
  readonly cleanupPending: boolean;
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
  readonly contentId: string;
  readonly tags: readonly string[];
	readonly artifactRoles?: readonly string[];
	readonly preferredEngine?: string;
	readonly engineConfig?: JsonObject;
  readonly metadata?: JsonObject;
}

export interface NimiRuntimeLocalInstallPlanDescriptor {
  readonly planId: string;
  readonly itemId: string;
  readonly source: 'verified' | 'huggingface' | string;
  readonly templateId?: string;
  readonly modelId: string;
  readonly modelType?: string;
  readonly repo: string;
  readonly revision: string;
  readonly capabilities: readonly NimiRuntimeLocalCapabilityToken[];
  readonly engine: string;
  readonly engineRuntimeMode?: NimiRuntimeLocalEngineRuntimeModeId;
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
  readonly totalSizeBytes?: number;
  readonly offerRef?: string;
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

/**
 * Shared acquisition facts of a transfer. `modelAssetId` is the committed
 * final ModelAsset only (empty before commit); `sourceLabel` is a bounded
 * display label of the immutable source and never an identity.
 * `bytesReceived` is payload this transfer fetched or copied itself,
 * `bytesReused` is verified managed content it references by position, and
 * `bytesVerified` is bytes read only to identify or verify content.
 */
export interface NimiRuntimeLocalTransferAcquisition {
  readonly installSessionId: string;
  readonly modelAssetId: string;
  readonly sourceLabel: string;
  readonly sessionKind: NimiRuntimeLocalTransferSessionKind;
  readonly phase: string;
  readonly bytesReceived: number;
  readonly bytesReused: number;
  readonly bytesVerified: number;
  readonly bytesTotal?: number;
  readonly speedBytesPerSec?: number;
  readonly etaSeconds?: number;
  readonly message?: string;
  readonly state: NimiRuntimeLocalDownloadState;
  readonly reasonCode?: string;
  readonly disposition?: NimiRuntimeLocalTransferDisposition;
  readonly availableActions: readonly NimiRuntimeLocalTransferAction[];
  readonly relatedInstallSessionId?: string;
  readonly cleanupPending: boolean;
  readonly planId?: string;
}

export interface NimiRuntimeLocalTransferProgressEvent extends NimiRuntimeLocalTransferAcquisition {
  readonly retryable?: boolean;
  readonly done: boolean;
  readonly success: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface NimiRuntimeLocalTransferSessionSummary extends NimiRuntimeLocalTransferAcquisition {
  readonly retryable: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface NimiRuntimeLocalTransferAccepted {
  readonly installSessionId: string;
  readonly sourceLabel: string;
}

export interface NimiRuntimeLocalInstallResult {
  readonly modelAsset: NimiRuntimeModelAssetRecord;
  readonly installSessionId: string;
  readonly disposition?: NimiRuntimeLocalTransferDisposition;
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
  readonly requiredDependencyFamilies: readonly string[];
  readonly aggregateSizeKnown: boolean;
  readonly aggregateSizeBytes: number;
  readonly storageCategories: readonly string[];
  readonly sourceOwners: readonly string[];
  readonly noSystemMutation: boolean;
  readonly candidateLoadoutId?: string;
  readonly candidateRevision?: string;
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

export interface NimiRuntimeLocalCatalogSearchInput {
  readonly query: string;
  readonly category?: string;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

export interface NimiRuntimeLocalCatalogSearchResult {
  readonly items: readonly NimiRuntimeModelAssetCatalogSearchResult[];
  readonly huggingFaceUnavailable: boolean;
}

export interface NimiRuntimeLocalResolveInstallPlanInput {
  readonly itemId?: string;
  readonly source?: 'verified' | 'huggingface' | string;
  readonly templateId?: string;
  readonly modelId?: string;
  readonly modelType?: string;
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
  readonly capabilityContract: string;
  readonly runtimeDataRoot?: string;
  readonly candidateLoadoutId?: string;
}

export interface NimiRuntimeLocalEnvironmentPlanApplyInput {
  readonly resolution: NimiRuntimeLocalEnvironmentPlanInput;
  readonly expectedPlanId: string;
  readonly confirmed: boolean;
}

export interface NimiRuntimeLocalEnvironmentPlanApplyResult {
  readonly plan: NimiRuntimeLocalEnvironmentPlan;
  readonly jobs: readonly NimiRuntimeLocalEnvironmentDependencyJob[];
}

export interface NimiRuntimeLocalWriteOptions {
  readonly caller?: 'core' | 'builtin' | 'injected' | 'sideload' | string;
  readonly callOptions?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeLocalEnvironmentClientOptions {
  readonly local: NimiRuntimeLocalEnvironmentRpc | (() => NimiRuntimeLocalEnvironmentRpc);
  readonly callOptions?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeLocalTransferWatchOptions {
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly onError?: (error: unknown) => void;
}

export type NimiRuntimeLocalEnvironmentRpc = Pick<
  RuntimeTypedClient,
  | 'importModelAsset'
  | 'listModelAssets'
  | 'getModelAsset'
  | 'removeModelAsset'
  | 'listVerifiedAssets'
  | 'searchCatalogModels'
  | 'listCatalogVariants'
  | 'getCatalogModelCard'
  | 'listFeaturedModelAssets'
  | 'listFactoryProfileRecommendations'
  | 'resolveModelInstallPlan'
  | 'installModelFromPlan'
  | 'listLocalTransfers'
  | 'pauseLocalTransfer'
  | 'resumeLocalTransfer'
  | 'cancelLocalTransfer'
  | 'watchLocalTransfers'
  | 'collectDeviceProfile'
  | 'resolveLocalEnvironmentPlan'
  | 'applyLocalEnvironmentPlan'
  | 'listLocalEnvironmentDependencyJobs'
  | 'startLocalEnvironmentDependencyJob'
  | 'cancelLocalEnvironmentDependencyJob'
  | 'retryLocalEnvironmentDependencyJob'
  | 'repairLocalEnvironmentDependency'
>;

export interface NimiRuntimeLocalEnvironmentClient {
  importModelAsset(input: { readonly sourcePath: string; readonly displayName?: string }, options?: NimiRuntimeLocalWriteOptions): Promise<NimiRuntimeLocalTransferAccepted>;
  listModelAssets(input?: { readonly pageSize?: number; readonly maxPages?: number }): Promise<readonly NimiRuntimeModelAssetRecord[]>;
  getModelAsset(modelAssetId: string): Promise<NimiRuntimeModelAssetRecord>;
  inspectModelAssetRemoval(modelAssetId: string): Promise<NimiRuntimeModelAssetRemovalInspection>;
  removeModelAsset(modelAssetId: string, options?: NimiRuntimeLocalWriteOptions): Promise<NimiRuntimeModelAssetRemovalResult>;
  listVerifiedAssets(input?: {
    readonly kind?: NimiRuntimeLocalAssetKind | string | null;
    readonly engine?: string | null;
    readonly pageSize?: number;
    readonly maxPages?: number;
  }): Promise<readonly NimiRuntimeLocalVerifiedAssetDescriptor[]>;
  searchCatalog(input: NimiRuntimeLocalCatalogSearchInput): Promise<NimiRuntimeLocalCatalogSearchResult>;
  getCatalogModelCard(input: { readonly modelLocator?: string; readonly offerRef?: string }): Promise<{ readonly markdown: string; readonly sourceUrl: string; readonly baseUrl: string }>;
  listCatalogVariants(modelLocator: string): Promise<readonly NimiRuntimeModelAssetMarketCandidate[]>;
  listFeaturedModelAssets(input: {
    readonly category: string;
    readonly pageSize?: number;
  }): Promise<NimiRuntimeFeaturedModelAssets>;
  listFactoryProfileRecommendations(input?: {
    readonly capabilityContract?: string;
  }): Promise<readonly NimiRuntimeFactoryProfileRecommendation[]>;
  resolveInstallPlan(input: NimiRuntimeLocalResolveInstallPlanInput): Promise<NimiRuntimeLocalInstallPlanDescriptor>;
  resolveOfferInstallPlan(offerRef: string): Promise<NimiRuntimeLocalInstallPlanDescriptor>;
  install(planId: string, options?: NimiRuntimeLocalWriteOptions):
    Promise<NimiRuntimeLocalInstallResult>;
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
  resolveEnvironmentPlan(input: NimiRuntimeLocalEnvironmentPlanInput): Promise<NimiRuntimeLocalEnvironmentPlan>;
  applyEnvironmentPlan(input: NimiRuntimeLocalEnvironmentPlanApplyInput, options?: NimiRuntimeLocalWriteOptions):
    Promise<NimiRuntimeLocalEnvironmentPlanApplyResult>;
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
}
