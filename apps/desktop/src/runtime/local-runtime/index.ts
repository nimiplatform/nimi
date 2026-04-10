import {
  appendLocalRuntimeInferenceAudit,
  appendLocalRuntimeAudit,
  revealLocalRuntimeAssetInFolder,
  revealLocalRuntimeAssetsRootFolder,
  subscribeLocalRuntimeDownloadProgress,
  fetchLocalRuntimeSnapshot,
  healthLocalRuntimeAssets,
  installLocalRuntimeVerifiedAsset,
  importLocalRuntimeAsset,
  importLocalRuntimeAssetFile,
  importLocalRuntimeAssetFileUnified,
  importLocalRuntimeAssetBundle,
  importLocalRuntimeAssetManifest,
  installLocalRuntimeAsset,
  searchLocalRuntimeCatalog,
  listLocalRuntimeRepoGgufVariants,
  resolveLocalRuntimeInstallPlan,
  listLocalRuntimeDownloadSessions,
  pauseLocalRuntimeDownload,
  resumeLocalRuntimeDownload,
  cancelLocalRuntimeDownload,
  collectLocalRuntimeDeviceProfile,
  getLocalRuntimeRecommendationFeed,
  applyLocalRuntimeProfile,
  getLocalRuntimeProfileInstallStatus,
  listLocalRuntimeServices,
  installLocalRuntimeService,
  startLocalRuntimeService,
  stopLocalRuntimeService,
  healthLocalRuntimeServices,
  removeLocalRuntimeService,
  listLocalRuntimeNodesCatalog,
  listLocalRuntimeAssets,
  listLocalRuntimeVerifiedAssets,
  listLocalRuntimeAudits,
  pickLocalRuntimeAssetManifestPath,
  pickLocalRuntimeAssetFile,
  pickLocalRuntimeAssetDirectory,
  removeLocalRuntimeAsset,
  rescanLocalRuntimeAssetBundle,
  startLocalRuntimeAsset,
  stopLocalRuntimeAsset,
  scanLocalRuntimeUnregisteredAssets,
  scaffoldLocalRuntimeOrphanAsset,
  resolveLocalRuntimeProfile,
} from './commands';
import type {
  GgufVariantDescriptor,
  LocalRuntimeCatalogRecommendation,
  LocalRuntimeCatalogVariantDescriptor,
  LocalRuntimeAssetKind,
  LocalRuntimeSuggestionSource,
  LocalRuntimeSuggestionConfidence,
  LocalRuntimeAssetDeclaration,
  LocalRuntimeUnregisteredAssetDescriptor,
  LocalRuntimeAssetRecord,
  LocalRuntimeVerifiedAssetDescriptor,
  LocalRuntimeAuditEvent,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeCatalogResolveInstallPlanPayload,
  LocalRuntimeCatalogSearchPayload,
  LocalRuntimeAuditQuery,
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileDescriptor,
  LocalRuntimeProfileEntryDescriptor,
  LocalRuntimeProfileEntryOverride,
  LocalRuntimeProfileInstallRequest,
  LocalRuntimeProfileInstallRequestResult,
  LocalRuntimeProfileInstallStatus,
  LocalRuntimeProfileResolutionPlan,
  LocalRuntimeProfileResolvePayload,
  LocalRuntimeProfileTargetDescriptor,
  LocalRuntimeDeviceProfile,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeDownloadState,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeImportAssetFilePayload,
  LocalRuntimeAssetFileImportResult,
  LocalRuntimeAssetManifestImportResult,
  LocalRuntimeInstallVerifiedAssetPayload,
  LocalRuntimeInstallPlanDescriptor,
  LocalRuntimeImportAssetPayload,
  LocalRuntimeImportFilePayload,
  LocalRuntimeImportBundlePayload,
  LocalRuntimeInstallPayload,
  LocalRuntimeProviderAdapter,
  LocalRuntimeProviderHints,
  LocalRuntimeServiceDescriptor,
  LocalRuntimeServicesInstallPayload,
  LocalRuntimeNodeDescriptor,
  LocalRuntimeExecutionEntryDescriptor,
  LocalRuntimeExecutionPlan,
  LocalRuntimeCapabilityMatrixEntry,
  LocalRuntimeNodesCatalogListPayload,
  LocalRuntimeAssetHealth,
  LocalRuntimeAssetStatus,
  LocalRuntimeRecommendationFeedDescriptor,
  LocalRuntimeRecommendationFeedItemDescriptor,
  LocalRuntimeRecommendationFeedGetPayload,
  LocalRuntimeAuditPayload,
  LocalRuntimeSnapshot,
  LocalRuntimeWriteOptions,
  LocalRuntimeImportManifestOptions,
  LocalRuntimeListAssetsPayload,
  LocalRuntimeListVerifiedAssetsPayload,
  LocalRuntimeInferenceAuditPayload,
  LocalRuntimeScaffoldAssetPayload,
  LocalRuntimeScaffoldAssetResult,
  LocalRuntimeScaffoldOrphanPayload,
  LocalRuntimeRescanBundlePayload,
} from './types';
import {
  queryLocalRuntimeAssetsByCapability,
  type LocalRuntimeCapability,
} from './capability-query';
import { startLocalRuntimePolling, type LocalRuntimePollingOptions } from './polling';
export {
  bridgeLocalRuntimeProfile,
  findLocalRuntimeProfileById,
  normalizeLocalRuntimeProfilesDeclaration,
  profileSupportsCapability,
} from './profile-manifest';

export { listLocalRuntimeAssets };

export type {
  LocalRuntimeAssetKind,
  LocalRuntimeSuggestionSource,
  LocalRuntimeSuggestionConfidence,
  LocalRuntimeAssetDeclaration,
  LocalRuntimeUnregisteredAssetDescriptor,
  GgufVariantDescriptor,
  LocalRuntimeCatalogRecommendation,
  LocalRuntimeCatalogVariantDescriptor,
  LocalRuntimeAssetRecord,
  LocalRuntimeVerifiedAssetDescriptor,
  LocalRuntimeAuditEvent,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeCatalogResolveInstallPlanPayload,
  LocalRuntimeCatalogSearchPayload,
  LocalRuntimeAuditQuery,
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileDescriptor,
  LocalRuntimeProfileEntryDescriptor,
  LocalRuntimeProfileEntryOverride,
  LocalRuntimeProfileInstallRequest,
  LocalRuntimeProfileInstallRequestResult,
  LocalRuntimeProfileInstallStatus,
  LocalRuntimeProfileResolutionPlan,
  LocalRuntimeProfileResolvePayload,
  LocalRuntimeProfileTargetDescriptor,
  LocalRuntimeDeviceProfile,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeDownloadState,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeImportAssetFilePayload,
  LocalRuntimeAssetFileImportResult,
  LocalRuntimeAssetManifestImportResult,
  LocalRuntimeInstallVerifiedAssetPayload,
  LocalRuntimeInstallPlanDescriptor,
  LocalRuntimeImportAssetPayload,
  LocalRuntimeImportFilePayload,
  LocalRuntimeImportBundlePayload,
  LocalRuntimeInstallPayload,
  LocalRuntimeProviderAdapter,
  LocalRuntimeProviderHints,
  LocalRuntimeServiceDescriptor,
  LocalRuntimeServicesInstallPayload,
  LocalRuntimeNodeDescriptor,
  LocalRuntimeExecutionEntryDescriptor,
  LocalRuntimeExecutionPlan,
  LocalRuntimeCapabilityMatrixEntry,
  LocalRuntimeNodesCatalogListPayload,
  LocalRuntimeAssetHealth,
  LocalRuntimeAssetStatus,
  LocalRuntimeRecommendationFeedDescriptor,
  LocalRuntimeRecommendationFeedItemDescriptor,
  LocalRuntimeRecommendationFeedGetPayload,
  LocalRuntimeAuditPayload,
  LocalRuntimeCapability,
  LocalRuntimePollingOptions,
  LocalRuntimeSnapshot,
  LocalRuntimeWriteOptions,
  LocalRuntimeImportManifestOptions,
  LocalRuntimeListAssetsPayload,
  LocalRuntimeListVerifiedAssetsPayload,
  LocalRuntimeScaffoldAssetPayload,
  LocalRuntimeScaffoldAssetResult,
  LocalRuntimeScaffoldOrphanPayload,
  LocalRuntimeRescanBundlePayload,
};

export type LocalRuntimeFacade = {
  listAssets: (payload?: LocalRuntimeListAssetsPayload) => Promise<LocalRuntimeAssetRecord[]>;
  searchCatalog: (payload?: LocalRuntimeCatalogSearchPayload) => Promise<LocalRuntimeCatalogItemDescriptor[]>;
  listRepoGgufVariants: (repo: string) => Promise<GgufVariantDescriptor[]>;
  listRepoVariants: (repo: string) => Promise<LocalRuntimeCatalogVariantDescriptor[]>;
  resolveInstallPlan: (payload: LocalRuntimeCatalogResolveInstallPlanPayload) => Promise<LocalRuntimeInstallPlanDescriptor>;
  collectDeviceProfile: () => Promise<LocalRuntimeDeviceProfile>;
  getRecommendationFeed: (
    payload?: LocalRuntimeRecommendationFeedGetPayload,
  ) => Promise<LocalRuntimeRecommendationFeedDescriptor>;
  resolveProfile: (payload: LocalRuntimeProfileResolvePayload) => Promise<LocalRuntimeProfileResolutionPlan>;
  applyProfile: (
    plan: LocalRuntimeProfileResolutionPlan,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeProfileApplyResult>;
  getProfileInstallStatus: (payload: LocalRuntimeProfileResolvePayload) => Promise<LocalRuntimeProfileInstallStatus>;
  listServices: () => Promise<LocalRuntimeServiceDescriptor[]>;
  installService: (
    payload: LocalRuntimeServicesInstallPayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeServiceDescriptor>;
  startService: (
    serviceId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeServiceDescriptor>;
  stopService: (
    serviceId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeServiceDescriptor>;
  healthServices: (serviceId?: string) => Promise<LocalRuntimeServiceDescriptor[]>;
  removeService: (
    serviceId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeServiceDescriptor>;
  listNodesCatalog: (payload?: LocalRuntimeNodesCatalogListPayload) => Promise<LocalRuntimeNodeDescriptor[]>;
  install: (
    payload: LocalRuntimeInstallPayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetRecord>;
  listVerifiedAssets: (
    payload?: LocalRuntimeListVerifiedAssetsPayload,
  ) => Promise<LocalRuntimeVerifiedAssetDescriptor[]>;
  installVerifiedAsset: (
    payload: LocalRuntimeInstallVerifiedAssetPayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetRecord>;
  listDownloads: () => Promise<LocalRuntimeDownloadSessionSummary[]>;
  pauseDownload: (
    installSessionId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeDownloadSessionSummary>;
  resumeDownload: (
    installSessionId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeDownloadSessionSummary>;
  cancelDownload: (
    installSessionId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeDownloadSessionSummary>;
  importAsset: (
    payload: LocalRuntimeImportAssetPayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetRecord>;
  pickAssetFile: () => Promise<string | null>;
  pickAssetDirectory: () => Promise<string | null>;
  importFile: (
    payload: LocalRuntimeImportFilePayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetRecord>;
  importAssetBundle: (
    payload: LocalRuntimeImportBundlePayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetRecord>;
  remove: (
    localAssetId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetRecord>;
  start: (
    localAssetId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetRecord>;
  stop: (
    localAssetId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetRecord>;
  health: (localAssetId?: string) => Promise<LocalRuntimeAssetHealth[]>;
  appendAudit: (payload: LocalRuntimeAuditPayload) => Promise<void>;
  appendInferenceAudit: (payload: LocalRuntimeInferenceAuditPayload) => Promise<void>;
  listAudits: (query?: LocalRuntimeAuditQuery) => Promise<LocalRuntimeAuditEvent[]>;
  pickAssetManifestPath: () => Promise<string | null>;
  queryByCapability: (capability: LocalRuntimeCapability) => Promise<LocalRuntimeAssetRecord[]>;
  pollSnapshot: (localAssetId?: string) => Promise<LocalRuntimeSnapshot>;
  subscribeDownloadProgress: (
    listener: (event: LocalRuntimeDownloadProgressEvent) => void,
  ) => Promise<() => void>;
  revealInFolder: (localAssetId: string) => Promise<void>;
  revealRootFolder: () => Promise<void>;
  rescanAssetBundle: (
    payload: LocalRuntimeRescanBundlePayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetRecord>;
  scaffoldOrphanAsset: (
    payload: LocalRuntimeScaffoldOrphanPayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetRecord>;
  scanUnregisteredAssets: () => Promise<LocalRuntimeUnregisteredAssetDescriptor[]>;
  importAssetFile: (
    payload: LocalRuntimeImportAssetFilePayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetFileImportResult>;
  importAssetManifest: (
    manifestPath: string,
    options?: LocalRuntimeImportManifestOptions,
  ) => Promise<LocalRuntimeAssetManifestImportResult>;
};

export const localRuntime: LocalRuntimeFacade = {
  listAssets: listLocalRuntimeAssets,
  searchCatalog: searchLocalRuntimeCatalog,
  listRepoGgufVariants: listLocalRuntimeRepoGgufVariants,
  listRepoVariants: listLocalRuntimeRepoGgufVariants,
  resolveInstallPlan: resolveLocalRuntimeInstallPlan,
  collectDeviceProfile: collectLocalRuntimeDeviceProfile,
  getRecommendationFeed: getLocalRuntimeRecommendationFeed,
  resolveProfile: resolveLocalRuntimeProfile,
  applyProfile: applyLocalRuntimeProfile,
  getProfileInstallStatus: getLocalRuntimeProfileInstallStatus,
  listServices: listLocalRuntimeServices,
  installService: installLocalRuntimeService,
  startService: startLocalRuntimeService,
  stopService: stopLocalRuntimeService,
  healthServices: healthLocalRuntimeServices,
  removeService: removeLocalRuntimeService,
  listNodesCatalog: listLocalRuntimeNodesCatalog,
  install: installLocalRuntimeAsset,
  listVerifiedAssets: listLocalRuntimeVerifiedAssets,
  installVerifiedAsset: installLocalRuntimeVerifiedAsset,
  listDownloads: listLocalRuntimeDownloadSessions,
  pauseDownload: pauseLocalRuntimeDownload,
  resumeDownload: resumeLocalRuntimeDownload,
  cancelDownload: cancelLocalRuntimeDownload,
  importAsset: importLocalRuntimeAsset,
  pickAssetFile: pickLocalRuntimeAssetFile,
  pickAssetDirectory: pickLocalRuntimeAssetDirectory,
  importFile: importLocalRuntimeAssetFile,
  importAssetBundle: importLocalRuntimeAssetBundle,
  remove: removeLocalRuntimeAsset,
  start: startLocalRuntimeAsset,
  stop: stopLocalRuntimeAsset,
  health: healthLocalRuntimeAssets,
  appendAudit: appendLocalRuntimeAudit,
  appendInferenceAudit: appendLocalRuntimeInferenceAudit,
  listAudits: listLocalRuntimeAudits,
  pickAssetManifestPath: pickLocalRuntimeAssetManifestPath,
  queryByCapability: queryLocalRuntimeAssetsByCapability,
  pollSnapshot: fetchLocalRuntimeSnapshot,
  subscribeDownloadProgress: subscribeLocalRuntimeDownloadProgress,
  revealInFolder: revealLocalRuntimeAssetInFolder,
  revealRootFolder: revealLocalRuntimeAssetsRootFolder,
  rescanAssetBundle: rescanLocalRuntimeAssetBundle,
  scaffoldOrphanAsset: scaffoldLocalRuntimeOrphanAsset,
  scanUnregisteredAssets: scanLocalRuntimeUnregisteredAssets,
  importAssetFile: importLocalRuntimeAssetFileUnified,
  importAssetManifest: importLocalRuntimeAssetManifest,
};

export { startLocalRuntimePolling };
