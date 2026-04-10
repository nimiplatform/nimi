import { getPlatformClient } from '@nimiplatform/sdk';
import { emitRuntimeLog } from '../telemetry/logger';
import type {
  GgufVariantDescriptor,
  LocalRuntimeAssetRecord,
  LocalRuntimeVerifiedAssetDescriptor,
  LocalRuntimeCatalogSearchPayload,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeCatalogResolveInstallPlanPayload,
  LocalRuntimeInstallPlanDescriptor,
  LocalRuntimeDeviceProfile,
  LocalRuntimeExecutionPlan,
  LocalRuntimeProfileApplyResult,
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
  LocalRuntimeInstallVerifiedAssetPayload,
  LocalRuntimeImportAssetPayload,
  LocalRuntimeImportFilePayload,
  LocalRuntimeImportBundlePayload,
  LocalRuntimeImportAssetFilePayload,
  LocalRuntimeAssetFileImportResult,
  LocalRuntimeAssetHealth,
  LocalRuntimeRecommendationFeedDescriptor,
  LocalRuntimeRecommendationFeedGetPayload,
  LocalRuntimeInferenceAuditPayload,
  LocalRuntimeAuditPayload,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeSnapshot,
  LocalRuntimeWriteOptions,
  LocalRuntimeImportManifestOptions,
  LocalRuntimeListAssetsPayload,
  LocalRuntimeListVerifiedAssetsPayload,
  LocalRuntimeUnregisteredAssetDescriptor,
  LocalRuntimeScaffoldOrphanPayload,
  LocalRuntimeRescanBundlePayload,
} from './types';
import { localIdsMatch, toCanonicalLocalLookupKey } from './local-id';
import {
  invokeLocalRuntimeCommand,
  parseAssetRecord,
  parseVerifiedAssetDescriptor,
  parseCatalogItemDescriptor,
  parseGgufVariantDescriptor,
  parseInstallPlanDescriptor,
  parseDeviceProfile,
  parseProfileApplyResult,
  parseProfileResolutionPlan,
  parseServiceDescriptor,
  parseNodeDescriptor,
  parseAuditEvent,
  parseAssetHealth,
  parseDownloadProgressEvent,
  parseDownloadSessionSummary,
  parseRecommendationFeedDescriptor,
  parseUnregisteredAssetDescriptor,
  assertLifecycleWriteAllowed,
} from './parsers';
export {
  pickLocalRuntimeAssetManifestPath,
  pickLocalRuntimeAssetFile,
  pickLocalRuntimeAssetDirectory,
} from './commands-pickers';

// Desktop command contract: commands bridged via SDK gRPC client (not direct Tauri invoke).
// These markers satisfy the desktop-spec-kernel-consistency check against ipc-commands.yaml.
// runtime_local_audits_list
// runtime_local_assets_install_verified
// runtime_local_assets_import
// runtime_local_assets_import_file
// runtime_local_pick_asset_directory
// runtime_local_assets_import_bundle
// runtime_local_assets_rescan_bundle
// runtime_local_assets_remove
// runtime_local_assets_start
// runtime_local_assets_stop
// runtime_local_assets_health
// runtime_local_models_catalog_search
// runtime_local_models_catalog_resolve_install_plan
// runtime_local_device_profile_collect
// runtime_local_services_list
// runtime_local_services_install
// runtime_local_services_start
// runtime_local_services_stop
// runtime_local_services_health
// runtime_local_services_remove
// runtime_local_nodes_catalog_list
// runtime_local_downloads_list
// runtime_local_downloads_pause
// runtime_local_downloads_resume
// runtime_local_downloads_cancel
// runtime_local_append_inference_audit
// runtime_local_append_runtime_audit
// runtime_local_assets_scan_unregistered

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


function requireSdkLocal(): LocalClient {
  const runtime = getSdkLocal();
  if (!runtime) {
    throw new Error('Runtime local service unavailable');
  }
  return runtime;
}

function toAssetStatusFilter(status?: LocalRuntimeListAssetsPayload['status']): number {
  if (status === 'installed') return 1;
  if (status === 'active') return 2;
  if (status === 'unhealthy') return 3;
  if (status === 'removed') return 4;
  return 0;
}

function toAssetKindFilter(kind?: LocalRuntimeListAssetsPayload['kind']): number {
  if (kind === 'chat') return 1;
  if (kind === 'image') return 2;
  if (kind === 'video') return 3;
  if (kind === 'tts') return 4;
  if (kind === 'stt') return 5;
  if (kind === 'vae') return 10;
  if (kind === 'clip') return 11;
  if (kind === 'lora') return 12;
  if (kind === 'controlnet') return 13;
  if (kind === 'auxiliary') return 14;
  return 0;
}

function assetLookupKey(asset: Pick<LocalRuntimeAssetRecord, 'assetId' | 'kind' | 'engine'>): string {
  return [
    toCanonicalLocalLookupKey(asset.assetId),
    String(asset.kind || '').trim().toLowerCase(),
    String(asset.engine || '').trim().toLowerCase(),
  ].join('::');
}

export async function listLocalRuntimeAssets(
  payload?: LocalRuntimeListAssetsPayload,
): Promise<LocalRuntimeAssetRecord[]> {
  const runtime = getSdkLocal();
  if (!runtime) {
    return [];
  }
  const assets: LocalRuntimeAssetRecord[] = [];
  let pageToken = '';
  for (let index = 0; index < 20; index += 1) {
    const response = await runtime.listLocalAssets({
      statusFilter: toAssetStatusFilter(payload?.status),
      kindFilter: toAssetKindFilter(payload?.kind),
      engineFilter: String(payload?.engine || '').trim(),
      pageSize: 100,
      pageToken,
    });
    const raw = asRecord(response);
    const items = Array.isArray(raw.assets) ? raw.assets : [];
    assets.push(...items.map((item) => parseAssetRecord(item)));
    pageToken = String(raw.nextPageToken || '').trim();
    if (!pageToken) {
      break;
    }
  }
  const byKey = new Map(assets.map((asset) => [assetLookupKey(asset), asset] as const));
  return [...byKey.values()];
}

export async function listLocalRuntimeVerifiedAssets(
  payload?: LocalRuntimeListVerifiedAssetsPayload,
): Promise<LocalRuntimeVerifiedAssetDescriptor[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listVerifiedAssets({
    kindFilter: toAssetKindFilter(payload?.kind),
    engineFilter: String(payload?.engine || '').trim(),
    pageSize: 0,
    pageToken: '',
  });
  const raw = asRecord(response);
  const items: unknown[] = Array.isArray(raw.assets) ? raw.assets : [];
  return items.map((item: unknown) => parseVerifiedAssetDescriptor(item));
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

function assetMatchesDependency(
  dependency: LocalRuntimeExecutionPlan['entries'][number],
  asset: LocalRuntimeAssetRecord,
): boolean {
  const modelId = String(dependency.modelId || '').trim();
  const engine = String(dependency.engine || '').trim().toLowerCase();
  if (modelId && !localIdsMatch(asset.assetId, modelId)) {
    return false;
  }
  if (engine && String(asset.engine || '').trim().toLowerCase() !== engine) {
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
      entryOverrides: payload.entryOverrides,
    },
  });
  return parseProfileResolutionPlan(result);
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
    installedAssets: applyResult.installedAssets,
    warnings: applyResult.warnings,
    reasonCode: applyResult.reasonCode || applyResult.executionResult.reasonCode,
  };
}

export async function getLocalRuntimeProfileInstallStatus(
  payload: LocalRuntimeProfileResolvePayload,
): Promise<LocalRuntimeProfileInstallStatus> {
  const resolved = await resolveLocalRuntimeProfile(payload);
  const assets = await listLocalRuntimeAssets();
  const services = await listLocalRuntimeServices();
  const nodes = await listLocalRuntimeNodesCatalog();
  const warnings = [...resolved.warnings];
  const missingDependencies = resolved.executionPlan.entries.flatMap((entry) => {
    if (!entry.required || !entry.selected) {
      return entry.required ? [entry.entryId] : [];
    }
    if (entry.kind === 'asset') {
      const asset = assets.find((candidate) => assetMatchesDependency(entry, candidate)) || null;
      if (!asset || asset.status === 'removed') {
        return [entry.entryId];
      }
      if (asset.status !== 'active') {
        warnings.push(`asset ${entry.modelId || entry.entryId} is ${asset.status}`);
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
  const missingEntries = [...missingDependencies];
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
    localModelId: String(payload.localAssetId || '').trim(),
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

export async function importLocalRuntimeAssetFile(
  payload: LocalRuntimeImportFilePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_import_file', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.importLocalAssetFile({
    filePath: String(payload.filePath || '').trim(),
    assetName: String(payload.assetName || '').trim(),
    kind: toAssetKindFilter(payload.kind),
    engine: String(payload.engine || '').trim(),
    capabilities: [],
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
}

export async function importLocalRuntimeAssetBundle(
  payload: LocalRuntimeImportBundlePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_import_bundle', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_assets_import_bundle', {
    payload: {
      directoryPath: String(payload.directoryPath || '').trim(),
      modelName: String(payload.modelName || '').trim() || undefined,
      capabilities: Array.isArray(payload.capabilities) ? payload.capabilities : [],
      engine: String(payload.engine || '').trim() || undefined,
      endpoint: String(payload.endpoint || '').trim() || undefined,
    },
  });
  return parseAssetRecord(result);
}

export async function installLocalRuntimeAsset(
  payload: LocalRuntimeInstallPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_install', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_assets_install', {
    payload: {
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
      engineConfig: payload.engineConfig,
    },
  });
  return parseAssetRecord(result);
}

export async function installLocalRuntimeVerifiedAsset(
  payload: LocalRuntimeInstallVerifiedAssetPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_install_verified', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.installVerifiedAsset({
    templateId: String(payload.templateId || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
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

export async function importLocalRuntimeAsset(
  payload: LocalRuntimeImportAssetPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_import', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.importLocalAsset({
    manifestPath: String(payload.manifestPath || '').trim(),
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
}

export async function removeLocalRuntimeAsset(
  localAssetId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_remove', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.removeLocalAsset({
    localAssetId: String(localAssetId || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
}

export async function startLocalRuntimeAsset(
  localAssetId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_start', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.startLocalAsset({
    localAssetId: String(localAssetId || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
}

export async function stopLocalRuntimeAsset(
  localAssetId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_stop', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.stopLocalAsset({
    localAssetId: String(localAssetId || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
}

export async function healthLocalRuntimeAssets(localAssetId?: string): Promise<LocalRuntimeAssetHealth[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.checkLocalAssetHealth({
    localAssetId: String(localAssetId || '').trim(),
  });
  const raw = asRecord(response);
  const assets = Array.isArray(raw.assets) ? raw.assets : [];
  return assets.map((item) => parseAssetHealth(item));
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
    modelId: String(payload.assetId || ''),
    localModelId: String(payload.localAssetId || ''),
    payload: payload.payload as never,
  });
}

export async function revealLocalRuntimeAssetInFolder(localAssetId: string): Promise<void> {
  await invokeLocalRuntimeCommand<void>('runtime_local_assets_reveal_in_folder', {
    payload: { localAssetId },
  });
}

export async function revealLocalRuntimeAssetsRootFolder(): Promise<void> {
  await invokeLocalRuntimeCommand<void>('runtime_local_assets_reveal_root_folder');
}

export async function rescanLocalRuntimeAssetBundle(
  payload: LocalRuntimeRescanBundlePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_rescan_bundle', options?.caller);
  const result = await invokeLocalRuntimeCommand<unknown>('runtime_local_assets_rescan_bundle', {
    payload: {
      localAssetId: String(payload.localAssetId || '').trim(),
    },
  });
  return parseAssetRecord(result);
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

export async function scaffoldLocalRuntimeOrphanAsset(
  payload: LocalRuntimeScaffoldOrphanPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  assertLifecycleWriteAllowed('local_runtime_assets_scaffold_orphan', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.scaffoldOrphanAsset({
    path: String(payload.path || '').trim(),
    kind: toAssetKindFilter(payload.kind),
    engine: String(payload.engine || '').trim(),
    capabilities: [],
    endpoint: String(payload.endpoint || '').trim(),
  });
  return parseAssetRecord(asRecord(response).asset);
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

export async function importLocalRuntimeAssetFileUnified(
  payload: LocalRuntimeImportAssetFilePayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetFileImportResult> {
  const declaration = payload.declaration;
  const asset = await importLocalRuntimeAssetFile({
    filePath: payload.filePath,
    assetName: payload.assetName,
    kind: declaration.assetKind,
    engine: declaration.engine,
    endpoint: payload.endpoint,
  }, options);
  return { asset };
}

export async function importLocalRuntimeAssetManifest(
  manifestPath: string,
  options?: LocalRuntimeImportManifestOptions,
): Promise<import('./types').LocalRuntimeAssetManifestImportResult> {
  const normalizedPath = String(manifestPath || '').trim();
  if (!normalizedPath) {
    throw new Error('manifestPath is required');
  }
  const asset = await importLocalRuntimeAsset({
    manifestPath: normalizedPath,
    endpoint: String(options?.endpoint || '').trim() || undefined,
  }, options);
  return { asset };
}

export async function fetchLocalRuntimeSnapshot(localAssetId?: string): Promise<LocalRuntimeSnapshot> {
  const [assets, health] = await Promise.all([
    listLocalRuntimeAssets(),
    healthLocalRuntimeAssets(localAssetId),
  ]);
  return {
    assets,
    health,
    generatedAt: new Date().toISOString(),
  };
}
