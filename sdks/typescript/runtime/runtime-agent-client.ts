import type {
  AppMessageEvent,
  ApplySharedLocalAgentAIProfileRequest,
  ApplySharedLocalAgentAIProfileResponse,
  GetSharedLocalAgentAIConfigRequest,
  GetSharedLocalAgentAIConfigResponse,
  GetAgentRequest,
  GetAgentResponse,
  GetPublicChatSessionSnapshotRequest,
  GetPublicChatSessionSnapshotResponse,
  ListAgentsRequest,
  ListAgentsResponse,
  OpenConversationAnchorRequest,
  OpenConversationAnchorResponse,
  OverwriteSharedLocalAgentAIConfigRequest,
  OverwriteSharedLocalAgentAIConfigResponse,
  PreviewSharedLocalAgentAIProfileRequest,
  PreviewSharedLocalAgentAIProfileResponse,
  RuntimeTypedCallOptions,
  SendAppMessageRequest,
  SendAppMessageResponse,
  SubscribeAppMessagesRequest,
  TerminateAgentRequest,
  TerminateAgentResponse,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../types';
import { projectRuntimeLocalAgentIdentity, type RuntimeLocalAgentIdentityInput } from './agent-local-identity';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
  type NimiRuntimeAgentDiscoveredLocalAgent,
  type NimiRuntimeAgentDiscoverLocalAgentsBySourceInput,
  type NimiRuntimeAgentListLocalAgentsInput,
  type NimiRuntimeAgentTerminateLocalAgentInput,
} from './runtime-agent-lifecycle';
import {
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import {
  createNimiSharedLocalAgentAISurface,
  type NimiSharedLocalAgentAIConfigClient,
  type NimiSharedLocalAgentAIProfileClient,
} from './shared-local-agent-ai-config';
import {
  createNimiRuntimeAgentTurnsModule,
} from './runtime-agent-turns';
import {
  runNimiRuntimeAgentTurn,
  type NimiRuntimeAgentTurnRunnerOptions,
  type NimiRuntimeAgentTurnRunnerPart,
} from './runtime-agent-turn-runner';
import type {
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentConversationAnchorSnapshot,
  NimiRuntimeAgentConversationSummariesInput,
  NimiRuntimeAgentConversationSummariesResult,
  NimiRuntimeAgentConsumeRuntime,
  NimiRuntimeAgentSessionSnapshot,
} from './runtime-agent-consume-types';
import {
  createNimiRuntimeAgentConsumeClient,
  decodeNimiRuntimeAgentConversationAnchorSnapshot,
} from './runtime-agent-consume-client';
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
  readonly agent?: NimiRuntimeAgentClientAgentModule;
  readonly agents?: NimiRuntimeAgentClientAgentModule;
  readonly appMessages: NimiRuntimeAgentClientAppMessagesModule;
}

export interface NimiRuntimeAgentClientAgentModule {
  getAgent(request: GetAgentRequest, options?: RuntimeTypedCallOptions): Promise<GetAgentResponse>;
  listAgents(request: ListAgentsRequest, options?: RuntimeTypedCallOptions): Promise<ListAgentsResponse>;
  terminateAgent(request: TerminateAgentRequest, options?: RuntimeTypedCallOptions): Promise<TerminateAgentResponse>;
  openConversationAnchor(request: OpenConversationAnchorRequest, options?: RuntimeTypedCallOptions): Promise<OpenConversationAnchorResponse>;
  listAgentConversationSummaries?(
    request: unknown,
    options?: RuntimeTypedCallOptions,
  ): Promise<{ summaries?: unknown[]; nextPageToken?: string }>;
  getPublicChatSessionSnapshot(
    request: GetPublicChatSessionSnapshotRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetPublicChatSessionSnapshotResponse>;
  // Singular shared LocalAgent subsystem AIConfig. Host projections may omit
  // this optional transport surface; SDK operations then fail closed.
  getSharedLocalAgentAIConfig?(
    request: GetSharedLocalAgentAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetSharedLocalAgentAIConfigResponse>;
  overwriteSharedLocalAgentAIConfig?(
    request: OverwriteSharedLocalAgentAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<OverwriteSharedLocalAgentAIConfigResponse>;
  previewSharedLocalAgentAIProfile?(
    request: PreviewSharedLocalAgentAIProfileRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<PreviewSharedLocalAgentAIProfileResponse>;
  applySharedLocalAgentAIProfile?(
    request: ApplySharedLocalAgentAIProfileRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ApplySharedLocalAgentAIProfileResponse>;
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
  listLocalAgents(input?: NimiRuntimeAgentListLocalAgentsInput): Promise<NimiRuntimeAgentDiscoveredLocalAgent[]>;
  discoverBySource(input: NimiRuntimeAgentDiscoverLocalAgentsBySourceInput): Promise<NimiRuntimeAgentDiscoveredLocalAgent[]>;
  terminate(input: NimiRuntimeAgentTerminateLocalAgentInput): Promise<void>;
  openConversation(input: NimiRuntimeAgentOpenConversationInput): Promise<NimiRuntimeAgentConversationAnchorSnapshot>;
  listConversationSummaries(input: NimiRuntimeAgentConversationSummariesInput): Promise<NimiRuntimeAgentConversationSummariesResult>;
  sendTurn(input: NimiRuntimeAgentTurnRequest): Promise<SendAppMessageResponse>;
  streamTurn(input: NimiRuntimeAgentTurnRequest, options?: NimiRuntimeAgentClientStreamTurnOptions): Promise<{
    readonly stream: AsyncIterable<NimiRuntimeAgentTurnRunnerPart>;
  }>;
  interruptTurn(input: NimiRuntimeAgentTurnInterruptRequest): Promise<SendAppMessageResponse>;
  subscribeEvents(input: NimiRuntimeAgentConsumeRequest): Promise<AsyncIterable<NimiRuntimeAgentConsumeEvent>>;
  getSessionSnapshot(input: NimiRuntimeAgentSessionSnapshotRequest): Promise<NimiRuntimeAgentSessionSnapshot>;
  readonly sharedAIConfig: NimiSharedLocalAgentAIConfigClient;
  readonly sharedAIProfile: NimiSharedLocalAgentAIProfileClient;
}

export interface NimiRuntimeAgentClientStreamTurnOptions
  extends Omit<NimiRuntimeAgentTurnRunnerOptions, 'turns' | 'request'> {}

export function createNimiRuntimeAgentClient(options: NimiRuntimeAgentClientOptions): NimiRuntimeAgentClient {
  const runtime = normalizeRuntime(options.runtime, options.appId);
  const turns = createNimiRuntimeAgentTurnsModule({
    runtime: {
      appId: runtime.appId,
      auth: runtime.auth,
      agents: {
        getPublicChatSessionSnapshot: runtime.agent.getPublicChatSessionSnapshot,
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
      agent: runtime.agent,
    }),
    getSubjectUserId: options.getSubjectUserId,
    withScopes: options.withScopes,
  });
  const sharedAI = createNimiSharedLocalAgentAISurface({
    runtime: {
      appId: runtime.appId,
      auth: runtime.auth,
      agent: runtime.agent,
    },
    getSubjectUserId: options.getSubjectUserId,
    withScopes: options.withScopes,
  });
  const consume = createNimiRuntimeAgentConsumeClient({
    runtime: {
      agents: runtime.agent as unknown as NimiRuntimeAgentConsumeRuntime['agents'],
      appMessages: runtime.appMessages,
    },
    runtimeAppId: runtime.appId,
  });

  return {
    listLocalAgents: lifecycle.listLocalAgents,
    discoverBySource: lifecycle.discoverLocalAgentsBySource,
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
    async listConversationSummaries(input) {
      const identity = runtimeAgentIdentity(input);
      const subjectUserId = normalizeNimiRuntimeAgentText(await options.getSubjectUserId()) || identity.ownerUserId;
      return withRuntimeAgentScopes(
        runtime,
        options.withScopes,
        subjectUserId,
        ['runtime.agent.read'],
        (callOptions) => consume.anchors.listSummaries(input, callOptions),
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
    sharedAIConfig: sharedAI.sharedAIConfig,
    sharedAIProfile: sharedAI.sharedAIProfile,
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
  return {
    appId,
    auth: runtime.auth,
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
