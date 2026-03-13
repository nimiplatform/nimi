import type {
  ScopeCatalogDescriptor,
  ScopeCatalogEntry,
  ScopeCatalogPublishResult,
  ScopeCatalogRevokeResult,
  ScopeManifest,
} from '../types/index.js';
import type { Realm } from '../realm/client.js';
import type { Runtime } from './runtime.js';
import type {
  EmbeddingGenerateInput,
  EmbeddingGenerateOutput,
  TextGenerateInput,
  TextGenerateOutput,
  TextStreamInput,
  TextStreamOutput,
} from './types-media.js';
import type {
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
  ReadRealtimeEventsRequest,
  RealtimeEvent,
  ScenarioJobEvent,
  StreamScenarioEvent,
  StreamScenarioRequest,
  SubmitScenarioJobRequest,
  SubmitScenarioJobResponse,
  SubscribeScenarioJobEventsRequest,
  UploadArtifactResponse,
} from './generated/runtime/v1/ai';
import type {
  DeleteVoiceAssetRequest,
  DeleteVoiceAssetResponse,
  GetVoiceAssetRequest,
  GetVoiceAssetResponse,
  ListPresetVoicesRequest,
  ListPresetVoicesResponse,
  ListVoiceAssetsRequest,
  ListVoiceAssetsResponse,
} from './generated/runtime/v1/voice';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from './types.js';

export type RuntimeRealmBridgeContext = {
  appId: string;
  runtime: Runtime;
  realm: Realm;
};

export type RuntimeRealmBridgeHelpers = {
  fetchRealmGrant(input: {
    appId?: string;
    subjectUserId: string;
    scopes: string[];
    path?: string;
  }): Promise<{
    token: string;
    version: string;
    expiresAt?: string;
  }>;
  buildRuntimeAuthMetadata(input: {
    grantToken: string;
    grantVersion: string;
  }): Record<string, string>;
};

export type RuntimeScopeModule = {
  register(input: ScopeManifest): Promise<ScopeCatalogEntry>;
  publish(): Promise<ScopeCatalogPublishResult>;
  revoke(input: { scopes: string[] }): Promise<ScopeCatalogRevokeResult>;
  list(input?: { include?: Array<'realm' | 'runtime' | 'app'> }): Promise<ScopeCatalogDescriptor>;
};

export type RuntimeAiExecuteScenarioRequestInput =
  Omit<ExecuteScenarioRequest, 'head'>
  & {
    head: Omit<NonNullable<ExecuteScenarioRequest['head']>, 'subjectUserId'> & { subjectUserId?: string };
  };

export type RuntimeAiStreamScenarioRequestInput =
  Omit<StreamScenarioRequest, 'head'>
  & {
    head: Omit<NonNullable<StreamScenarioRequest['head']>, 'subjectUserId'> & { subjectUserId?: string };
  };

export type RuntimeAiSubmitScenarioJobRequestInput =
  Omit<SubmitScenarioJobRequest, 'head'>
  & {
    head: Omit<NonNullable<SubmitScenarioJobRequest['head']>, 'subjectUserId'> & { subjectUserId?: string };
  };

export type RuntimeAiOpenRealtimeSessionRequestInput =
  Omit<OpenRealtimeSessionRequest, 'head'>
  & {
    head: Omit<NonNullable<OpenRealtimeSessionRequest['head']>, 'subjectUserId'> & { subjectUserId?: string };
  };

export type RuntimeAiUploadArtifactInput = {
  subjectUserId?: string;
  mimeType: string;
  bytes: Uint8Array;
  displayName?: string;
  chunkSize?: number;
};

export type RuntimeAiModule = {
  executeScenario(
    request: RuntimeAiExecuteScenarioRequestInput,
    options?: RuntimeCallOptions,
  ): Promise<ExecuteScenarioResponse>;
  streamScenario(
    request: RuntimeAiStreamScenarioRequestInput,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<StreamScenarioEvent>>;
  submitScenarioJob(
    request: RuntimeAiSubmitScenarioJobRequestInput,
    options?: RuntimeCallOptions,
  ): Promise<SubmitScenarioJobResponse>;
  getScenarioJob(
    request: GetScenarioJobRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetScenarioJobResponse>;
  cancelScenarioJob(
    request: CancelScenarioJobRequest,
    options?: RuntimeCallOptions,
  ): Promise<CancelScenarioJobResponse>;
  subscribeScenarioJobEvents(
    request: SubscribeScenarioJobEventsRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<ScenarioJobEvent>>;
  getScenarioArtifacts(
    request: GetScenarioArtifactsRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetScenarioArtifactsResponse>;
  listScenarioProfiles(
    request: ListScenarioProfilesRequest,
    options?: RuntimeCallOptions,
  ): Promise<ListScenarioProfilesResponse>;
  getVoiceAsset(request: GetVoiceAssetRequest, options?: RuntimeCallOptions): Promise<GetVoiceAssetResponse>;
  listVoiceAssets(request: ListVoiceAssetsRequest, options?: RuntimeCallOptions): Promise<ListVoiceAssetsResponse>;
  deleteVoiceAsset(request: DeleteVoiceAssetRequest, options?: RuntimeCallOptions): Promise<DeleteVoiceAssetResponse>;
  listPresetVoices(request: ListPresetVoicesRequest, options?: RuntimeCallOptions): Promise<ListPresetVoicesResponse>;
  uploadArtifact(input: RuntimeAiUploadArtifactInput, options?: RuntimeCallOptions): Promise<UploadArtifactResponse>;
  openRealtimeSession(
    request: RuntimeAiOpenRealtimeSessionRequestInput,
    options?: RuntimeCallOptions,
  ): Promise<OpenRealtimeSessionResponse>;
  appendRealtimeInput(
    request: AppendRealtimeInputRequest,
    options?: RuntimeCallOptions,
  ): Promise<AppendRealtimeInputResponse>;
  readRealtimeEvents(
    request: ReadRealtimeEventsRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<RealtimeEvent>>;
  closeRealtimeSession(
    request: CloseRealtimeSessionRequest,
    options?: RuntimeCallOptions,
  ): Promise<CloseRealtimeSessionResponse>;
  text: {
    generate(input: TextGenerateInput): Promise<TextGenerateOutput>;
    stream(input: TextStreamInput): Promise<TextStreamOutput>;
  };
  embedding: {
    generate(input: EmbeddingGenerateInput): Promise<EmbeddingGenerateOutput>;
  };
};
