import {
  toLocalProfileEntryKindRequestValue,
  toLocalRecommendationFeedCapabilityRequestValue,
  toLocalRuntimeAssetKindRequestValue,
  toLocalRuntimeGpuMemoryModelRequestValue,
  toProtoStruct,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
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
  LocalRuntimeProfileDescriptor,
  LocalRuntimeProfileEntryDescriptor,
  LocalRuntimeProfileEntryOverride,
  LocalRuntimeProfileInstallStatus,
  LocalRuntimeProfileRequirementDescriptor,
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
  resolveLocalRuntimeEnvironmentActivationGate,
  resolveLocalRuntimeEnvironmentPlan,
  resumeLocalRuntimeDownload,
  revealLocalRuntimeAssetInFolder,
  revealLocalRuntimeAssetsRootFolder,
  scanLocalRuntimeUnregisteredAssets,
  scaffoldLocalRuntimeOrphanAsset,
  listLocalRuntimeEnvironmentDependencyJobs,
  listLocalRuntimeEnvironmentSelectedSources,
  startLocalRuntimeEnvironmentDependencyJob,
  cancelLocalRuntimeEnvironmentDependencyJob,
  retryLocalRuntimeEnvironmentDependencyJob,
  repairLocalRuntimeEnvironmentDependency,
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
// runtime_local_pick_asset_directory
// runtime_local_assets_reveal_in_folder
// runtime_local_assets_reveal_root_folder

function toInt64String(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : '0';
}

function toSdkDeviceProfile(profile?: LocalRuntimeDeviceProfile): Record<string, unknown> | undefined {
  if (!profile) {
    return undefined;
  }
  return {
    os: String(profile.os || ''),
    arch: String(profile.arch || ''),
    totalRamBytes: toInt64String(profile.totalRamBytes),
    availableRamBytes: toInt64String(profile.availableRamBytes),
    diskFreeBytes: toInt64String(profile.diskFreeBytes),
    ports: (Array.isArray(profile.ports) ? profile.ports : []).map((port) => ({
      port: Number(port.port || 0),
      available: Boolean(port.available),
    })),
    gpu: {
      available: Boolean(profile.gpu?.available),
      vendor: String(profile.gpu?.vendor || ''),
      model: String(profile.gpu?.model || ''),
      totalVramBytes: toInt64String(profile.gpu?.totalVramBytes),
      availableVramBytes: toInt64String(profile.gpu?.availableVramBytes),
      memoryModel: toLocalRuntimeGpuMemoryModelRequestValue(profile.gpu?.memoryModel),
    },
    python: {
      available: Boolean(profile.python?.available),
      version: String(profile.python?.version || ''),
    },
    npu: {
      available: Boolean(profile.npu?.available),
      ready: Boolean(profile.npu?.ready),
      vendor: String(profile.npu?.vendor || ''),
      runtime: String(profile.npu?.runtime || ''),
      detail: String(profile.npu?.detail || ''),
    },
  };
}

function toSdkProfileRequirements(
  requirements?: LocalRuntimeProfileRequirementDescriptor,
): Record<string, unknown> | undefined {
  if (!requirements) {
    return undefined;
  }
  return {
    minGpuMemoryGb: Number(requirements.minGpuMemoryGb || 0),
    minDiskBytes: toInt64String(requirements.minDiskBytes),
    platforms: Array.isArray(requirements.platforms) ? requirements.platforms : [],
    notes: Array.isArray(requirements.notes) ? requirements.notes : [],
  };
}

function toSdkProfileEntry(entry: LocalRuntimeProfileEntryDescriptor): Record<string, unknown> {
  return {
    entryId: String(entry.entryId || ''),
    kind: toLocalProfileEntryKindRequestValue(entry.kind),
    title: String(entry.title || ''),
    description: String(entry.description || ''),
    capability: String(entry.capability || ''),
    required: Boolean(entry.required),
    preferred: Boolean(entry.preferred),
    assetId: String(entry.assetId || ''),
    assetKind: toLocalRuntimeAssetKindRequestValue(entry.assetKind),
    engineSlot: String(entry.engineSlot || ''),
    repo: String(entry.repo || ''),
    serviceId: String(entry.serviceId || ''),
    nodeId: String(entry.nodeId || ''),
    engine: String(entry.engine || ''),
    templateId: String(entry.templateId || ''),
    revision: String(entry.revision || ''),
    tags: Array.isArray(entry.tags) ? entry.tags : [],
  };
}

function toSdkProfileDescriptor(profile: LocalRuntimeProfileDescriptor): Record<string, unknown> {
  return {
    id: String(profile.id || ''),
    title: String(profile.title || ''),
    description: String(profile.description || ''),
    recommended: Boolean(profile.recommended),
    consumeCapabilities: Array.isArray(profile.consumeCapabilities) ? profile.consumeCapabilities : [],
    entries: (Array.isArray(profile.entries) ? profile.entries : []).map((entry) => toSdkProfileEntry(entry)),
    requirements: toSdkProfileRequirements(profile.requirements),
  };
}

function toSdkProfileEntryOverride(override: LocalRuntimeProfileEntryOverride): Record<string, unknown> {
  return {
    entryId: String(override.entryId || ''),
    localAssetId: String(override.localAssetId || ''),
  };
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
    pageSize: Number(payload?.limit || 0) || 50,
    pageToken: '',
  });
  const raw = asRecord(response);
  const items: unknown[] = Array.isArray(raw.items) ? raw.items : [];
  return (Array.isArray(items) ? items : []).map((item) => parseCatalogItemDescriptor(item));
}

export async function listLocalRuntimeRepoGgufVariants(
  repo: string,
): Promise<GgufVariantDescriptor[]> {
  const runtime = requireSdkLocal();
  const response = await runtime.listCatalogVariants({
    repo: String(repo || '').trim(),
  });
  const raw = asRecord(response);
  const items: unknown[] = Array.isArray(raw.variants) ? raw.variants : [];
  return items.map((item) => parseGgufVariantDescriptor(item));
}

export async function resolveLocalRuntimeInstallPlan(
  payload: LocalRuntimeCatalogResolveInstallPlanPayload,
): Promise<LocalRuntimeInstallPlanDescriptor> {
  const runtime = requireSdkLocal();
  const response = await runtime.resolveModelInstallPlan({
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
    engineConfig: toProtoStruct(payload.engineConfig),
  });
  return parseInstallPlanDescriptor(asRecord(response).plan);
}

export async function collectLocalRuntimeDeviceProfile(): Promise<LocalRuntimeDeviceProfile> {
  const runtime = requireSdkLocal();
  const response = await runtime.collectDeviceProfile({ extraPorts: [] });
  return parseDeviceProfile(asRecord(response).profile);
}

export async function getLocalRuntimeRecommendationFeed(
  payload?: LocalRuntimeRecommendationFeedGetPayload,
): Promise<LocalRuntimeRecommendationFeedDescriptor> {
  const runtime = requireSdkLocal();
  const response = await runtime.getRecommendationFeed({
    capability: toLocalRecommendationFeedCapabilityRequestValue(payload?.capability),
    pageSize: Number(payload?.pageSize || 0),
  });
  return parseRecommendationFeedDescriptor(asRecord(response).feed, parseDeviceProfile);
}

export async function resolveLocalRuntimeProfile(
  payload: LocalRuntimeProfileResolvePayload,
): Promise<LocalRuntimeProfileResolutionPlan> {
  const runtime = requireSdkLocal();
  const request = {
    targetId: String(payload.targetId || '').trim(),
    profile: toSdkProfileDescriptor(payload.profile),
    capability: String(payload.capability || '').trim(),
    deviceProfile: toSdkDeviceProfile(payload.deviceProfile),
    entryOverrides: (Array.isArray(payload.entryOverrides) ? payload.entryOverrides : [])
      .map((entryOverride) => toSdkProfileEntryOverride(entryOverride)),
  } as unknown as Parameters<typeof runtime.resolveProfile>[0];
  const response = await runtime.resolveProfile(request);
  return parseProfileResolutionPlan(asRecord(response).plan);
}

export async function applyLocalRuntimeProfile(
  plan: LocalRuntimeProfileResolutionPlan,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeProfileApplyResult> {
  assertLifecycleWriteAllowed('local_runtime_profiles_apply', options?.caller);
  const runtime = requireSdkLocal();
  const response = await runtime.applyProfile({
    plan: plan as unknown as Parameters<typeof runtime.applyProfile>[0]['plan'],
  });
  const result = parseProfileApplyResult(asRecord(response).result);
  const reasonCode = String(result.reasonCode || result.executionResult.reasonCode || '').trim();
  if (reasonCode && reasonCode !== ReasonCode.ACTION_EXECUTED) {
    throw new Error(reasonCode);
  }
  return result;
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
    targetId: payload.targetId,
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
  resolveLocalRuntimeEnvironmentActivationGate,
  resolveLocalRuntimeEnvironmentPlan,
  resumeLocalRuntimeDownload,
  revealLocalRuntimeAssetInFolder,
  revealLocalRuntimeAssetsRootFolder,
  scanLocalRuntimeUnregisteredAssets,
  scaffoldLocalRuntimeOrphanAsset,
  listLocalRuntimeEnvironmentDependencyJobs,
  listLocalRuntimeEnvironmentSelectedSources,
  startLocalRuntimeEnvironmentDependencyJob,
  cancelLocalRuntimeEnvironmentDependencyJob,
  retryLocalRuntimeEnvironmentDependencyJob,
  repairLocalRuntimeEnvironmentDependency,
  startLocalRuntimeAsset,
  startLocalRuntimeService,
  stopLocalRuntimeAsset,
  stopLocalRuntimeService,
  subscribeLocalRuntimeDownloadProgress,
};
