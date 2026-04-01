import type {
  LocalRuntimeExecutionDeclarationDescriptor,
  LocalRuntimeDeviceProfile,
} from './types-dependencies';
import type {
  LocalRuntimeProfileResolvePayload,
} from './types-profiles';

export type LocalRuntimeAssetStatus = 'installed' | 'active' | 'unhealthy' | 'removed';
export type LocalRuntimeAssetKind = 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'vae' | 'clip' | 'lora' | 'controlnet' | 'auxiliary';
export type LocalRuntimeIntegrityMode = 'verified' | 'local_unverified';
export type LocalRuntimeSuggestionSource = 'manifest' | 'folder' | 'download-metadata' | 'filename' | 'unknown';
export type LocalRuntimeSuggestionConfidence = 'high' | 'low';

export type LocalRuntimeAssetRecord = {
  localAssetId: string;
  assetId: string;
  kind: LocalRuntimeAssetKind;
  engine: string;
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

export type LocalRuntimeEngineRuntimeMode = 'supervised' | 'attached-endpoint';

export type LocalRuntimeProviderAdapter =
  | 'openai_compat_adapter'
  | 'llama_native_adapter'
  | 'media_native_adapter'
  | 'speech_native_adapter'
  | 'sidecar_music_adapter'
  | string;

export type LocalRuntimeProviderLlamaHints = {
  preferredAdapter?: LocalRuntimeProviderAdapter;
  whisperVariant?: string;
};

export type LocalRuntimeProviderMediaHints = {
  preferredAdapter?: LocalRuntimeProviderAdapter;
  deviceId?: string;
  driver?: string;
  family?: string;
  policyGate?: string;
};

export type LocalRuntimeProviderSpeechHints = {
  preferredAdapter?: LocalRuntimeProviderAdapter;
  backend?: string;
  family?: string;
  driver?: string;
  deviceId?: string;
  policyGate?: string;
};

export type LocalRuntimeProviderSidecarHints = {
  preferredAdapter?: LocalRuntimeProviderAdapter;
};

export type LocalRuntimeProviderHints = {
  llama?: LocalRuntimeProviderLlamaHints;
  media?: LocalRuntimeProviderMediaHints;
  speech?: LocalRuntimeProviderSpeechHints;
  sidecar?: LocalRuntimeProviderSidecarHints;
  extra?: Record<string, unknown>;
} & Record<string, unknown>;

export type LocalRuntimeRecommendationSource = 'llmfit' | 'media-fit';
export type LocalRuntimeRecommendationFormat = 'gguf' | 'safetensors';
export type LocalRuntimeRecommendationTier = 'recommended' | 'runnable' | 'tight' | 'not_recommended';
export type LocalRuntimeRecommendationHostSupportClass = 'supported_supervised' | 'attached_only' | 'unsupported';
export type LocalRuntimeRecommendationConfidence = 'high' | 'medium' | 'low';
export type LocalRuntimeRecommendationBaseline = 'image-default-v1' | 'video-default-v1';
export type LocalRuntimeRecommendationFeedCacheState = 'fresh' | 'stale' | 'empty';
export type LocalRuntimeRecommendationFeedCapability = 'chat' | 'image' | 'video';
export type LocalRuntimeRecommendationFeedSource = 'model-index';

export type LocalRuntimeSuggestedAsset = {
  templateId?: string;
  assetId?: string;
  kind: string;
  family?: string;
};

export type LocalRuntimeCatalogRecommendation = {
  source: LocalRuntimeRecommendationSource;
  format?: LocalRuntimeRecommendationFormat;
  tier?: LocalRuntimeRecommendationTier;
  hostSupportClass?: LocalRuntimeRecommendationHostSupportClass;
  confidence?: LocalRuntimeRecommendationConfidence;
  reasonCodes: string[];
  recommendedEntry?: string;
  fallbackEntries: string[];
  suggestedAssets: LocalRuntimeSuggestedAsset[];
  suggestedNotes: string[];
  baseline?: LocalRuntimeRecommendationBaseline;
};

export type LocalRuntimeRecommendationFeedEntryDescriptor = {
  entryId: string;
  format: LocalRuntimeRecommendationFormat;
  entry: string;
  files: string[];
  totalSizeBytes: number;
  sha256?: string;
};

export type LocalRuntimeRecommendationInstalledState = {
  installed: boolean;
  localAssetId?: string;
  status?: LocalRuntimeAssetStatus;
};

export type LocalRuntimeRecommendationActionState = {
  canReviewInstallPlan: boolean;
  canOpenVariants: boolean;
  canOpenLocalAsset: boolean;
};

export type LocalRuntimeRecommendationFeedItemDescriptor = {
  itemId: string;
  source: LocalRuntimeRecommendationFeedSource;
  repo: string;
  revision: string;
  title: string;
  description?: string;
  capabilities: string[];
  tags: string[];
  formats: LocalRuntimeRecommendationFormat[];
  downloads?: number;
  likes?: number;
  lastModified?: string;
  preferredEngine: string;
  verified: boolean;
  entries: LocalRuntimeRecommendationFeedEntryDescriptor[];
  recommendation?: LocalRuntimeCatalogRecommendation;
  installedState: LocalRuntimeRecommendationInstalledState;
  actionState: LocalRuntimeRecommendationActionState;
  installPayload: LocalRuntimeInstallPayload;
};

export type LocalRuntimeRecommendationFeedDescriptor = {
  deviceProfile: LocalRuntimeDeviceProfile;
  activeCapability: LocalRuntimeRecommendationFeedCapability;
  generatedAt?: string;
  cacheState: LocalRuntimeRecommendationFeedCacheState;
  items: LocalRuntimeRecommendationFeedItemDescriptor[];
};

export type LocalRuntimeCatalogItemDescriptor = {
  itemId: string;
  source: 'verified' | 'huggingface' | string;
  title: string;
  description: string;
  modelId: string;
  repo: string;
  revision: string;
  templateId?: string;
  capabilities: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string>;
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
  capabilities: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string>;
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
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
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
  capabilities?: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string>;
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
  LocalRuntimeProfileInstallStatus,
  LocalRuntimeProfileResolvePayload,
  LocalRuntimeProfileInstallRequest,
  LocalRuntimeProfileInstallRequestResult,
  LocalRuntimeProfileExecutionBridge,
} from './types-profiles';

export type LocalRuntimeExecutionResolvePayload = {
  modId: string;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  entries?: LocalRuntimeExecutionDeclarationDescriptor;
  deviceProfile: LocalRuntimeDeviceProfile;
};

export type LocalRuntimeProfilesResolvePayload = LocalRuntimeProfileResolvePayload;

export type LocalRuntimeServiceStatus = 'installed' | 'active' | 'unhealthy' | 'removed';

export type LocalRuntimeServiceDescriptor = {
  serviceId: string;
  title: string;
  engine: string;
  artifactType?: 'python-env' | 'binary' | 'attached-endpoint';
  endpoint?: string;
  capabilities: string[];
  localAssetId?: string;
  status: LocalRuntimeServiceStatus;
  detail?: string;
  installedAt: string;
  updatedAt: string;
};

export type LocalRuntimeServicesInstallPayload = {
  serviceId: string;
  title?: string;
  engine?: string;
  endpoint?: string;
  capabilities?: string[];
  localAssetId?: string;
};

export type LocalRuntimeNodesCatalogListPayload = {
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  serviceId?: string;
  provider?: string;
};

export type LocalRuntimeNodeDescriptor = {
  nodeId: string;
  title: string;
  serviceId: string;
  capabilities: string[];
  provider: string;
  adapter: LocalRuntimeProviderAdapter;
  backend?: string;
  backendSource?: string;
  available: boolean;
  reasonCode?: string;
  providerHints?: LocalRuntimeProviderHints;
  policyGate?: string;
  apiPath?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  readOnly: boolean;
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

export type LocalRuntimeInferenceAuditPayload = {
  eventType: 'inference_invoked' | 'inference_failed' | 'fallback_to_cloud';
  modId: string;
  source: 'local' | 'cloud';
  routeSource?: 'local' | 'cloud';
  provider: string;
  modality: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding';
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
  modId?: string;
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
