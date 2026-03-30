import {
  appendLocalRuntimeInferenceAudit,
  appendLocalRuntimeAudit,
  revealLocalRuntimeModelInFolder,
  subscribeLocalRuntimeDownloadProgress,
  fetchLocalRuntimeSnapshot,
  healthLocalRuntimeModels,
  installLocalRuntimeVerifiedModel,
  importLocalRuntimeModel,
  importLocalRuntimeModelFile,
  importLocalRuntimeAssetFile,
  importLocalRuntimeAssetManifest,
  installLocalRuntimeModel,
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
  listLocalRuntimeArtifacts,
  listLocalRuntimeVerifiedArtifacts,
  listLocalRuntimeVerifiedModels,
  listLocalRuntimeAudits,
  listLocalRuntimeModels,
  listRuntimeLocalModelsSnapshot,
  pickLocalRuntimeManifestPath,
  pickLocalRuntimeArtifactManifestPath,
  pickLocalRuntimeAssetManifestPath,
  pickLocalRuntimeModelFile,
  importLocalRuntimeArtifact,
  removeLocalRuntimeModel,
  removeLocalRuntimeArtifact,
  startLocalRuntimeModel,
  stopLocalRuntimeModel,
  scanLocalRuntimeOrphans,
  scanLocalRuntimeArtifactOrphans,
  scanLocalRuntimeUnregisteredAssets,
  scaffoldLocalRuntimeOrphan,
  scaffoldLocalRuntimeArtifactOrphan,
  installLocalRuntimeVerifiedArtifact,
  resolveLocalRuntimeProfile,
} from './commands';
import type {
  GgufVariantDescriptor,
  LocalRuntimeCatalogRecommendation,
  LocalRuntimeCatalogVariantDescriptor,
  LocalRuntimeArtifactKind,
  LocalRuntimeAssetClass,
  LocalRuntimeModelType,
  LocalRuntimeSuggestionSource,
  LocalRuntimeSuggestionConfidence,
  LocalRuntimeAssetDeclaration,
  LocalRuntimeUnregisteredAssetDescriptor,
  LocalRuntimeArtifactRecord,
  LocalRuntimeVerifiedArtifactDescriptor,
  LocalRuntimeAuditEvent,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeCatalogResolveInstallPlanPayload,
  LocalRuntimeCatalogSearchPayload,
  LocalRuntimeAuditQuery,
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileDescriptor,
  LocalRuntimeProfileEntryDescriptor,
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
  LocalRuntimeImportArtifactPayload,
  LocalRuntimeImportAssetFilePayload,
  LocalRuntimeAssetFileImportResult,
  LocalRuntimeAssetManifestImportResult,
  LocalRuntimeInstallVerifiedArtifactPayload,
  LocalRuntimeInstallPlanDescriptor,
  LocalRuntimeImportPayload,
  LocalRuntimeImportFilePayload,
  LocalRuntimeInstallPayload,
  LocalRuntimeInstallVerifiedPayload,
  LocalRuntimeProviderAdapter,
  LocalRuntimeProviderHints,
  LocalRuntimeServiceDescriptor,
  LocalRuntimeServicesInstallPayload,
  LocalRuntimeNodeDescriptor,
  LocalRuntimeExecutionEntryDescriptor,
  LocalRuntimeExecutionPlan,
  LocalRuntimeCapabilityMatrixEntry,
  LocalRuntimeNodesCatalogListPayload,
  LocalRuntimeModelHealth,
  LocalRuntimeModelLifecycleOperation,
  LocalRuntimeModelRecord,
  LocalRuntimeRecommendationFeedDescriptor,
  LocalRuntimeRecommendationFeedItemDescriptor,
  LocalRuntimeRecommendationFeedGetPayload,
  LocalRuntimeAuditPayload,
  LocalRuntimeSnapshot,
  LocalRuntimeWriteOptions,
  LocalRuntimeListArtifactsPayload,
  LocalRuntimeListVerifiedArtifactsPayload,
  LocalRuntimeVerifiedModelDescriptor,
  LocalRuntimeInferenceAuditPayload,
  OrphanArtifactFile,
  OrphanModelFile,
  LocalRuntimeScaffoldArtifactPayload,
  LocalRuntimeScaffoldArtifactResult,
  LocalRuntimeScanOrphansPayload,
  LocalRuntimeScaffoldOrphanPayload,
} from './types';
import {
  queryLocalRuntimeModelsByCapability,
  type LocalRuntimeCapability,
} from './capability-query';
import { startLocalRuntimePolling, type LocalRuntimePollingOptions } from './polling';
export {
  bridgeLocalRuntimeProfile,
  findLocalRuntimeProfileById,
  normalizeLocalRuntimeProfilesDeclaration,
  profileSupportsCapability,
} from './profile-manifest';
export { listRuntimeLocalModelsSnapshot };

export type {
  LocalRuntimeArtifactKind,
  LocalRuntimeAssetClass,
  LocalRuntimeModelType,
  LocalRuntimeSuggestionSource,
  LocalRuntimeSuggestionConfidence,
  LocalRuntimeAssetDeclaration,
  LocalRuntimeUnregisteredAssetDescriptor,
  GgufVariantDescriptor,
  LocalRuntimeCatalogRecommendation,
  LocalRuntimeCatalogVariantDescriptor,
  LocalRuntimeArtifactRecord,
  LocalRuntimeVerifiedArtifactDescriptor,
  LocalRuntimeAuditEvent,
  LocalRuntimeCatalogItemDescriptor,
  LocalRuntimeCatalogResolveInstallPlanPayload,
  LocalRuntimeCatalogSearchPayload,
  LocalRuntimeAuditQuery,
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileDescriptor,
  LocalRuntimeProfileEntryDescriptor,
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
  LocalRuntimeImportArtifactPayload,
  LocalRuntimeImportAssetFilePayload,
  LocalRuntimeAssetFileImportResult,
  LocalRuntimeAssetManifestImportResult,
  LocalRuntimeInstallVerifiedArtifactPayload,
  LocalRuntimeInstallPlanDescriptor,
  LocalRuntimeImportPayload,
  LocalRuntimeImportFilePayload,
  LocalRuntimeInstallPayload,
  LocalRuntimeInstallVerifiedPayload,
  LocalRuntimeProviderAdapter,
  LocalRuntimeProviderHints,
  LocalRuntimeServiceDescriptor,
  LocalRuntimeServicesInstallPayload,
  LocalRuntimeNodeDescriptor,
  LocalRuntimeExecutionEntryDescriptor,
  LocalRuntimeExecutionPlan,
  LocalRuntimeCapabilityMatrixEntry,
  LocalRuntimeNodesCatalogListPayload,
  LocalRuntimeModelHealth,
  LocalRuntimeModelLifecycleOperation,
  LocalRuntimeModelRecord,
  LocalRuntimeRecommendationFeedDescriptor,
  LocalRuntimeRecommendationFeedItemDescriptor,
  LocalRuntimeRecommendationFeedGetPayload,
  LocalRuntimeAuditPayload,
  LocalRuntimeCapability,
  LocalRuntimePollingOptions,
  LocalRuntimeSnapshot,
  LocalRuntimeWriteOptions,
  LocalRuntimeListArtifactsPayload,
  LocalRuntimeListVerifiedArtifactsPayload,
  LocalRuntimeVerifiedModelDescriptor,
  OrphanArtifactFile,
  OrphanModelFile,
  LocalRuntimeScaffoldArtifactPayload,
  LocalRuntimeScaffoldArtifactResult,
  LocalRuntimeScanOrphansPayload,
  LocalRuntimeScaffoldOrphanPayload,
};

export type LocalRuntimeFacade = {
  list: () => Promise<LocalRuntimeModelRecord[]>;
  listArtifacts: (payload?: LocalRuntimeListArtifactsPayload) => Promise<LocalRuntimeArtifactRecord[]>;
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
  ) => Promise<LocalRuntimeModelRecord>;
  listVerified: () => Promise<LocalRuntimeVerifiedModelDescriptor[]>;
  listVerifiedArtifacts: (
    payload?: LocalRuntimeListVerifiedArtifactsPayload,
  ) => Promise<LocalRuntimeVerifiedArtifactDescriptor[]>;
  installVerified: (
    payload: LocalRuntimeInstallVerifiedPayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeModelRecord>;
  installVerifiedArtifact: (
    payload: LocalRuntimeInstallVerifiedArtifactPayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeArtifactRecord>;
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
  import: (
    payload: LocalRuntimeImportPayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeModelRecord>;
  importArtifact: (
    payload: LocalRuntimeImportArtifactPayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeArtifactRecord>;
  pickModelFile: () => Promise<string | null>;
  importFile: (
    payload: LocalRuntimeImportFilePayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeModelRecord>;
  remove: (
    localModelId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeModelRecord>;
  removeArtifact: (
    localArtifactId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeArtifactRecord>;
  start: (
    localModelId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeModelRecord>;
  stop: (
    localModelId: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeModelRecord>;
  health: (localModelId?: string) => Promise<LocalRuntimeModelHealth[]>;
  appendAudit: (payload: LocalRuntimeAuditPayload) => Promise<void>;
  appendInferenceAudit: (payload: LocalRuntimeInferenceAuditPayload) => Promise<void>;
  listAudits: (query?: LocalRuntimeAuditQuery) => Promise<LocalRuntimeAuditEvent[]>;
  pickManifestPath: () => Promise<string | null>;
  pickArtifactManifestPath: () => Promise<string | null>;
  pickAssetManifestPath: () => Promise<string | null>;
  queryByCapability: (capability: LocalRuntimeCapability) => Promise<LocalRuntimeModelRecord[]>;
  pollSnapshot: (localModelId?: string) => Promise<LocalRuntimeSnapshot>;
  subscribeDownloadProgress: (
    listener: (event: LocalRuntimeDownloadProgressEvent) => void,
  ) => Promise<() => void>;
  revealInFolder: (localModelId: string) => Promise<void>;
  scanOrphans: (payload?: LocalRuntimeScanOrphansPayload) => Promise<OrphanModelFile[]>;
  scaffoldOrphan: (payload: LocalRuntimeScaffoldOrphanPayload) => Promise<LocalRuntimeModelRecord>;
  scanArtifactOrphans: () => Promise<OrphanArtifactFile[]>;
  scanUnregisteredAssets: () => Promise<LocalRuntimeUnregisteredAssetDescriptor[]>;
  importAssetFile: (
    payload: LocalRuntimeImportAssetFilePayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetFileImportResult>;
  importAssetManifest: (
    manifestPath: string,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeAssetManifestImportResult>;
  scaffoldArtifactOrphan: (
    payload: LocalRuntimeScaffoldArtifactPayload,
    options?: LocalRuntimeWriteOptions,
  ) => Promise<LocalRuntimeScaffoldArtifactResult>;
};

export const localRuntime: LocalRuntimeFacade = {
  list: listLocalRuntimeModels,
  listArtifacts: listLocalRuntimeArtifacts,
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
  install: installLocalRuntimeModel,
  listVerified: listLocalRuntimeVerifiedModels,
  listVerifiedArtifacts: listLocalRuntimeVerifiedArtifacts,
  installVerified: installLocalRuntimeVerifiedModel,
  installVerifiedArtifact: installLocalRuntimeVerifiedArtifact,
  listDownloads: listLocalRuntimeDownloadSessions,
  pauseDownload: pauseLocalRuntimeDownload,
  resumeDownload: resumeLocalRuntimeDownload,
  cancelDownload: cancelLocalRuntimeDownload,
  import: importLocalRuntimeModel,
  importArtifact: importLocalRuntimeArtifact,
  pickModelFile: pickLocalRuntimeModelFile,
  importFile: importLocalRuntimeModelFile,
  remove: removeLocalRuntimeModel,
  removeArtifact: removeLocalRuntimeArtifact,
  start: startLocalRuntimeModel,
  stop: stopLocalRuntimeModel,
  health: healthLocalRuntimeModels,
  appendAudit: appendLocalRuntimeAudit,
  appendInferenceAudit: appendLocalRuntimeInferenceAudit,
  listAudits: listLocalRuntimeAudits,
  pickManifestPath: pickLocalRuntimeManifestPath,
  pickArtifactManifestPath: pickLocalRuntimeArtifactManifestPath,
  pickAssetManifestPath: pickLocalRuntimeAssetManifestPath,
  queryByCapability: queryLocalRuntimeModelsByCapability,
  pollSnapshot: fetchLocalRuntimeSnapshot,
  subscribeDownloadProgress: subscribeLocalRuntimeDownloadProgress,
  revealInFolder: revealLocalRuntimeModelInFolder,
  scanOrphans: scanLocalRuntimeOrphans,
  scaffoldOrphan: scaffoldLocalRuntimeOrphan,
  scanArtifactOrphans: scanLocalRuntimeArtifactOrphans,
  scanUnregisteredAssets: scanLocalRuntimeUnregisteredAssets,
  importAssetFile: importLocalRuntimeAssetFile,
  importAssetManifest: importLocalRuntimeAssetManifest,
  scaffoldArtifactOrphan: scaffoldLocalRuntimeArtifactOrphan,
};

export { startLocalRuntimePolling };
