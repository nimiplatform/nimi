import { hasTauriInvoke, tauriInvoke } from '../llm-adapter/tauri-bridge';
import { getPlatformClient } from '@nimiplatform/sdk';
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
  LocalRuntimeInstallAcceptedResponse,
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
  parseInstallAcceptedResponse,
  parseOrphanArtifactFile,
  parseOrphanModelFile,
  parseRecommendationFeedDescriptor,
  parseScaffoldArtifactResult,
  parseUnregisteredAssetDescriptor,
  readGlobalTauriEventListen,
  assertLifecycleWriteAllowed,
} from './parsers';

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

export async function listLocalRuntimeModels(): Promise<LocalRuntimeModelRecord[]> {
  const models = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_models_list');
  return (Array.isArray(models) ? models : []).map((item) => parseModelRecord(item));
}

export async function listLocalRuntimeVerifiedModels(): Promise<LocalRuntimeVerifiedModelDescriptor[]> {
  const models = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_models_verified_list');
  return (Array.isArray(models) ? models : []).map((item) => parseVerifiedModelDescriptor(item));
}

export async function listLocalRuntimeArtifacts(
  payload?: LocalRuntimeListArtifactsPayload,
): Promise<LocalRuntimeArtifactRecord[]> {
  if (getSdkLocal()) {
    try {
      const goRuntimeArtifacts = await listGoRuntimeArtifactsSnapshot(payload);
      for (const artifact of goRuntimeArtifacts) {
        await adoptLocalRuntimeArtifact(artifact, { caller: 'core' }).catch(() => artifact);
      }
      return goRuntimeArtifacts;
    } catch {
      // Fall back to the Desktop cache when the runtime bridge is unavailable.
    }
  }

  const response = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_artifacts_list', {
    payload: payload ? {
      status: payload.status,
      kind: payload.kind,
      engine: payload.engine,
    } : undefined,
  });
  const desktopArtifacts = (Array.isArray(response) ? response : []).map((item: unknown) => parseArtifactRecord(item));
  const byKey = new Map(desktopArtifacts.map((artifact) => [artifactLookupKey(artifact), artifact] as const));
  return [...byKey.values()];
}

export async function listLocalRuntimeVerifiedArtifacts(
  payload?: LocalRuntimeListVerifiedArtifactsPayload,
): Promise<LocalRuntimeVerifiedArtifactDescriptor[]> {
  const response = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_artifacts_verified_list', {
    payload: payload ? {
      kind: payload.kind,
      engine: payload.engine,
    } : undefined,
  });
  return (Array.isArray(response) ? response : []).map((item: unknown) => parseVerifiedArtifactDescriptor(item));
}

export async function searchLocalRuntimeCatalog(
  payload?: LocalRuntimeCatalogSearchPayload,
): Promise<LocalRuntimeCatalogItemDescriptor[]> {
  const items = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_models_catalog_search', {
    payload: payload ? {
      query: payload.query,
      capability: payload.capability,
      limit: payload.limit,
    } : undefined,
  });
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
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_models_catalog_resolve_install_plan', {
    payload,
  });
  return parseInstallPlanDescriptor(result);
}

export async function collectLocalRuntimeDeviceProfile(): Promise<LocalRuntimeDeviceProfile> {
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_device_profile_collect');
  return parseDeviceProfile(result);
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
  const services = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_services_list');
  return (Array.isArray(services) ? services : []).map((item) => parseServiceDescriptor(item));
}

export async function installLocalRuntimeService(
  payload: LocalRuntimeServicesInstallPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_install', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_services_install', { payload });
  return parseServiceDescriptor(result);
}

export async function startLocalRuntimeService(
  serviceId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_start', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_services_start', {
    payload: { serviceId },
  });
  return parseServiceDescriptor(result);
}

export async function stopLocalRuntimeService(
  serviceId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_stop', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_services_stop', {
    payload: { serviceId },
  });
  return parseServiceDescriptor(result);
}

export async function healthLocalRuntimeServices(serviceId?: string): Promise<LocalRuntimeServiceDescriptor[]> {
  const services = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_services_health', {
    payload: serviceId ? { serviceId } : undefined,
  });
  return (Array.isArray(services) ? services : []).map((item) => parseServiceDescriptor(item));
}

export async function removeLocalRuntimeService(
  serviceId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_remove', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_services_remove', {
    payload: { serviceId },
  });
  return parseServiceDescriptor(result);
}

export async function listLocalRuntimeNodesCatalog(
  payload?: LocalRuntimeNodesCatalogListPayload,
): Promise<LocalRuntimeNodeDescriptor[]> {
  const nodes = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_nodes_catalog_list', {
    payload: payload || undefined,
  });
  return (Array.isArray(nodes) ? nodes : []).map((item) => parseNodeDescriptor(item));
}

export async function listLocalRuntimeAudits(query?: LocalRuntimeAuditQuery): Promise<LocalRuntimeAuditEvent[]> {
  const events = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_audits_list', {
    payload: query || undefined,
  });
  return (Array.isArray(events) ? events : []).map((item) => parseAuditEvent(item));
}

export async function pickLocalRuntimeManifestPath(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<string | null>('runtime_local_pick_manifest_path', {});
  return result || null;
}

export async function pickLocalRuntimeArtifactManifestPath(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<string | null>('runtime_local_pick_artifact_manifest_path', {});
  return result || null;
}

export async function pickLocalRuntimeAssetManifestPath(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<string | null>('runtime_local_pick_asset_manifest_path', {});
  return result || null;
}

export async function pickLocalRuntimeModelFile(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<string | null>('runtime_local_pick_model_file', {});
  return result || null;
}

export async function importLocalRuntimeModelFile(
  payload: LocalRuntimeImportFilePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeInstallAcceptedResponse> {
  assertLifecycleWriteAllowed('local_runtime_models_import_file', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_models_import_file', { payload });
  return parseInstallAcceptedResponse(result);
}

export async function installLocalRuntimeModel(
  payload: LocalRuntimeInstallPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeInstallAcceptedResponse> {
  assertLifecycleWriteAllowed('local_runtime_models_install', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_models_install', { payload });
  return parseInstallAcceptedResponse(result);
}

export async function installLocalRuntimeVerifiedModel(
  payload: LocalRuntimeInstallVerifiedPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeInstallAcceptedResponse> {
  assertLifecycleWriteAllowed('local_runtime_models_install_verified', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_models_install_verified', { payload });
  return parseInstallAcceptedResponse(result);
}

export async function installLocalRuntimeVerifiedArtifact(
  payload: LocalRuntimeInstallVerifiedArtifactPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeArtifactRecord> {
  assertLifecycleWriteAllowed('local_runtime_artifacts_install_verified', options?.caller);
  const response = await invokeLocalRuntimeCommand<unknown>('runtime_local_artifacts_install_verified', {
    payload: {
      templateId: String(payload.templateId || '').trim(),
    },
  });
  return parseArtifactRecord(response);
}

export async function listLocalRuntimeDownloadSessions(): Promise<LocalRuntimeDownloadSessionSummary[]> {
  const sessions = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_downloads_list');
  return (Array.isArray(sessions) ? sessions : []).map((item) => parseDownloadSessionSummary(item));
}

export async function pauseLocalRuntimeDownload(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  assertLifecycleWriteAllowed('local_runtime_downloads_pause', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_downloads_pause', {
    payload: { installSessionId },
  });
  return parseDownloadSessionSummary(result);
}

export async function resumeLocalRuntimeDownload(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  assertLifecycleWriteAllowed('local_runtime_downloads_resume', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_downloads_resume', {
    payload: { installSessionId },
  });
  return parseDownloadSessionSummary(result);
}

export async function cancelLocalRuntimeDownload(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  assertLifecycleWriteAllowed('local_runtime_downloads_cancel', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_downloads_cancel', {
    payload: { installSessionId },
  });
  return parseDownloadSessionSummary(result);
}

export async function importLocalRuntimeModel(
  payload: LocalRuntimeImportPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_import', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_models_import', { payload });
  return parseModelRecord(result);
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
  const response = await invokeLocalRuntimeCommand<unknown>('runtime_local_artifacts_import', {
    payload: {
      manifestPath: String(payload.manifestPath || '').trim(),
    },
  });
  return parseArtifactRecord(response);
}

export async function removeLocalRuntimeModel(
  localModelId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_remove', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_models_remove', {
    payload: { localModelId },
  });
  return parseModelRecord(result);
}

export async function removeLocalRuntimeArtifact(
  localArtifactId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeArtifactRecord> {
  assertLifecycleWriteAllowed('local_runtime_artifacts_remove', options?.caller);
  const response = await invokeLocalRuntimeCommand<unknown>('runtime_local_artifacts_remove', {
    payload: { localArtifactId: String(localArtifactId || '').trim() },
  });
  return parseArtifactRecord(response);
}

export async function startLocalRuntimeModel(
  localModelId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_start', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_models_start', {
    payload: { localModelId },
  });
  return parseModelRecord(result);
}

export async function stopLocalRuntimeModel(
  localModelId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_stop', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_models_stop', {
    payload: { localModelId },
  });
  return parseModelRecord(result);
}

export async function healthLocalRuntimeModels(localModelId?: string): Promise<LocalRuntimeModelHealth[]> {
  const response = await invokeLocalRuntimeCommand<{ models?: unknown[] }>('runtime_local_models_health', {
    payload: localModelId ? { localModelId } : undefined,
  });
  const models = Array.isArray(response?.models) ? response.models : [];
  return models.map((item) => parseModelHealth(item));
}

export async function appendLocalRuntimeInferenceAudit(payload: LocalRuntimeInferenceAuditPayload): Promise<void> {
  await invokeLocalRuntimeCommand<void>('runtime_local_append_inference_audit', { payload });
}

export async function appendLocalRuntimeAudit(payload: LocalRuntimeAuditPayload): Promise<void> {
  await invokeLocalRuntimeCommand<void>('runtime_local_append_runtime_audit', { payload });
}

export async function revealLocalRuntimeModelInFolder(localModelId: string): Promise<void> {
  await invokeLocalRuntimeCommand<void>('runtime_local_models_reveal_in_folder', {
    payload: { localModelId },
  });
}

export async function revealLocalRuntimeModelsRootFolder(): Promise<void> {
  await invokeLocalRuntimeCommand<void>('runtime_local_models_reveal_root_folder');
}

const LOCAL_AI_DOWNLOAD_PROGRESS_EVENT = 'local-ai://download-progress';

export async function subscribeLocalRuntimeDownloadProgress(
  listener: (event: LocalRuntimeDownloadProgressEvent) => void,
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

export async function scanLocalRuntimeOrphans(
  payload?: LocalRuntimeScanOrphansPayload,
): Promise<OrphanModelFile[]> {
  const items = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_models_scan_orphans', {
    payload,
  });
  return (Array.isArray(items) ? items : []).map((item) => parseOrphanModelFile(item));
}

export async function scanLocalRuntimeArtifactOrphans(): Promise<OrphanArtifactFile[]> {
  const items = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_artifacts_scan_orphans');
  return (Array.isArray(items) ? items : []).map((item) => parseOrphanArtifactFile(item));
}

export async function scaffoldLocalRuntimeOrphan(
  payload: LocalRuntimeScaffoldOrphanPayload,
): Promise<LocalRuntimeInstallAcceptedResponse> {
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_models_scaffold_orphan', {
    payload,
  });
  return parseInstallAcceptedResponse(result);
}

export async function scaffoldLocalRuntimeArtifactOrphan(
  payload: LocalRuntimeScaffoldArtifactPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeScaffoldArtifactResult> {
  assertLifecycleWriteAllowed('local_runtime_artifacts_scaffold_orphan', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_artifacts_scaffold_orphan', {
    payload,
  });
  return parseScaffoldArtifactResult(result);
}

export async function scanLocalRuntimeUnregisteredAssets(): Promise<LocalRuntimeUnregisteredAssetDescriptor[]> {
  const items = await invokeLocalRuntimeCommand<unknown[]>('runtime_local_assets_scan_unregistered');
  return (Array.isArray(items) ? items : []).map((item) => parseUnregisteredAssetDescriptor(item));
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
    const artifactKind = declaration.artifactKind;
    if (!artifactKind) {
      throw new Error('artifactKind is required for companion asset import');
    }
    const scaffolded = await scaffoldLocalRuntimeArtifactOrphan({
      path: payload.filePath,
      kind: artifactKind,
      engine: declaration.engine,
    }, options);
    const artifact = await importLocalRuntimeArtifact({
      manifestPath: scaffolded.manifestPath,
    }, options);
    return { assetClass: 'artifact', artifact };
  }

  if (!declaration.modelType) {
    throw new Error('modelType is required for main model import');
  }
  const accepted = await importLocalRuntimeModelFile({
    filePath: payload.filePath,
    modelName: payload.modelName,
    capabilities: capabilitiesForModelType(declaration.modelType),
    engine: declaration.engine,
    endpoint: payload.endpoint,
  }, options);
  return { assetClass: 'model', accepted };
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
