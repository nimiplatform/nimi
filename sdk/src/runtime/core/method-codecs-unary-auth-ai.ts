import { RuntimeMethodIds } from '../method-ids';
import { Ack } from '../generated/runtime/v1/common';
import {
  OpenExternalPrincipalSessionRequest,
  OpenExternalPrincipalSessionResponse,
  OpenSessionRequest,
  OpenSessionResponse,
  RefreshSessionRequest,
  RefreshSessionResponse,
  RegisterAppRequest,
  RegisterAppResponse,
  RegisterExternalPrincipalRequest,
  RegisterExternalPrincipalResponse,
  RevokeExternalPrincipalSessionRequest,
  RevokeSessionRequest,
} from '../generated/runtime/v1/auth';
import {
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  IssueDelegatedAccessTokenRequest,
  IssueDelegatedAccessTokenResponse,
  ListTokenChainRequest,
  ListTokenChainResponse,
  RevokeAppAccessTokenRequest,
  ValidateAppAccessTokenRequest,
  ValidateAppAccessTokenResponse,
} from '../generated/runtime/v1/grant';
import {
  AppendRealtimeInputRequest,
  AppendRealtimeInputResponse,
  CancelScenarioJobRequest,
  CancelScenarioJobResponse,
  CloseRealtimeSessionRequest,
  CloseRealtimeSessionResponse,
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  GetScenarioArtifactsRequest,
  GetScenarioArtifactsResponse,
  GetScenarioJobRequest,
  GetScenarioJobResponse,
  ListScenarioProfilesRequest,
  ListScenarioProfilesResponse,
  OpenRealtimeSessionRequest,
  OpenRealtimeSessionResponse,
  SubmitScenarioJobRequest,
  SubmitScenarioJobResponse,
} from '../generated/runtime/v1/ai';
import {
  PeekSchedulingRequest,
  PeekSchedulingResponse,
} from '../generated/runtime/v1/ai_scheduling';
import {
  DeleteVoiceAssetRequest,
  DeleteVoiceAssetResponse,
  GetVoiceAssetRequest,
  GetVoiceAssetResponse,
  ListPresetVoicesRequest,
  ListPresetVoicesResponse,
  ListVoiceAssetsRequest,
  ListVoiceAssetsResponse,
} from '../generated/runtime/v1/voice';
import {
  CancelWorkflowRequest,
  GetWorkflowRequest,
  GetWorkflowResponse,
  SubmitWorkflowRequest,
  SubmitWorkflowResponse,
} from '../generated/runtime/v1/workflow';
import {
  CheckModelHealthRequest,
  CheckModelHealthResponse,
  ListModelsRequest,
  ListModelsResponse,
  PullModelRequest,
  PullModelResponse,
  RemoveModelRequest,
} from '../generated/runtime/v1/model';
import type { RuntimeUnaryMethodCodecMap } from './method-codecs-types';

export const runtimeUnaryMethodCodecsAuthAi: Partial<RuntimeUnaryMethodCodecMap> = {
  [RuntimeMethodIds.auth.registerApp]: {
    requestType: RegisterAppRequest,
    responseType: RegisterAppResponse,
  },
  [RuntimeMethodIds.auth.openSession]: {
    requestType: OpenSessionRequest,
    responseType: OpenSessionResponse,
  },
  [RuntimeMethodIds.auth.refreshSession]: {
    requestType: RefreshSessionRequest,
    responseType: RefreshSessionResponse,
  },
  [RuntimeMethodIds.auth.revokeSession]: {
    requestType: RevokeSessionRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.auth.registerExternalPrincipal]: {
    requestType: RegisterExternalPrincipalRequest,
    responseType: RegisterExternalPrincipalResponse,
  },
  [RuntimeMethodIds.auth.openExternalPrincipalSession]: {
    requestType: OpenExternalPrincipalSessionRequest,
    responseType: OpenExternalPrincipalSessionResponse,
  },
  [RuntimeMethodIds.auth.revokeExternalPrincipalSession]: {
    requestType: RevokeExternalPrincipalSessionRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.appAuth.authorizeExternalPrincipal]: {
    requestType: AuthorizeExternalPrincipalRequest,
    responseType: AuthorizeExternalPrincipalResponse,
  },
  [RuntimeMethodIds.appAuth.validateToken]: {
    requestType: ValidateAppAccessTokenRequest,
    responseType: ValidateAppAccessTokenResponse,
  },
  [RuntimeMethodIds.appAuth.revokeToken]: {
    requestType: RevokeAppAccessTokenRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.appAuth.issueDelegatedToken]: {
    requestType: IssueDelegatedAccessTokenRequest,
    responseType: IssueDelegatedAccessTokenResponse,
  },
  [RuntimeMethodIds.appAuth.listTokenChain]: {
    requestType: ListTokenChainRequest,
    responseType: ListTokenChainResponse,
  },
  [RuntimeMethodIds.ai.executeScenario]: {
    requestType: ExecuteScenarioRequest,
    responseType: ExecuteScenarioResponse,
  },
  [RuntimeMethodIds.ai.submitScenarioJob]: {
    requestType: SubmitScenarioJobRequest,
    responseType: SubmitScenarioJobResponse,
  },
  [RuntimeMethodIds.ai.getScenarioJob]: {
    requestType: GetScenarioJobRequest,
    responseType: GetScenarioJobResponse,
  },
  [RuntimeMethodIds.ai.cancelScenarioJob]: {
    requestType: CancelScenarioJobRequest,
    responseType: CancelScenarioJobResponse,
  },
  [RuntimeMethodIds.ai.getScenarioArtifacts]: {
    requestType: GetScenarioArtifactsRequest,
    responseType: GetScenarioArtifactsResponse,
  },
  [RuntimeMethodIds.ai.listScenarioProfiles]: {
    requestType: ListScenarioProfilesRequest,
    responseType: ListScenarioProfilesResponse,
  },
  [RuntimeMethodIds.ai.getVoiceAsset]: {
    requestType: GetVoiceAssetRequest,
    responseType: GetVoiceAssetResponse,
  },
  [RuntimeMethodIds.ai.listVoiceAssets]: {
    requestType: ListVoiceAssetsRequest,
    responseType: ListVoiceAssetsResponse,
  },
  [RuntimeMethodIds.ai.deleteVoiceAsset]: {
    requestType: DeleteVoiceAssetRequest,
    responseType: DeleteVoiceAssetResponse,
  },
  [RuntimeMethodIds.ai.listPresetVoices]: {
    requestType: ListPresetVoicesRequest,
    responseType: ListPresetVoicesResponse,
  },
  [RuntimeMethodIds.ai.peekScheduling]: {
    requestType: PeekSchedulingRequest,
    responseType: PeekSchedulingResponse,
  },
  [RuntimeMethodIds.aiRealtime.openRealtimeSession]: {
    requestType: OpenRealtimeSessionRequest,
    responseType: OpenRealtimeSessionResponse,
  },
  [RuntimeMethodIds.aiRealtime.appendRealtimeInput]: {
    requestType: AppendRealtimeInputRequest,
    responseType: AppendRealtimeInputResponse,
  },
  [RuntimeMethodIds.aiRealtime.closeRealtimeSession]: {
    requestType: CloseRealtimeSessionRequest,
    responseType: CloseRealtimeSessionResponse,
  },
  [RuntimeMethodIds.workflow.submit]: {
    requestType: SubmitWorkflowRequest,
    responseType: SubmitWorkflowResponse,
  },
  [RuntimeMethodIds.workflow.get]: {
    requestType: GetWorkflowRequest,
    responseType: GetWorkflowResponse,
  },
  [RuntimeMethodIds.workflow.cancel]: {
    requestType: CancelWorkflowRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.model.list]: {
    requestType: ListModelsRequest,
    responseType: ListModelsResponse,
  },
  [RuntimeMethodIds.model.pull]: {
    requestType: PullModelRequest,
    responseType: PullModelResponse,
  },
  [RuntimeMethodIds.model.remove]: {
    requestType: RemoveModelRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.model.checkHealth]: {
    requestType: CheckModelHealthRequest,
    responseType: CheckModelHealthResponse,
  },
} satisfies Partial<RuntimeUnaryMethodCodecMap>;
