import type {
  AppInstallJobEvent,
  GetAppInstallJobRequest,
  GetAppInstallJobResponse,
  GetAppPackageReadinessRequest,
  GetAppPackageReadinessResponse,
  GetAppStorageRequest,
  GetAppStorageResponse,
  HealthRepairAppRequest,
  HealthRepairAppResponse,
  InstallAppRequest,
  InstallAppResponse,
  ListAppInstallJobsRequest,
  ListAppInstallJobsResponse,
  OpenAppRequest,
  OpenAppResponse,
  RuntimeTypedCallOptions,
  UninstallAppRequest,
  UninstallAppResponse,
  UpdateAppRequest,
  UpdateAppResponse,
  WatchAppInstallJobEventsRequest,
} from '../core-generated/runtime-typed-client';
import type {
  NimiRuntimeAppStorageProjection,
  NimiRuntimeAppStorageState,
} from './app-storage';

export type NimiRuntimeAppInstallJobPhase =
  | 'queued'
  | 'resolve_descriptor'
  | 'download'
  | 'verify'
  | 'materialize'
  | 'unpack'
  | 'evidence'
  | 'installed'
  | 'swap'
  | 'failed'
  | 'cancelled'
  | 'uninstalled';

export type NimiRuntimeAppInstallJobState =
  | 'queued'
  | 'in_progress'
  | 'installed'
  | 'failed'
  | 'cancelled'
  | 'uninstalled';

export type NimiRuntimeAppLifecycleJobKind =
  | 'install'
  | 'update'
  | 'repair'
  | 'uninstall';

export type NimiRuntimeAppInstallSourceKind = 'bundled' | 'external_artifact';

export type NimiRuntimeAppHealthRepairAction =
  | 'cancel'
  | 'retry'
  | 'repair'
  | 'reinstall';

export type NimiRuntimeAppInstallStorage = {
  readonly appRoot: string;
  readonly releaseRoot: string;
  readonly durableDataRoot: string;
  readonly cacheRoot: string;
  readonly tempRoot: string;
};

export type NimiRuntimeAppPackageReadinessState =
  | 'ready'
  | 'install_required'
  | 'update_required'
  | 'repair_required'
  | 'blocked';

export type NimiRuntimeAppPackageReadinessProjection = {
  readonly appId: string;
  readonly releaseDescriptorRef: string;
  readonly storagePolicyRef: string;
  readonly expectedVersion: string;
  readonly activeVersion?: string;
  readonly installedVersion?: string;
  readonly sha256?: string;
  readonly verificationState?: string;
  readonly state: NimiRuntimeAppPackageReadinessState;
  readonly reasonCode?: string;
  readonly detail?: string;
};

export type NimiRuntimeAppInstallJob = {
  readonly jobId: string;
  readonly appId: string;
  readonly kind: NimiRuntimeAppLifecycleJobKind;
  readonly releaseDescriptorRef: string;
  readonly installedVersion: string;
  readonly previousVersion?: string;
  readonly state: NimiRuntimeAppInstallJobState;
  readonly phase: NimiRuntimeAppInstallJobPhase;
  readonly sourceKind: NimiRuntimeAppInstallSourceKind;
  readonly sha256?: string;
  readonly artifactBytes: number;
  readonly storage: NimiRuntimeAppInstallStorage;
  readonly reasonCode?: string;
  readonly failureDetail?: string;
  readonly retryable: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type NimiRuntimeAppInstallJobEvent = {
  readonly sequence: number;
  readonly job: NimiRuntimeAppInstallJob;
  readonly timestamp?: string;
};

export type NimiRuntimeAppUninstallResult = {
  readonly appId: string;
  readonly releaseRemoved: boolean;
  readonly durableDataRemoved: boolean;
  readonly storage: NimiRuntimeAppInstallStorage;
  readonly reasonCode?: string;
  readonly job: NimiRuntimeAppInstallJob;
};

export type NimiRuntimeAppOpenScopeRef = {
  readonly kind: 'app';
  readonly ownerId: string;
  readonly surfaceId?: string;
};

export type NimiRuntimeAppOpenFlowStep =
  | 'resolve_registry'
  | 'verify_package'
  | 'verify_library'
  | 'verify_app_data'
  | 'verify_permissions'
  | 'ensure_aiconfig'
  | 'validate_manifest'
  | 'launch';

export type NimiRuntimeAppOpenState = 'launched' | 'blocked';

export type NimiRuntimeAppOpenProjection = {
  readonly appId: string;
  readonly state: NimiRuntimeAppOpenState;
  readonly reachedStep: NimiRuntimeAppOpenFlowStep;
  readonly launched: boolean;
  readonly activeVersion?: string;
  readonly scope?: NimiRuntimeAppOpenScopeRef;
  readonly reasonCode?: string;
  readonly detail?: string;
};

export type NimiRuntimeAppInstallInput = {
  readonly appId: string;
  readonly confirmed: boolean;
};

export type NimiRuntimeAppUninstallInput = {
  readonly appId: string;
  readonly deleteDurableData?: boolean;
  readonly destructiveDataDeleteConfirmed?: boolean;
};

export type NimiRuntimeAppUpdateInput = {
  readonly appId: string;
  readonly confirmed: boolean;
};

export type NimiRuntimeAppHealthRepairInput = {
  readonly appId: string;
  readonly action: NimiRuntimeAppHealthRepairAction;
  readonly jobId?: string;
};

export type NimiRuntimeAppOpenInput = {
  readonly appId: string;
  readonly scope: NimiRuntimeAppOpenScopeRef;
};

export interface NimiRuntimeAppLifecycleGeneratedClient {
  installApp(request: InstallAppRequest, options?: RuntimeTypedCallOptions): Promise<InstallAppResponse>;
  uninstallApp(request: UninstallAppRequest, options?: RuntimeTypedCallOptions): Promise<UninstallAppResponse>;
  getAppStorage(request: GetAppStorageRequest, options?: RuntimeTypedCallOptions): Promise<GetAppStorageResponse>;
  getAppPackageReadiness(
    request: GetAppPackageReadinessRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetAppPackageReadinessResponse>;
  getAppInstallJob(request: GetAppInstallJobRequest, options?: RuntimeTypedCallOptions): Promise<GetAppInstallJobResponse>;
  listAppInstallJobs(
    request: ListAppInstallJobsRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ListAppInstallJobsResponse>;
  watchAppInstallJobEvents(
    request: WatchAppInstallJobEventsRequest,
    options?: RuntimeTypedCallOptions,
  ): AsyncIterable<AppInstallJobEvent>;
  updateApp(request: UpdateAppRequest, options?: RuntimeTypedCallOptions): Promise<UpdateAppResponse>;
  healthRepairApp(request: HealthRepairAppRequest, options?: RuntimeTypedCallOptions): Promise<HealthRepairAppResponse>;
  openApp(request: OpenAppRequest, options?: RuntimeTypedCallOptions): Promise<OpenAppResponse>;
}

export interface NimiRuntimeAppLifecycleClient {
  install(input: NimiRuntimeAppInstallInput, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppInstallJob>;
  uninstall(input: NimiRuntimeAppUninstallInput, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppUninstallResult>;
  storage(input: { readonly appId: string }, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppStorageProjection>;
  packageReadiness(
    input: { readonly appId: string },
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiRuntimeAppPackageReadinessProjection>;
  getJob(input: { readonly jobId: string }, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppInstallJob>;
  listJobs(input?: { readonly appId?: string }, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppInstallJob[]>;
  watchJobEvents(
    input?: { readonly jobId?: string },
    options?: RuntimeTypedCallOptions,
  ): AsyncIterable<NimiRuntimeAppInstallJobEvent>;
  update(input: NimiRuntimeAppUpdateInput, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppInstallJob>;
  healthRepair(
    input: NimiRuntimeAppHealthRepairInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiRuntimeAppInstallJob>;
  open(input: NimiRuntimeAppOpenInput, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppOpenProjection>;
}
