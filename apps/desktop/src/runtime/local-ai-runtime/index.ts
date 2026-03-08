import {
  appendLocalAiRuntimeInferenceAudit,
  appendLocalAiRuntimeAudit,
  revealLocalAiRuntimeModelInFolder,
  subscribeLocalAiRuntimeDownloadProgress,
  fetchLocalAiRuntimeSnapshot,
  healthLocalAiRuntimeModels,
  installLocalAiRuntimeVerifiedModel,
  importLocalAiRuntimeModel,
  importLocalAiRuntimeModelFile,
  installLocalAiRuntimeModel,
  searchLocalAiRuntimeCatalog,
  listLocalAiRuntimeRepoGgufVariants,
  resolveLocalAiRuntimeInstallPlan,
  listLocalAiRuntimeDownloadSessions,
  pauseLocalAiRuntimeDownload,
  resumeLocalAiRuntimeDownload,
  cancelLocalAiRuntimeDownload,
  collectLocalAiRuntimeDeviceProfile,
  resolveLocalAiRuntimeDependencies,
  applyLocalAiRuntimeDependencies,
  listLocalAiRuntimeServices,
  installLocalAiRuntimeService,
  startLocalAiRuntimeService,
  stopLocalAiRuntimeService,
  healthLocalAiRuntimeServices,
  removeLocalAiRuntimeService,
  listLocalAiRuntimeNodesCatalog,
  listLocalAiRuntimeArtifacts,
  listLocalAiRuntimeVerifiedArtifacts,
  listLocalAiRuntimeVerifiedModels,
  listLocalAiRuntimeAudits,
  listLocalAiRuntimeModels,
  pickLocalAiRuntimeManifestPath,
  pickLocalAiRuntimeArtifactManifestPath,
  pickLocalAiRuntimeModelFile,
  importLocalAiRuntimeArtifact,
  removeLocalAiRuntimeModel,
  removeLocalAiRuntimeArtifact,
  startLocalAiRuntimeModel,
  stopLocalAiRuntimeModel,
  scanLocalAiRuntimeOrphans,
  scanLocalAiRuntimeArtifactOrphans,
  scaffoldLocalAiRuntimeOrphan,
  scaffoldLocalAiRuntimeArtifactOrphan,
  installLocalAiRuntimeVerifiedArtifact,
} from './commands';
import type {
  GgufVariantDescriptor,
  LocalAiArtifactKind,
  LocalAiArtifactRecord,
  LocalAiVerifiedArtifactDescriptor,
  LocalAiAuditEvent,
  LocalAiCatalogItemDescriptor,
  LocalAiCatalogResolveInstallPlanPayload,
  LocalAiCatalogSearchPayload,
  LocalAiAuditQuery,
  LocalAiDependenciesDeclarationDescriptor,
  LocalAiDependenciesResolvePayload,
  LocalAiDependencyDescriptor,
  LocalAiDependencyResolutionPlan,
  LocalAiDependencyApplyResult,
  LocalAiDeviceProfile,
  LocalAiDownloadSessionSummary,
  LocalAiDownloadState,
  LocalAiDownloadProgressEvent,
  LocalAiImportArtifactPayload,
  LocalAiInstallAcceptedResponse,
  LocalAiInstallVerifiedArtifactPayload,
  LocalAiInstallPlanDescriptor,
  LocalAiImportPayload,
  LocalAiImportFilePayload,
  LocalAiInstallPayload,
  LocalAiInstallVerifiedPayload,
  LocalAiProviderAdapter,
  LocalAiProviderHints,
  LocalAiServiceDescriptor,
  LocalAiServicesInstallPayload,
  LocalAiNodeDescriptor,
  LocalAiCapabilityMatrixEntry,
  LocalAiNodesCatalogListPayload,
  LocalAiModelHealth,
  LocalAiModelRecord,
  LocalAiRuntimeAuditPayload,
  LocalAiRuntimeSnapshot,
  LocalAiRuntimeWriteOptions,
  LocalAiListArtifactsPayload,
  LocalAiListVerifiedArtifactsPayload,
  LocalAiVerifiedModelDescriptor,
  LocalAiInferenceAuditPayload,
  OrphanArtifactFile,
  OrphanModelFile,
  LocalAiScaffoldArtifactPayload,
  LocalAiScaffoldArtifactResult,
  LocalAiScaffoldOrphanPayload,
} from './types';
import {
  queryLocalAiRuntimeModelsByCapability,
  type LocalAiRuntimeCapability,
} from './capability-query';
import { startLocalAiRuntimePolling, type LocalAiRuntimePollingOptions } from './polling';
import {
  type GoRuntimeBootstrapResult,
  type GoRuntimeModelEntry,
  type GoRuntimeSyncAction,
  type GoRuntimeSyncResult,
  type GoRuntimeSyncTarget,
  GoRuntimeSyncError,
  listGoRuntimeModelsSnapshot,
  reconcileDesktopAndGoRuntimeModels,
  syncModelInstallToGoRuntime,
  syncModelStartToGoRuntime,
  syncModelStopToGoRuntime,
  syncModelRemoveToGoRuntime,
  reconcileModelsToGoRuntime,
} from './go-runtime-sync';

export {
  GoRuntimeSyncError,
  listGoRuntimeModelsSnapshot,
  reconcileDesktopAndGoRuntimeModels,
  syncModelInstallToGoRuntime,
  syncModelStartToGoRuntime,
  syncModelStopToGoRuntime,
  syncModelRemoveToGoRuntime,
  reconcileModelsToGoRuntime,
};

export type {
  LocalAiArtifactKind,
  GgufVariantDescriptor,
  LocalAiArtifactRecord,
  LocalAiVerifiedArtifactDescriptor,
  LocalAiAuditEvent,
  LocalAiCatalogItemDescriptor,
  LocalAiCatalogResolveInstallPlanPayload,
  LocalAiCatalogSearchPayload,
  LocalAiAuditQuery,
  LocalAiDependenciesDeclarationDescriptor,
  LocalAiDependenciesResolvePayload,
  LocalAiDependencyDescriptor,
  LocalAiDependencyResolutionPlan,
  LocalAiDependencyApplyResult,
  LocalAiDeviceProfile,
  LocalAiDownloadSessionSummary,
  LocalAiDownloadState,
  LocalAiDownloadProgressEvent,
  LocalAiImportArtifactPayload,
  LocalAiInstallAcceptedResponse,
  LocalAiInstallVerifiedArtifactPayload,
  LocalAiInstallPlanDescriptor,
  LocalAiImportPayload,
  LocalAiImportFilePayload,
  LocalAiInstallPayload,
  LocalAiInstallVerifiedPayload,
  LocalAiProviderAdapter,
  LocalAiProviderHints,
  LocalAiServiceDescriptor,
  LocalAiServicesInstallPayload,
  LocalAiNodeDescriptor,
  LocalAiCapabilityMatrixEntry,
  LocalAiNodesCatalogListPayload,
  LocalAiModelHealth,
  LocalAiModelRecord,
  LocalAiRuntimeAuditPayload,
  LocalAiRuntimeCapability,
  LocalAiRuntimePollingOptions,
  LocalAiRuntimeSnapshot,
  LocalAiRuntimeWriteOptions,
  LocalAiListArtifactsPayload,
  LocalAiListVerifiedArtifactsPayload,
  LocalAiVerifiedModelDescriptor,
  GoRuntimeBootstrapResult,
  GoRuntimeModelEntry,
  GoRuntimeSyncAction,
  GoRuntimeSyncResult,
  GoRuntimeSyncTarget,
  OrphanArtifactFile,
  OrphanModelFile,
  LocalAiScaffoldArtifactPayload,
  LocalAiScaffoldArtifactResult,
  LocalAiScaffoldOrphanPayload,
};

export type LocalAiRuntimeFacade = {
  list: () => Promise<LocalAiModelRecord[]>;
  listArtifacts: (payload?: LocalAiListArtifactsPayload) => Promise<LocalAiArtifactRecord[]>;
  searchCatalog: (payload?: LocalAiCatalogSearchPayload) => Promise<LocalAiCatalogItemDescriptor[]>;
  listRepoGgufVariants: (repo: string) => Promise<GgufVariantDescriptor[]>;
  resolveInstallPlan: (payload: LocalAiCatalogResolveInstallPlanPayload) => Promise<LocalAiInstallPlanDescriptor>;
  collectDeviceProfile: () => Promise<LocalAiDeviceProfile>;
  resolveDependencies: (payload: LocalAiDependenciesResolvePayload) => Promise<LocalAiDependencyResolutionPlan>;
  applyDependencies: (
    plan: LocalAiDependencyResolutionPlan,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiDependencyApplyResult>;
  listServices: () => Promise<LocalAiServiceDescriptor[]>;
  installService: (
    payload: LocalAiServicesInstallPayload,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiServiceDescriptor>;
  startService: (
    serviceId: string,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiServiceDescriptor>;
  stopService: (
    serviceId: string,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiServiceDescriptor>;
  healthServices: (serviceId?: string) => Promise<LocalAiServiceDescriptor[]>;
  removeService: (
    serviceId: string,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiServiceDescriptor>;
  listNodesCatalog: (payload?: LocalAiNodesCatalogListPayload) => Promise<LocalAiNodeDescriptor[]>;
  install: (
    payload: LocalAiInstallPayload,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiInstallAcceptedResponse>;
  listVerified: () => Promise<LocalAiVerifiedModelDescriptor[]>;
  listVerifiedArtifacts: (
    payload?: LocalAiListVerifiedArtifactsPayload,
  ) => Promise<LocalAiVerifiedArtifactDescriptor[]>;
  installVerified: (
    payload: LocalAiInstallVerifiedPayload,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiInstallAcceptedResponse>;
  installVerifiedArtifact: (
    payload: LocalAiInstallVerifiedArtifactPayload,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiArtifactRecord>;
  listDownloads: () => Promise<LocalAiDownloadSessionSummary[]>;
  pauseDownload: (
    installSessionId: string,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiDownloadSessionSummary>;
  resumeDownload: (
    installSessionId: string,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiDownloadSessionSummary>;
  cancelDownload: (
    installSessionId: string,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiDownloadSessionSummary>;
  import: (
    payload: LocalAiImportPayload,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiModelRecord>;
  importArtifact: (
    payload: LocalAiImportArtifactPayload,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiArtifactRecord>;
  pickModelFile: () => Promise<string | null>;
  importFile: (
    payload: LocalAiImportFilePayload,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiInstallAcceptedResponse>;
  remove: (
    localModelId: string,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiModelRecord>;
  removeArtifact: (
    localArtifactId: string,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiArtifactRecord>;
  start: (
    localModelId: string,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiModelRecord>;
  stop: (
    localModelId: string,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiModelRecord>;
  health: (localModelId?: string) => Promise<LocalAiModelHealth[]>;
  appendAudit: (payload: LocalAiRuntimeAuditPayload) => Promise<void>;
  appendInferenceAudit: (payload: LocalAiInferenceAuditPayload) => Promise<void>;
  listAudits: (query?: LocalAiAuditQuery) => Promise<LocalAiAuditEvent[]>;
  pickManifestPath: () => Promise<string | null>;
  pickArtifactManifestPath: () => Promise<string | null>;
  queryByCapability: (capability: LocalAiRuntimeCapability) => Promise<LocalAiModelRecord[]>;
  pollSnapshot: (localModelId?: string) => Promise<LocalAiRuntimeSnapshot>;
  subscribeDownloadProgress: (
    listener: (event: LocalAiDownloadProgressEvent) => void,
  ) => Promise<() => void>;
  revealInFolder: (localModelId: string) => Promise<void>;
  scanOrphans: () => Promise<OrphanModelFile[]>;
  scaffoldOrphan: (payload: LocalAiScaffoldOrphanPayload) => Promise<LocalAiInstallAcceptedResponse>;
  scanArtifactOrphans: () => Promise<OrphanArtifactFile[]>;
  scaffoldArtifactOrphan: (
    payload: LocalAiScaffoldArtifactPayload,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiScaffoldArtifactResult>;
};

export const localAiRuntime: LocalAiRuntimeFacade = {
  list: listLocalAiRuntimeModels,
  listArtifacts: listLocalAiRuntimeArtifacts,
  searchCatalog: searchLocalAiRuntimeCatalog,
  listRepoGgufVariants: listLocalAiRuntimeRepoGgufVariants,
  resolveInstallPlan: resolveLocalAiRuntimeInstallPlan,
  collectDeviceProfile: collectLocalAiRuntimeDeviceProfile,
  resolveDependencies: resolveLocalAiRuntimeDependencies,
  applyDependencies: applyLocalAiRuntimeDependencies,
  listServices: listLocalAiRuntimeServices,
  installService: installLocalAiRuntimeService,
  startService: startLocalAiRuntimeService,
  stopService: stopLocalAiRuntimeService,
  healthServices: healthLocalAiRuntimeServices,
  removeService: removeLocalAiRuntimeService,
  listNodesCatalog: listLocalAiRuntimeNodesCatalog,
  install: installLocalAiRuntimeModel,
  listVerified: listLocalAiRuntimeVerifiedModels,
  listVerifiedArtifacts: listLocalAiRuntimeVerifiedArtifacts,
  installVerified: installLocalAiRuntimeVerifiedModel,
  installVerifiedArtifact: installLocalAiRuntimeVerifiedArtifact,
  listDownloads: listLocalAiRuntimeDownloadSessions,
  pauseDownload: pauseLocalAiRuntimeDownload,
  resumeDownload: resumeLocalAiRuntimeDownload,
  cancelDownload: cancelLocalAiRuntimeDownload,
  import: importLocalAiRuntimeModel,
  importArtifact: importLocalAiRuntimeArtifact,
  pickModelFile: pickLocalAiRuntimeModelFile,
  importFile: importLocalAiRuntimeModelFile,
  remove: removeLocalAiRuntimeModel,
  removeArtifact: removeLocalAiRuntimeArtifact,
  start: startLocalAiRuntimeModel,
  stop: stopLocalAiRuntimeModel,
  health: healthLocalAiRuntimeModels,
  appendAudit: appendLocalAiRuntimeAudit,
  appendInferenceAudit: appendLocalAiRuntimeInferenceAudit,
  listAudits: listLocalAiRuntimeAudits,
  pickManifestPath: pickLocalAiRuntimeManifestPath,
  pickArtifactManifestPath: pickLocalAiRuntimeArtifactManifestPath,
  queryByCapability: queryLocalAiRuntimeModelsByCapability,
  pollSnapshot: fetchLocalAiRuntimeSnapshot,
  subscribeDownloadProgress: subscribeLocalAiRuntimeDownloadProgress,
  revealInFolder: revealLocalAiRuntimeModelInFolder,
  scanOrphans: scanLocalAiRuntimeOrphans,
  scaffoldOrphan: scaffoldLocalAiRuntimeOrphan,
  scanArtifactOrphans: scanLocalAiRuntimeArtifactOrphans,
  scaffoldArtifactOrphan: scaffoldLocalAiRuntimeArtifactOrphan,
};

export { startLocalAiRuntimePolling };
