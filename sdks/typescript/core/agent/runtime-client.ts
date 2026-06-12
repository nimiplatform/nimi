import type {
  AgentEvent,
  AppMessageEvent,
  ConversationAnchorSnapshot,
  GetAgentCanonicalMemoryBankStatusRequest,
  GetAgentCanonicalMemoryBankStatusResponse,
  GetAgentRequest,
  GetAgentResponse,
  GetPublicChatSessionSnapshotRequest,
  GetPublicChatSessionSnapshotResponse,
  InitializeAgentRequest,
  InitializeAgentResponse,
  OpenConversationAnchorRequest,
  OpenConversationAnchorResponse,
  QueryAgentMemoryRequest,
  QueryAgentMemoryResponse,
  RequestAgentCanonicalMemoryBankBindRequest,
  RequestAgentCanonicalMemoryBankBindResponse,
  RuntimeTypedCallOptions,
  SendAppMessageRequest,
  SendAppMessageResponse,
  SubscribeAgentEventsRequest,
  SubscribeAppMessagesRequest,
  TerminateAgentRequest,
  TerminateAgentResponse,
  WriteAgentMemoryRequest,
  WriteAgentMemoryResponse,
} from '../../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../../types';
import type { RuntimeLocalAgentIdentityInput } from '../../runtime/agent-local-identity';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
  createNimiHostRuntimeAgentMemorySurface,
  createNimiRuntimeAgentTurnsModule,
  normalizeNimiRuntimeAgentText,
  runNimiRuntimeAgentTurn,
  toNimiRuntimeProtoStruct,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentCanonicalMemoryBankStatus,
  type NimiRuntimeAgentConsumeEvent,
  type NimiRuntimeAgentConsumeRequest,
  type NimiRuntimeAgentEnsureLocalAgentInitializedInput,
  type NimiRuntimeAgentInitializeLocalAgentInput,
  type NimiRuntimeAgentMessage,
  type NimiRuntimeAgentScopeRunner,
  type NimiRuntimeAgentSessionSnapshot,
  type NimiRuntimeAgentSessionSnapshotRequest,
  type NimiRuntimeAgentTerminateLocalAgentInput,
  type NimiRuntimeAgentTurnInterruptRequest,
  type NimiRuntimeAgentTurnRequest,
  type NimiRuntimeAgentTurnRunnerOptions,
  type NimiRuntimeAgentTurnRunnerPart,
} from '../../runtime';
import type { NimiJsonObject } from '../contracts';

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
  getAgent(request: GetAgentRequest, options?: RuntimeTypedCallOptions): Promise<GetAgentResponse>;
  initializeAgent(request: InitializeAgentRequest, options?: RuntimeTypedCallOptions): Promise<InitializeAgentResponse>;
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
  ensureInitialized(input: NimiRuntimeAgentEnsureLocalAgentInitializedInput): Promise<void>;
  initialize(input: NimiRuntimeAgentInitializeLocalAgentInput): Promise<void>;
  terminate(input: NimiRuntimeAgentTerminateLocalAgentInput): Promise<void>;
  openConversation(input: NimiRuntimeAgentOpenConversationInput): Promise<ConversationAnchorSnapshot>;
  sendTurn(input: NimiRuntimeAgentTurnRequest): Promise<SendAppMessageResponse>;
  streamTurn(input: NimiRuntimeAgentTurnRequest, options?: NimiRuntimeAgentClientStreamTurnOptions): Promise<{
    readonly stream: AsyncIterable<NimiRuntimeAgentTurnRunnerPart>;
  }>;
  interruptTurn(input: NimiRuntimeAgentTurnInterruptRequest): Promise<SendAppMessageResponse>;
  subscribeEvents(input: NimiRuntimeAgentConsumeRequest): Promise<AsyncIterable<NimiRuntimeAgentConsumeEvent>>;
  getSessionSnapshot(input: NimiRuntimeAgentSessionSnapshotRequest): Promise<NimiRuntimeAgentSessionSnapshot>;
  queryMemory(input: NimiRuntimeAgentQueryMemoryInput): Promise<QueryAgentMemoryResponse>;
  writeMemory(input: NimiRuntimeAgentWriteMemoryInput): Promise<WriteAgentMemoryResponse>;
  getCanonicalMemoryStatus(agentId: string): Promise<NimiRuntimeAgentCanonicalMemoryBankStatus>;
  bindCanonicalMemoryStandard(agentId: string): Promise<NimiRuntimeAgentCanonicalMemoryBankStatus>;
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
  const memory = createNimiHostRuntimeAgentMemorySurface({
    getRuntime: () => ({
      appId: runtime.appId,
      agent: runtime.agent,
    }),
    getSubjectUserId: options.getSubjectUserId,
  });

  return {
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
            realmAgentId: identity.realmAgentId,
            localAgentRef: identity.localAgentRef,
          },
          agentId: identity.localAgentRef,
          subjectUserId,
          localAgentRef: identity.localAgentRef,
          ownerUserId: identity.ownerUserId,
          realmAgentId: identity.realmAgentId,
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
      return response.snapshot;
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
            realmAgentId: identity.realmAgentId,
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
            realmAgentId: identity.realmAgentId,
            localAgentRef: identity.localAgentRef,
          },
          agentId: identity.localAgentRef,
          candidates: [...(input.candidates ?? [])],
        }, callOptions),
      );
    },
    getCanonicalMemoryStatus: memory.getCanonicalBankStatus,
    bindCanonicalMemoryStandard: memory.bindCanonicalBankStandard,
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
  const ownerUserId = normalizeNimiRuntimeAgentText(input.ownerUserId);
  const realmAgentId = normalizeNimiRuntimeAgentText(input.realmAgentId);
  const localAgentRef = normalizeNimiRuntimeAgentText(input.localAgentRef) || `local-agent:${ownerUserId}:${realmAgentId}`;
  if (!ownerUserId || !realmAgentId || localAgentRef !== `local-agent:${ownerUserId}:${realmAgentId}`) {
    runtimeAgentClientError(
      'Nimi runtime agent client requires explicit matching local agent identity.',
      ReasonCode.AI_INPUT_INVALID,
      'provide_runtime_agent_local_identity',
    );
  }
  return { ownerUserId, realmAgentId, localAgentRef };
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
