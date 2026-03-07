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
  listLocalAiRuntimeVerifiedModels,
  listLocalAiRuntimeAudits,
  listLocalAiRuntimeModels,
  pickLocalAiRuntimeManifestPath,
  pickLocalAiRuntimeModelFile,
  removeLocalAiRuntimeModel,
  startLocalAiRuntimeModel,
  stopLocalAiRuntimeModel,
} from './commands';
import type {
  GgufVariantDescriptor,
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
  LocalAiInstallAcceptedResponse,
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
  LocalAiVerifiedModelDescriptor,
  LocalAiInferenceAuditPayload,
} from './types';
import {
  queryLocalAiRuntimeModelsByCapability,
  type LocalAiRuntimeCapability,
} from './capability-query';
import { startLocalAiRuntimePolling, type LocalAiRuntimePollingOptions } from './polling';

export type {
  GgufVariantDescriptor,
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
  LocalAiInstallAcceptedResponse,
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
  LocalAiVerifiedModelDescriptor,
};

export type LocalAiRuntimeFacade = {
  list: () => Promise<LocalAiModelRecord[]>;
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
  installVerified: (
    payload: LocalAiInstallVerifiedPayload,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiInstallAcceptedResponse>;
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
  pickModelFile: () => Promise<string | null>;
  importFile: (
    payload: LocalAiImportFilePayload,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiInstallAcceptedResponse>;
  remove: (
    localModelId: string,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiModelRecord>;
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
  queryByCapability: (capability: LocalAiRuntimeCapability) => Promise<LocalAiModelRecord[]>;
  pollSnapshot: (localModelId?: string) => Promise<LocalAiRuntimeSnapshot>;
  subscribeDownloadProgress: (
    listener: (event: LocalAiDownloadProgressEvent) => void,
  ) => Promise<() => void>;
  revealInFolder: (localModelId: string) => Promise<void>;
};

export const localAiRuntime: LocalAiRuntimeFacade = {
  list: listLocalAiRuntimeModels,
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
  installVerified: installLocalAiRuntimeVerifiedModel,
  listDownloads: listLocalAiRuntimeDownloadSessions,
  pauseDownload: pauseLocalAiRuntimeDownload,
  resumeDownload: resumeLocalAiRuntimeDownload,
  cancelDownload: cancelLocalAiRuntimeDownload,
  import: importLocalAiRuntimeModel,
  pickModelFile: pickLocalAiRuntimeModelFile,
  importFile: importLocalAiRuntimeModelFile,
  remove: removeLocalAiRuntimeModel,
  start: startLocalAiRuntimeModel,
  stop: stopLocalAiRuntimeModel,
  health: healthLocalAiRuntimeModels,
  appendAudit: appendLocalAiRuntimeAudit,
  appendInferenceAudit: appendLocalAiRuntimeInferenceAudit,
  listAudits: listLocalAiRuntimeAudits,
  pickManifestPath: pickLocalAiRuntimeManifestPath,
  queryByCapability: queryLocalAiRuntimeModelsByCapability,
  pollSnapshot: fetchLocalAiRuntimeSnapshot,
  subscribeDownloadProgress: subscribeLocalAiRuntimeDownloadProgress,
  revealInFolder: revealLocalAiRuntimeModelInFolder,
};

export { startLocalAiRuntimePolling };
