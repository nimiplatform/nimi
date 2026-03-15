import type {
  LocalRuntimeExecutionDeclarationDescriptor,
  LocalRuntimeDeviceProfile,
} from './types-dependencies';
import type {
  LocalRuntimeProfileResolvePayload,
} from './types-profiles';

export type LocalRuntimeModelStatus = 'installed' | 'active' | 'unhealthy' | 'removed';
export type LocalRuntimeArtifactKind = 'vae' | 'llm' | 'clip' | 'controlnet' | 'lora' | 'auxiliary';
export type LocalRuntimeArtifactStatus = 'installed' | 'active' | 'unhealthy' | 'removed';

export type LocalRuntimeModelRecord = {
  localModelId: string;
  modelId: string;
  capabilities: string[];
  engine: string;
  entry: string;
  license: string;
  source: {
    repo: string;
    revision: string;
  };
  hashes: Record<string, string>;
  endpoint: string;
  status: LocalRuntimeModelStatus;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
  engineConfig?: Record<string, unknown>;
};

export type LocalRuntimeArtifactRecord = {
  localArtifactId: string;
  artifactId: string;
  kind: LocalRuntimeArtifactKind;
  engine: string;
  entry: string;
  files: string[];
  license: string;
  source: {
    repo: string;
    revision: string;
  };
  hashes: Record<string, string>;
  status: LocalRuntimeArtifactStatus;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
  metadata?: Record<string, unknown>;
};

export type LocalRuntimeModelHealth = {
  localModelId: string;
  status: LocalRuntimeModelStatus;
  detail: string;
  endpoint: string;
};

export type LocalRuntimeInstallPayload = {
  modelId: string;
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

export type LocalRuntimeVerifiedModelDescriptor = {
  templateId: string;
  title: string;
  description: string;
  installKind: string;
  modelId: string;
  repo: string;
  revision: string;
  capabilities: string[];
  engine: string;
  entry: string;
  files: string[];
  license: string;
  hashes: Record<string, string>;
  endpoint: string;
  fileCount: number;
  totalSizeBytes?: number;
  tags: string[];
  engineConfig?: Record<string, unknown>;
};

export type LocalRuntimeVerifiedArtifactDescriptor = {
  templateId: string;
  title: string;
  description: string;
  artifactId: string;
  kind: LocalRuntimeArtifactKind;
  engine: string;
  entry: string;
  files: string[];
  license: string;
  repo: string;
  revision: string;
  hashes: Record<string, string>;
  fileCount: number;
  totalSizeBytes?: number;
  tags: string[];
  metadata?: Record<string, unknown>;
};

export type LocalRuntimeEngineRuntimeMode = 'supervised' | 'attached-endpoint';

export type LocalRuntimeProviderAdapter =
  | 'openai_compat_adapter'
  | 'localai_native_adapter'
  | 'nexa_native_adapter'
  | 'nimi_media_native_adapter'
  | string;

export type LocalRuntimeProviderLocalHints = {
  backend?: string;
  preferredAdapter?: LocalRuntimeProviderAdapter;
  whisperVariant?: string;
  stablediffusionPipeline?: string;
  videoBackend?: string;
};

export type LocalRuntimeProviderNexaHints = {
  backend?: string;
  preferredAdapter?: LocalRuntimeProviderAdapter;
  pluginId?: string;
  deviceId?: string;
  modelType?: string;
  npuMode?: string;
  policyGate?: string;
  hostNpuReady?: boolean;
  modelProbeHasNpuCandidate?: boolean;
  policyGateAllowsNpu?: boolean;
  npuUsable?: boolean;
  gateReason?: string;
  gateDetail?: string;
};

export type LocalRuntimeProviderNimiMediaHints = {
  preferredAdapter?: LocalRuntimeProviderAdapter;
  driver?: string;
  family?: string;
};

export type LocalRuntimeProviderHints = {
  localai?: LocalRuntimeProviderLocalHints;
  nexa?: LocalRuntimeProviderNexaHints;
  nimiMedia?: LocalRuntimeProviderNimiMediaHints;
  extra?: Record<string, unknown>;
} & Record<string, unknown>;

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
};

export type GgufVariantDescriptor = {
  filename: string;
  sizeBytes?: number;
  sha256?: string;
};

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
};

export type LocalRuntimeCatalogSearchPayload = {
  query?: string;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  limit?: number;
};

export type LocalRuntimeListArtifactsPayload = {
  status?: LocalRuntimeArtifactStatus;
  kind?: LocalRuntimeArtifactKind;
  engine?: string;
};

export type LocalRuntimeListVerifiedArtifactsPayload = {
  kind?: LocalRuntimeArtifactKind;
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
  LocalRuntimeProfileEntryKind,
  LocalRuntimeProfileRequirementDescriptor,
  LocalRuntimeProfileEntryDescriptor,
  LocalRuntimeProfileDescriptor,
  LocalRuntimeProfileTargetDescriptor,
  LocalRuntimeProfileArtifactPlanEntry,
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
  localModelId?: string;
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
  localModelId?: string;
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

export type LocalRuntimeInstallVerifiedPayload = {
  templateId: string;
  endpoint?: string;
};

export type LocalRuntimeInstallVerifiedArtifactPayload = {
  templateId: string;
};

export type LocalRuntimeImportPayload = {
  manifestPath: string;
  endpoint?: string;
};

export type LocalRuntimeImportArtifactPayload = {
  manifestPath: string;
};

export type LocalRuntimeImportFilePayload = {
  filePath: string;
  modelName?: string;
  capabilities: string[];
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
  eventType: 'runtime_model_ready_after_install' | string;
  modelId?: string;
  localModelId?: string;
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
  models: LocalRuntimeModelRecord[];
  health: LocalRuntimeModelHealth[];
  generatedAt: string;
};

export type LocalRuntimeDownloadState = 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';

export type LocalRuntimeDownloadProgressEvent = {
  installSessionId: string;
  modelId: string;
  localModelId?: string;
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

export type LocalRuntimeInstallAcceptedResponse = {
  installSessionId: string;
  modelId: string;
  localModelId: string;
};

export type OrphanModelFile = {
  filename: string;
  path: string;
  sizeBytes: number;
};

export type OrphanArtifactFile = {
  filename: string;
  path: string;
  sizeBytes: number;
};

export type LocalRuntimeScaffoldOrphanPayload = {
  path: string;
  capabilities: string[];
  engine?: string;
  endpoint?: string;
};

export type LocalRuntimeScaffoldArtifactPayload = {
  path: string;
  kind: LocalRuntimeArtifactKind;
};

export type LocalRuntimeScaffoldArtifactResult = {
  manifestPath: string;
  artifactId: string;
  kind: LocalRuntimeArtifactKind;
};
