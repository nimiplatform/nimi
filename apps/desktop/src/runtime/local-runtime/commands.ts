import type {
  GgufVariantDescriptor,
  LocalRuntimeAssetRecord,
  LocalRuntimeVerifiedAssetDescriptor,
  LocalRuntimeCatalogSearchPayload,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeCatalogResolveInstallPlanPayload,
  LocalRuntimeInstallPlanDescriptor,
  LocalRuntimeDeviceProfile,
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileInstallStatus,
  LocalRuntimeProfileResolutionPlan,
  LocalRuntimeProfileResolvePayload,
  LocalRuntimeRecommendationFeedDescriptor,
  LocalRuntimeRecommendationFeedGetPayload,
  LocalRuntimeSnapshot,
  LocalRuntimeWriteOptions,
  LocalRuntimeListAssetsPayload,
  LocalRuntimeListVerifiedAssetsPayload,
} from './types';
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
  parseRecommendationFeedDescriptor,
  assertLifecycleWriteAllowed,
} from './parsers';
import {
  assetLookupKey,
  assetMatchesDependency,
  asRecord,
  getSdkLocal,
  requireSdkLocal,
  serviceMatchesDependency,
  toAssetKindFilter,
  toAssetStatusFilter,
} from './commands-shared';
import {
  appendLocalRuntimeAudit,
  appendLocalRuntimeInferenceAudit,
  healthLocalRuntimeServices,
  installLocalRuntimeService,
  listLocalRuntimeAudits,
  listLocalRuntimeNodesCatalog,
  listLocalRuntimeServices,
  removeLocalRuntimeService,
  startLocalRuntimeService,
  stopLocalRuntimeService,
} from './commands-services';
import {
  cancelLocalRuntimeDownload,
  healthLocalRuntimeAssets,
  importLocalRuntimeAsset,
  importLocalRuntimeAssetBundle,
  importLocalRuntimeAssetFile,
  importLocalRuntimeAssetFileUnified,
  importLocalRuntimeAssetManifest,
  installLocalRuntimeAsset,
  installLocalRuntimeVerifiedAsset,
  listLocalRuntimeDownloadSessions,
  pauseLocalRuntimeDownload,
  removeLocalRuntimeAsset,
  rescanLocalRuntimeAssetBundle,
  resumeLocalRuntimeDownload,
  revealLocalRuntimeAssetInFolder,
  revealLocalRuntimeAssetsRootFolder,
  scanLocalRuntimeUnregisteredAssets,
  scaffoldLocalRuntimeOrphanAsset,
  startLocalRuntimeAsset,
  stopLocalRuntimeAsset,
  subscribeLocalRuntimeDownloadProgress,
} from './commands-assets';
export {
  pickLocalRuntimeAssetManifestPath,
  pickLocalRuntimeAssetFile,
  pickLocalRuntimeAssetDirectory,
} from './commands-pickers';

// Desktop command contract: commands bridged via SDK gRPC client (not direct Tauri invoke).
// These markers satisfy the desktop-spec-kernel-consistency check against ipc-commands.yaml.
// runtime_local_audits_list
// runtime_local_assets_install
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
// runtime_local_assets_reveal_in_folder
// runtime_local_assets_reveal_root_folder
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

export {
  appendLocalRuntimeAudit,
  appendLocalRuntimeInferenceAudit,
  cancelLocalRuntimeDownload,
  healthLocalRuntimeAssets,
  healthLocalRuntimeServices,
  importLocalRuntimeAsset,
  importLocalRuntimeAssetBundle,
  importLocalRuntimeAssetFile,
  importLocalRuntimeAssetFileUnified,
  importLocalRuntimeAssetManifest,
  installLocalRuntimeAsset,
  installLocalRuntimeService,
  installLocalRuntimeVerifiedAsset,
  listLocalRuntimeAudits,
  listLocalRuntimeDownloadSessions,
  listLocalRuntimeNodesCatalog,
  listLocalRuntimeServices,
  pauseLocalRuntimeDownload,
  removeLocalRuntimeAsset,
  removeLocalRuntimeService,
  rescanLocalRuntimeAssetBundle,
  resumeLocalRuntimeDownload,
  revealLocalRuntimeAssetInFolder,
  revealLocalRuntimeAssetsRootFolder,
  scanLocalRuntimeUnregisteredAssets,
  scaffoldLocalRuntimeOrphanAsset,
  startLocalRuntimeAsset,
  startLocalRuntimeService,
  stopLocalRuntimeAsset,
  stopLocalRuntimeService,
  subscribeLocalRuntimeDownloadProgress,
};
