import { hasTauriInvoke, tauriInvoke } from '../llm-adapter/tauri-bridge';
import type {
  GgufVariantDescriptor,
  LocalAiModelRecord,
  LocalAiVerifiedModelDescriptor,
  LocalAiCatalogSearchPayload,
  LocalAiCatalogItemDescriptor,
  LocalAiCatalogResolveInstallPlanPayload,
  LocalAiInstallPlanDescriptor,
  LocalAiDeviceProfile,
  LocalAiDependenciesResolvePayload,
  LocalAiDependencyResolutionPlan,
  LocalAiDependencyApplyResult,
  LocalAiServiceDescriptor,
  LocalAiServicesInstallPayload,
  LocalAiNodesCatalogListPayload,
  LocalAiNodeDescriptor,
  LocalAiAuditQuery,
  LocalAiAuditEvent,
  LocalAiInstallPayload,
  LocalAiInstallVerifiedPayload,
  LocalAiImportPayload,
  LocalAiImportFilePayload,
  LocalAiModelHealth,
  LocalAiInferenceAuditPayload,
  LocalAiRuntimeAuditPayload,
  LocalAiDownloadProgressEvent,
  LocalAiDownloadSessionSummary,
  LocalAiInstallAcceptedResponse,
  LocalAiRuntimeSnapshot,
  LocalAiRuntimeWriteOptions,
  OrphanModelFile,
  LocalAiScaffoldOrphanPayload,
} from './types';
import {
  invokeLocalAiCommand,
  parseModelRecord,
  parseVerifiedModelDescriptor,
  parseCatalogItemDescriptor,
  parseGgufVariantDescriptor,
  parseInstallPlanDescriptor,
  parseDeviceProfile,
  parseDependencyResolutionPlan,
  parseDependencyApplyResult,
  parseServiceDescriptor,
  parseNodeDescriptor,
  parseAuditEvent,
  parseModelHealth,
  parseDownloadProgressEvent,
  parseDownloadSessionSummary,
  parseInstallAcceptedResponse,
  parseOrphanModelFile,
  readGlobalTauriEventListen,
  assertLifecycleWriteAllowed,
} from './parsers';

export async function listLocalAiRuntimeModels(): Promise<LocalAiModelRecord[]> {
  const models = await invokeLocalAiCommand<unknown[]>('runtime_local_models_list');
  return (Array.isArray(models) ? models : []).map((item) => parseModelRecord(item));
}

export async function listLocalAiRuntimeVerifiedModels(): Promise<LocalAiVerifiedModelDescriptor[]> {
  const models = await invokeLocalAiCommand<unknown[]>('runtime_local_models_verified_list');
  return (Array.isArray(models) ? models : []).map((item) => parseVerifiedModelDescriptor(item));
}

export async function searchLocalAiRuntimeCatalog(
  payload?: LocalAiCatalogSearchPayload,
): Promise<LocalAiCatalogItemDescriptor[]> {
  const items = await invokeLocalAiCommand<unknown[]>('runtime_local_models_catalog_search', {
    payload: payload ? {
      query: payload.query,
      capability: payload.capability,
      limit: payload.limit,
    } : undefined,
  });
  return (Array.isArray(items) ? items : []).map((item) => parseCatalogItemDescriptor(item));
}

export async function listLocalAiRuntimeRepoGgufVariants(
  repo: string,
): Promise<GgufVariantDescriptor[]> {
  const items = await invokeLocalAiCommand<unknown[]>('runtime_local_models_catalog_list_variants', {
    payload: { repo },
  });
  return (Array.isArray(items) ? items : []).map((item) => parseGgufVariantDescriptor(item));
}

export async function resolveLocalAiRuntimeInstallPlan(
  payload: LocalAiCatalogResolveInstallPlanPayload,
): Promise<LocalAiInstallPlanDescriptor> {
  const result = await invokeLocalAiCommand<unknown>('runtime_local_models_catalog_resolve_install_plan', {
    payload,
  });
  return parseInstallPlanDescriptor(result);
}

export async function collectLocalAiRuntimeDeviceProfile(): Promise<LocalAiDeviceProfile> {
  const result = await invokeLocalAiCommand<unknown>('runtime_local_device_profile_collect');
  return parseDeviceProfile(result);
}

export async function resolveLocalAiRuntimeDependencies(
  payload: LocalAiDependenciesResolvePayload,
): Promise<LocalAiDependencyResolutionPlan> {
  const result = await invokeLocalAiCommand<unknown>('runtime_local_dependencies_resolve', {
    payload,
  });
  return parseDependencyResolutionPlan(result);
}

export async function applyLocalAiRuntimeDependencies(
  plan: LocalAiDependencyResolutionPlan,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiDependencyApplyResult> {
  assertLifecycleWriteAllowed('local_runtime_dependencies_apply', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_dependencies_apply', {
    payload: { plan },
  });
  return parseDependencyApplyResult(result);
}

export async function listLocalAiRuntimeServices(): Promise<LocalAiServiceDescriptor[]> {
  const services = await invokeLocalAiCommand<unknown[]>('runtime_local_services_list');
  return (Array.isArray(services) ? services : []).map((item) => parseServiceDescriptor(item));
}

export async function installLocalAiRuntimeService(
  payload: LocalAiServicesInstallPayload,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_install', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_services_install', { payload });
  return parseServiceDescriptor(result);
}

export async function startLocalAiRuntimeService(
  serviceId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_start', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_services_start', {
    payload: { serviceId },
  });
  return parseServiceDescriptor(result);
}

export async function stopLocalAiRuntimeService(
  serviceId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_stop', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_services_stop', {
    payload: { serviceId },
  });
  return parseServiceDescriptor(result);
}

export async function healthLocalAiRuntimeServices(serviceId?: string): Promise<LocalAiServiceDescriptor[]> {
  const services = await invokeLocalAiCommand<unknown[]>('runtime_local_services_health', {
    payload: serviceId ? { serviceId } : undefined,
  });
  return (Array.isArray(services) ? services : []).map((item) => parseServiceDescriptor(item));
}

export async function removeLocalAiRuntimeService(
  serviceId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiServiceDescriptor> {
  assertLifecycleWriteAllowed('local_runtime_services_remove', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_services_remove', {
    payload: { serviceId },
  });
  return parseServiceDescriptor(result);
}

export async function listLocalAiRuntimeNodesCatalog(
  payload?: LocalAiNodesCatalogListPayload,
): Promise<LocalAiNodeDescriptor[]> {
  const nodes = await invokeLocalAiCommand<unknown[]>('runtime_local_nodes_catalog_list', {
    payload: payload || undefined,
  });
  return (Array.isArray(nodes) ? nodes : []).map((item) => parseNodeDescriptor(item));
}

export async function listLocalAiRuntimeAudits(query?: LocalAiAuditQuery): Promise<LocalAiAuditEvent[]> {
  const events = await invokeLocalAiCommand<unknown[]>('runtime_local_audits_list', {
    payload: query || undefined,
  });
  return (Array.isArray(events) ? events : []).map((item) => parseAuditEvent(item));
}

export async function pickLocalAiRuntimeManifestPath(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<string | null>('runtime_local_pick_manifest_path', {});
  return result || null;
}

export async function pickLocalAiRuntimeModelFile(): Promise<string | null> {
  if (!hasTauriInvoke()) return null;
  const result = await tauriInvoke<string | null>('runtime_local_pick_model_file', {});
  return result || null;
}

export async function importLocalAiRuntimeModelFile(
  payload: LocalAiImportFilePayload,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiInstallAcceptedResponse> {
  assertLifecycleWriteAllowed('local_runtime_models_import_file', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_models_import_file', { payload });
  return parseInstallAcceptedResponse(result);
}

export async function installLocalAiRuntimeModel(
  payload: LocalAiInstallPayload,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiInstallAcceptedResponse> {
  assertLifecycleWriteAllowed('local_runtime_models_install', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_models_install', { payload });
  return parseInstallAcceptedResponse(result);
}

export async function installLocalAiRuntimeVerifiedModel(
  payload: LocalAiInstallVerifiedPayload,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiInstallAcceptedResponse> {
  assertLifecycleWriteAllowed('local_runtime_models_install_verified', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_models_install_verified', { payload });
  return parseInstallAcceptedResponse(result);
}

export async function listLocalAiRuntimeDownloadSessions(): Promise<LocalAiDownloadSessionSummary[]> {
  const sessions = await invokeLocalAiCommand<unknown[]>('runtime_local_downloads_list');
  return (Array.isArray(sessions) ? sessions : []).map((item) => parseDownloadSessionSummary(item));
}

export async function pauseLocalAiRuntimeDownload(
  installSessionId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiDownloadSessionSummary> {
  assertLifecycleWriteAllowed('local_runtime_downloads_pause', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_downloads_pause', {
    payload: { installSessionId },
  });
  return parseDownloadSessionSummary(result);
}

export async function resumeLocalAiRuntimeDownload(
  installSessionId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiDownloadSessionSummary> {
  assertLifecycleWriteAllowed('local_runtime_downloads_resume', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_downloads_resume', {
    payload: { installSessionId },
  });
  return parseDownloadSessionSummary(result);
}

export async function cancelLocalAiRuntimeDownload(
  installSessionId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiDownloadSessionSummary> {
  assertLifecycleWriteAllowed('local_runtime_downloads_cancel', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_downloads_cancel', {
    payload: { installSessionId },
  });
  return parseDownloadSessionSummary(result);
}

export async function importLocalAiRuntimeModel(
  payload: LocalAiImportPayload,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_import', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_models_import', { payload });
  return parseModelRecord(result);
}

export async function removeLocalAiRuntimeModel(
  localModelId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_remove', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_models_remove', {
    payload: { localModelId },
  });
  return parseModelRecord(result);
}

export async function startLocalAiRuntimeModel(
  localModelId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_start', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_models_start', {
    payload: { localModelId },
  });
  return parseModelRecord(result);
}

export async function stopLocalAiRuntimeModel(
  localModelId: string,
  options?: LocalAiRuntimeWriteOptions,
): Promise<LocalAiModelRecord> {
  assertLifecycleWriteAllowed('local_runtime_models_stop', options?.caller);
  const result = await invokeLocalAiCommand<unknown>('runtime_local_models_stop', {
    payload: { localModelId },
  });
  return parseModelRecord(result);
}

export async function healthLocalAiRuntimeModels(localModelId?: string): Promise<LocalAiModelHealth[]> {
  const response = await invokeLocalAiCommand<{ models?: unknown[] }>('runtime_local_models_health', {
    payload: localModelId ? { localModelId } : undefined,
  });
  const models = Array.isArray(response?.models) ? response.models : [];
  return models.map((item) => parseModelHealth(item));
}

export async function appendLocalAiRuntimeInferenceAudit(payload: LocalAiInferenceAuditPayload): Promise<void> {
  await invokeLocalAiCommand<void>('runtime_local_append_inference_audit', { payload });
}

export async function appendLocalAiRuntimeAudit(payload: LocalAiRuntimeAuditPayload): Promise<void> {
  await invokeLocalAiCommand<void>('runtime_local_append_runtime_audit', { payload });
}

export async function revealLocalAiRuntimeModelInFolder(localModelId: string): Promise<void> {
  await invokeLocalAiCommand<void>('runtime_local_models_reveal_in_folder', {
    payload: { localModelId },
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

export async function scanLocalAiRuntimeOrphans(): Promise<OrphanModelFile[]> {
  const items = await invokeLocalAiCommand<unknown[]>('runtime_local_models_scan_orphans');
  return (Array.isArray(items) ? items : []).map((item) => parseOrphanModelFile(item));
}

export async function scaffoldLocalAiRuntimeOrphan(
  payload: LocalAiScaffoldOrphanPayload,
): Promise<LocalAiInstallAcceptedResponse> {
  const result = await invokeLocalAiCommand<unknown>('runtime_local_models_scaffold_orphan', {
    payload,
  });
  return parseInstallAcceptedResponse(result);
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
