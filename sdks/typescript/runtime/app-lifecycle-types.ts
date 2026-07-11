import type {
  AdoptLocalAppRequest,
  AdoptLocalAppResponse,
  AppInstallJobEvent,
  GetAppInstallJobRequest,
  GetAppInstallJobResponse,
  GetAccountAppInventoryRequest,
  GetAccountAppInventoryResponse,
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
  ListLocalAppAdoptionsRequest,
  ListLocalAppAdoptionsResponse,
  OpenAppRequest,
  OpenAppResponse,
  RemoveLocalAppAdoptionRequest,
  RemoveLocalAppAdoptionResponse,
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

export type NimiRuntimeAccountAppInventoryState =
  | 'verified'
  | 'entitled'
  | 'disabled'
  | 'removed'
  | 'revoked';

export type NimiRuntimeAccountAppInstallState =
  | 'not-installed'
  | 'installed'
  | 'adopted-local'
  | 'removed';

export type NimiRuntimeLocalAppAdoptionState =
  | 'adopted'
  | 'repair-required'
  | 'removed';

export type NimiRuntimeLocalAppAdoptionTrust =
  | 'explicit-local'
  | 'developer-local';

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

export type NimiRuntimeAccountAppInventoryRow = {
  readonly appId: string;
  readonly accountState: NimiRuntimeAccountAppInventoryState;
  readonly installState: NimiRuntimeAccountAppInstallState;
  readonly lastOpenedAt?: string;
  readonly dataPolicy: string;
  readonly verifiedAt?: string;
  readonly source?: string;
  readonly detail?: string;
};

export type NimiRuntimeAccountAppInventoryRecord = {
  readonly schemaVersion: 2;
  readonly accountId: string;
  readonly updatedAt: string;
  readonly apps: readonly NimiRuntimeAccountAppInventoryRow[];
};

export type NimiRuntimeAccountAppInventoryProjection = {
  readonly exists: boolean;
  readonly record?: NimiRuntimeAccountAppInventoryRecord;
  readonly reasonCode?: string;
  readonly detail?: string;
};

export type NimiRuntimeLocalAppAdoption = {
  readonly appId: string;
  readonly rootPath: string;
  readonly manifestPath: string;
  readonly displayName: string;
  readonly version: string;
  readonly entryRef: string;
  readonly permissionScopeRef: string;
  readonly storagePolicyRef: string;
  readonly state: NimiRuntimeLocalAppAdoptionState;
  readonly trust: NimiRuntimeLocalAppAdoptionTrust;
  readonly adoptedAt?: string;
  readonly updatedAt?: string;
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

export type NimiRuntimeAppOpenState = 'launched' | 'blocked' | 'launch_prepared';

export type NimiRuntimeAppOpenProjection = {
  readonly appId: string;
  readonly state: NimiRuntimeAppOpenState;
  readonly reachedStep: NimiRuntimeAppOpenFlowStep;
  readonly launched: boolean;
  readonly activeVersion?: string;
  readonly scope?: NimiRuntimeAppOpenScopeRef;
  readonly reasonCode?: string;
  readonly detail?: string;
  readonly releaseDescriptorRef?: string;
  readonly descriptorClass?: string;
  readonly admissionTrack?: string;
  readonly sourceKind?: string;
  readonly ordinaryVisibility?: string;
  readonly digestVerificationState?: string;
  readonly runtimeEntryRef?: string;
  readonly activeReleaseRoot?: string;
  readonly storage?: NimiRuntimeAppInstallStorage;
  readonly shellCapabilitySetRef?: string;
  readonly callerMode?: string;
  /** Non-authorizing Runtime launch correlation id. */
  readonly launchId?: Uint8Array;
  readonly productReadinessClaimAllowed?: boolean;
};

export type NimiRuntimeAppLifecycleIntentBinding = {
  readonly lifecycleIntentId: string;
  readonly displayedImpactDigest: string;
};

export type NimiRuntimeAppInstallInput = NimiRuntimeAppLifecycleIntentBinding & {
  readonly appId: string;
  readonly confirmed: boolean;
};

export type NimiRuntimeAppUninstallInput = NimiRuntimeAppLifecycleIntentBinding & {
  readonly appId: string;
  readonly deleteDurableData?: boolean;
  readonly destructiveDataDeleteConfirmed?: boolean;
};

export type NimiRuntimeAppUpdateInput = NimiRuntimeAppLifecycleIntentBinding & {
  readonly appId: string;
  readonly confirmed: boolean;
};

export type NimiRuntimeAppHealthRepairInput = NimiRuntimeAppLifecycleIntentBinding & {
  readonly appId: string;
  readonly action: NimiRuntimeAppHealthRepairAction;
  readonly jobId?: string;
};

export type NimiRuntimeAppOpenInput = NimiRuntimeAppLifecycleIntentBinding & {
  readonly appId: string;
  readonly scope: NimiRuntimeAppOpenScopeRef;
};

export type NimiRuntimeAdoptLocalAppInput = NimiRuntimeAppLifecycleIntentBinding & {
  readonly rootPath: string;
  readonly expectedAppId?: string;
};

export type NimiRuntimeRemoveLocalAppAdoptionInput = NimiRuntimeAppLifecycleIntentBinding & {
  readonly appId: string;
  readonly deleteDurableDataConfirmed?: boolean;
};

export interface NimiRuntimeAppLifecycleGeneratedClient {
  getAccountAppInventory(
    request: GetAccountAppInventoryRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetAccountAppInventoryResponse>;
  adoptLocalApp(request: AdoptLocalAppRequest, options?: RuntimeTypedCallOptions): Promise<AdoptLocalAppResponse>;
  listLocalAppAdoptions(
    request: ListLocalAppAdoptionsRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ListLocalAppAdoptionsResponse>;
  removeLocalAppAdoption(
    request: RemoveLocalAppAdoptionRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<RemoveLocalAppAdoptionResponse>;
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
  accountInventory(options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAccountAppInventoryProjection>;
  adoptLocal(
    input: NimiRuntimeAdoptLocalAppInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiRuntimeLocalAppAdoption>;
  listLocalAdoptions(options?: RuntimeTypedCallOptions): Promise<NimiRuntimeLocalAppAdoption[]>;
  removeLocalAdoption(
    input: NimiRuntimeRemoveLocalAppAdoptionInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiRuntimeLocalAppAdoption>;
  install(input: NimiRuntimeAppInstallInput, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppInstallJob>;
  uninstall(input: NimiRuntimeAppUninstallInput, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppUninstallResult>;
  storage(input: { readonly appId: string }, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppStorageProjection>;
  packageReadiness(
    input: { readonly appId: string },
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiRuntimeAppPackageReadinessProjection>;
  getJob(input: { readonly jobId: string }, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppInstallJob>;
  listJobs(input: { readonly appId: string }, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppInstallJob[]>;
  watchJobEvents(
    input: { readonly jobId: string },
    options?: RuntimeTypedCallOptions,
  ): AsyncIterable<NimiRuntimeAppInstallJobEvent>;
  update(input: NimiRuntimeAppUpdateInput, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppInstallJob>;
  healthRepair(
    input: NimiRuntimeAppHealthRepairInput,
    options?: RuntimeTypedCallOptions,
  ): Promise<NimiRuntimeAppInstallJob>;
  open(input: NimiRuntimeAppOpenInput, options?: RuntimeTypedCallOptions): Promise<NimiRuntimeAppOpenProjection>;
}
