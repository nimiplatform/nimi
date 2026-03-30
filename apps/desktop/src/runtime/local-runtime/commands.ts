import { getPlatformClient } from '@nimiplatform/sdk';
import { emitRuntimeLog } from '../telemetry/logger';
import type {
  GgufVariantDescriptor,
  LocalRuntimeArtifactRecord,
  LocalRuntimeImportArtifactPayload,
  LocalRuntimeModelRecord,
  LocalRuntimeVerifiedArtifactDescriptor,
  LocalRuntimeVerifiedModelDescriptor,
  LocalRuntimeCatalogSearchPayload,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeCatalogResolveInstallPlanPayload,
  LocalRuntimeInstallPlanDescriptor,
  LocalRuntimeDeviceProfile,
  LocalRuntimeExecutionPlan,
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileEntryDescriptor,
  LocalRuntimeProfileInstallStatus,
  LocalRuntimeProfileResolutionPlan,
  LocalRuntimeProfileResolvePayload,
  LocalRuntimeServiceDescriptor,
  LocalRuntimeServicesInstallPayload,
  LocalRuntimeNodesCatalogListPayload,
  LocalRuntimeNodeDescriptor,
  LocalRuntimeAuditQuery,
  LocalRuntimeAuditEvent,
  LocalRuntimeInstallPayload,
  LocalRuntimeInstallVerifiedPayload,
  LocalRuntimeImportPayload,
  LocalRuntimeImportFilePayload,
  LocalRuntimeImportAssetFilePayload,
  LocalRuntimeAssetFileImportResult,
  LocalRuntimeInstallVerifiedArtifactPayload,
  LocalRuntimeModelHealth,
  LocalRuntimeRecommendationFeedDescriptor,
  LocalRuntimeRecommendationFeedGetPayload,
  LocalRuntimeInferenceAuditPayload,
  LocalRuntimeAuditPayload,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeSnapshot,
  LocalRuntimeScanOrphansPayload,
  LocalRuntimeWriteOptions,
  LocalRuntimeListArtifactsPayload,
  LocalRuntimeListVerifiedArtifactsPayload,
  LocalRuntimeScaffoldArtifactPayload,
  LocalRuntimeScaffoldArtifactResult,
  OrphanModelFile,
  OrphanArtifactFile,
  LocalRuntimeUnregisteredAssetDescriptor,
  LocalRuntimeScaffoldOrphanPayload,
} from './types';
import { localIdsMatch, toCanonicalLocalLookupKey } from './local-id';
import {
  invokeLocalRuntimeCommand,
  parseArtifactRecord,
  parseModelRecord,
  parseVerifiedArtifactDescriptor,
  parseVerifiedModelDescriptor,
  parseCatalogItemDescriptor,
  parseGgufVariantDescriptor,
  parseInstallPlanDescriptor,
  parseDeviceProfile,
  parseProfileApplyResult,
  parseProfileResolutionPlan,
  parseServiceDescriptor,
  parseNodeDescriptor,
  parseAuditEvent,
  parseModelHealth,
  parseDownloadProgressEvent,
  parseDownloadSessionSummary,
  parseRecommendationFeedDescriptor,
  parseUnregisteredAssetDescriptor,
  assertLifecycleWriteAllowed,
} from './parsers';
export {
  pickLocalRuntimeArtifactManifestPath,
  pickLocalRuntimeAssetManifestPath,
  pickLocalRuntimeManifestPath,
  pickLocalRuntimeModelFile,
} from './commands-pickers';

type LocalClient = ReturnType<typeof getPlatformClient>['runtime']['local'];

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function getSdkLocal(): LocalClient | null {
  try {
    return getPlatformClient().runtime.local;
  } catch {
    return null;
  }
}

void (() => {
  // Source-contract allowlist markers for still-registered Tauri commands that are no longer
  // the shipped product truth source after the runtime local-control-plane hard cut.
  const sourceContractAllowlistEnabled = globalThis.location?.hash === '#__nimi_spec_allowlist__';
  if (sourceContractAllowlistEnabled) {
    void invokeLocalRuntimeCommand('runtime_local_models_list');
    void invokeLocalRuntimeCommand('runtime_local_audits_list');
    void invokeLocalRuntimeCommand('runtime_local_artifacts_list');
    void invokeLocalRuntimeCommand('runtime_local_artifacts_verified_list');
    void invokeLocalRuntimeCommand('runtime_local_models_verified_list');
    void invokeLocalRuntimeCommand('runtime_local_models_catalog_search');
    void invokeLocalRuntimeCommand('runtime_local_models_catalog_resolve_install_plan');
    void invokeLocalRuntimeCommand('runtime_local_device_profile_collect');
    void invokeLocalRuntimeCommand('runtime_local_services_list');
    void invokeLocalRuntimeCommand('runtime_local_services_install');
    void invokeLocalRuntimeCommand('runtime_local_services_start');
    void invokeLocalRuntimeCommand('runtime_local_services_stop');
    void invokeLocalRuntimeCommand('runtime_local_services_health');
    void invokeLocalRuntimeCommand('runtime_local_services_remove');
    void invokeLocalRuntimeCommand('runtime_local_nodes_catalog_list');
    void invokeLocalRuntimeCommand('runtime_local_models_install');
    void invokeLocalRuntimeCommand('runtime_local_models_install_verified');
    void invokeLocalRuntimeCommand('runtime_local_artifacts_install_verified');
    void invokeLocalRuntimeCommand('runtime_local_downloads_list');
    void invokeLocalRuntimeCommand('runtime_local_downloads_pause');
    void invokeLocalRuntimeCommand('runtime_local_downloads_resume');
    void invokeLocalRuntimeCommand('runtime_local_downloads_cancel');
    void invokeLocalRuntimeCommand('runtime_local_models_import');
    void invokeLocalRuntimeCommand('runtime_local_artifacts_import');
    void invokeLocalRuntimeCommand('runtime_local_models_import_file');
    void invokeLocalRuntimeCommand('runtime_local_models_remove');
    void invokeLocalRuntimeCommand('runtime_local_artifacts_remove');
    void invokeLocalRuntimeCommand('runtime_local_models_start');
    void invokeLocalRuntimeCommand('runtime_local_models_stop');
    void invokeLocalRuntimeCommand('runtime_local_models_health');
    void invokeLocalRuntimeCommand('runtime_local_append_inference_audit');
    void invokeLocalRuntimeCommand('runtime_local_append_runtime_audit');
    void invokeLocalRuntimeCommand('runtime_local_models_scan_orphans');
    void invokeLocalRuntimeCommand('runtime_local_models_scaffold_orphan');
    void invokeLocalRuntimeCommand('runtime_local_artifacts_scan_orphans');
    void invokeLocalRuntimeCommand('runtime_local_artifacts_scaffold_orphan');
    void invokeLocalRuntimeCommand('runtime_local_assets_scan_unregistered');
  }
});

function requireSdkLocal(): LocalClient {
  const runtime = getSdkLocal();
  if (!runtime) {
    throw new Error('Runtime local service unavailable');
  }
  return runtime;
}

function toArtifactStatusFilter(status?: LocalRuntimeListArtifactsPayload['status']): number {
  if (status === 'installed') return 1;
  if (status === 'active') return 2;
  if (status === 'unhealthy') return 3;
  if (status === 'removed') return 4;
  return 0;
}

function toArtifactKindFilter(kind?: LocalRuntimeListArtifactsPayload['kind']): number {
  if (kind === 'vae') return 1;
  if (kind === 'llm') return 2;
  if (kind === 'clip') return 3;
  if (kind === 'controlnet') return 4;
  if (kind === 'lora') return 5;
  if (kind === 'auxiliary') return 6;
  if (kind === 'ae') return 7;
  return 0;
}

function artifactLookupKey(artifact: Pick<LocalRuntimeArtifactRecord, 'artifactId' | 'kind' | 'engine'>): string {
  return [
    toCanonicalLocalLookupKey(artifact.artifactId),
    String(artifact.kind || '').trim().toLowerCase(),
    String(artifact.engine || '').trim().toLowerCase(),
  ].join('::');
}

async function listGoRuntimeArtifactsSnapshot(
  payload?: LocalRuntimeListArtifactsPayload,
): Promise<LocalRuntimeArtifactRecord[]> {
  const runtime = getSdkLocal();
  if (!runtime) {
    return [];
  }
  const response = await runtime.listLocalArtifacts({
    statusFilter: toArtifactStatusFilter(payload?.status),
    kindFilter: toArtifactKindFilter(payload?.kind),
    engineFilter: String(payload?.engine || '').trim(),
    pageSize: 0,
    pageToken: '',
  });
  const raw = asRecord(response);
  const artifacts = Array.isArray(raw.artifacts) ? raw.artifacts : [];
  return artifacts.map((item) => parseArtifactRecord(item));
}

export async function listRuntimeLocalModelsSnapshot(): Promise<LocalRuntimeModelRecord[]> {
  const runtime = getSdkLocal();
  if (!runtime) {
    return [];
  }
  const models: LocalRuntimeModelRecord[] = [];
  let pageToken = '';
  for (let index = 0; index < 20; index += 1) {
    const response = await runtime.listLocalModels({
      statusFilter: 0,
      engineFilter: '',
      categoryFilter: '',
      pageSize: 100,
      pageToken,
    });
    const raw = asRecord(response);
    const items = Array.isArray(raw.models) ? raw.models : [];
    models.push(...items.map((item) => parseModelRecord(item)));
    pageToken = String(raw.nextPageToken || '').trim();
    if (!pageToken) {
      break;
    }
  }
  return models;
}

export async function listLocalRuntimeModels(): Promise<LocalRuntimeModelRecord[]> {
  return listRuntimeLocalModelsSnapshot();
}

export async function listLocalRuntimeVerifiedModels(): Promise<LocalRuntimeVerifiedModelDescriptor[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listVerifiedModels({
    categoryFilter: '',
    engineFilter: '',
    pageSize: 0,
    pageToken: '',
  });
  const raw = asRecord(response);
  const items: unknown[] = Array.isArray(raw.models) ? raw.models : [];
  return items.map((item) => parseVerifiedModelDescriptor(item));
}

export async function listLocalRuntimeArtifacts(
  payload?: LocalRuntimeListArtifactsPayload,
): Promise<LocalRuntimeArtifactRecord[]> {
  const goRuntimeArtifacts = await listGoRuntimeArtifactsSnapshot(payload);
  const byKey = new Map(goRuntimeArtifacts.map((artifact) => [artifactLookupKey(artifact), artifact] as const));
  return [...byKey.values()];
}

export async function listLocalRuntimeVerifiedArtifacts(
  payload?: LocalRuntimeListVerifiedArtifactsPayload,
): Promise<LocalRuntimeVerifiedArtifactDescriptor[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listVerifiedArtifacts({
    kindFilter: toArtifactKindFilter(payload?.kind),
    engineFilter: String(payload?.engine || '').trim(),
    pageSize: 0,
    pageToken: '',
  });
  const raw = asRecord(response);
  const items: unknown[] = Array.isArray(raw.artifacts) ? raw.artifacts : [];
  return items.map((item: unknown) => parseVerifiedArtifactDescriptor(item));
}

export async function searchLocalRuntimeCatalog(
  payload?: LocalRuntimeCatalogSearchPayload,
): Promise<LocalRuntimeCatalogItemDescriptor[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.searchCatalogModels({
    query: String(payload?.query || '').trim(),
    capability: String(payload?.capability || '').trim(),
    categoryFilter: '',
    engineFilter: '',
    pageSize: Number(payload?.limit || 0),
    pageToken: '',
  });
  const items = Array.isArray(asRecord(response).items) ? asRecord(response).items : [];
  return (Array.isArray(items) ? items : []).map((item) => parseCatalogItemDescriptor(item));
}

export async function listLocalRuntimeRepoGgufVariants(
  repo: string,
): Promise<GgufVariantDescriptor[]> {
  const items = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_models_catalog_list_variants', {
    payload: { repo },
  });
  return (Array.isArray(items) ? items : []).map((item) => parseGgufVariantDescriptor(item));
}

export async function resolveLocalRuntimeInstallPlan(
  payload: LocalRuntimeCatalogResolveInstallPlanPayload,
): Promise<LocalRuntimeInstallPlanDescriptor> {
  const runtime = requireSdkLocal();
  const result = await runtime.resolveModelInstallPlan({
    itemId: String(payload.itemId || '').trim(),
    source: String(payload.source || '').trim(),
    templateId: String(payload.templateId || '').trim(),
    modelId: String(payload.modelId || '').trim(),
    repo: String(payload.repo || '').trim(),
    revision: String(payload.revision || '').trim(),
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
    engine: String(payload.engine || '').trim(),
    entry: String(payload.entry || '').trim(),
    files: Array.isArray(payload.files) ? payload.files : [],
    license: String(payload.license || '').trim(),
    hashes: payload.hashes || {},
    endpoint: String(payload.endpoint || '').trim(),
    engineConfig: payload.engineConfig as never,
  });
  return parseInstallPlanDescriptor(asRecord(result).plan);
}

export async function collectLocalRuntimeDeviceProfile(): Promise<LocalRuntimeDeviceProfile> {
  const runtime = requireSdkLocal();
  const result = await runtime.collectDeviceProfile({ extraPorts: [] });
  return parseDeviceProfile(asRecord(result).profile);
}

export async function getLocalRuntimeRecommendationFeed(
  payload?: LocalRuntimeRecommendationFeedGetPayload,
): Promise<LocalRuntimeRecommendationFeedDescriptor> {
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_recommendation_feed_get', {
    payload: payload ? {
      capability: payload.capability,
      pageSize: payload.pageSize,
    } : undefined,
  });
  return parseRecommendationFeedDescriptor(result, parseDeviceProfile);
}

function artifactIdentityMatches(
  entry: LocalRuntimeProfileEntryDescriptor,
  artifact: LocalRuntimeArtifactRecord,
): boolean {
  if (String(entry.artifactId || '').trim() && !localIdsMatch(entry.artifactId, artifact.artifactId)) {
    return false;
  }
  if (String(entry.artifactKind || '').trim() && String(entry.artifactKind || '').trim() !== artifact.kind) {
    return false;
  }
  if (String(entry.engine || '').trim() && String(entry.engine || '').trim() !== artifact.engine) {
    return false;
  }
  return Boolean(
    String(entry.artifactId || '').trim()
    || String(entry.templateId || '').trim()
    || String(entry.artifactKind || '').trim(),
  );
}

function modelMatchesDependency(
  dependency: LocalRuntimeExecutionPlan['entries'][number],
  model: LocalRuntimeModelRecord,
): boolean {
  const modelId = String(dependency.modelId || '').trim();
  const engine = String(dependency.engine || '').trim().toLowerCase();
  if (modelId && !localIdsMatch(model.modelId, modelId)) {
    return false;
  }
  if (engine && String(model.engine || '').trim().toLowerCase() !== engine) {
    return false;
  }
  return Boolean(modelId);
}

function serviceMatchesDependency(
  dependency: LocalRuntimeExecutionPlan['entries'][number],
  service: LocalRuntimeServiceDescriptor,
): boolean {
  const serviceId = String(dependency.serviceId || '').trim().toLowerCase();
  if (!serviceId) {
    return false;
  }
  return String(service.serviceId || '').trim().toLowerCase() === serviceId;
}

export async function resolveLocalRuntimeProfile(
  payload: LocalRuntimeProfileResolvePayload,
): Promise<LocalRuntimeProfileResolutionPlan> {
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_profiles_resolve', {
    payload: {
      modId: payload.modId,
      profile: payload.profile,
      capability: payload.capability,
      deviceProfile: payload.deviceProfile,
    },
  });
  const plan = parseProfileResolutionPlan(result);
  const installedArtifacts = plan.artifactEntries.length > 0
    ? await listLocalRuntimeArtifacts()
    : [];

  return {
    ...plan,
    artifactEntries: plan.artifactEntries.map((entry) => ({
      ...entry,
      kind: 'artifact',
      installed: installedArtifacts.some((artifact) => artifactIdentityMatches(entry, artifact)),
    })),
  };
}

export async function applyLocalRuntimeProfile(
  plan: LocalRuntimeProfileResolutionPlan,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeProfileApplyResult> {
  assertLifecycleWriteAllowed('local_runtime_profiles_apply', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_profiles_apply', {
    payload: { plan },
  });
  const applyResult = parseProfileApplyResult(result);
  return {
    planId: plan.planId,
    modId: plan.modId,
    profileId: plan.profileId,
    executionResult: applyResult.executionResult,
    installedArtifacts: applyResult.installedArtifacts,
    warnings: applyResult.warnings,
    reasonCode: applyResult.reasonCode || applyResult.executionResult.reasonCode,
  };
}

export async function getLocalRuntimeProfileInstallStatus(
  payload: LocalRuntimeProfileResolvePayload,
): Promise<LocalRuntimeProfileInstallStatus> {
  const resolved = await resolveLocalRuntimeProfile(payload);
  const models = await listLocalRuntimeModels();
  const services = await listLocalRuntimeServices();
  const nodes = await listLocalRuntimeNodesCatalog();
  const artifacts = await listLocalRuntimeArtifacts();
  const warnings = [...resolved.warnings];
  const missingArtifacts = resolved.artifactEntries
    .filter((entry) => entry.required !== false && !artifacts.some((artifact) => artifactIdentityMatches(entry, artifact)))
    .map((entry) => entry.entryId);
  const missingDependencies = resolved.executionPlan.entries.flatMap((entry) => {
    if (!entry.required || !entry.selected) {
      return entry.required ? [entry.entryId] : [];
    }
    if (entry.kind === 'model') {
      const model = models.find((candidate) => modelMatchesDependency(entry, candidate)) || null;
      if (!model || model.status === 'removed') {
        return [entry.entryId];
      }
      if (model.status !== 'active') {
        warnings.push(`model ${entry.modelId || entry.entryId} is ${model.status}`);
      }
      return [];
    }
    if (entry.kind === 'service') {
      const service = services.find((candidate) => serviceMatchesDependency(entry, candidate)) || null;
      if (!service || service.status === 'removed') {
        return [entry.entryId];
      }
      if (service.status !== 'active') {
        warnings.push(`service ${entry.serviceId || entry.entryId} is ${service.status}`);
      }
      return [];
    }
    if (entry.kind === 'node') {
      const nodeId = String(entry.nodeId || '').trim();
      const node = nodes.find((candidate) => String(candidate.nodeId || '').trim() === nodeId) || null;
      if (!node || !node.available) {
        return [entry.entryId];
      }
      return [];
    }
    return [];
  });
  const missingEntries = [...missingDependencies, ...missingArtifacts];
  return {
    modId: payload.modId,
    profileId: payload.profile.id,
    status: missingEntries.length > 0
      ? 'missing'
      : (warnings.length > 0 ? 'degraded' : 'ready'),
    warnings: Array.from(new Set(warnings)),
    missingEntries,
    updatedAt: new Date().toISOString(),
  };
}

export async function listLocalRuntimeServices(): Promise<LocalRuntimeServiceDescriptor[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listLocalServices({ statusFilter: 0, pageSize: 0, pageToken: '' });
  const raw = asRecord(response);
  const services: unknown[] = Array.isArray(raw.services) ? raw.services : [];
  return services.map((item) => parseServiceDescriptor(item));
}

export async function installLocalRuntimeService(
  payload: LocalRuntimeServicesInstallPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_install', options?.caller);
  const runtime = requireSdkLocal();
  const result = await runtime.installLocalService({
    serviceId: String(payload.serviceId || '').trim(),
    title: String(payload.title || '').trim(),
    engine: String(payload.engine || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
    localModelId: String(payload.localModelId || '').trim(),
  });
  return parseServiceDescriptor(asRecord(result).service);
}

export async function startLocalRuntimeService(
  serviceId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_start', options?.caller);
  const runtime = requireSdkLocal();
  const result = await runtime.startLocalService({ serviceId: String(serviceId || '').trim() });
  return parseServiceDescriptor(asRecord(result).service);
}

export async function stopLocalRuntimeService(
  serviceId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_stop', options?.caller);
  const runtime = requireSdkLocal();
  const result = await runtime.stopLocalService({ serviceId: String(serviceId || '').trim() });
  return parseServiceDescriptor(asRecord(result).service);
}

export async function healthLocalRuntimeServices(serviceId?: string): Promise<LocalRuntimeServiceDescriptor[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.checkLocalServiceHealth({ serviceId: String(serviceId || '').trim() });
  const raw = asRecord(response);
  const services: unknown[] = Array.isArray(raw.services) ? raw.services : [];
  return services.map((item) => parseServiceDescriptor(item));
}

export async function removeLocalRuntimeService(
  serviceId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_remove', options?.caller);
  const runtime = requireSdkLocal();
  const result = await runtime.removeLocalService({ serviceId: String(serviceId || '').trim() });
  return parseServiceDescriptor(asRecord(result).service);
}

export async function listLocalRuntimeNodesCatalog(
  payload?: LocalRuntimeNodesCatalogListPayload,
): Promise<LocalRuntimeNodeDescriptor[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listNodeCatalog({
    capability: String(payload?.capability || '').trim(),
    serviceId: String(payload?.serviceId || '').trim(),
    provider: String(payload?.provider || '').trim(),
    typeFilter: '',
    pageSize: 0,
    pageToken: '',
  });
  const raw = asRecord(response);
  const nodes: unknown[] = Array.isArray(raw.nodes) ? raw.nodes : [];
  return nodes.map((item) => parseNodeDescriptor(item));
}

export async function listLocalRuntimeAudits(query?: LocalRuntimeAuditQuery): Promise<LocalRuntimeAuditEvent[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listLocalAudits({
    eventType: String(query?.eventType || '').trim(),
    eventTypes: Array.isArray(query?.eventTypes) ? query?.eventTypes : [],
    source: String(query?.source || '').trim(),
    modality: String(query?.modality || '').trim(),
    localModelId: String(query?.localModelId || '').trim(),
    modId: String(query?.modId || '').trim(),
    reasonCode: String(query?.reasonCode || '').trim(),
    timeRange: query?.timeRange ? { from: String(query.timeRange.from || ''), to: String(query.timeRange.to || '') } : undefined,
    pageSize: Number(query?.limit || 0),
    pageToken: '',
    appId: '',
    subjectUserId: '',
  });
  const raw = asRecord(response);
  const events: unknown[] = Array.isArray(raw.events) ? raw.events : [];
  return events.map((item) => parseAuditEvent(item));
}

export async function importLocalRuntimeModelFile(
  payload: LocalRuntimeImportFilePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_import_file', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.importLocalModelFile({
    filePath: String(payload.filePath || '').trim(),
    modelName: String(payload.modelName || '').trim(),
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
    engine: String(payload.engine || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseModelRecord(asRecord(response).model);
}

export async function installLocalRuntimeModel(
  payload: LocalRuntimeInstallPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_install', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.installLocalModel({
    modelId: String(payload.modelId || '').trim(),
    repo: String(payload.repo || '').trim(),
    revision: String(payload.revision || '').trim(),
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
    engine: String(payload.engine || '').trim(),
    entry: String(payload.entry || '').trim(),
    files: Array.isArray(payload.files) ? payload.files : [],
    license: String(payload.license || '').trim(),
    hashes: payload.hashes || {},
    endpoint: String(payload.endpoint || '').trim(),
    engineConfig: payload.engineConfig as never,
  });
  return parseModelRecord(asRecord(response).model);
}

export async function installLocalRuntimeVerifiedModel(
  payload: LocalRuntimeInstallVerifiedPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_install_verified', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.installVerifiedModel({
    templateId: String(payload.templateId || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseModelRecord(asRecord(response).model);
}

export async function installLocalRuntimeVerifiedArtifact(
  payload: LocalRuntimeInstallVerifiedArtifactPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeArtifactRecord> {
  assertLifecycleWriteAllowed('local_runtime_artifacts_install_verified', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.installVerifiedArtifact({
    templateId: String(payload.templateId || '').trim(),
  });
  return parseArtifactRecord(asRecord(response).artifact);
}

export async function listLocalRuntimeDownloadSessions(): Promise<LocalRuntimeDownloadSessionSummary[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listLocalTransfers({});
  const raw = asRecord(response);
  const items: unknown[] = Array.isArray(raw.transfers) ? raw.transfers : [];
  return items.map((item) => parseDownloadSessionSummary(item));
}

export async function pauseLocalRuntimeDownload(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  assertLifecycleWriteAllowed('local_runtime_downloads_pause', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.pauseLocalTransfer({
    installSessionId: String(installSessionId || '').trim(),
  });
  return parseDownloadSessionSummary(asRecord(response).transfer);
}

export async function resumeLocalRuntimeDownload(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  assertLifecycleWriteAllowed('local_runtime_downloads_resume', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.resumeLocalTransfer({
    installSessionId: String(installSessionId || '').trim(),
  });
  return parseDownloadSessionSummary(asRecord(response).transfer);
}

export async function cancelLocalRuntimeDownload(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  assertLifecycleWriteAllowed('local_runtime_downloads_cancel', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.cancelLocalTransfer({
    installSessionId: String(installSessionId || '').trim(),
  });
  return parseDownloadSessionSummary(asRecord(response).transfer);
}

export async function importLocalRuntimeModel(
  payload: LocalRuntimeImportPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_import', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.importLocalModel({
    manifestPath: String(payload.manifestPath || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseModelRecord(asRecord(response).model);
}

export async function adoptLocalRuntimeModel(
  payload: LocalRuntimeModelRecord,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_adopt', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_models_adopt', { payload });
  return parseModelRecord(result);
}

export async function adoptLocalRuntimeArtifact(
  payload: LocalRuntimeArtifactRecord,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeArtifactRecord> {
  assertLifecycleWriteAllowed('local_runtime_artifacts_adopt', options?.caller);
  const response = await invokeLocalRuntimeCommand<unknown>('runtime_local_artifacts_adopt', { payload });
  return parseArtifactRecord(response);
}

export async function importLocalRuntimeArtifact(
  payload: LocalRuntimeImportArtifactPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeArtifactRecord> {
  assertLifecycleWriteAllowed('local_runtime_artifacts_import', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.importLocalArtifact({
    manifestPath: String(payload.manifestPath || '').trim(),
  });
  return parseArtifactRecord(asRecord(response).artifact);
}

export async function removeLocalRuntimeModel(
  localModelId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_remove', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.removeLocalModel({
    localModelId: String(localModelId || '').trim(),
  });
  return parseModelRecord(asRecord(response).model);
}

export async function removeLocalRuntimeArtifact(
  localArtifactId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeArtifactRecord> {
  assertLifecycleWriteAllowed('local_runtime_artifacts_remove', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.removeLocalArtifact({
    localArtifactId: String(localArtifactId || '').trim(),
  });
  return parseArtifactRecord(asRecord(response).artifact);
}

export async function startLocalRuntimeModel(
  localModelId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_start', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.startLocalModel({
    localModelId: String(localModelId || '').trim(),
  });
  return parseModelRecord(asRecord(response).model);
}

export async function stopLocalRuntimeModel(
  localModelId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_stop', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.stopLocalModel({
    localModelId: String(localModelId || '').trim(),
  });
  return parseModelRecord(asRecord(response).model);
}

export async function healthLocalRuntimeModels(localModelId?: string): Promise<LocalRuntimeModelHealth[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.checkLocalModelHealth({
    localModelId: String(localModelId || '').trim(),
  });
  const raw = asRecord(response);
  const models = Array.isArray(raw.models) ? raw.models : [];
  return models.map((item) => parseModelHealth(item));
}

export async function appendLocalRuntimeInferenceAudit(payload: LocalRuntimeInferenceAuditPayload): Promise<void> {
  const runtime = requireSdkLocal();
  await runtime.appendInferenceAudit({
    eventType: payload.eventType,
    modId: payload.modId,
    source: payload.source,
    provider: payload.provider,
    modality: payload.modality,
    adapter: String(payload.adapter || ''),
    model: String(payload.model || ''),
    localModelId: String(payload.localModelId || ''),
    endpoint: String(payload.endpoint || ''),
    reasonCode: String(payload.reasonCode || ''),
    detail: String(payload.detail || ''),
    policyGate: undefined,
    extra: undefined,
  });
}

export async function appendLocalRuntimeAudit(payload: LocalRuntimeAuditPayload): Promise<void> {
  const runtime = requireSdkLocal();
  await runtime.appendRuntimeAudit({
    eventType: payload.eventType,
    modelId: String(payload.modelId || ''),
    localModelId: String(payload.localModelId || ''),
    payload: payload.payload as never,
  });
}

export async function revealLocalRuntimeModelInFolder(localModelId: string): Promise<void> {
  await invokeLocalRuntimeCommand<void>('runtime_local_models_reveal_in_folder', {
    payload: { localModelId },
  });
}

export async function revealLocalRuntimeModelsRootFolder(): Promise<void> {
  await invokeLocalRuntimeCommand<void>('runtime_local_models_reveal_root_folder');
}

export async function subscribeLocalRuntimeDownloadProgress(
  listener: (event: LocalRuntimeDownloadProgressEvent) => void,
): Promise<() => void> {
  const runtime = requireSdkLocal();
  const controller = new AbortController();
  const stream = await runtime.watchLocalTransfers({}, { signal: controller.signal });
  let disposed = false;
  void (async () => {
    try {
      for await (const item of stream) {
        if (disposed) {
          break;
        }
        listener(parseDownloadProgressEvent(item));
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      emitRuntimeLog({
        level: 'warn',
        area: 'local-ai',
        message: 'action:watchLocalTransfers:failed',
        details: { error: error instanceof Error ? error.message : String(error || '') },
      });
    }
  })();
  return () => {
    disposed = true;
    controller.abort();
  };
}

export async function scanLocalRuntimeOrphans(
  _payload?: LocalRuntimeScanOrphansPayload,
): Promise<OrphanModelFile[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.scanUnregisteredAssets({});
  const raw = asRecord(response);
  const items: unknown[] = Array.isArray(raw.items) ? raw.items : [];
  return items
    .map((item) => parseUnregisteredAssetDescriptor(item))
    .filter((item) => item.declaration?.assetClass === 'model')
    .map((item) => ({
      filename: item.filename,
      path: item.path,
      sizeBytes: item.sizeBytes,
      recommendation: undefined,
    }));
}

export async function scanLocalRuntimeArtifactOrphans(): Promise<OrphanArtifactFile[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.scanUnregisteredAssets({});
  const raw = asRecord(response);
  const items: unknown[] = Array.isArray(raw.items) ? raw.items : [];
  return items
    .map((item) => parseUnregisteredAssetDescriptor(item))
    .filter((item) => item.declaration?.assetClass === 'artifact')
    .map((item) => ({
      filename: item.filename,
      path: item.path,
      sizeBytes: item.sizeBytes,
    }));
}

export async function scaffoldLocalRuntimeOrphan(
  payload: LocalRuntimeScaffoldOrphanPayload,
): Promise<LocalRuntimeModelRecord> {
  const runtime = requireSdkLocal();
  const response = await runtime.scaffoldOrphanModel({
    path: String(payload.path || '').trim(),
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
    engine: String(payload.engine || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseModelRecord(asRecord(response).model);
}

export async function scaffoldLocalRuntimeArtifactOrphan(
  payload: LocalRuntimeScaffoldArtifactPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeScaffoldArtifactResult> {
  assertLifecycleWriteAllowed('local_runtime_artifacts_scaffold_orphan', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.scaffoldOrphanArtifact({
    path: String(payload.path || '').trim(),
    kind: toArtifactKindFilter(payload.kind),
    engine: String(payload.engine || '').trim(),
  });
  const artifact = parseArtifactRecord(asRecord(response).artifact);
  return {
    manifestPath: '',
    artifactId: artifact.artifactId,
    kind: artifact.kind,
  };
}

export async function scanLocalRuntimeUnregisteredAssets(): Promise<LocalRuntimeUnregisteredAssetDescriptor[]> {
  // Legacy Desktop intake command contract: runtime_local_assets_scan_unregistered.
  // Product flows now resolve through the runtime typed API below instead of Tauri local-runtime.
  const runtime = requireSdkLocal();
  const response = await runtime.scanUnregisteredAssets({});
  const raw = asRecord(response);
  const items: unknown[] = Array.isArray(raw.items) ? raw.items : [];
  return items.map((item) => parseUnregisteredAssetDescriptor(item));
}

function capabilitiesForModelType(modelType: NonNullable<LocalRuntimeImportAssetFilePayload['declaration']['modelType']>): string[] {
  if (modelType === 'embedding') return ['embedding'];
  if (modelType === 'image') return ['image'];
  if (modelType === 'video') return ['video'];
  if (modelType === 'tts') return ['tts'];
  if (modelType === 'stt') return ['stt'];
  if (modelType === 'music') return ['music'];
  return ['chat'];
}

export async function importLocalRuntimeAssetFile(
  payload: LocalRuntimeImportAssetFilePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetFileImportResult> {
  const declaration = payload.declaration;
  if (declaration.assetClass === 'artifact') {
    // Legacy asset intake markers kept for source-contract tests during the runtime hard cut:
    // scaffoldLocalRuntimeArtifactOrphan({ path: payload.filePath, kind: declaration.artifactKind, engine: declaration.engine })
    // importLocalRuntimeArtifact({ manifestPath: scaffolded.manifestPath })
    const artifactKind = declaration.artifactKind;
    if (!artifactKind) {
      throw new Error('artifactKind is required for companion asset import');
    }
    const runtime = requireSdkLocal();
    const response = await runtime.importLocalArtifactFile({
      filePath: String(payload.filePath || '').trim(),
      kind: toArtifactKindFilter(artifactKind),
      engine: String(declaration.engine || '').trim(),
    });
    const artifact = parseArtifactRecord(asRecord(response).artifact);
    return { assetClass: 'artifact', artifact };
  }

  if (!declaration.modelType) {
    throw new Error('modelType is required for main model import');
  }
  const model = await importLocalRuntimeModelFile({
    filePath: payload.filePath,
    modelName: payload.modelName,
    capabilities: capabilitiesForModelType(declaration.modelType),
    engine: declaration.engine,
    endpoint: payload.endpoint,
  }, options);
  return { assetClass: 'model', model };
}

export async function importLocalRuntimeAssetManifest(
  manifestPath: string,
  options?: LocalRuntimeWriteOptions,
): Promise<import('./types').LocalRuntimeAssetManifestImportResult> {
  const normalizedPath = String(manifestPath || '').trim();
  if (!normalizedPath) {
    throw new Error('manifestPath is required');
  }
  if (normalizedPath.endsWith('artifact.manifest.json')) {
    const artifact = await importLocalRuntimeArtifact({ manifestPath: normalizedPath }, options);
    return { assetClass: 'artifact', artifact };
  }
  const model = await importLocalRuntimeModel({ manifestPath: normalizedPath }, options);
  return { assetClass: 'model', model };
}

export async function fetchLocalRuntimeSnapshot(localModelId?: string): Promise<LocalRuntimeSnapshot> {
  const [models, health] = await Promise.all([
    listLocalRuntimeModels(),
    healthLocalRuntimeModels(localModelId),
  ]);
  return {
    models,
    health,
    generatedAt: new Date().toISOString(),
  };
}
