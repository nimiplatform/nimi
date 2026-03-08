import type {
  LocalAiArtifactKind,
  LocalAiArtifactRecord,
  LocalAiArtifactStatus,
  LocalAiModelStatus,
  LocalAiModelRecord,
  LocalAiVerifiedArtifactDescriptor,
  LocalAiVerifiedModelDescriptor,
  LocalAiEngineRuntimeMode,
  LocalAiProviderAdapter,
  LocalAiProviderHints,
  LocalAiCatalogItemDescriptor,
  LocalAiInstallPlanDescriptor,
  LocalAiDependencyApplyResult,
  LocalAiServiceStatus,
  LocalAiServiceDescriptor,
  LocalAiNodeDescriptor,
} from './types';
import { asRecord, asString } from './parser-primitives';
import { asPlainObject } from './parser-helpers';
import { parseApplyStageResult, parseDependencyDescriptor, parsePreflightDecision } from './parsers-dependencies';
export { asRecord, asString } from './parser-primitives';
export {
  assertLifecycleWriteAllowed,
  invokeLocalAiCommand,
  normalizeCaller,
  readGlobalTauriEventListen,
} from './parser-helpers';
export {
  normalizeDependencyKind,
  parseApplyStageResult,
  parseDependencyDescriptor,
  parseDependencyResolutionPlan,
  parseDeviceProfile,
  parsePreflightDecision,
  parseSelectionRationale,
} from './parsers-dependencies';
export {
  normalizeDownloadState,
  parseAuditEvent,
  parseDownloadProgressEvent,
  parseDownloadSessionSummary,
  parseGgufVariantDescriptor,
  parseInstallAcceptedResponse,
  parseModelHealth,
  parseOrphanModelFile,
} from './parsers-runtime-events';
export function normalizeStatus(value: unknown): LocalAiModelStatus {
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

export function parseModelRecord(value: unknown): LocalAiModelRecord {
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
    engineConfig: asPlainObject(record.engineConfig),
  };
}

export function parseVerifiedModelDescriptor(value: unknown): LocalAiVerifiedModelDescriptor {
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
    engineConfig: asPlainObject(record.engineConfig),
  };
}

export function normalizeArtifactKind(value: unknown): LocalAiArtifactKind {
  if (typeof value === 'number') {
    if (value === 2) return 'llm';
    if (value === 3) return 'clip';
    if (value === 4) return 'controlnet';
    if (value === 5) return 'lora';
    if (value === 6) return 'auxiliary';
    return 'vae';
  }
  const raw = asString(value).toLowerCase();
  if (raw === 'local_artifact_kind_llm' || raw === '2' || raw === 'llm') return 'llm';
  if (raw === 'local_artifact_kind_clip' || raw === '3' || raw === 'clip') return 'clip';
  if (raw === 'local_artifact_kind_controlnet' || raw === '4' || raw === 'controlnet') return 'controlnet';
  if (raw === 'local_artifact_kind_lora' || raw === '5' || raw === 'lora') return 'lora';
  if (raw === 'local_artifact_kind_auxiliary' || raw === '6' || raw === 'auxiliary') return 'auxiliary';
  return 'vae';
}

export function normalizeArtifactStatus(value: unknown): LocalAiArtifactStatus {
  if (typeof value === 'number') {
    if (value === 2) return 'active';
    if (value === 3) return 'unhealthy';
    if (value === 4) return 'removed';
    return 'installed';
  }
  const raw = asString(value).toLowerCase();
  if (raw === 'local_artifact_status_active' || raw === '2' || raw === 'active') return 'active';
  if (raw === 'local_artifact_status_unhealthy' || raw === '3' || raw === 'unhealthy') return 'unhealthy';
  if (raw === 'local_artifact_status_removed' || raw === '4' || raw === 'removed') return 'removed';
  return 'installed';
}

export function parseArtifactRecord(value: unknown): LocalAiArtifactRecord {
  const record = asRecord(value);
  const source = asRecord(record.source);
  const hashes = asRecord(record.hashes);
  const files = Array.isArray(record.files)
    ? record.files.map((item) => asString(item)).filter(Boolean)
    : [];
  return {
    localArtifactId: asString(record.localArtifactId),
    artifactId: asString(record.artifactId),
    kind: normalizeArtifactKind(record.kind),
    engine: asString(record.engine),
    entry: asString(record.entry),
    files,
    license: asString(record.license),
    source: {
      repo: asString(source.repo),
      revision: asString(source.revision),
    },
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hash]) => [String(key), asString(hash)]),
    ),
    status: normalizeArtifactStatus(record.status),
    installedAt: asString(record.installedAt),
    updatedAt: asString(record.updatedAt),
    healthDetail: asString(record.healthDetail) || undefined,
    metadata: asPlainObject(record.metadata),
  };
}

export function parseVerifiedArtifactDescriptor(value: unknown): LocalAiVerifiedArtifactDescriptor {
  const record = asRecord(value);
  const hashes = asRecord(record.hashes);
  const files = Array.isArray(record.files)
    ? record.files.map((item) => asString(item)).filter(Boolean)
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
    artifactId: asString(record.artifactId),
    kind: normalizeArtifactKind(record.kind),
    engine: asString(record.engine),
    entry: asString(record.entry),
    files,
    license: asString(record.license),
    repo: asString(record.repo),
    revision: asString(record.revision) || 'main',
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hash]) => [String(key), asString(hash)]),
    ),
    fileCount: Number.isFinite(fileCountRaw) && fileCountRaw > 0 ? fileCountRaw : files.length,
    totalSizeBytes: Number.isFinite(totalSizeBytesRaw) && totalSizeBytesRaw > 0
      ? totalSizeBytesRaw
      : undefined,
    tags,
    metadata: asPlainObject(record.metadata),
  };
}

export function normalizeEngineRuntimeMode(value: unknown): LocalAiEngineRuntimeMode {
  if (typeof value === 'number') {
    return value === 1 ? 'supervised' : 'attached-endpoint';
  }
  const normalized = asString(value);
  if (normalized === 'LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED' || normalized === '1') {
    return 'supervised';
  }
  return asString(value) === 'supervised' ? 'supervised' : 'attached-endpoint';
}

export function normalizeProviderAdapter(value: unknown): LocalAiProviderAdapter {
  const raw = asString(value);
  if (raw === 'localai_native_adapter') return raw;
  return 'openai_compat_adapter';
}

export function parseProviderHints(value: unknown): LocalAiProviderHints | undefined {
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

export function parseCatalogItemDescriptor(value: unknown): LocalAiCatalogItemDescriptor {
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
    engineConfig: asPlainObject(record.engineConfig),
  };
}

export function parseInstallPlanDescriptor(value: unknown): LocalAiInstallPlanDescriptor {
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
    engineConfig: asPlainObject(record.engineConfig),
  };
}

export function parseDependencyApplyResult(value: unknown): LocalAiDependencyApplyResult {
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

export function normalizeServiceStatus(value: unknown): LocalAiServiceStatus {
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

export function normalizeServiceArtifactType(
  value: unknown,
): LocalAiServiceDescriptor['artifactType'] {
  const raw = asString(value).toLowerCase();
  if (raw === 'python-env' || raw === 'binary' || raw === 'attached-endpoint') {
    return raw;
  }
  return undefined;
}

export function parseServiceDescriptor(value: unknown): LocalAiServiceDescriptor {
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

export function parseNodeDescriptor(value: unknown): LocalAiNodeDescriptor {
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
    inputSchema: record.inputSchema && typeof record.inputSchema === 'object' && !Array.isArray(record.inputSchema)
      ? record.inputSchema as Record<string, unknown>
      : undefined,
    outputSchema: record.outputSchema && typeof record.outputSchema === 'object' && !Array.isArray(record.outputSchema)
      ? record.outputSchema as Record<string, unknown>
      : undefined,
    readOnly: Boolean(record.readOnly),
  };
}
