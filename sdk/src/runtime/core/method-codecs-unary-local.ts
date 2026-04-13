import { RuntimeMethodIds } from '../method-ids';
import { Ack } from '../generated/runtime/v1/common';
import {
  ApplyProfileRequest,
  ApplyProfileResponse,
  AppendInferenceAuditRequest,
  AppendRuntimeAuditRequest,
  CancelLocalTransferRequest,
  CancelLocalTransferResponse,
  CheckLocalAssetHealthRequest,
  CheckLocalAssetHealthResponse,
  CheckLocalServiceHealthRequest,
  CheckLocalServiceHealthResponse,
  CollectDeviceProfileRequest,
  CollectDeviceProfileResponse,
  ImportLocalAssetRequest,
  ImportLocalAssetResponse,
  ImportLocalAssetFileRequest,
  ImportLocalAssetFileResponse,
  InstallLocalServiceRequest,
  InstallLocalServiceResponse,
  InstallVerifiedAssetRequest,
  InstallVerifiedAssetResponse,
  ListLocalAssetsRequest,
  ListLocalAssetsResponse,
  ListLocalAuditsRequest,
  ListLocalAuditsResponse,
  ListLocalServicesRequest,
  ListLocalServicesResponse,
  ListLocalTransfersRequest,
  ListLocalTransfersResponse,
  ListNodeCatalogRequest,
  ListNodeCatalogResponse,
  ListVerifiedAssetsRequest,
  ListVerifiedAssetsResponse,
  PauseLocalTransferRequest,
  PauseLocalTransferResponse,
  RemoveLocalAssetRequest,
  RemoveLocalAssetResponse,
  RemoveLocalServiceRequest,
  RemoveLocalServiceResponse,
  ResolveModelInstallPlanRequest,
  ResolveModelInstallPlanResponse,
  ResolveProfileRequest,
  ResolveProfileResponse,
  ResumeLocalTransferRequest,
  ResumeLocalTransferResponse,
  ScanUnregisteredAssetsRequest,
  ScanUnregisteredAssetsResponse,
  ScaffoldOrphanAssetRequest,
  ScaffoldOrphanAssetResponse,
  SearchCatalogModelsRequest,
  SearchCatalogModelsResponse,
  StartLocalAssetRequest,
  StartLocalAssetResponse,
  StartLocalServiceRequest,
  StartLocalServiceResponse,
  StopLocalAssetRequest,
  StopLocalAssetResponse,
  StopLocalServiceRequest,
  StopLocalServiceResponse,
  WarmLocalAssetRequest,
  WarmLocalAssetResponse,
} from '../generated/runtime/v1/local_runtime';
import {
  EnsureEngineRequest,
  EnsureEngineResponse,
  GetEngineStatusRequest,
  GetEngineStatusResponse,
  ListEnginesRequest,
  ListEnginesResponse,
  StartEngineRequest,
  StartEngineResponse,
  StopEngineRequest,
  StopEngineResponse,
} from '../generated/runtime/v1/local_runtime_engine';
import type { RuntimeUnaryMethodCodecMap } from './method-codecs-types';

export const runtimeUnaryMethodCodecsLocal = {
  [RuntimeMethodIds.local.listLocalAssets]: {
    requestType: ListLocalAssetsRequest,
    responseType: ListLocalAssetsResponse,
  },
  [RuntimeMethodIds.local.listVerifiedAssets]: {
    requestType: ListVerifiedAssetsRequest,
    responseType: ListVerifiedAssetsResponse,
  },
  [RuntimeMethodIds.local.searchCatalogModels]: {
    requestType: SearchCatalogModelsRequest,
    responseType: SearchCatalogModelsResponse,
  },
  [RuntimeMethodIds.local.resolveModelInstallPlan]: {
    requestType: ResolveModelInstallPlanRequest,
    responseType: ResolveModelInstallPlanResponse,
  },
  [RuntimeMethodIds.local.installVerifiedAsset]: {
    requestType: InstallVerifiedAssetRequest,
    responseType: InstallVerifiedAssetResponse,
  },
  [RuntimeMethodIds.local.importLocalAsset]: {
    requestType: ImportLocalAssetRequest,
    responseType: ImportLocalAssetResponse,
  },
  [RuntimeMethodIds.local.importLocalAssetFile]: {
    requestType: ImportLocalAssetFileRequest,
    responseType: ImportLocalAssetFileResponse,
  },
  [RuntimeMethodIds.local.scanUnregisteredAssets]: {
    requestType: ScanUnregisteredAssetsRequest,
    responseType: ScanUnregisteredAssetsResponse,
  },
  [RuntimeMethodIds.local.scaffoldOrphanAsset]: {
    requestType: ScaffoldOrphanAssetRequest,
    responseType: ScaffoldOrphanAssetResponse,
  },
  [RuntimeMethodIds.local.removeLocalAsset]: {
    requestType: RemoveLocalAssetRequest,
    responseType: RemoveLocalAssetResponse,
  },
  [RuntimeMethodIds.local.startLocalAsset]: {
    requestType: StartLocalAssetRequest,
    responseType: StartLocalAssetResponse,
  },
  [RuntimeMethodIds.local.stopLocalAsset]: {
    requestType: StopLocalAssetRequest,
    responseType: StopLocalAssetResponse,
  },
  [RuntimeMethodIds.local.checkLocalAssetHealth]: {
    requestType: CheckLocalAssetHealthRequest,
    responseType: CheckLocalAssetHealthResponse,
  },
  [RuntimeMethodIds.local.warmLocalAsset]: {
    requestType: WarmLocalAssetRequest,
    responseType: WarmLocalAssetResponse,
  },
  [RuntimeMethodIds.local.collectDeviceProfile]: {
    requestType: CollectDeviceProfileRequest,
    responseType: CollectDeviceProfileResponse,
  },
  [RuntimeMethodIds.local.resolveProfile]: {
    requestType: ResolveProfileRequest,
    responseType: ResolveProfileResponse,
  },
  [RuntimeMethodIds.local.applyProfile]: {
    requestType: ApplyProfileRequest,
    responseType: ApplyProfileResponse,
  },
  [RuntimeMethodIds.local.listLocalServices]: {
    requestType: ListLocalServicesRequest,
    responseType: ListLocalServicesResponse,
  },
  [RuntimeMethodIds.local.installLocalService]: {
    requestType: InstallLocalServiceRequest,
    responseType: InstallLocalServiceResponse,
  },
  [RuntimeMethodIds.local.startLocalService]: {
    requestType: StartLocalServiceRequest,
    responseType: StartLocalServiceResponse,
  },
  [RuntimeMethodIds.local.stopLocalService]: {
    requestType: StopLocalServiceRequest,
    responseType: StopLocalServiceResponse,
  },
  [RuntimeMethodIds.local.checkLocalServiceHealth]: {
    requestType: CheckLocalServiceHealthRequest,
    responseType: CheckLocalServiceHealthResponse,
  },
  [RuntimeMethodIds.local.removeLocalService]: {
    requestType: RemoveLocalServiceRequest,
    responseType: RemoveLocalServiceResponse,
  },
  [RuntimeMethodIds.local.listNodeCatalog]: {
    requestType: ListNodeCatalogRequest,
    responseType: ListNodeCatalogResponse,
  },
  [RuntimeMethodIds.local.listLocalAudits]: {
    requestType: ListLocalAuditsRequest,
    responseType: ListLocalAuditsResponse,
  },
  [RuntimeMethodIds.local.appendInferenceAudit]: {
    requestType: AppendInferenceAuditRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.local.appendRuntimeAudit]: {
    requestType: AppendRuntimeAuditRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.local.listEngines]: {
    requestType: ListEnginesRequest,
    responseType: ListEnginesResponse,
  },
  [RuntimeMethodIds.local.ensureEngine]: {
    requestType: EnsureEngineRequest,
    responseType: EnsureEngineResponse,
  },
  [RuntimeMethodIds.local.startEngine]: {
    requestType: StartEngineRequest,
    responseType: StartEngineResponse,
  },
  [RuntimeMethodIds.local.stopEngine]: {
    requestType: StopEngineRequest,
    responseType: StopEngineResponse,
  },
  [RuntimeMethodIds.local.getEngineStatus]: {
    requestType: GetEngineStatusRequest,
    responseType: GetEngineStatusResponse,
  },
  [RuntimeMethodIds.local.listLocalTransfers]: {
    requestType: ListLocalTransfersRequest,
    responseType: ListLocalTransfersResponse,
  },
  [RuntimeMethodIds.local.pauseLocalTransfer]: {
    requestType: PauseLocalTransferRequest,
    responseType: PauseLocalTransferResponse,
  },
  [RuntimeMethodIds.local.resumeLocalTransfer]: {
    requestType: ResumeLocalTransferRequest,
    responseType: ResumeLocalTransferResponse,
  },
  [RuntimeMethodIds.local.cancelLocalTransfer]: {
    requestType: CancelLocalTransferRequest,
    responseType: CancelLocalTransferResponse,
  },
} satisfies Partial<RuntimeUnaryMethodCodecMap>;
