import {
  ReasonCode as RuntimeGeneratedReasonCode,
  type AppMessageEvent,
  type GetPublicChatSessionSnapshotRequest,
  type GetPublicChatSessionSnapshotResponse,
  type SendAppMessageRequest,
  type SendAppMessageResponse,
  type SubscribeAgentEventsRequest,
  type SubscribeAppMessagesRequest,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import type { ScopedRuntimeBindingAttachment } from '../core-generated/runtime-protobuf/runtime/v1/common';
import { createNimiError, ReasonCode, type JsonObject } from '../types';
import {
  buildRuntimeAgentRequestContext,
  projectRuntimeLocalAgentIdentity,
  type RuntimeLocalAgentIdentityInput,
} from './agent-local-identity';
import {
  parseNimiRuntimeAgentSessionSnapshot,
  projectNimiRuntimeAgentAppMessageEvent,
  projectNimiRuntimeAgentServiceEvent,
} from './runtime-agent-consume-projection';
import type {
  NimiRuntimeAgentConsumeEvent,
} from './runtime-agent-consume-types';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText, toNimiRuntimeProtoStruct } from './runtime-agent-values';
import type {
  NimiRuntimeAgentConsumeRequest,
  NimiRuntimeAgentMessage,
  NimiRuntimeAgentSessionSnapshotRequest,
  NimiRuntimeAgentTurnInterruptRequest,
  NimiRuntimeAgentTurnRequest,
  NimiRuntimeAgentTurnsModule,
} from './runtime-agent-turn-runner-types';

const RUNTIME_AGENT_APP_ID = 'runtime.agent';
const AGENT_READ_SCOPE = 'runtime.agent.read';
const TURN_WRITE_SCOPE = 'runtime.agent.turn.write';
const TURN_READ_SCOPE = 'runtime.agent.turn.read';
const TURN_REQUEST_TYPE = 'runtime.agent.turn.request';
const TURN_INTERRUPT_TYPE = 'runtime.agent.turn.interrupt';
const TURN_ROUTES = new Set(['local', 'cloud']);

export interface NimiRuntimeAgentTurnsRuntime {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth: NimiRuntimeAgentAppAuthClient;
  readonly agents: {
    getPublicChatSessionSnapshot(
      request: GetPublicChatSessionSnapshotRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetPublicChatSessionSnapshotResponse>;
    subscribeAgentEvents(
      request: SubscribeAgentEventsRequest,
      options?: RuntimeTypedCallOptions,
    ): AsyncIterable<unknown>;
  };
  readonly appMessages: {
    sendAppMessage(
      request: SendAppMessageRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<SendAppMessageResponse>;
    subscribeAppMessages(
      request: SubscribeAppMessagesRequest,
      options?: RuntimeTypedCallOptions,
    ): AsyncIterable<AppMessageEvent>;
  };
}

export interface NimiRuntimeAgentTurnsModuleOptions {
  readonly runtime: NimiRuntimeAgentTurnsRuntime;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

function runtimeAgentInputError(message: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint,
    source: 'sdk',
  });
}

function optionalString(value: unknown): string | undefined {
  const normalized = normalizeNimiRuntimeAgentText(value);
  return normalized || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function requireConversationAnchorId(anchorId: unknown, actionHint = 'open_runtime_agent_anchor_first'): string {
  const normalized = optionalString(anchorId);
  if (!normalized) {
    runtimeAgentInputError('runtime agent request requires conversationAnchorId', actionHint);
  }
  return normalized;
}

function optionalRuntimeCursor(cursor: unknown): string {
  const normalized = optionalString(cursor);
  if (!normalized) {
    return '';
  }
  if (!/^\d+$/u.test(normalized)) {
    runtimeAgentInputError('runtime agent stream cursor must be a non-negative integer string', 'use_runtime_agent_returned_cursor');
  }
  return normalized;
}

function toScopedBindingAttachment(
  input: ScopedRuntimeBindingAttachment | undefined,
  defaults: {
    readonly runtimeAppId: string;
    readonly localAgentRef?: string;
    readonly conversationAnchorId?: string;
    readonly worldId?: string;
  },
): ScopedRuntimeBindingAttachment | undefined {
  const bindingId = optionalString(input?.bindingId);
  if (!bindingId) {
    return undefined;
  }
  return {
    bindingId,
    bindingHandle: optionalString(input?.bindingHandle) || '',
    runtimeAppId: optionalString(input?.runtimeAppId) || defaults.runtimeAppId,
    appInstanceId: optionalString(input?.appInstanceId) || '',
    windowId: optionalString(input?.windowId) || '',
    avatarInstanceId: optionalString(input?.avatarInstanceId) || '',
    agentId: optionalString(input?.agentId) || optionalString(defaults.localAgentRef) || '',
    conversationAnchorId: optionalString(input?.conversationAnchorId) || optionalString(defaults.conversationAnchorId) || '',
    worldId: optionalString(input?.worldId) || optionalString(defaults.worldId) || '',
  };
}

function normalizeTurnMessages(messages: readonly NimiRuntimeAgentMessage[]): NimiRuntimeAgentMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .map((message) => ({
      role: message.role,
      content: optionalString(message.content) || '',
      ...(optionalString(message.name) ? { name: optionalString(message.name) } : {}),
    }))
    .filter((message) => Boolean(message.role && message.content));
}

export function buildNimiRuntimeAgentTurnPayload(request: NimiRuntimeAgentTurnRequest): JsonObject {
  const identity = projectRuntimeLocalAgentIdentity(request);
  const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
  const messages = normalizeTurnMessages(request.messages);
  if (messages.length === 0) {
    runtimeAgentInputError('runtime agent turn request requires at least one non-empty message', 'provide_runtime_agent_turn_message');
  }
  const hasExecutionBinding = Boolean(request.executionBinding);
  const route = hasExecutionBinding ? normalizeNimiRuntimeAgentText(request.executionBinding?.route).toLowerCase() : '';
  if (hasExecutionBinding && !TURN_ROUTES.has(route)) {
    runtimeAgentInputError('runtime agent turn request executionBinding.route must be local or cloud', 'select_runtime_agent_route');
  }
  const modelId = hasExecutionBinding ? normalizeNimiRuntimeAgentText(request.executionBinding?.modelId) : '';
  if (hasExecutionBinding && !modelId) {
    runtimeAgentInputError('runtime agent turn request executionBinding.modelId is required', 'select_runtime_agent_model');
  }
  const maxOutputTokens = optionalNumber(request.maxOutputTokens);
  if (maxOutputTokens !== undefined && maxOutputTokens < 0) {
    runtimeAgentInputError('runtime agent turn request maxOutputTokens must be non-negative', 'provide_non_negative_max_output_tokens');
  }
  return {
    local_agent_ref: identity.localAgentRef,
    owner_user_id: identity.ownerUserId,
    realm_agent_id: identity.realmAgentId,
    conversation_anchor_id: conversationAnchorId,
    ...(optionalString(request.requestId) ? { request_id: optionalString(request.requestId) } : {}),
    ...(optionalString(request.threadId) ? { thread_id: optionalString(request.threadId) } : {}),
    ...(optionalString(request.systemPrompt) ? { system_prompt: optionalString(request.systemPrompt) } : {}),
    ...(optionalString(request.worldId) ? { world_id: optionalString(request.worldId) } : {}),
    ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
    messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(optionalString(message.name) ? { name: optionalString(message.name) } : {}),
    })),
    ...(hasExecutionBinding ? {
      execution_binding: {
        route,
        model_id: modelId,
        ...(optionalString(request.executionBinding?.connectorId)
          ? { connector_id: optionalString(request.executionBinding?.connectorId) }
          : {}),
      },
    } : {}),
    ...(request.reasoning ? {
      reasoning: {
        ...(optionalString(request.reasoning.mode) ? { mode: optionalString(request.reasoning.mode) } : {}),
        ...(optionalString(request.reasoning.traceMode) ? { trace_mode: optionalString(request.reasoning.traceMode) } : {}),
        ...(optionalNumber(request.reasoning.budgetTokens) !== undefined
          ? { budget_tokens: optionalNumber(request.reasoning.budgetTokens) }
          : {}),
      },
    } : {}),
  };
}

function reasonCodeName(value: RuntimeGeneratedReasonCode): string {
  return RuntimeGeneratedReasonCode[value] || '';
}

function assertAccepted(response: SendAppMessageResponse, messageType: string): SendAppMessageResponse {
  if (response.accepted) {
    return response;
  }
  throw createNimiError({
    message: `${messageType} was rejected`,
    reasonCode: reasonCodeName(response.reasonCode) || 'APP_SCOPE_FORBIDDEN',
    actionHint: 'check_runtime_agent_surface_access',
    source: 'runtime',
  });
}

async function resolveSubjectUserId(
  options: NimiRuntimeAgentTurnsModuleOptions,
  explicit?: unknown,
): Promise<string> {
  const explicitSubject = optionalString(explicit);
  if (explicitSubject) {
    return explicitSubject;
  }
  return resolveNimiRuntimeAgentSubjectUserId(
    options.getSubjectUserId,
    'Runtime Agent turn module requires authenticated subject user id.',
  );
}

async function withTurnScopes<T>(
  options: NimiRuntimeAgentTurnsModuleOptions,
  subjectUserId: string,
  scopes: readonly string[],
  operation: (callOptions: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  return withNimiRuntimeAgentScopes({
    runtime: options.runtime,
    subjectUserId,
    withScopes: options.withScopes,
  }, scopes, operation);
}

function localIdentity(input: RuntimeLocalAgentIdentityInput) {
  return projectRuntimeLocalAgentIdentity(input);
}

function requestContext(input: {
  readonly runtimeAppId: string;
  readonly subjectUserId: string;
  readonly localAgentRef: string;
  readonly scopedBinding?: ScopedRuntimeBindingAttachment;
}) {
  return buildRuntimeAgentRequestContext(input);
}

function appMessageEvents(
  stream: AsyncIterable<AppMessageEvent>,
  request: NimiRuntimeAgentConsumeRequest,
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return projectRuntimeAgentEventStream(stream, (event) => {
    const projected = projectNimiRuntimeAgentAppMessageEvent(event);
    if (!projected) return null;
    const expectedAnchorId = optionalString(request.conversationAnchorId);
    if (expectedAnchorId && projected.conversationAnchorId !== expectedAnchorId) {
      return null;
    }
    return projected;
  });
}

function projectRuntimeAgentEventStream<Input>(
  stream: AsyncIterable<Input>,
  project: (event: Input) => NimiRuntimeAgentConsumeEvent | null,
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<NimiRuntimeAgentConsumeEvent> {
      const iterator = stream[Symbol.asyncIterator]();
      let closed = false;
      return {
        next: async () => {
          while (!closed) {
            const next = await iterator.next();
            if (next.done) {
              return { done: true, value: undefined };
            }
            const projected = project(next.value);
            if (projected) {
              return { done: false, value: projected };
            }
          }
          return { done: true, value: undefined };
        },
        return: async () => {
          closed = true;
          await Promise.resolve(iterator.return?.()).catch(() => undefined);
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function agentEvents(
  stream: AsyncIterable<unknown>,
  request: NimiRuntimeAgentConsumeRequest,
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return projectRuntimeAgentEventStream(stream, (event) => {
    const projected = projectNimiRuntimeAgentServiceEvent(event as Parameters<typeof projectNimiRuntimeAgentServiceEvent>[0]);
    const expectedAnchorId = optionalString(request.conversationAnchorId);
    const projectedAnchorId = optionalString((projected as { readonly conversationAnchorId?: unknown }).conversationAnchorId);
    if (expectedAnchorId && projectedAnchorId && projectedAnchorId !== expectedAnchorId) {
      return null;
    }
    return projected;
  });
}

function mergeAsyncIterables<T>(sources: readonly AsyncIterable<T>[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      const iterators = sources.map((source) => source[Symbol.asyncIterator]());
      const never = new Promise<{ index: number; result: IteratorResult<T> }>(() => undefined);
      const nexts = iterators.map((iterator, index) => iterator.next().then((result) => ({ index, result })));
      let active = iterators.length;
      try {
        while (active > 0) {
          const { index, result } = await Promise.race(nexts);
          if (result.done) {
            active -= 1;
            nexts[index] = never;
            continue;
          }
          nexts[index] = iterators[index]!.next().then((nextResult) => ({ index, result: nextResult }));
          yield result.value;
        }
      } finally {
        await Promise.allSettled(
          iterators.map((iterator) => iterator.return?.()),
        );
      }
    },
  };
}

export function createNimiRuntimeAgentTurnsModule(
  options: NimiRuntimeAgentTurnsModuleOptions,
): NimiRuntimeAgentTurnsModule {
  const runtime = options.runtime;
  return {
    async subscribe(request) {
      const identity = localIdentity(request);
      const conversationAnchorId = optionalString(request.conversationAnchorId);
      const cursor = optionalRuntimeCursor(request.cursor);
      const scopedBinding = toScopedBindingAttachment(request.scopedBinding, {
        runtimeAppId: runtime.appId,
        localAgentRef: identity.localAgentRef,
        conversationAnchorId,
      });
      const subjectUserId = await resolveSubjectUserId(options, request.subjectUserId || identity.ownerUserId);
      const appStream = await withTurnScopes(options, subjectUserId, [TURN_READ_SCOPE], async (callOptions) =>
        runtime.appMessages.subscribeAppMessages({
          appId: runtime.appId,
          subjectUserId: scopedBinding ? '' : subjectUserId,
          scopedBinding,
          cursor,
          fromAppIds: [RUNTIME_AGENT_APP_ID],
        }, callOptions),
      );
      const includeAgentEvents = request.includeAgentEvents !== false;
      const agentStream = includeAgentEvents
        ? await withTurnScopes(options, subjectUserId, [AGENT_READ_SCOPE], async (callOptions) =>
          runtime.agents.subscribeAgentEvents({
            agentId: '',
            cursor,
            eventFilters: [1, 2, 3],
            context: requestContext({
              runtimeAppId: runtime.appId,
              subjectUserId,
              localAgentRef: identity.localAgentRef,
              scopedBinding,
            }),
          }, callOptions),
        )
        : null;
      const sources = agentStream
        ? [appMessageEvents(appStream, request), agentEvents(agentStream, request)]
        : [appMessageEvents(appStream, request)];
      return mergeAsyncIterables(sources);
    },
    async request(request) {
      const identity = localIdentity(request);
      const scopedBinding = toScopedBindingAttachment(request.scopedBinding, {
        runtimeAppId: runtime.appId,
        localAgentRef: identity.localAgentRef,
        conversationAnchorId: request.conversationAnchorId,
        worldId: request.worldId,
      });
      const payload = toNimiRuntimeProtoStruct(buildNimiRuntimeAgentTurnPayload(request));
      const subjectUserId = await resolveSubjectUserId(options, identity.ownerUserId);
      const response = await withTurnScopes(options, subjectUserId, [TURN_WRITE_SCOPE], async (callOptions) =>
        runtime.appMessages.sendAppMessage({
          fromAppId: runtime.appId,
          toAppId: RUNTIME_AGENT_APP_ID,
          subjectUserId: scopedBinding ? '' : subjectUserId,
          scopedBinding,
          messageType: TURN_REQUEST_TYPE,
          payload,
          requireAck: false,
        }, callOptions),
      );
      return assertAccepted(response, TURN_REQUEST_TYPE);
    },
    async interrupt(request) {
      const identity = localIdentity(request);
      const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
      const scopedBinding = toScopedBindingAttachment(request.scopedBinding, {
        runtimeAppId: runtime.appId,
        localAgentRef: identity.localAgentRef,
        conversationAnchorId,
        worldId: request.worldId,
      });
      const payload = toNimiRuntimeProtoStruct({
        conversation_anchor_id: conversationAnchorId,
        ...(optionalString(request.turnId) ? { turn_id: optionalString(request.turnId) } : {}),
        ...(optionalString(request.reason) ? { reason: optionalString(request.reason) } : {}),
      });
      const subjectUserId = await resolveSubjectUserId(options, identity.ownerUserId);
      const response = await withTurnScopes(options, subjectUserId, [TURN_WRITE_SCOPE], async (callOptions) =>
        runtime.appMessages.sendAppMessage({
          fromAppId: runtime.appId,
          toAppId: RUNTIME_AGENT_APP_ID,
          subjectUserId: scopedBinding ? '' : subjectUserId,
          scopedBinding,
          messageType: TURN_INTERRUPT_TYPE,
          payload,
          requireAck: false,
        }, callOptions),
      );
      return assertAccepted(response, TURN_INTERRUPT_TYPE);
    },
    async getSessionSnapshot(request) {
      const identity = localIdentity(request);
      const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
      const scopedBinding = toScopedBindingAttachment(request.scopedBinding, {
        runtimeAppId: runtime.appId,
        localAgentRef: identity.localAgentRef,
        conversationAnchorId,
        worldId: request.worldId,
      });
      const subjectUserId = await resolveSubjectUserId(options, identity.ownerUserId);
      const response = await withTurnScopes(options, subjectUserId, [AGENT_READ_SCOPE], async (callOptions) =>
        runtime.agents.getPublicChatSessionSnapshot({
          agentId: identity.localAgentRef,
          conversationAnchorId,
          requestId: optionalString(request.requestId) || '',
          worldId: optionalString(request.worldId) || '',
          context: requestContext({
            runtimeAppId: runtime.appId,
            subjectUserId,
            localAgentRef: identity.localAgentRef,
            scopedBinding,
          }),
        }, callOptions),
      );
      return parseNimiRuntimeAgentSessionSnapshot(response.snapshot);
    },
  };
}
