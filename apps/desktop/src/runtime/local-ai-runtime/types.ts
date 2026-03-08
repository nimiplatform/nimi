import type {
  LocalAiDependenciesDeclarationDescriptor as LocalAiDependencyDeclaration,
  LocalAiDeviceProfile as LocalAiDependencyDeviceProfile,
} from './types-dependencies';

export type LocalAiModelStatus = 'installed' | 'active' | 'unhealthy' | 'removed';
export type LocalAiArtifactKind = 'vae' | 'llm' | 'clip' | 'controlnet' | 'lora' | 'auxiliary';
export type LocalAiArtifactStatus = 'installed' | 'active' | 'unhealthy' | 'removed';

export type LocalAiModelRecord = {
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
  status: LocalAiModelStatus;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
  engineConfig?: Record<string, unknown>;
};

export type LocalAiArtifactRecord = {
  localArtifactId: string;
  artifactId: string;
  kind: LocalAiArtifactKind;
  engine: string;
  entry: string;
  files: string[];
  license: string;
  source: {
    repo: string;
    revision: string;
  };
  hashes: Record<string, string>;
  status: LocalAiArtifactStatus;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
  metadata?: Record<string, unknown>;
};

export type LocalAiModelHealth = {
  localModelId: string;
  status: LocalAiModelStatus;
  detail: string;
  endpoint: string;
};

export type LocalAiInstallPayload = {
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

export type LocalAiVerifiedModelDescriptor = {
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

export type LocalAiVerifiedArtifactDescriptor = {
  templateId: string;
  title: string;
  description: string;
  artifactId: string;
  kind: LocalAiArtifactKind;
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

export type LocalAiEngineRuntimeMode = 'supervised' | 'attached-endpoint';

export type LocalAiProviderAdapter = 'openai_compat_adapter' | 'localai_native_adapter' | string;

export type LocalAiProviderLocalHints = {
  backend?: string;
  preferredAdapter?: LocalAiProviderAdapter;
  whisperVariant?: string;
  stablediffusionPipeline?: string;
  videoBackend?: string;
};

export type LocalAiProviderNexaHints = {
  backend?: string;
  preferredAdapter?: LocalAiProviderAdapter;
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

export type LocalAiProviderHints = {
  localai?: LocalAiProviderLocalHints;
  nexa?: LocalAiProviderNexaHints;
} & Record<string, unknown>;

export type LocalAiCatalogItemDescriptor = {
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
  engineRuntimeMode: LocalAiEngineRuntimeMode;
  installKind: string;
  installAvailable: boolean;
  endpoint?: string;
  providerHints?: LocalAiProviderHints;
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

export type LocalAiInstallPlanDescriptor = {
  planId: string;
  itemId: string;
  source: 'verified' | 'huggingface' | string;
  templateId?: string;
  modelId: string;
  repo: string;
  revision: string;
  capabilities: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string>;
  engine: string;
  engineRuntimeMode: LocalAiEngineRuntimeMode;
  installKind: string;
  installAvailable: boolean;
  endpoint: string;
  providerHints?: LocalAiProviderHints;
  entry: string;
  files: string[];
  license: string;
  hashes: Record<string, string>;
  warnings: string[];
  reasonCode?: string;
  engineConfig?: Record<string, unknown>;
};

export type LocalAiCatalogSearchPayload = {
  query?: string;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  limit?: number;
};

export type LocalAiListArtifactsPayload = {
  status?: LocalAiArtifactStatus;
  kind?: LocalAiArtifactKind;
  engine?: string;
};

export type LocalAiListVerifiedArtifactsPayload = {
  kind?: LocalAiArtifactKind;
  engine?: string;
};

export type LocalAiCatalogResolveInstallPlanPayload = {
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
  LocalAiDependencyKind,
  LocalAiDependencyOptionDescriptor,
  LocalAiDependencyAlternativeDescriptor,
  LocalAiDependenciesDeclarationDescriptor,
  LocalAiDependencyDescriptor,
  LocalAiGpuProfile,
  LocalAiPythonProfile,
  LocalAiNpuProfile,
  LocalAiPortAvailability,
  LocalAiDeviceProfile,
  LocalAiPreflightDecision,
  LocalAiDependencySelectionRationale,
  LocalAiDependencyApplyStageResult,
  LocalAiDependencyResolutionPlan,
  LocalAiDependencyApplyResult,
} from './types-dependencies';

export type LocalAiDependenciesResolvePayload = {
  modId: string;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  dependencies?: LocalAiDependencyDeclaration;
  deviceProfile: LocalAiDependencyDeviceProfile;
};

export type LocalAiServiceStatus = 'installed' | 'active' | 'unhealthy' | 'removed';

export type LocalAiServiceDescriptor = {
  serviceId: string;
  title: string;
  engine: string;
  artifactType?: 'python-env' | 'binary' | 'attached-endpoint';
  endpoint?: string;
  capabilities: string[];
  localModelId?: string;
  status: LocalAiServiceStatus;
  detail?: string;
  installedAt: string;
  updatedAt: string;
};

export type LocalAiServicesInstallPayload = {
  serviceId: string;
  title?: string;
  engine?: string;
  endpoint?: string;
  capabilities?: string[];
  localModelId?: string;
};

export type LocalAiNodesCatalogListPayload = {
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  serviceId?: string;
  provider?: string;
};

export type LocalAiNodeDescriptor = {
  nodeId: string;
  title: string;
  serviceId: string;
  capabilities: string[];
  provider: string;
  adapter: LocalAiProviderAdapter;
  backend?: string;
  backendSource?: string;
  available: boolean;
  reasonCode?: string;
  providerHints?: LocalAiProviderHints;
  policyGate?: string;
  apiPath?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  readOnly: boolean;
};

export type LocalAiCapabilityMatrixEntry = {
  serviceId: string;
  nodeId: string;
  capability: string;
  provider: string;
  modelId?: string;
  modelEngine?: string;
  backend?: string;
  backendSource: string;
  adapter: LocalAiProviderAdapter;
  available: boolean;
  reasonCode?: string;
  providerHints?: LocalAiProviderHints;
  policyGate?: string;
};

export type LocalAiInstallVerifiedPayload = {
  templateId: string;
  endpoint?: string;
};

export type LocalAiInstallVerifiedArtifactPayload = {
  templateId: string;
};

export type LocalAiImportPayload = {
  manifestPath: string;
  endpoint?: string;
};

export type LocalAiImportArtifactPayload = {
  manifestPath: string;
};

export type LocalAiImportFilePayload = {
  filePath: string;
  modelName?: string;
  capabilities: string[];
  engine?: string;
  endpoint?: string;
};

export type LocalAiInferenceAuditPayload = {
  eventType: 'inference_invoked' | 'inference_failed' | 'fallback_to_cloud';
  modId: string;
  source: 'local' | 'cloud';
  routeSource?: 'local' | 'cloud';
  provider: string;
  modality: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding';
  adapter: LocalAiProviderAdapter;
  traceId?: string;
  model?: string;
  localModelId?: string;
  endpoint?: string;
  reasonCode?: string;
  detail?: string;
  policyGate?: string | Record<string, unknown>;
  extra?: Record<string, unknown>;
};

export type LocalAiRuntimeAuditPayload = {
  eventType: 'runtime_model_ready_after_install' | string;
  modelId?: string;
  localModelId?: string;
  source?: LocalAiAuditSource;
  modality?: LocalAiAuditModality;
  reasonCode?: string;
  detail?: string;
  payload?: Record<string, unknown>;
};

export type LocalAiRuntimeWriteOptions = {
  caller?: 'core' | 'builtin' | 'injected' | 'sideload' | string;
};

export type LocalAiAuditSource = 'local' | 'cloud' | string;
export type LocalAiAuditModality =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'embedding'
  | string;

export type LocalAiAuditEvent = {
  id: string;
  eventType: string;
  occurredAt: string;
  source?: LocalAiAuditSource;
  modality?: LocalAiAuditModality;
  reasonCode?: string;
  detail?: string;
  modelId?: string;
  localModelId?: string;
  payload?: Record<string, unknown>;
};

export type LocalAiAuditTimeRange = {
  from?: string;
  to?: string;
};

export type LocalAiAuditQuery = {
  limit?: number;
  eventType?: string;
  eventTypes?: string[];
  source?: LocalAiAuditSource;
  modality?: LocalAiAuditModality;
  localModelId?: string;
  modId?: string;
  reasonCode?: string;
  timeRange?: LocalAiAuditTimeRange;
};

export type LocalAiRuntimeSnapshot = {
  models: LocalAiModelRecord[];
  health: LocalAiModelHealth[];
  generatedAt: string;
};

export type LocalAiDownloadState = 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled';

export type LocalAiDownloadProgressEvent = {
  installSessionId: string;
  modelId: string;
  localModelId?: string;
  phase: string;
  bytesReceived: number;
  bytesTotal?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  message?: string;
  state: LocalAiDownloadState;
  reasonCode?: string;
  retryable?: boolean;
  done: boolean;
  success: boolean;
};

export type LocalAiDownloadSessionSummary = {
  installSessionId: string;
  modelId: string;
  localModelId: string;
  phase: string;
  state: LocalAiDownloadState;
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

export type LocalAiDownloadControlPayload = {
  installSessionId: string;
};

export type LocalAiInstallAcceptedResponse = {
  installSessionId: string;
  modelId: string;
  localModelId: string;
};

export type OrphanModelFile = {
  filename: string;
  path: string;
  sizeBytes: number;
};

export type LocalAiScaffoldOrphanPayload = {
  path: string;
  capabilities: string[];
  engine?: string;
  endpoint?: string;
};
