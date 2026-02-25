import { emitRuntimeLog } from '../telemetry/logger';
import { hasTauriInvoke, tauriInvoke } from '../llm-adapter/tauri-bridge';

type RuntimeLocalRuntimeClient = {
  listLocalModels: (...args: unknown[]) => Promise<Record<string, unknown>>;
  listVerifiedModels: (...args: unknown[]) => Promise<Record<string, unknown>>;
  searchCatalogModels: (...args: unknown[]) => Promise<Record<string, unknown>>;
  resolveModelInstallPlan: (...args: unknown[]) => Promise<Record<string, unknown>>;
  collectDeviceProfile: (...args: unknown[]) => Promise<Record<string, unknown>>;
  resolveDependencies: (...args: unknown[]) => Promise<Record<string, unknown>>;
  applyDependencies: (...args: unknown[]) => Promise<Record<string, unknown>>;
  listLocalServices: (...args: unknown[]) => Promise<Record<string, unknown>>;
  installLocalService: (...args: unknown[]) => Promise<Record<string, unknown>>;
  startLocalService: (...args: unknown[]) => Promise<Record<string, unknown>>;
  stopLocalService: (...args: unknown[]) => Promise<Record<string, unknown>>;
  checkLocalServiceHealth: (...args: unknown[]) => Promise<Record<string, unknown>>;
  removeLocalService: (...args: unknown[]) => Promise<Record<string, unknown>>;
  listNodeCatalog: (...args: unknown[]) => Promise<Record<string, unknown>>;
  listLocalAudits: (...args: unknown[]) => Promise<Record<string, unknown>>;
  installLocalModel: (...args: unknown[]) => Promise<Record<string, unknown>>;
  installVerifiedModel: (...args: unknown[]) => Promise<Record<string, unknown>>;
  importLocalModel: (...args: unknown[]) => Promise<Record<string, unknown>>;
  removeLocalModel: (...args: unknown[]) => Promise<Record<string, unknown>>;
  startLocalModel: (...args: unknown[]) => Promise<Record<string, unknown>>;
  stopLocalModel: (...args: unknown[]) => Promise<Record<string, unknown>>;
  checkLocalModelHealth: (...args: unknown[]) => Promise<Record<string, unknown>>;
  appendInferenceAudit: (...args: unknown[]) => Promise<Record<string, unknown>>;
  appendRuntimeAudit: (...args: unknown[]) => Promise<Record<string, unknown>>;
};

let platformClientModulePromise: Promise<typeof import('../platform-client')> | null = null;

async function loadPlatformClientModule(): Promise<typeof import('../platform-client')> {
  if (!platformClientModulePromise) {
    platformClientModulePromise = import('../platform-client');
  }
  return platformClientModulePromise;
}

async function getRuntimeLocalRuntimeClient(): Promise<RuntimeLocalRuntimeClient> {
  const platformClient = await loadPlatformClientModule();
  const runtime = platformClient.getPlatformClient().runtime;
  if (!runtime?.localRuntime) {
    throw new Error('RUNTIME_LOCAL_RUNTIME_CLIENT_UNAVAILABLE');
  }
  return runtime.localRuntime as unknown as RuntimeLocalRuntimeClient;
}

export type LocalAiModelStatus = 'installed' | 'active' | 'unhealthy' | 'removed';

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
};

export type LocalAiCatalogSearchPayload = {
  query?: string;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  limit?: number;
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
};

export type LocalAiDependencyKind = 'model' | 'service' | 'node';

export type LocalAiDependencyOptionDescriptor = {
  dependencyId: string;
  kind: LocalAiDependencyKind;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  title?: string;
  modelId?: string;
  repo?: string;
  serviceId?: string;
  nodeId?: string;
  engine?: string;
};

export type LocalAiDependencyAlternativeDescriptor = {
  alternativeId: string;
  preferredDependencyId?: string;
  options: LocalAiDependencyOptionDescriptor[];
};

export type LocalAiDependenciesDeclarationDescriptor = {
  required?: LocalAiDependencyOptionDescriptor[];
  optional?: LocalAiDependencyOptionDescriptor[];
  alternatives?: LocalAiDependencyAlternativeDescriptor[];
  preferred?: Partial<Record<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding', string>>;
};

export type LocalAiDependenciesResolvePayload = {
  modId: string;
  capability?: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | string;
  dependencies?: LocalAiDependenciesDeclarationDescriptor;
  deviceProfile: LocalAiDeviceProfile;
};

export type LocalAiDependencyDescriptor = {
  dependencyId: string;
  kind: LocalAiDependencyKind;
  capability?: string;
  required: boolean;
  selected: boolean;
  preferred: boolean;
  modelId?: string;
  repo?: string;
  engine?: string;
  serviceId?: string;
  nodeId?: string;
  reasonCode?: string;
  warnings: string[];
};

export type LocalAiGpuProfile = {
  available: boolean;
  vendor?: string;
  model?: string;
};

export type LocalAiPythonProfile = {
  available: boolean;
  version?: string;
};

export type LocalAiNpuProfile = {
  available: boolean;
  ready: boolean;
  vendor?: string;
  runtime?: string;
  detail?: string;
};

export type LocalAiPortAvailability = {
  port: number;
  available: boolean;
};

export type LocalAiDeviceProfile = {
  os: string;
  arch: string;
  gpu: LocalAiGpuProfile;
  python: LocalAiPythonProfile;
  npu: LocalAiNpuProfile;
  diskFreeBytes: number;
  ports: LocalAiPortAvailability[];
};

export type LocalAiPreflightDecision = {
  dependencyId?: string;
  target: string;
  check: string;
  ok: boolean;
  reasonCode: string;
  detail: string;
};

export type LocalAiDependencySelectionRationale = {
  dependencyId: string;
  selected: boolean;
  reasonCode: string;
  detail: string;
};

export type LocalAiDependencyApplyStageResult = {
  stage: string;
  ok: boolean;
  reasonCode?: string;
  detail?: string;
};

export type LocalAiDependencyResolutionPlan = {
  planId: string;
  modId: string;
  capability?: string;
  deviceProfile: LocalAiDeviceProfile;
  dependencies: LocalAiDependencyDescriptor[];
  selectionRationale: LocalAiDependencySelectionRationale[];
  preflightDecisions: LocalAiPreflightDecision[];
  warnings: string[];
  reasonCode?: string;
};

export type LocalAiDependencyApplyResult = {
  planId: string;
  modId: string;
  dependencies: LocalAiDependencyDescriptor[];
  installedModels: LocalAiModelRecord[];
  services: LocalAiServiceDescriptor[];
  capabilities: string[];
  stageResults: LocalAiDependencyApplyStageResult[];
  preflightDecisions: LocalAiPreflightDecision[];
  rollbackApplied: boolean;
  warnings: string[];
  reasonCode?: string;
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

export type LocalAiImportPayload = {
  manifestPath: string;
  endpoint?: string;
};

export type LocalAiInferenceAuditPayload = {
  eventType: 'inference_invoked' | 'inference_failed' | 'fallback_to_token_api';
  modId: string;
  source: 'local-runtime' | 'token-api';
  provider: string;
  modality: 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding';
  adapter: LocalAiProviderAdapter;
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
  payload?: Record<string, unknown>;
};

export type LocalAiRuntimeWriteOptions = {
  caller?: 'core' | 'builtin' | 'injected' | 'sideload' | string;
};

export type LocalAiAuditSource = 'local-runtime' | 'token-api' | string;
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
  done: boolean;
  success: boolean;
};

type TauriEventUnsubscribe = () => void;
type TauriEventListen = (
  eventName: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<TauriEventUnsubscribe | undefined> | TauriEventUnsubscribe | undefined;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return String(value || '').trim();
}

function fromProtoStructValue(value: unknown): unknown {
  const record = asRecord(value);
  const kind = asRecord(record.kind);
  const oneof = asString(kind.oneofKind);
  if (oneof === 'stringValue') return asString(kind.stringValue);
  if (oneof === 'numberValue') return Number(kind.numberValue);
  if (oneof === 'boolValue') return Boolean(kind.boolValue);
  if (oneof === 'nullValue') return null;
  if (oneof === 'structValue') return fromProtoStruct(asRecord(kind.structValue));
  if (oneof === 'listValue') {
    const list = asRecord(kind.listValue);
    const values = Array.isArray(list.values) ? list.values : [];
    return values.map((item) => fromProtoStructValue(item));
  }
  return undefined;
}

function fromProtoStruct(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  const fields = asRecord(record.fields);
  if (Object.keys(fields).length === 0) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(fields)) {
    const resolved = fromProtoStructValue(fieldValue);
    if (resolved !== undefined) {
      out[key] = resolved;
    }
  }
  return out;
}

function normalizeStatus(value: unknown): LocalAiModelStatus {
  if (typeof value === 'number') {
    if (value === 2) return 'active';
    if (value === 3) return 'unhealthy';
    if (value === 4) return 'removed';
    return 'installed';
  }
  const raw = asString(value);
  if (raw === 'active' || raw === 'unhealthy' || raw === 'removed') return raw;
  if (raw === 'LOCAL_MODEL_STATUS_ACTIVE' || raw === '2') return 'active';
  if (raw === 'LOCAL_MODEL_STATUS_UNHEALTHY' || raw === '3') return 'unhealthy';
  if (raw === 'LOCAL_MODEL_STATUS_REMOVED' || raw === '4') return 'removed';
  return 'installed';
}

function parseModelRecord(value: unknown): LocalAiModelRecord {
  const record = asRecord(value);
  const source = asRecord(record.source);
  const hashes = asRecord(record.hashes);
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    localModelId: asString(record.localModelId),
    modelId: asString(record.modelId),
    capabilities,
    engine: asString(record.engine),
    entry: asString(record.entry),
    license: asString(record.license),
    source: {
      repo: asString(source.repo),
      revision: asString(source.revision),
    },
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hash]) => [String(key), asString(hash)]),
    ),
    endpoint: asString(record.endpoint),
    status: normalizeStatus(record.status),
    installedAt: asString(record.installedAt),
    updatedAt: asString(record.updatedAt),
    healthDetail: asString(record.healthDetail) || undefined,
  };
}

function parseVerifiedModelDescriptor(value: unknown): LocalAiVerifiedModelDescriptor {
  const record = asRecord(value);
  const hashes = asRecord(record.hashes);
  const files = Array.isArray(record.files)
    ? record.files.map((item) => asString(item)).filter(Boolean)
    : [];
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((item) => asString(item)).filter(Boolean)
    : [];
  const tags = Array.isArray(record.tags)
    ? record.tags.map((item) => asString(item)).filter(Boolean)
    : [];
  const fileCountRaw = Number(record.fileCount);
  const totalSizeBytesRaw = Number(record.totalSizeBytes);
  return {
    templateId: asString(record.templateId),
    title: asString(record.title),
    description: asString(record.description),
    installKind: asString(record.installKind),
    modelId: asString(record.modelId),
    repo: asString(record.repo),
    revision: asString(record.revision) || 'main',
    capabilities,
    engine: asString(record.engine),
    entry: asString(record.entry),
    files,
    license: asString(record.license),
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hash]) => [String(key), asString(hash)]),
    ),
    endpoint: asString(record.endpoint),
    fileCount: Number.isFinite(fileCountRaw) && fileCountRaw > 0 ? fileCountRaw : files.length,
    totalSizeBytes: Number.isFinite(totalSizeBytesRaw) && totalSizeBytesRaw > 0
      ? totalSizeBytesRaw
      : undefined,
    tags,
  };
}

function normalizeEngineRuntimeMode(value: unknown): LocalAiEngineRuntimeMode {
  if (typeof value === 'number') {
    return value === 1 ? 'supervised' : 'attached-endpoint';
  }
  const normalized = asString(value);
  if (normalized === 'LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED' || normalized === '1') {
    return 'supervised';
  }
  return asString(value) === 'supervised' ? 'supervised' : 'attached-endpoint';
}

function normalizeProviderAdapter(value: unknown): LocalAiProviderAdapter {
  const raw = asString(value);
  if (raw === 'localai_native_adapter') return raw;
  return 'openai_compat_adapter';
}

function parseProviderHints(value: unknown): LocalAiProviderHints | undefined {
  const record = asRecord(value);
  const localai = asRecord(record.localai);
  const nexa = asRecord(record.nexa);
  const passthrough = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== 'localai' && key !== 'nexa'),
  );
  if (
    Object.keys(localai).length === 0
    && Object.keys(nexa).length === 0
    && Object.keys(passthrough).length === 0
  ) {
    return undefined;
  }
  const preferredAdapter = asString(localai.preferredAdapter || localai.preferred_adapter);
  const nexaPreferredAdapter = asString(nexa.preferredAdapter || nexa.preferred_adapter);
  const parsed: LocalAiProviderHints = { ...passthrough };
  if (Object.keys(localai).length > 0) {
    parsed.localai = {
      backend: asString(localai.backend) || undefined,
      preferredAdapter: preferredAdapter ? normalizeProviderAdapter(preferredAdapter) : undefined,
      whisperVariant: asString(localai.whisperVariant || localai.whisper_variant) || undefined,
      stablediffusionPipeline: asString(localai.stablediffusionPipeline || localai.stablediffusion_pipeline) || undefined,
      videoBackend: asString(localai.videoBackend || localai.video_backend) || undefined,
    };
  }
  if (Object.keys(nexa).length > 0) {
    parsed.nexa = {
      backend: asString(nexa.backend) || undefined,
      preferredAdapter: nexaPreferredAdapter ? normalizeProviderAdapter(nexaPreferredAdapter) : undefined,
      pluginId: asString(nexa.pluginId || nexa.plugin_id) || undefined,
      deviceId: asString(nexa.deviceId || nexa.device_id) || undefined,
      modelType: asString(nexa.modelType || nexa.model_type) || undefined,
      npuMode: asString(nexa.npuMode || nexa.npu_mode) || undefined,
      policyGate: asString(nexa.policyGate || nexa.policy_gate) || undefined,
      hostNpuReady: typeof (nexa.hostNpuReady ?? nexa.host_npu_ready) === 'boolean'
        ? Boolean(nexa.hostNpuReady ?? nexa.host_npu_ready)
        : undefined,
      modelProbeHasNpuCandidate: typeof (nexa.modelProbeHasNpuCandidate ?? nexa.model_probe_has_npu_candidate) === 'boolean'
        ? Boolean(nexa.modelProbeHasNpuCandidate ?? nexa.model_probe_has_npu_candidate)
        : undefined,
      policyGateAllowsNpu: typeof (nexa.policyGateAllowsNpu ?? nexa.policy_gate_allows_npu) === 'boolean'
        ? Boolean(nexa.policyGateAllowsNpu ?? nexa.policy_gate_allows_npu)
        : undefined,
      npuUsable: typeof (nexa.npuUsable ?? nexa.npu_usable) === 'boolean'
        ? Boolean(nexa.npuUsable ?? nexa.npu_usable)
        : undefined,
      gateReason: asString(nexa.gateReason || nexa.gate_reason) || undefined,
      gateDetail: asString(nexa.gateDetail || nexa.gate_detail) || undefined,
    };
  }
  return parsed;
}

function parseCatalogItemDescriptor(value: unknown): LocalAiCatalogItemDescriptor {
  const record = asRecord(value);
  const hashes = asRecord(record.hashes);
  const files = Array.isArray(record.files)
    ? record.files.map((item) => asString(item)).filter(Boolean)
    : [];
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((item) => asString(item)).filter(Boolean)
    : [];
  const tags = Array.isArray(record.tags)
    ? record.tags.map((item) => asString(item)).filter(Boolean)
    : [];
  const downloads = Number(record.downloads);
  const likes = Number(record.likes);
  return {
    itemId: asString(record.itemId),
    source: asString(record.source) || 'huggingface',
    title: asString(record.title),
    description: asString(record.description),
    modelId: asString(record.modelId),
    repo: asString(record.repo),
    revision: asString(record.revision) || 'main',
    templateId: asString(record.templateId) || undefined,
    capabilities,
    engine: asString(record.engine) || 'localai',
    engineRuntimeMode: normalizeEngineRuntimeMode(record.engineRuntimeMode),
    installKind: asString(record.installKind),
    installAvailable: Boolean(record.installAvailable),
    endpoint: asString(record.endpoint) || undefined,
    providerHints: parseProviderHints(record.providerHints),
    entry: asString(record.entry) || undefined,
    files,
    license: asString(record.license) || undefined,
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hash]) => [String(key), asString(hash)]),
    ),
    tags,
    downloads: Number.isFinite(downloads) && downloads > 0 ? downloads : undefined,
    likes: Number.isFinite(likes) && likes >= 0 ? likes : undefined,
    lastModified: asString(record.lastModified) || undefined,
    verified: Boolean(record.verified),
  };
}

function parseInstallPlanDescriptor(value: unknown): LocalAiInstallPlanDescriptor {
  const record = asRecord(value);
  const hashes = asRecord(record.hashes);
  const files = Array.isArray(record.files)
    ? record.files.map((item) => asString(item)).filter(Boolean)
    : [];
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((item) => asString(item)).filter(Boolean)
    : [];
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    planId: asString(record.planId),
    itemId: asString(record.itemId),
    source: asString(record.source) || 'huggingface',
    templateId: asString(record.templateId) || undefined,
    modelId: asString(record.modelId),
    repo: asString(record.repo),
    revision: asString(record.revision) || 'main',
    capabilities,
    engine: asString(record.engine) || 'localai',
    engineRuntimeMode: normalizeEngineRuntimeMode(record.engineRuntimeMode),
    installKind: asString(record.installKind),
    installAvailable: Boolean(record.installAvailable),
    endpoint: asString(record.endpoint),
    providerHints: parseProviderHints(record.providerHints),
    entry: asString(record.entry),
    files,
    license: asString(record.license),
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hash]) => [String(key), asString(hash)]),
    ),
    warnings,
    reasonCode: asString(record.reasonCode) || undefined,
  };
}

function normalizeDependencyKind(value: unknown): LocalAiDependencyKind {
  if (typeof value === 'number') {
    if (value === 2) return 'service';
    if (value === 3) return 'node';
    return 'model';
  }
  const raw = asString(value).toLowerCase();
  if (raw === 'local_dependency_kind_service' || raw === '2') return 'service';
  if (raw === 'local_dependency_kind_node' || raw === '3') return 'node';
  if (raw === 'service' || raw === 'node') {
    return raw;
  }
  return 'model';
}

function parseDependencyDescriptor(value: unknown): LocalAiDependencyDescriptor {
  const record = asRecord(value);
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    dependencyId: asString(record.dependencyId),
    kind: normalizeDependencyKind(record.kind),
    capability: asString(record.capability) || undefined,
    required: Boolean(record.required),
    selected: Boolean(record.selected),
    preferred: Boolean(record.preferred),
    modelId: asString(record.modelId) || undefined,
    repo: asString(record.repo) || undefined,
    engine: asString(record.engine) || undefined,
    serviceId: asString(record.serviceId) || undefined,
    nodeId: asString(record.nodeId) || undefined,
    reasonCode: asString(record.reasonCode) || undefined,
    warnings,
  };
}

function parseDeviceProfile(value: unknown): LocalAiDeviceProfile {
  const record = asRecord(value);
  const gpu = asRecord(record.gpu);
  const python = asRecord(record.python);
  const npu = asRecord(record.npu);
  const portsRaw = Array.isArray(record.ports) ? record.ports : [];
  const diskFreeBytes = Number(record.diskFreeBytes);
  return {
    os: asString(record.os) || 'unknown',
    arch: asString(record.arch) || 'unknown',
    gpu: {
      available: Boolean(gpu.available),
      vendor: asString(gpu.vendor) || undefined,
      model: asString(gpu.model) || undefined,
    },
    python: {
      available: Boolean(python.available),
      version: asString(python.version) || undefined,
    },
    npu: {
      available: Boolean(npu.available),
      ready: Boolean(npu.ready),
      vendor: asString(npu.vendor) || undefined,
      runtime: asString(npu.runtime) || undefined,
      detail: asString(npu.detail) || undefined,
    },
    diskFreeBytes: Number.isFinite(diskFreeBytes) && diskFreeBytes >= 0 ? diskFreeBytes : 0,
    ports: portsRaw.map((item) => {
      const portRow = asRecord(item);
      const port = Number(portRow.port);
      return {
        port: Number.isFinite(port) && port > 0 ? Math.floor(port) : 0,
        available: Boolean(portRow.available),
      };
    }).filter((item) => item.port > 0),
  };
}

function parsePreflightDecision(value: unknown): LocalAiPreflightDecision {
  const record = asRecord(value);
  return {
    dependencyId: asString(record.dependencyId) || undefined,
    target: asString(record.target),
    check: asString(record.check),
    ok: Boolean(record.ok),
    reasonCode: asString(record.reasonCode),
    detail: asString(record.detail),
  };
}

function parseSelectionRationale(value: unknown): LocalAiDependencySelectionRationale {
  const record = asRecord(value);
  return {
    dependencyId: asString(record.dependencyId),
    selected: Boolean(record.selected),
    reasonCode: asString(record.reasonCode),
    detail: asString(record.detail),
  };
}

function parseApplyStageResult(value: unknown): LocalAiDependencyApplyStageResult {
  const record = asRecord(value);
  return {
    stage: asString(record.stage),
    ok: Boolean(record.ok),
    reasonCode: asString(record.reasonCode) || undefined,
    detail: asString(record.detail) || undefined,
  };
}

function parseDependencyResolutionPlan(value: unknown): LocalAiDependencyResolutionPlan {
  const record = asRecord(value);
  const dependencies = Array.isArray(record.dependencies)
    ? record.dependencies.map((item) => parseDependencyDescriptor(item))
    : [];
  const selectionRationale = Array.isArray(record.selectionRationale)
    ? record.selectionRationale.map((item) => parseSelectionRationale(item))
    : [];
  const preflightDecisions = Array.isArray(record.preflightDecisions)
    ? record.preflightDecisions.map((item) => parsePreflightDecision(item))
    : [];
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    planId: asString(record.planId),
    modId: asString(record.modId),
    capability: asString(record.capability) || undefined,
    deviceProfile: parseDeviceProfile(record.deviceProfile),
    dependencies,
    selectionRationale,
    preflightDecisions,
    warnings,
    reasonCode: asString(record.reasonCode) || undefined,
  };
}

function parseDependencyApplyResult(value: unknown): LocalAiDependencyApplyResult {
  const record = asRecord(value);
  const dependencies = Array.isArray(record.dependencies)
    ? record.dependencies.map((item) => parseDependencyDescriptor(item))
    : [];
  const installedModels = Array.isArray(record.installedModels)
    ? record.installedModels.map((item) => parseModelRecord(item))
    : [];
  const services = Array.isArray(record.services)
    ? record.services.map((item) => parseServiceDescriptor(item))
    : [];
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((item) => asString(item)).filter(Boolean)
    : [];
  const stageResults = Array.isArray(record.stageResults)
    ? record.stageResults.map((item) => parseApplyStageResult(item))
    : [];
  const preflightDecisions = Array.isArray(record.preflightDecisions)
    ? record.preflightDecisions.map((item) => parsePreflightDecision(item))
    : [];
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    planId: asString(record.planId),
    modId: asString(record.modId),
    dependencies,
    installedModels,
    services,
    capabilities,
    stageResults,
    preflightDecisions,
    rollbackApplied: Boolean(record.rollbackApplied),
    warnings,
    reasonCode: asString(record.reasonCode) || undefined,
  };
}

function normalizeServiceStatus(value: unknown): LocalAiServiceStatus {
  if (typeof value === 'number') {
    if (value === 2) return 'active';
    if (value === 3) return 'unhealthy';
    if (value === 4) return 'removed';
    return 'installed';
  }
  const raw = asString(value).toLowerCase();
  if (raw === 'local_service_status_active' || raw === '2') return 'active';
  if (raw === 'local_service_status_unhealthy' || raw === '3') return 'unhealthy';
  if (raw === 'local_service_status_removed' || raw === '4') return 'removed';
  if (raw === 'active' || raw === 'unhealthy' || raw === 'removed') {
    return raw;
  }
  return 'installed';
}

function normalizeServiceArtifactType(
  value: unknown,
): LocalAiServiceDescriptor['artifactType'] {
  const raw = asString(value).toLowerCase();
  if (raw === 'python-env' || raw === 'binary' || raw === 'attached-endpoint') {
    return raw;
  }
  return undefined;
}

function parseServiceDescriptor(value: unknown): LocalAiServiceDescriptor {
  const record = asRecord(value);
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    serviceId: asString(record.serviceId),
    title: asString(record.title),
    engine: asString(record.engine),
    artifactType: normalizeServiceArtifactType(record.artifactType),
    endpoint: asString(record.endpoint) || undefined,
    capabilities,
    localModelId: asString(record.localModelId) || undefined,
    status: normalizeServiceStatus(record.status),
    detail: asString(record.detail) || undefined,
    installedAt: asString(record.installedAt),
    updatedAt: asString(record.updatedAt),
  };
}

function parseNodeDescriptor(value: unknown): LocalAiNodeDescriptor {
  const record = asRecord(value);
  return {
    nodeId: asString(record.nodeId),
    title: asString(record.title),
    serviceId: asString(record.serviceId),
    capabilities: Array.isArray(record.capabilities)
      ? record.capabilities.map((item) => asString(item)).filter(Boolean)
      : [],
    provider: asString(record.provider) || 'localai',
    adapter: normalizeProviderAdapter(record.adapter),
    backend: asString(record.backend) || undefined,
    backendSource: asString(record.backendSource) || undefined,
    available: Boolean(record.available),
    reasonCode: asString(record.reasonCode) || undefined,
    providerHints: parseProviderHints(record.providerHints),
    policyGate: asString(record.policyGate) || undefined,
    apiPath: asString(record.apiPath) || undefined,
    inputSchema: fromProtoStruct(record.inputSchema)
      || (record.inputSchema && typeof record.inputSchema === 'object' && !Array.isArray(record.inputSchema)
        ? record.inputSchema as Record<string, unknown>
        : undefined),
    outputSchema: fromProtoStruct(record.outputSchema)
      || (record.outputSchema && typeof record.outputSchema === 'object' && !Array.isArray(record.outputSchema)
        ? record.outputSchema as Record<string, unknown>
        : undefined),
    readOnly: Boolean(record.readOnly),
  };
}

function parseModelHealth(value: unknown): LocalAiModelHealth {
  const record = asRecord(value);
  return {
    localModelId: asString(record.localModelId),
    status: normalizeStatus(record.status),
    detail: asString(record.detail),
    endpoint: asString(record.endpoint),
  };
}

function parseAuditEvent(value: unknown): LocalAiAuditEvent {
  const record = asRecord(value);
  const payload = fromProtoStruct(record.payload)
    || (record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
      ? (record.payload as Record<string, unknown>)
      : undefined);
  const source = asString(record.source || payload?.source) || undefined;
  const modality = asString(record.modality || payload?.modality) || undefined;
  const reasonCode = asString(record.reasonCode || payload?.reasonCode) || undefined;
  const detail = asString(record.detail || payload?.detail || payload?.error) || undefined;
  return {
    id: asString(record.id),
    eventType: asString(record.eventType),
    occurredAt: asString(record.occurredAt),
    source,
    modality,
    reasonCode,
    detail,
    modelId: asString(record.modelId) || undefined,
    localModelId: asString(record.localModelId) || undefined,
    payload,
  };
}

function parseDownloadProgressEvent(value: unknown): LocalAiDownloadProgressEvent {
  const record = asRecord(value);
  const bytesReceived = Number(record.bytesReceived);
  const bytesTotalRaw = Number(record.bytesTotal);
  const speedRaw = Number(record.speedBytesPerSec);
  const etaRaw = Number(record.etaSeconds);
  return {
    installSessionId: asString(record.installSessionId),
    modelId: asString(record.modelId),
    localModelId: asString(record.localModelId) || undefined,
    phase: asString(record.phase) || 'download',
    bytesReceived: Number.isFinite(bytesReceived) && bytesReceived >= 0 ? bytesReceived : 0,
    bytesTotal: Number.isFinite(bytesTotalRaw) && bytesTotalRaw >= 0 ? bytesTotalRaw : undefined,
    speedBytesPerSec: Number.isFinite(speedRaw) && speedRaw >= 0 ? speedRaw : undefined,
    etaSeconds: Number.isFinite(etaRaw) && etaRaw >= 0 ? etaRaw : undefined,
    message: asString(record.message) || undefined,
    done: Boolean(record.done),
    success: Boolean(record.success),
  };
}

function readGlobalTauriEventListen(): TauriEventListen | null {
  const value = globalThis as {
    window?: {
      __TAURI__?: {
        event?: {
          listen?: TauriEventListen;
        };
      };
    };
    __TAURI__?: {
      event?: {
        listen?: TauriEventListen;
      };
    };
  };
  const fromWindow = value.window?.__TAURI__?.event?.listen;
  if (typeof fromWindow === 'function') {
    return fromWindow.bind(value.window?.__TAURI__?.event);
  }
  const fromGlobal = value.__TAURI__?.event?.listen;
  if (typeof fromGlobal === 'function') {
    return fromGlobal.bind(value.__TAURI__?.event);
  }
  return null;
}

function normalizeCaller(caller: LocalAiRuntimeWriteOptions['caller']): string {
  return asString(caller || 'core').toLowerCase() || 'core';
}

function assertLifecycleWriteAllowed(command: string, caller: LocalAiRuntimeWriteOptions['caller']): void {
  const normalizedCaller = normalizeCaller(caller);
  if (normalizedCaller === 'core') return;

  emitRuntimeLog({
    level: 'warn',
    area: 'local-ai-runtime-audit',
    message: 'fallback:local-runtime-lifecycle-write-denied',
    details: {
      command,
      caller: normalizedCaller,
      decision: 'DENY',
      reasonCode: 'LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED',
    },
  });
  throw new Error(`LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED: caller=${normalizedCaller}`);
}

function makeTraceId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRuntimeUnavailableError(error: unknown): boolean {
  const reasonCode = asString((error as { reasonCode?: unknown } | null)?.reasonCode).toUpperCase();
  if (
    reasonCode.includes('UNAVAILABLE')
    || reasonCode === 'RUNTIME_UNAVAILABLE'
    || reasonCode === 'RUNTIME_BRIDGE_DAEMON_UNAVAILABLE'
  ) {
    return true;
  }
  const message = asString((error as { message?: unknown } | null)?.message).toUpperCase();
  if (!message) {
    return false;
  }
  return (
    message.includes('PLATFORM_CLIENT_NOT_READY')
    || message.includes('UNAVAILABLE')
    || message.includes('RUNTIME_BRIDGE')
    || message.includes('NETWORK')
  );
}

function buildRuntimeFailFastError(action: string, error: unknown): Error {
  const upstream = error as {
    reasonCode?: unknown;
    actionHint?: unknown;
    traceId?: unknown;
    message?: unknown;
  } | null;
  const reasonCode = asString(upstream?.reasonCode) || 'RUNTIME_UNAVAILABLE';
  const actionHint = asString(upstream?.actionHint) || 'start_or_restart_runtime_then_retry';
  const traceId = asString(upstream?.traceId) || makeTraceId('runtime-unavailable');
  const detail = asString(upstream?.message) || String(error || '');
  const failFast = new Error(
    `${reasonCode}: ${action} failed; actionHint=${actionHint}; traceId=${traceId}; detail=${detail}`,
  ) as Error & { reasonCode?: string; actionHint?: string; traceId?: string };
  failFast.reasonCode = reasonCode;
  failFast.actionHint = actionHint;
  failFast.traceId = traceId;
  return failFast;
}

function runtimeCallOptions(caller?: LocalAiRuntimeWriteOptions['caller'], timeoutMs = 8000): {
  timeoutMs: number;
  metadata: {
    callerKind: 'desktop-core' | 'desktop-mod';
    callerId: string;
    surfaceId: string;
    traceId: string;
  };
} {
  const normalizedCaller = normalizeCaller(caller);
  const callerKind = normalizedCaller === 'core' ? 'desktop-core' : 'desktop-mod';
  const callerId = normalizedCaller === 'core'
    ? 'local-ai-runtime'
    : `mod:${normalizedCaller}`;
  return {
    timeoutMs,
    metadata: {
      callerKind,
      callerId,
      surfaceId: 'desktop.local-ai-runtime',
      traceId: makeTraceId('local-runtime'),
    },
  };
}

async function withLocalRuntimeClient<T>(input: {
  action: string;
  caller?: LocalAiRuntimeWriteOptions['caller'];
  timeoutMs?: number;
  run: (
    client: RuntimeLocalRuntimeClient,
    options: ReturnType<typeof runtimeCallOptions>,
  ) => Promise<T>;
}): Promise<T> {
  try {
    const localRuntimeClient = await getRuntimeLocalRuntimeClient();
    const options = runtimeCallOptions(input.caller, input.timeoutMs);
    return await input.run(localRuntimeClient, options);
  } catch (error) {
    if (isRuntimeUnavailableError(error)) {
      throw buildRuntimeFailFastError(input.action, error);
    }
    throw error;
  }
}

function toProtoDependencyKind(kind: LocalAiDependencyKind | string | undefined): number {
  const normalized = asString(kind).toLowerCase();
  if (normalized === 'service') return 2;
  if (normalized === 'node') return 3;
  return 1;
}

type ProtoStruct = {
  fields: Record<string, ProtoStructValue>;
};

type ProtoStructValue = {
  kind:
    | { oneofKind: 'nullValue'; nullValue: 0 }
    | { oneofKind: 'numberValue'; numberValue: number }
    | { oneofKind: 'stringValue'; stringValue: string }
    | { oneofKind: 'boolValue'; boolValue: boolean }
    | { oneofKind: 'structValue'; structValue: ProtoStruct }
    | { oneofKind: 'listValue'; listValue: { values: ProtoStructValue[] } }
    | { oneofKind: undefined };
};

type ProtoLocalDependencyOptionDescriptor = {
  dependencyId: string;
  kind: number;
  capability: string;
  title: string;
  modelId: string;
  repo: string;
  serviceId: string;
  nodeId: string;
  engine: string;
};

type ProtoLocalDependenciesDeclarationDescriptor = {
  required: ProtoLocalDependencyOptionDescriptor[];
  optional: ProtoLocalDependencyOptionDescriptor[];
  alternatives: Array<{
    alternativeId: string;
    preferredDependencyId: string;
    options: ProtoLocalDependencyOptionDescriptor[];
  }>;
  preferred: Record<string, string>;
};

type ProtoLocalDeviceProfile = {
  os: string;
  arch: string;
  gpu: {
    available: boolean;
    vendor: string;
    model: string;
  };
  python: {
    available: boolean;
    version: string;
  };
  npu: {
    available: boolean;
    ready: boolean;
    vendor: string;
    runtime: string;
    detail: string;
  };
  diskFreeBytes: string;
  ports: Array<{
    port: number;
    available: boolean;
  }>;
};

type ProtoLocalDependencyResolutionPlan = {
  planId: string;
  modId: string;
  capability: string;
  deviceProfile: ProtoLocalDeviceProfile;
  dependencies: Array<{
    dependencyId: string;
    kind: number;
    capability: string;
    required: boolean;
    selected: boolean;
    preferred: boolean;
    modelId: string;
    repo: string;
    engine: string;
    serviceId: string;
    nodeId: string;
    reasonCode: string;
    warnings: string[];
  }>;
  selectionRationale: Array<{
    dependencyId: string;
    selected: boolean;
    reasonCode: string;
    detail: string;
  }>;
  preflightDecisions: Array<{
    dependencyId: string;
    target: string;
    check: string;
    ok: boolean;
    reasonCode: string;
    detail: string;
  }>;
  warnings: string[];
  reasonCode: string;
};

function toProtoStructValue(value: unknown): ProtoStructValue {
  if (value === null || value === undefined) {
    return {
      kind: {
        oneofKind: 'nullValue',
        nullValue: 0,
      },
    };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      kind: {
        oneofKind: 'numberValue',
        numberValue: value,
      },
    };
  }
  if (typeof value === 'string') {
    return {
      kind: {
        oneofKind: 'stringValue',
        stringValue: value,
      },
    };
  }
  if (typeof value === 'boolean') {
    return {
      kind: {
        oneofKind: 'boolValue',
        boolValue: value,
      },
    };
  }
  if (Array.isArray(value)) {
    return {
      kind: {
        oneofKind: 'listValue',
        listValue: {
          values: value.map((item) => toProtoStructValue(item)),
        },
      },
    };
  }
  if (typeof value === 'object') {
    return {
      kind: {
        oneofKind: 'structValue',
        structValue: toProtoStruct(value) || { fields: {} },
      },
    };
  }
  return {
    kind: {
      oneofKind: 'stringValue',
      stringValue: String(value),
    },
  };
}

function toProtoStruct(value: unknown): ProtoStruct | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return undefined;
  }
  const fields: Record<string, ProtoStructValue> = {};
  for (const [key, entryValue] of entries) {
    if (!key) continue;
    fields[key] = toProtoStructValue(entryValue);
  }
  if (Object.keys(fields).length === 0) {
    return undefined;
  }
  return { fields };
}

function toProtoDependencyOption(
  option: LocalAiDependencyOptionDescriptor,
): ProtoLocalDependencyOptionDescriptor {
  return {
    dependencyId: option.dependencyId,
    kind: toProtoDependencyKind(option.kind),
    capability: option.capability || '',
    title: option.title || '',
    modelId: option.modelId || '',
    repo: option.repo || '',
    serviceId: option.serviceId || '',
    nodeId: option.nodeId || '',
    engine: option.engine || '',
  };
}

function toProtoDependenciesDeclaration(
  descriptor: LocalAiDependenciesDeclarationDescriptor,
): ProtoLocalDependenciesDeclarationDescriptor {
  return {
    required: (descriptor.required || []).map((item) => toProtoDependencyOption(item)),
    optional: (descriptor.optional || []).map((item) => toProtoDependencyOption(item)),
    alternatives: (descriptor.alternatives || []).map((alternative) => ({
      alternativeId: alternative.alternativeId,
      preferredDependencyId: alternative.preferredDependencyId || '',
      options: (alternative.options || []).map((item) => toProtoDependencyOption(item)),
    })),
    preferred: Object.fromEntries(
      Object.entries(descriptor.preferred || {})
        .map(([key, value]) => [key, asString(value)])
        .filter(([key, value]) => Boolean(key) && Boolean(value)),
    ),
  };
}

function toProtoDeviceProfile(profile: LocalAiDeviceProfile): ProtoLocalDeviceProfile {
  const diskFreeBytes = Number.isFinite(profile.diskFreeBytes) && profile.diskFreeBytes > 0
    ? Math.floor(profile.diskFreeBytes)
    : 0;
  return {
    os: profile.os,
    arch: profile.arch,
    gpu: {
      available: Boolean(profile.gpu.available),
      vendor: profile.gpu.vendor || '',
      model: profile.gpu.model || '',
    },
    python: {
      available: Boolean(profile.python.available),
      version: profile.python.version || '',
    },
    npu: {
      available: Boolean(profile.npu.available),
      ready: Boolean(profile.npu.ready),
      vendor: profile.npu.vendor || '',
      runtime: profile.npu.runtime || '',
      detail: profile.npu.detail || '',
    },
    diskFreeBytes: String(diskFreeBytes),
    ports: (profile.ports || []).map((port) => ({
      port: port.port,
      available: Boolean(port.available),
    })),
  };
}

function toProtoDependencyResolutionPlan(
  plan: LocalAiDependencyResolutionPlan,
): ProtoLocalDependencyResolutionPlan {
  return {
    planId: plan.planId,
    modId: plan.modId,
    capability: plan.capability || '',
    deviceProfile: toProtoDeviceProfile(plan.deviceProfile),
    dependencies: (plan.dependencies || []).map((dependency) => ({
      dependencyId: dependency.dependencyId,
      kind: toProtoDependencyKind(dependency.kind),
      capability: dependency.capability || '',
      required: Boolean(dependency.required),
      selected: Boolean(dependency.selected),
      preferred: Boolean(dependency.preferred),
      modelId: dependency.modelId || '',
      repo: dependency.repo || '',
      engine: dependency.engine || '',
      serviceId: dependency.serviceId || '',
      nodeId: dependency.nodeId || '',
      reasonCode: dependency.reasonCode || '',
      warnings: dependency.warnings || [],
    })),
    selectionRationale: (plan.selectionRationale || []).map((item) => ({
      dependencyId: item.dependencyId,
      selected: Boolean(item.selected),
      reasonCode: item.reasonCode,
      detail: item.detail,
    })),
    preflightDecisions: (plan.preflightDecisions || []).map((item) => ({
      dependencyId: item.dependencyId || '',
      target: item.target,
      check: item.check,
      ok: Boolean(item.ok),
      reasonCode: item.reasonCode,
      detail: item.detail,
    })),
    warnings: plan.warnings || [],
    reasonCode: plan.reasonCode || '',
  };
}

export async function listLocalAiRuntimeModels(): Promise<LocalAiModelRecord[]> {
  const response = await withLocalRuntimeClient({
    action: 'list local models',
    timeoutMs: 4000,
    run: (client, options) => client.listLocalModels({}, options),
  });
  const models = Array.isArray(response.models) ? response.models : [];
  return models.map((item) => parseModelRecord(item));
}

export async function listLocalAiRuntimeVerifiedModels(): Promise<LocalAiVerifiedModelDescriptor[]> {
  const response = await withLocalRuntimeClient({
    action: 'list verified local models',
    timeoutMs: 4000,
    run: (client, options) => client.listVerifiedModels({}, options),
  });
  const models = Array.isArray(response.models) ? response.models : [];
  return models.map((item) => parseVerifiedModelDescriptor(item));
}

export async function searchLocalAiRuntimeCatalog(
  payload?: LocalAiCatalogSearchPayload,
): Promise<LocalAiCatalogItemDescriptor[]> {
  const response = await withLocalRuntimeClient({
    action: 'search local model catalog',
    timeoutMs: 5000,
    run: (client, options) => client.searchCatalogModels({
      query: payload?.query || '',
      capability: payload?.capability || '',
      limit: payload?.limit || 0,
    }, options),
  });
  const items = Array.isArray(response.items) ? response.items : [];
  return items.map((item) => parseCatalogItemDescriptor(item));
}

export async function resolveLocalAiRuntimeInstallPlan(
  payload: LocalAiCatalogResolveInstallPlanPayload,
): Promise<LocalAiInstallPlanDescriptor> {
  const response = await withLocalRuntimeClient({
    action: 'resolve model install plan',
    timeoutMs: 5000,
    run: (client, options) => client.resolveModelInstallPlan({
      itemId: payload.itemId || '',
      source: payload.source || '',
      templateId: payload.templateId || '',
      modelId: payload.modelId || '',
      repo: payload.repo || '',
      revision: payload.revision || '',
      capabilities: payload.capabilities || [],
      engine: payload.engine || '',
      entry: payload.entry || '',
      files: payload.files || [],
      license: payload.license || '',
      hashes: payload.hashes || {},
      endpoint: payload.endpoint || '',
    }, options),
  });
  return parseInstallPlanDescriptor(response.plan || {});
}

export async function collectLocalAiRuntimeDeviceProfile(): Promise<LocalAiDeviceProfile> {
  const response = await withLocalRuntimeClient({
    action: 'collect device profile',
    timeoutMs: 4000,
    run: (client, options) => client.collectDeviceProfile({}, options),
  });
  return parseDeviceProfile(response.profile || {});
}

export async function resolveLocalAiRuntimeDependencies(
  payload: LocalAiDependenciesResolvePayload,
): Promise<LocalAiDependencyResolutionPlan> {
  const response = await withLocalRuntimeClient({
    action: 'resolve local dependencies',
    timeoutMs: 6000,
    run: (client, options) => client.resolveDependencies({
      modId: payload.modId,
      capability: payload.capability || '',
      dependencies: payload.dependencies
        ? toProtoDependenciesDeclaration(payload.dependencies)
        : undefined,
      deviceProfile: toProtoDeviceProfile(payload.deviceProfile),
    }, options),
  });
  return parseDependencyResolutionPlan(response.plan || {});
}

export async function applyLocalAiRuntimeDependencies(
  plan: LocalAiDependencyResolutionPlan,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiDependencyApplyResult> {
  assertLifecycleWriteAllowed('local_runtime_dependencies_apply', options?.caller);
  const response = await withLocalRuntimeClient({
    action: 'apply local dependencies',
    caller: options?.caller,
    timeoutMs: 12000,
    run: (client, runtimeOptions) => client.applyDependencies({
      plan: toProtoDependencyResolutionPlan(plan),
    }, runtimeOptions),
  });
  return parseDependencyApplyResult(response.result || {});
}

export async function listLocalAiRuntimeServices(): Promise<LocalAiServiceDescriptor[]> {
  const response = await withLocalRuntimeClient({
    action: 'list local services',
    timeoutMs: 4000,
    run: (client, options) => client.listLocalServices({}, options),
  });
  const services = Array.isArray(response.services) ? response.services : [];
  return services.map((item) => parseServiceDescriptor(item));
}

export async function installLocalAiRuntimeService(
  payload: LocalAiServicesInstallPayload,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_install', options?.caller);
  const response = await withLocalRuntimeClient({
    action: 'install local service',
    caller: options?.caller,
    timeoutMs: 10000,
    run: (client, runtimeOptions) => client.installLocalService({
      serviceId: payload.serviceId,
      title: payload.title || '',
      engine: payload.engine || '',
      endpoint: payload.endpoint || '',
      capabilities: payload.capabilities || [],
      localModelId: payload.localModelId || '',
    }, runtimeOptions),
  });
  return parseServiceDescriptor(response.service || {});
}

export async function startLocalAiRuntimeService(
  serviceId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_start', options?.caller);
  const response = await withLocalRuntimeClient({
    action: 'start local service',
    caller: options?.caller,
    timeoutMs: 6000,
    run: (client, runtimeOptions) => client.startLocalService({ serviceId }, runtimeOptions),
  });
  return parseServiceDescriptor(response.service || {});
}

export async function stopLocalAiRuntimeService(
  serviceId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_stop', options?.caller);
  const response = await withLocalRuntimeClient({
    action: 'stop local service',
    caller: options?.caller,
    timeoutMs: 6000,
    run: (client, runtimeOptions) => client.stopLocalService({ serviceId }, runtimeOptions),
  });
  return parseServiceDescriptor(response.service || {});
}

export async function healthLocalAiRuntimeServices(serviceId?: string): Promise<LocalAiServiceDescriptor[]> {
  const response = await withLocalRuntimeClient({
    action: 'check local service health',
    timeoutMs: 4000,
    run: (client, options) => client.checkLocalServiceHealth({
      serviceId: serviceId || '',
    }, options),
  });
  const services = Array.isArray(response.services) ? response.services : [];
  return services.map((item) => parseServiceDescriptor(item));
}

export async function removeLocalAiRuntimeService(
  serviceId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_remove', options?.caller);
  const response = await withLocalRuntimeClient({
    action: 'remove local service',
    caller: options?.caller,
    timeoutMs: 6000,
    run: (client, runtimeOptions) => client.removeLocalService({ serviceId }, runtimeOptions),
  });
  return parseServiceDescriptor(response.service || {});
}

export async function listLocalAiRuntimeNodesCatalog(
  payload?: LocalAiNodesCatalogListPayload,
): Promise<LocalAiNodeDescriptor[]> {
  const response = await withLocalRuntimeClient({
    action: 'list local runtime node catalog',
    timeoutMs: 5000,
    run: (client, options) => client.listNodeCatalog({
      capability: payload?.capability || '',
      serviceId: payload?.serviceId || '',
      provider: payload?.provider || '',
    }, options),
  });
  const nodes = Array.isArray(response.nodes) ? response.nodes : [];
  return nodes.map((item) => parseNodeDescriptor(item));
}

export async function listLocalAiRuntimeAudits(query?: LocalAiAuditQuery): Promise<LocalAiAuditEvent[]> {
  const eventTypes = query?.eventTypes && query.eventTypes.length > 0
    ? query.eventTypes
    : (query?.eventType ? [query.eventType] : []);
  const response = await withLocalRuntimeClient({
    action: 'list local runtime audits',
    timeoutMs: 5000,
    run: (client, options) => client.listLocalAudits({
      limit: query?.limit || 0,
      eventType: query?.eventType || '',
      eventTypes,
      source: query?.source || '',
      modality: query?.modality || '',
      localModelId: query?.localModelId || '',
      modId: query?.modId || '',
      reasonCode: query?.reasonCode || '',
      timeRange: query?.timeRange
        ? {
          from: query.timeRange.from || '',
          to: query.timeRange.to || '',
        }
        : undefined,
    }, options),
  });
  const events = Array.isArray(response.events) ? response.events : [];
  return events.map((item) => parseAuditEvent(item));
}

export async function pickLocalAiRuntimeManifestPath(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<unknown>('runtime_mod_pick_manifest_path', {});
  const normalized = asString(result);
  return normalized || null;
}

export async function installLocalAiRuntimeModel(
  payload: LocalAiInstallPayload,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_install', options?.caller);
  const response = await withLocalRuntimeClient({
    action: 'install local model',
    caller: options?.caller,
    timeoutMs: 15000,
    run: (client, runtimeOptions) => client.installLocalModel({
      modelId: payload.modelId,
      repo: payload.repo,
      revision: payload.revision || '',
      capabilities: payload.capabilities || [],
      engine: payload.engine || '',
      entry: payload.entry || '',
      files: payload.files || [],
      license: payload.license || '',
      hashes: payload.hashes || {},
      endpoint: payload.endpoint || '',
    }, runtimeOptions),
  });
  return parseModelRecord(response.model || {});
}

export async function installLocalAiRuntimeVerifiedModel(
  payload: LocalAiInstallVerifiedPayload,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_install_verified', options?.caller);
  const response = await withLocalRuntimeClient({
    action: 'install verified local model',
    caller: options?.caller,
    timeoutMs: 15000,
    run: (client, runtimeOptions) => client.installVerifiedModel({
      templateId: payload.templateId,
      endpoint: payload.endpoint || '',
    }, runtimeOptions),
  });
  return parseModelRecord(response.model || {});
}

export async function importLocalAiRuntimeModel(
  payload: LocalAiImportPayload,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_import', options?.caller);
  const response = await withLocalRuntimeClient({
    action: 'import local model',
    caller: options?.caller,
    timeoutMs: 15000,
    run: (client, runtimeOptions) => client.importLocalModel({
      manifestPath: payload.manifestPath,
      endpoint: payload.endpoint || '',
    }, runtimeOptions),
  });
  return parseModelRecord(response.model || {});
}

export async function removeLocalAiRuntimeModel(
  localModelId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_remove', options?.caller);
  const response = await withLocalRuntimeClient({
    action: 'remove local model',
    caller: options?.caller,
    timeoutMs: 7000,
    run: (client, runtimeOptions) => client.removeLocalModel({ localModelId }, runtimeOptions),
  });
  return parseModelRecord(response.model || {});
}

export async function startLocalAiRuntimeModel(
  localModelId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_start', options?.caller);
  const response = await withLocalRuntimeClient({
    action: 'start local model',
    caller: options?.caller,
    timeoutMs: 7000,
    run: (client, runtimeOptions) => client.startLocalModel({ localModelId }, runtimeOptions),
  });
  return parseModelRecord(response.model || {});
}

export async function stopLocalAiRuntimeModel(
  localModelId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_stop', options?.caller);
  const response = await withLocalRuntimeClient({
    action: 'stop local model',
    caller: options?.caller,
    timeoutMs: 7000,
    run: (client, runtimeOptions) => client.stopLocalModel({ localModelId }, runtimeOptions),
  });
  return parseModelRecord(response.model || {});
}

export async function healthLocalAiRuntimeModels(localModelId?: string): Promise<LocalAiModelHealth[]> {
  const response = await withLocalRuntimeClient({
    action: 'check local model health',
    timeoutMs: 4000,
    run: (client, options) => client.checkLocalModelHealth({
      localModelId: localModelId || '',
    }, options),
  });
  const models = Array.isArray(response.models) ? response.models : [];
  return models.map((item) => parseModelHealth(item));
}

export async function appendLocalAiRuntimeInferenceAudit(payload: LocalAiInferenceAuditPayload): Promise<void> {
  await withLocalRuntimeClient({
    action: 'append local inference audit',
    timeoutMs: 5000,
    run: async (client, options) => {
      const policyGate = typeof payload.policyGate === 'string'
        ? toProtoStruct({ value: payload.policyGate })
        : toProtoStruct(payload.policyGate || {});
      await client.appendInferenceAudit({
        eventType: payload.eventType,
        modId: payload.modId,
        source: payload.source,
        provider: payload.provider,
        modality: payload.modality,
        adapter: payload.adapter,
        model: payload.model || '',
        localModelId: payload.localModelId || '',
        endpoint: payload.endpoint || '',
        reasonCode: payload.reasonCode || '',
        detail: payload.detail || '',
        policyGate,
        extra: toProtoStruct(payload.extra || {}),
      }, options);
    },
  });
}

export async function appendLocalAiRuntimeAudit(payload: LocalAiRuntimeAuditPayload): Promise<void> {
  await withLocalRuntimeClient({
    action: 'append local runtime audit',
    timeoutMs: 5000,
    run: async (client, options) => {
      await client.appendRuntimeAudit({
        eventType: payload.eventType,
        modelId: payload.modelId || '',
        localModelId: payload.localModelId || '',
        payload: toProtoStruct(payload.payload || {}),
      }, options);
    },
  });
}

const LOCAL_AI_DOWNLOAD_PROGRESS_EVENT = 'local-ai://download-progress';

export async function subscribeLocalAiRuntimeDownloadProgress(
  listener: (event: LocalAiDownloadProgressEvent) => void,
): Promise<() => void> {
  const listen = readGlobalTauriEventListen();
  if (!listen) {
    return () => {};
  }
  const unsubscribe = await Promise.resolve(listen(LOCAL_AI_DOWNLOAD_PROGRESS_EVENT, (event) => {
    const parsed = parseDownloadProgressEvent(event.payload);
    if (!parsed.installSessionId || !parsed.modelId) {
      return;
    }
    listener(parsed);
  }));
  if (typeof unsubscribe === 'function') {
    return unsubscribe;
  }
  return () => {};
}

export async function fetchLocalAiRuntimeSnapshot(localModelId?: string): Promise<LocalAiRuntimeSnapshot> {
  const [models, health] = await Promise.all([
    listLocalAiRuntimeModels(),
    healthLocalAiRuntimeModels(localModelId),
  ]);
  return {
    models,
    health,
    generatedAt: new Date().toISOString(),
  };
}
