import type {
  AgentEvent,
  AbortSourceMaterializationUploadRequest,
  AbortSourceMaterializationUploadResponse,
  BeginSourceMaterializationUploadRequest,
  BeginSourceMaterializationUploadResponse,
  CommitSourceMaterializationRequest,
  CommitSourceMaterializationResponse,
  CreateSourceMaterializationChallengeRequest,
  CreateSourceMaterializationChallengeResponse,
  RuntimeAgentAIConfigReadinessSnapshot,
  AppMessageEvent,
  GetAgentCanonicalMemoryBankStatusRequest,
  GetAgentCanonicalMemoryBankStatusResponse,
  GetRuntimeAgentAIConfigRequest,
  GetRuntimeAgentAIConfigResponse,
  GetRuntimeAgentAIConfigReadinessRequest,
  GetRuntimeAgentAIConfigReadinessResponse,
  GetAgentRequest,
  GetAgentResponse,
  GetPublicChatSessionSnapshotRequest,
  GetPublicChatSessionSnapshotResponse,
  InitializeAgentRequest,
  InitializeAgentResponse,
  ListAgentsRequest,
  ListAgentsResponse,
  OpenConversationAnchorRequest,
  OpenConversationAnchorResponse,
  PutSourceMaterializationChunkRequest,
  PutSourceMaterializationChunkResponse,
  QueryAgentMemoryRequest,
  QueryAgentMemoryResponse,
  RequestAgentCanonicalMemoryBankBindRequest,
  RequestAgentCanonicalMemoryBankBindResponse,
  RuntimeTypedCallOptions,
  SendAppMessageRequest,
  SendAppMessageResponse,
  SubscribeAgentEventsRequest,
  SubscribeRuntimeAgentAIConfigReadinessRequest,
  SubscribeAppMessagesRequest,
  TerminateAgentRequest,
  TerminateAgentResponse,
  UpsertRuntimeAgentAIConfigRequest,
  UpsertRuntimeAgentAIConfigResponse,
  WriteAgentMemoryRequest,
  WriteAgentMemoryResponse,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../types';
import { projectRuntimeLocalAgentIdentity, type RuntimeLocalAgentIdentityInput } from './agent-local-identity';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
  type NimiRuntimeAgentDiscoveredLocalAgent,
  type NimiRuntimeAgentDiscoverLocalAgentsBySourceInput,
  type NimiRuntimeAgentEnsureLocalAgentInitializedInput,
  type NimiRuntimeAgentInitializedLocalAgent,
  type NimiRuntimeAgentInitializeLocalAgentInput,
  type NimiRuntimeAgentListLocalAgentsInput,
  type NimiRuntimeAgentTerminateLocalAgentInput,
} from './runtime-agent-lifecycle';
import {
  createNimiHostRuntimeAgentMemorySurface,
  type NimiRuntimeAgentCanonicalMemoryBankStatus,
} from './runtime-agent-memory';
import {
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import {
  createNimiRuntimeAgentAIConfigModule,
  type NimiRuntimeAgentAIConfigModule,
} from './runtime-agent-ai-config';
import {
  createNimiRuntimeAgentTurnsModule,
} from './runtime-agent-turns';
import {
  createNimiHostRuntimeAgentMaterializationSurface,
  type NimiRuntimeAgentMaterializeRealmSourceInput,
  type NimiRuntimeAgentMaterializedRealmSource,
} from './runtime-agent-materialization';
import {
  runNimiRuntimeAgentTurn,
  type NimiRuntimeAgentTurnRunnerOptions,
  type NimiRuntimeAgentTurnRunnerPart,
} from './runtime-agent-turn-runner';
import type {
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentConversationAnchorSnapshot,
  NimiRuntimeAgentSessionSnapshot,
} from './runtime-agent-consume-types';
import { decodeNimiRuntimeAgentConversationAnchorSnapshot } from './runtime-agent-consume-client';
import type {
  NimiRuntimeAgentConsumeRequest,
  NimiRuntimeAgentSessionSnapshotRequest,
  NimiRuntimeAgentTurnInterruptRequest,
  NimiRuntimeAgentTurnRequest,
} from './runtime-agent-turn-runner-types';
import { normalizeNimiRuntimeAgentText, toNimiRuntimeProtoStruct } from './runtime-agent-values';
import type { NimiJsonObject } from '../core/contracts';

export interface NimiRuntimeAgentClientRuntime {
  readonly appId?: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth?: NimiRuntimeAgentAppAuthClient;
  readonly grants?: NimiRuntimeAgentAppAuthClient;
  readonly agent?: NimiRuntimeAgentClientAgentModule;
  readonly agents?: NimiRuntimeAgentClientAgentModule;
  readonly appMessages: NimiRuntimeAgentClientAppMessagesModule;
}

export interface NimiRuntimeAgentClientAgentModule {
  createSourceMaterializationChallenge(
    request: CreateSourceMaterializationChallengeRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<CreateSourceMaterializationChallengeResponse>;
  beginSourceMaterializationUpload(
    request: BeginSourceMaterializationUploadRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<BeginSourceMaterializationUploadResponse>;
  putSourceMaterializationChunk(
    request: PutSourceMaterializationChunkRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<PutSourceMaterializationChunkResponse>;
  commitSourceMaterialization(
    request: CommitSourceMaterializationRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<CommitSourceMaterializationResponse>;
  abortSourceMaterializationUpload(
    request: AbortSourceMaterializationUploadRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<AbortSourceMaterializationUploadResponse>;
  getAgent(request: GetAgentRequest, options?: RuntimeTypedCallOptions): Promise<GetAgentResponse>;
  initializeAgent(request: InitializeAgentRequest, options?: RuntimeTypedCallOptions): Promise<InitializeAgentResponse>;
  listAgents(request: ListAgentsRequest, options?: RuntimeTypedCallOptions): Promise<ListAgentsResponse>;
  terminateAgent(request: TerminateAgentRequest, options?: RuntimeTypedCallOptions): Promise<TerminateAgentResponse>;
  openConversationAnchor(request: OpenConversationAnchorRequest, options?: RuntimeTypedCallOptions): Promise<OpenConversationAnchorResponse>;
  getPublicChatSessionSnapshot(
    request: GetPublicChatSessionSnapshotRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetPublicChatSessionSnapshotResponse>;
  subscribeAgentEvents(request: SubscribeAgentEventsRequest, options?: RuntimeTypedCallOptions): AsyncIterable<AgentEvent | unknown>;
  queryAgentMemory(request: QueryAgentMemoryRequest, options?: RuntimeTypedCallOptions): Promise<QueryAgentMemoryResponse>;
  writeAgentMemory(request: WriteAgentMemoryRequest, options?: RuntimeTypedCallOptions): Promise<WriteAgentMemoryResponse>;
  getAgentCanonicalMemoryBankStatus(
    request: GetAgentCanonicalMemoryBankStatusRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetAgentCanonicalMemoryBankStatusResponse>;
  requestAgentCanonicalMemoryBankBind(
    request: RequestAgentCanonicalMemoryBankBindRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<RequestAgentCanonicalMemoryBankBindResponse>;
  // Runtime Agent AI Config projection (K-AGCORE-144~150). Host projections
  // may omit this optional transport surface, but agentAIConfig fails closed
  // with a typed error when the surface is missing.
  getRuntimeAgentAIConfig?(
    request: GetRuntimeAgentAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetRuntimeAgentAIConfigResponse>;
  upsertRuntimeAgentAIConfig?(
    request: UpsertRuntimeAgentAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<UpsertRuntimeAgentAIConfigResponse>;
  getRuntimeAgentAIConfigReadiness?(
    request: GetRuntimeAgentAIConfigReadinessRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetRuntimeAgentAIConfigReadinessResponse>;
  subscribeRuntimeAgentAIConfigReadiness?(
    request: SubscribeRuntimeAgentAIConfigReadinessRequest,
    options?: RuntimeTypedCallOptions,
  ): AsyncIterable<RuntimeAgentAIConfigReadinessSnapshot>;
}

export interface NimiRuntimeAgentClientAppMessagesModule {
  sendAppMessage(request: SendAppMessageRequest, options?: RuntimeTypedCallOptions): Promise<SendAppMessageResponse>;
  subscribeAppMessages(request: SubscribeAppMessagesRequest, options?: RuntimeTypedCallOptions): AsyncIterable<AppMessageEvent>;
}

export interface NimiRuntimeAgentClientOptions {
  readonly runtime: NimiRuntimeAgentClientRuntime;
  readonly appId?: string;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

export type NimiRuntimeAgentIdentityInput = RuntimeLocalAgentIdentityInput;

export interface NimiRuntimeAgentOpenConversationInput extends NimiRuntimeAgentIdentityInput {
  readonly subjectUserId?: string;
  readonly metadata?: NimiJsonObject;
}

export interface NimiRuntimeAgentClient {
  materialize(input: NimiRuntimeAgentMaterializeRealmSourceInput): Promise<NimiRuntimeAgentMaterializedRealmSource>;
  listLocalAgents(input?: NimiRuntimeAgentListLocalAgentsInput): Promise<NimiRuntimeAgentDiscoveredLocalAgent[]>;
  discoverBySource(input: NimiRuntimeAgentDiscoverLocalAgentsBySourceInput): Promise<NimiRuntimeAgentDiscoveredLocalAgent[]>;
  ensureInitialized(input: NimiRuntimeAgentEnsureLocalAgentInitializedInput): Promise<NimiRuntimeAgentInitializedLocalAgent>;
  initialize(input: NimiRuntimeAgentInitializeLocalAgentInput): Promise<NimiRuntimeAgentInitializedLocalAgent>;
  terminate(input: NimiRuntimeAgentTerminateLocalAgentInput): Promise<void>;
  openConversation(input: NimiRuntimeAgentOpenConversationInput): Promise<NimiRuntimeAgentConversationAnchorSnapshot>;
  sendTurn(input: NimiRuntimeAgentTurnRequest): Promise<SendAppMessageResponse>;
  streamTurn(input: NimiRuntimeAgentTurnRequest, options?: NimiRuntimeAgentClientStreamTurnOptions): Promise<{
    readonly stream: AsyncIterable<NimiRuntimeAgentTurnRunnerPart>;
  }>;
  interruptTurn(input: NimiRuntimeAgentTurnInterruptRequest): Promise<SendAppMessageResponse>;
  subscribeEvents(input: NimiRuntimeAgentConsumeRequest): Promise<AsyncIterable<NimiRuntimeAgentConsumeEvent>>;
  getSessionSnapshot(input: NimiRuntimeAgentSessionSnapshotRequest): Promise<NimiRuntimeAgentSessionSnapshot>;
  queryMemory(input: NimiRuntimeAgentQueryMemoryInput): Promise<QueryAgentMemoryResponse>;
  writeMemory(input: NimiRuntimeAgentWriteMemoryInput): Promise<WriteAgentMemoryResponse>;
  getCanonicalMemoryStatus(input: RuntimeLocalAgentIdentityInput): Promise<NimiRuntimeAgentCanonicalMemoryBankStatus>;
  bindCanonicalMemoryStandard(input: RuntimeLocalAgentIdentityInput): Promise<NimiRuntimeAgentCanonicalMemoryBankStatus>;
  readonly agentAIConfig: NimiRuntimeAgentAIConfigModule;
}

export interface NimiRuntimeAgentClientStreamTurnOptions
  extends Omit<NimiRuntimeAgentTurnRunnerOptions, 'turns' | 'request'> {}

export interface NimiRuntimeAgentQueryMemoryInput extends RuntimeLocalAgentIdentityInput {
  readonly query?: string;
  readonly limit?: number;
  readonly canonicalClasses?: QueryAgentMemoryRequest['canonicalClasses'];
  readonly kinds?: QueryAgentMemoryRequest['kinds'];
  readonly includeInvalidated?: boolean;
}

export interface NimiRuntimeAgentWriteMemoryInput extends RuntimeLocalAgentIdentityInput {
  readonly candidates: WriteAgentMemoryRequest['candidates'];
}

export function createNimiRuntimeAgentClient(options: NimiRuntimeAgentClientOptions): NimiRuntimeAgentClient {
  const runtime = normalizeRuntime(options.runtime, options.appId);
  const turns = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: runtime.appId,
      auth: runtime.auth,
      appAuth: runtime.appAuth,
      agents: {
        getPublicChatSessionSnapshot: runtime.agent.getPublicChatSessionSnapshot,
        subscribeAgentEvents: runtime.agent.subscribeAgentEvents,
      },
      appMessages: runtime.appMessages,
    },
    getSubjectUserId: options.getSubjectUserId,
    withScopes: options.withScopes,
  });
  const lifecycle = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: runtime.appId,
      auth: runtime.auth,
      appAuth: runtime.appAuth,
      agent: runtime.agent,
    }),
    getSubjectUserId: options.getSubjectUserId,
    withScopes: options.withScopes,
  });
  const materialization = createNimiHostRuntimeAgentMaterializationSurface({
    getRuntime: () => ({
      appId: runtime.appId,
      auth: runtime.auth,
      appAuth: runtime.appAuth,
      agent: runtime.agent,
    }),
    getSubjectUserId: options.getSubjectUserId,
    withScopes: options.withScopes,
  });
  const agentAIConfig = createNimiRuntimeAgentAIConfigModule({
    runtime: {
      appId: runtime.appId,
      auth: runtime.auth,
      appAuth: runtime.appAuth,
      agent: runtime.agent,
    },
    getSubjectUserId: options.getSubjectUserId,
    withScopes: options.withScopes,
  });
  const memory = createNimiHostRuntimeAgentMemorySurface({
    getRuntime: () => ({
      appId: runtime.appId,
      auth: runtime.auth,
      appAuth: runtime.appAuth,
      agent: runtime.agent,
    }),
    getSubjectUserId: options.getSubjectUserId,
    withScopes: options.withScopes,
  });

  return {
    materialize: materialization.materializeRealmSource,
    listLocalAgents: lifecycle.listLocalAgents,
    discoverBySource: lifecycle.discoverLocalAgentsBySource,
    ensureInitialized: lifecycle.ensureLocalAgentInitialized,
    initialize: lifecycle.initializeLocalAgent,
    terminate: lifecycle.terminateLocalAgent,
    async openConversation(input) {
      const identity = runtimeAgentIdentity(input);
      const subjectUserId = normalizeNimiRuntimeAgentText(input.subjectUserId)
        || normalizeNimiRuntimeAgentText(await options.getSubjectUserId())
        || identity.ownerUserId;
      const response = await withRuntimeAgentScopes(
        runtime,
        options.withScopes,
        subjectUserId,
        ['runtime.agent.write'],
        (callOptions) => runtime.agent.openConversationAnchor({
          context: {
            appId: runtime.appId,
            subjectUserId,
            ownerUserId: identity.ownerUserId,
            runtimeSourceRef: identity.runtimeSourceRef,
            localAgentRef: identity.localAgentRef,
          },
          agentId: '',
          subjectUserId,
          localAgentRef: identity.localAgentRef,
          ownerUserId: identity.ownerUserId,
          runtimeSourceRef: identity.runtimeSourceRef,
          metadata: input.metadata ? toNimiRuntimeProtoStruct(input.metadata) : undefined,
        }, callOptions),
      );
      if (!response.snapshot) {
        runtimeAgentClientError(
          'Runtime Agent openConversation returned no ConversationAnchorSnapshot.',
          'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
          'check_runtime_agent_open_conversation',
        );
      }
      return decodeNimiRuntimeAgentConversationAnchorSnapshot(
        response.snapshot,
        identity.localAgentRef,
      );
    },
    sendTurn: turns.request,
    streamTurn(input, streamOptions = {}) {
      return runNimiRuntimeAgentTurn({
        ...streamOptions,
        turns,
        request: input,
      });
    },
    interruptTurn: turns.interrupt,
    subscribeEvents: turns.subscribe,
    getSessionSnapshot: turns.getSessionSnapshot,
    async queryMemory(input) {
      const identity = runtimeAgentIdentity(input);
      const subjectUserId = normalizeNimiRuntimeAgentText(await options.getSubjectUserId()) || identity.ownerUserId;
      return withRuntimeAgentScopes(
        runtime,
        options.withScopes,
        subjectUserId,
        ['runtime.agent.read'],
        (callOptions) => runtime.agent.queryAgentMemory({
          context: {
            appId: runtime.appId,
            subjectUserId,
            ownerUserId: identity.ownerUserId,
            runtimeSourceRef: identity.runtimeSourceRef,
            localAgentRef: identity.localAgentRef,
          },
          agentId: identity.localAgentRef,
          query: normalizeNimiRuntimeAgentText(input.query),
          limit: Number(input.limit ?? 0),
          canonicalClasses: [...(input.canonicalClasses ?? [])],
          kinds: [...(input.kinds ?? [])],
          includeInvalidated: input.includeInvalidated === true,
        }, callOptions),
      );
    },
    async writeMemory(input) {
      const identity = runtimeAgentIdentity(input);
      const subjectUserId = normalizeNimiRuntimeAgentText(await options.getSubjectUserId()) || identity.ownerUserId;
      return withRuntimeAgentScopes(
        runtime,
        options.withScopes,
        subjectUserId,
        ['runtime.agent.write'],
        (callOptions) => runtime.agent.writeAgentMemory({
          context: {
            appId: runtime.appId,
            subjectUserId,
            ownerUserId: identity.ownerUserId,
            runtimeSourceRef: identity.runtimeSourceRef,
            localAgentRef: identity.localAgentRef,
          },
          agentId: identity.localAgentRef,
          candidates: [...(input.candidates ?? [])],
        }, callOptions),
      );
    },
    getCanonicalMemoryStatus: memory.getCanonicalBankStatus,
    bindCanonicalMemoryStandard: memory.bindCanonicalBankStandard,
    agentAIConfig,
  };
}

function normalizeRuntime(runtime: NimiRuntimeAgentClientRuntime, appIdOverride: string | undefined) {
  const appId = normalizeNimiRuntimeAgentText(appIdOverride) || normalizeNimiRuntimeAgentText(runtime.appId);
  if (!appId) {
    runtimeAgentClientError('Nimi runtime agent client requires appId.', 'SDK_RUNTIME_AGENT_APP_ID_REQUIRED', 'provide_runtime_agent_app_id');
  }
  const agent = runtime.agent ?? runtime.agents;
  if (!agent) {
    runtimeAgentClientError(
      'Nimi runtime agent client requires RuntimeAgentService projection.',
      'SDK_RUNTIME_AGENT_SURFACE_REQUIRED',
      'provide_runtime_agents_module',
    );
  }
  const appAuth = runtime.appAuth ?? runtime.grants;
  if (!appAuth) {
    runtimeAgentClientError(
      'Nimi runtime agent client requires Runtime grant/appAuth projection.',
      'SDK_RUNTIME_AGENT_AUTH_REQUIRED',
      'provide_runtime_grants_module',
    );
  }
  return {
    appId,
    auth: runtime.auth,
    appAuth,
    agent,
    appMessages: runtime.appMessages,
  };
}

function runtimeAgentIdentity(input: RuntimeLocalAgentIdentityInput) {
  try {
    return projectRuntimeLocalAgentIdentity(input);
  } catch {
    runtimeAgentClientError(
      'Nimi runtime agent client requires explicit Runtime-owned local agent identity.',
      ReasonCode.AI_INPUT_INVALID,
      'provide_runtime_agent_local_identity',
    );
  }
}

async function withRuntimeAgentScopes<T>(
  runtime: ReturnType<typeof normalizeRuntime>,
  withScopes: NimiRuntimeAgentScopeRunner | undefined,
  subjectUserId: string,
  scopes: readonly string[],
  operation: (options: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  if (withScopes) {
    return withScopes(scopes, operation);
  }
  return withNimiRuntimeAgentScopes({ runtime, subjectUserId }, scopes, operation);
}

function runtimeAgentClientError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}
