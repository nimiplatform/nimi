import type {
  LocalRuntimeExecutionDeclarationDescriptor,
  LocalRuntimeDeviceProfile,
} from './types-dependencies';
import type {
  LocalRecommendationFeedCapabilityId,
  LocalRecommendationBaselineId,
  LocalRecommendationConfidenceId,
  LocalRecommendationFeedCacheStateId,
  LocalRecommendationFeedSourceId,
  LocalRecommendationFormatId,
  LocalRecommendationHostSupportClassId,
  LocalRecommendationActionStateProjection,
  LocalRecommendationCatalogProjection,
  LocalRecommendationFeedEntryProjection,
  LocalRecommendationFeedItemProjection,
  LocalRecommendationFeedProjection,
  LocalRecommendationInstalledStateProjection,
  LocalRecommendationSuggestedAssetProjection,
  LocalRecommendationSourceId,
  LocalRecommendationTierId,
  LocalRuntimeAssetKindId,
  LocalRuntimeEngineRuntimeModeId,
  LocalRuntimeRunnableAssetKindId,
  LocalRuntimeEnvironmentDependencyJobProjection,
  LocalRuntimeEnvironmentPlanDependencyProjection,
  LocalRuntimeEnvironmentPlanProjection,
  LocalRuntimeNodeDescriptor,
  LocalRuntimeProviderAdapter,
  LocalRuntimeProviderHints,
  LocalRuntimeServiceDescriptor,
  LocalRuntimeServiceStatus,
} from '@nimiplatform/sdk/runtime';
import type {
  LocalRuntimeProfileResolvePayload,
} from './types-profiles';

export type LocalRuntimeAssetStatus = 'installed' | 'active' | 'unhealthy' | 'removed';
export type LocalRuntimeAssetKind = LocalRuntimeAssetKindId;
export type LocalRuntimeCapabilityToken = LocalRuntimeRunnableAssetKindId | string;
export type LocalRuntimeIntegrityMode = 'verified' | 'local_unverified';
export type LocalRuntimeSuggestionSource = 'manifest' | 'folder' | 'download-metadata' | 'filename' | 'unknown';
export type LocalRuntimeSuggestionConfidence = 'high' | 'low';

export type LocalRuntimeAssetRecord = {
  localAssetId: string;
  assetId: string;
  kind: LocalRuntimeAssetKind;
  engine: string;
  engineRuntimeMode?: LocalRuntimeEngineRuntimeMode;
  endpoint?: string;
  entry: string;
  files: string[];
  license: string;
  source: {
    repo: string;
    revision: string;
  };
  integrityMode: LocalRuntimeIntegrityMode;
  hashes: Record<string, string>;
  status: LocalRuntimeAssetStatus;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
  reasonCode?: string;
  // Runnable-only
  capabilities?: string[];
  logicalModelId?: string;
  family?: string;
  artifactRoles?: string[];
  preferredEngine?: string;
  fallbackEngines?: string[];
  engineConfig?: Record<string, unknown>;
  recommendation?: LocalRuntimeCatalogRecommendation;
  // Passive-only
  metadata?: Record<string, unknown>;
};

export type LocalRuntimeAssetHealth = {
  localAssetId: string;
  status: LocalRuntimeAssetStatus;
  detail: string;
  endpoint: string;
  reasonCode?: string;
};

export type LocalRuntimeInstallPayload = {
  modelId: string;
  kind: LocalRuntimeAssetKind;
  repo: string;
  revision?: string;
  capabilities?: string[];
  engine?: string;
  entry?: string;
  files?: string[];
  license?: string;
  hashes?: Record<string, string>;
  endpoint?: string;
  engineConfig?: Record<string, unknown>;
};

export type LocalRuntimeVerifiedAssetDescriptor = {
  templateId: string;
  title: string;
  description: string;
  installKind?: string;
  assetId: string;
  kind: LocalRuntimeAssetKind;
  logicalModelId?: string;
  repo: string;
  revision: string;
  capabilities?: string[];
  engine: string;
  entry: string;
  files: string[];
  license: string;
  hashes: Record<string, string>;
  endpoint?: string;
  fileCount: number;
  totalSizeBytes?: number;
  tags: string[];
  artifactRoles?: string[];
  preferredEngine?: string;
  fallbackEngines?: string[];
  engineConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type LocalRuntimeEngineRuntimeMode = LocalRuntimeEngineRuntimeModeId;
export type {
  LocalRuntimeNodeDescriptor,
  LocalRuntimeProviderAdapter,
  LocalRuntimeProviderHints,
  LocalRuntimeProviderLlamaHints,
  LocalRuntimeProviderMediaHints,
  LocalRuntimeProviderSidecarHints,
  LocalRuntimeProviderSpeechHints,
  LocalRuntimeServiceDescriptor,
  LocalRuntimeServiceStatus,
} from '@nimiplatform/sdk/runtime';

export type LocalRuntimeRecommendationSource = LocalRecommendationSourceId;
export type LocalRuntimeRecommendationFormat = LocalRecommendationFormatId;
export type LocalRuntimeRecommendationTier = LocalRecommendationTierId;
export type LocalRuntimeRecommendationHostSupportClass = LocalRecommendationHostSupportClassId;
export type LocalRuntimeRecommendationConfidence = LocalRecommendationConfidenceId;
export type LocalRuntimeRecommendationBaseline = LocalRecommendationBaselineId;
export type LocalRuntimeRecommendationFeedCacheState = LocalRecommendationFeedCacheStateId;
export type LocalRuntimeRecommendationFeedCapability = LocalRecommendationFeedCapabilityId;
export type LocalRuntimeRecommendationFeedSource = LocalRecommendationFeedSourceId;

export type LocalRuntimeSuggestedAsset = LocalRecommendationSuggestedAssetProjection;
export type LocalRuntimeCatalogRecommendation = LocalRecommendationCatalogProjection;
export type LocalRuntimeRecommendationFeedEntryDescriptor = LocalRecommendationFeedEntryProjection;
export type LocalRuntimeRecommendationInstalledState = LocalRecommendationInstalledStateProjection;
export type LocalRuntimeRecommendationActionState = LocalRecommendationActionStateProjection;
export type LocalRuntimeRecommendationFeedItemDescriptor = LocalRecommendationFeedItemProjection;
export type LocalRuntimeRecommendationFeedDescriptor = LocalRecommendationFeedProjection<LocalRuntimeDeviceProfile>;

export type LocalRuntimeCatalogItemDescriptor = {
  itemId: string;
  source: 'verified' | 'huggingface' | string;
  title: string;
  description: string;
  modelId: string;
  repo: string;
  revision: string;
  templateId?: string;
  capabilities: LocalRuntimeCapabilityToken[];
  engine: string;
  engineRuntimeMode: LocalRuntimeEngineRuntimeMode;
  installKind: string;
  installAvailable: boolean;
  endpoint?: string;
  providerHints?: LocalRuntimeProviderHints;
  entry?: string;
  files: string[];
  license?: string;
  hashes: Record<string, string>;
  tags: string[];
  downloads?: number;
  likes?: number;
  lastModified?: string;
  verified: boolean;
  engineConfig?: Record<string, unknown>;
  recommendation?: LocalRuntimeCatalogRecommendation;
};

export type LocalRuntimeCatalogVariantDescriptor = {
  filename: string;
  entry: string;
  files: string[];
  format?: string;
  sizeBytes?: number;
  sha256?: string;
  recommendation?: LocalRuntimeCatalogRecommendation;
};

export type GgufVariantDescriptor = LocalRuntimeCatalogVariantDescriptor;

export type LocalRuntimeInstallPlanDescriptor = {
  planId: string;
  itemId: string;
  source: 'verified' | 'huggingface' | string;
  templateId?: string;
  modelId: string;
  repo: string;
  revision: string;
  capabilities: LocalRuntimeCapabilityToken[];
  engine: string;
  engineRuntimeMode: LocalRuntimeEngineRuntimeMode;
  installKind: string;
  installAvailable: boolean;
  endpoint: string;
  providerHints?: LocalRuntimeProviderHints;
  entry: string;
  files: string[];
  license: string;
  hashes: Record<string, string>;
  warnings: string[];
  reasonCode?: string;
  engineConfig?: Record<string, unknown>;
  recommendation?: LocalRuntimeCatalogRecommendation;
};

export type LocalRuntimeCatalogSearchPayload = {
  query?: string;
  capability?: LocalRuntimeCapabilityToken;
  limit?: number;
};

export type LocalRuntimeRecommendationFeedGetPayload = {
  capability?: LocalRuntimeRecommendationFeedCapability;
  pageSize?: number;
};

export type LocalRuntimeListAssetsPayload = {
  status?: LocalRuntimeAssetStatus;
  kind?: LocalRuntimeAssetKind;
  engine?: string;
};

export type LocalRuntimeListVerifiedAssetsPayload = {
  kind?: LocalRuntimeAssetKind;
  engine?: string;
};

export type LocalRuntimeCatalogResolveInstallPlanPayload = {
  itemId?: string;
  source?: 'verified' | 'huggingface' | string;
  templateId?: string;
  modelId?: string;
  repo?: string;
  revision?: string;
  capabilities?: LocalRuntimeCapabilityToken[];
  engine?: string;
  entry?: string;
  files?: string[];
  license?: string;
  hashes?: Record<string, string>;
  endpoint?: string;
  engineConfig?: Record<string, unknown>;
};

export type {
  LocalRuntimeExecutionEntryKind,
  LocalRuntimeExecutionOptionDescriptor,
  LocalRuntimeExecutionAlternativeDescriptor,
  LocalRuntimeExecutionDeclarationDescriptor,
  LocalRuntimeExecutionEntryDescriptor,
  LocalRuntimeGpuProfile,
  LocalRuntimePythonProfile,
  LocalRuntimeNpuProfile,
  LocalRuntimePortAvailability,
  LocalRuntimeDeviceProfile,
  LocalRuntimePreflightDecision,
  LocalRuntimeExecutionSelectionRationale,
  LocalRuntimeExecutionStageResult,
  LocalRuntimeExecutionPlan,
  LocalRuntimeExecutionApplyResult,
} from './types-dependencies';
export type {
  LocalRuntimeProfileEntryOverride,
  LocalRuntimeProfileEntryKind,
  LocalRuntimeProfileRequirementDescriptor,
  LocalRuntimeProfileEntryDescriptor,
  LocalRuntimeProfileDescriptor,
  LocalRuntimeProfileTargetDescriptor,
  LocalRuntimeProfileResolutionPlan,
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileResolvePayload,
  LocalRuntimeProfileInstallRequest,
  LocalRuntimeProfileInstallRequestResult,
  LocalRuntimeProfileExecutionBridge,
} from './types-profiles';

export type LocalRuntimeExecutionResolvePayload = {
  targetId: string;
  capability?: LocalRuntimeCapabilityToken;
  entries?: LocalRuntimeExecutionDeclarationDescriptor;
  deviceProfile: LocalRuntimeDeviceProfile;
};

export type LocalRuntimeProfilesResolvePayload = LocalRuntimeProfileResolvePayload;

export type LocalRuntimeServicesInstallPayload = {
  serviceId: string;
  title?: string;
  engine?: string;
  endpoint?: string;
  capabilities?: string[];
  localAssetId?: string;
};

export type LocalRuntimeNodesCatalogListPayload = {
  capability?: LocalRuntimeCapabilityToken;
  serviceId?: string;
  provider?: string;
};

export type LocalRuntimeCapabilityMatrixEntry = {
  serviceId: string;
  nodeId: string;
  capability: string;
  provider: string;
  modelId?: string;
  modelEngine?: string;
  backend?: string;
  backendSource: string;
  adapter: LocalRuntimeProviderAdapter;
  available: boolean;
  reasonCode?: string;
  providerHints?: LocalRuntimeProviderHints;
  policyGate?: string;
};

export type LocalRuntimeInstallVerifiedAssetPayload = {
  templateId: string;
  endpoint?: string;
};

export type LocalRuntimeImportAssetPayload = {
  manifestPath: string;
  endpoint?: string;
};

export type LocalRuntimeImportFilePayload = {
  filePath: string;
  assetName?: string;
  kind: LocalRuntimeAssetKind;
  engine?: string;
  endpoint?: string;
};

export type LocalRuntimeImportBundlePayload = {
  directoryPath: string;
  modelName?: string;
  capabilities: string[];
  engine?: string;
  endpoint?: string;
};

export type LocalRuntimeRescanBundlePayload = {
  localAssetId: string;
};

export type LocalRuntimeInferenceAuditPayload = {
  eventType: 'inference_invoked' | 'inference_failed' | 'fallback_to_cloud';
  targetId: string;
  source: 'local' | 'cloud';
  routeSource?: 'local' | 'cloud';
  provider: string;
  modality: LocalRuntimeRunnableAssetKindId;
  adapter: LocalRuntimeProviderAdapter;
  traceId?: string;
  model?: string;
  localModelId?: string;
  endpoint?: string;
  reasonCode?: string;
  detail?: string;
  policyGate?: string | Record<string, unknown>;
  extra?: Record<string, unknown>;
};

export type LocalRuntimeAuditPayload = {
  eventType: 'runtime_asset_ready_after_install' | string;
  assetId?: string;
  localAssetId?: string;
  source?: LocalRuntimeAuditSource;
  modality?: LocalRuntimeAuditModality;
  reasonCode?: string;
  detail?: string;
  payload?: Record<string, unknown>;
};

export type LocalRuntimeWriteOptions = {
  caller?: 'core' | 'builtin' | 'injected' | 'sideload' | string;
};

export type LocalRuntimeImportManifestOptions = LocalRuntimeWriteOptions & {
  endpoint?: string;
};

export type LocalRuntimeAuditSource = 'local' | 'cloud' | string;
export type LocalRuntimeAuditModality =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'embedding'
  | string;

export type LocalRuntimeAuditEvent = {
  id: string;
  eventType: string;
  occurredAt: string;
  source?: LocalRuntimeAuditSource;
  modality?: LocalRuntimeAuditModality;
  reasonCode?: string;
  detail?: string;
  modelId?: string;
  localModelId?: string;
  payload?: Record<string, unknown>;
};

export type LocalRuntimeAuditTimeRange = {
  from?: string;
  to?: string;
};

export type LocalRuntimeAuditQuery = {
  limit?: number;
  eventType?: string;
  eventTypes?: string[];
  source?: LocalRuntimeAuditSource;
  modality?: LocalRuntimeAuditModality;
  localModelId?: string;
  targetId?: string;
  reasonCode?: string;
  timeRange?: LocalRuntimeAuditTimeRange;
};

export type LocalRuntimeSnapshot = {
  assets: LocalRuntimeAssetRecord[];
  health: LocalRuntimeAssetHealth[];
  generatedAt: string;
};

export type LocalRuntimeDownloadState = 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';
export type LocalRuntimeTransferSessionKind = 'download' | 'import';

export type LocalRuntimeDownloadProgressEvent = {
  installSessionId: string;
  modelId: string;
  localModelId?: string;
  sessionKind: LocalRuntimeTransferSessionKind;
  phase: string;
  bytesReceived: number;
  bytesTotal?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  message?: string;
  state: LocalRuntimeDownloadState;
  reasonCode?: string;
  retryable?: boolean;
  done: boolean;
  success: boolean;
};

export type LocalRuntimeDownloadSessionSummary = {
  installSessionId: string;
  modelId: string;
  localModelId: string;
  sessionKind: LocalRuntimeTransferSessionKind;
  phase: string;
  state: LocalRuntimeDownloadState;
  bytesReceived: number;
  bytesTotal?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  message?: string;
  reasonCode?: string;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LocalRuntimeDownloadControlPayload = {
  installSessionId: string;
};

export type LocalRuntimeTransferAccepted = {
  installSessionId: string;
  modelId: string;
  localModelId: string;
};

export type LocalRuntimeEnvironmentPlanDependency = LocalRuntimeEnvironmentPlanDependencyProjection;

export type LocalRuntimeEnvironmentPlan = LocalRuntimeEnvironmentPlanProjection;

export type LocalRuntimeEnvironmentPlanPayload = {
  packId: string;
  consumerScope?: string;
  runtimeDataRoot?: string;
  assetId?: string;
  localAssetId?: string;
  companionAssetId?: string;
  parentAssetId?: string;
  // installLevel is the first-run install level ('minimal' | 'recommended').
  // When set and no explicit assetId is supplied, Runtime resolves the pack's
  // model.asset / model.companion-asset dependencies internally via the
  // K-MCAT-034 deterministic resolver (K-RPC-025).
  installLevel?: string;
};

export type LocalRuntimeEnvironmentDependencyJob = LocalRuntimeEnvironmentDependencyJobProjection;

export type LocalRuntimeEnvironmentDependencyJobsPayload = {
  environmentKey?: string;
  state?: string;
};

export type LocalRuntimeEnvironmentDependencyJobStartPayload = {
  environmentKey: string;
  dependencyFamily: string;
  dependencyId: string;
  sourceKind: string;
  confirmed: boolean;
};

export type LocalRuntimeEnvironmentDependencyJobCancelPayload = {
  jobId: string;
};

export type LocalRuntimeEnvironmentDependencyJobRetryPayload = {
  jobId: string;
  confirmed: boolean;
};

export type LocalRuntimeEnvironmentDependencyRepairPayload = {
  environmentKey: string;
  dependencyFamily: string;
  dependencyId: string;
  confirmed: boolean;
  reasonCode?: string;
};

export type LocalRuntimeAssetDeclaration = {
  assetKind: LocalRuntimeAssetKind;
  engine?: string;
};

export type LocalRuntimeUnregisteredAssetDescriptor = {
  filename: string;
  path: string;
  sizeBytes: number;
  declaration?: LocalRuntimeAssetDeclaration;
  suggestionSource: LocalRuntimeSuggestionSource;
  confidence: LocalRuntimeSuggestionConfidence;
  autoImportable: boolean;
  requiresManualReview: boolean;
  folderName?: string;
};

export type LocalRuntimeScaffoldOrphanPayload = {
  path: string;
  kind: LocalRuntimeAssetKind;
  engine?: string;
  endpoint?: string;
};

export type LocalRuntimeScaffoldAssetPayload = {
  path: string;
  kind: LocalRuntimeAssetKind;
  engine?: string;
};

export type LocalRuntimeScaffoldAssetResult = {
  manifestPath: string;
  assetId: string;
  kind: LocalRuntimeAssetKind;
};

export type LocalRuntimeImportAssetFilePayload = {
  filePath: string;
  declaration: LocalRuntimeAssetDeclaration;
  assetName?: string;
  endpoint?: string;
};

export type LocalRuntimeAssetFileImportResult = {
  asset: LocalRuntimeAssetRecord;
};

export type LocalRuntimeAssetManifestImportResult = {
  asset: LocalRuntimeAssetRecord;
};
