import {
  appendLocalAiRuntimeInferenceAudit,
  appendLocalAiRuntimeAudit,
  subscribeLocalAiRuntimeDownloadProgress,
  fetchLocalAiRuntimeSnapshot,
  healthLocalAiRuntimeModels,
  installLocalAiRuntimeVerifiedModel,
  importLocalAiRuntimeModel,
  installLocalAiRuntimeModel,
  searchLocalAiRuntimeCatalog,
  resolveLocalAiRuntimeInstallPlan,
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
  removeLocalAiRuntimeModel,
  startLocalAiRuntimeModel,
  stopLocalAiRuntimeModel,
} from './commands';
import type {
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
  LocalAiDownloadProgressEvent,
  LocalAiInstallPlanDescriptor,
  LocalAiImportPayload,
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
  LocalAiDownloadProgressEvent,
  LocalAiInstallPlanDescriptor,
  LocalAiImportPayload,
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
  ) => Promise<LocalAiModelRecord>;
  listVerified: () => Promise<LocalAiVerifiedModelDescriptor[]>;
  installVerified: (
    payload: LocalAiInstallVerifiedPayload,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiModelRecord>;
  import: (
    payload: LocalAiImportPayload,
    options?: LocalAiRuntimeWriteOptions,
  ) => Promise<LocalAiModelRecord>;
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
};

export const localAiRuntime: LocalAiRuntimeFacade = {
  list: listLocalAiRuntimeModels,
  searchCatalog: searchLocalAiRuntimeCatalog,
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
  import: importLocalAiRuntimeModel,
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
};

export { startLocalAiRuntimePolling };
