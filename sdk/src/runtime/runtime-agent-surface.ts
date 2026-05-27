import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import {
  asRecord,
  normalizeText,
  parseCount,
  toIsoFromTimestamp,
  toProtoStruct,
} from './helpers.js';
import { Struct } from './generated/google/protobuf/struct.js';
import {
  AgentEventType,
  AgentExecutionState,
  type GetPublicChatSessionSnapshotRequest,
  AgentStateEventFamily,
  HookAdmissionState,
  HookEffect,
  HookTriggerFamily,
  type AgentEvent,
  type AgentPostureProjection,
  type HookTriggerDetail,
} from './generated/runtime/v1/agent_service.js';
import type { ScopedRuntimeBindingAttachment } from './generated/runtime/v1/common.js';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from './types.js';
import type {
  RuntimeAgentAnchorsModule,
  RuntimeAgentConsumeEvent,
  RuntimeAgentConsumeRequest,
  RuntimeAgentLocalIdentity,
  RuntimeAgentMessage,
  RuntimeAgentModule,
  RuntimeAgentSessionSnapshotRequest,
  RuntimeScopedBindingAttachment,
  RuntimeAgentTurnInterruptRequest,
  RuntimeAgentTurnRequest,
  RuntimeAgentTurnsModule,
} from './types-runtime-agent.js';
import type { RuntimeAgentClient } from './types-client-interfaces.js';
import type { SendAppMessageResponse } from './generated/runtime/v1/app.js';
import { fromProtoStruct, matchesConsumeRequest, mergeAsyncIterables, parseAgentConsumeEvent, parseAppConsumeEvent, parseSessionSnapshot } from './runtime-agent-surface-parsers.js';
const RUNTIME_AGENT_APP_ID = 'runtime.agent';
const AGENT_READ_SCOPE = 'runtime.agent.read';
const AGENT_WRITE_SCOPE = 'runtime.agent.write';
const TURN_WRITE_SCOPE = 'runtime.agent.turn.write';
const TURN_READ_SCOPE = 'runtime.agent.turn.read';
const TURN_REQUEST_TYPE = 'runtime.agent.turn.request';
const TURN_INTERRUPT_TYPE = 'runtime.agent.turn.interrupt';
const TURN_ROUTES = new Set(['local', 'cloud']);
type RuntimeAgentHookEventName =
  | 'runtime.agent.hook.intent_proposed'
  | 'runtime.agent.hook.pending'
  | 'runtime.agent.hook.rejected'
  | 'runtime.agent.hook.running'
  | 'runtime.agent.hook.completed'
  | 'runtime.agent.hook.failed'
  | 'runtime.agent.hook.canceled'
  | 'runtime.agent.hook.rescheduled';
const CONSUME_MESSAGE_TYPES = new Set<string>([
  'runtime.agent.turn.accepted',
  'runtime.agent.turn.started',
  'runtime.agent.turn.reasoning_delta',
  'runtime.agent.turn.text_delta',
  'runtime.agent.turn.structured',
  'runtime.agent.turn.message_committed',
  'runtime.agent.turn.post_turn',
  'runtime.agent.turn.completed',
  'runtime.agent.turn.failed',
  'runtime.agent.turn.interrupted',
  'runtime.agent.turn.interrupt_ack',
  'runtime.agent.presentation.activity_requested',
  'runtime.agent.presentation.motion_requested',
  'runtime.agent.presentation.expression_requested',
  'runtime.agent.presentation.pose_requested',
  'runtime.agent.presentation.pose_cleared',
  'runtime.agent.presentation.lookat_requested',
  'runtime.agent.presentation.voice_playback_requested',
  'runtime.agent.presentation.lipsync_frame_batch',
]);
type RuntimeAgentAppClient = {
  sendMessage(request: {
    fromAppId: string;
    toAppId: string;
    subjectUserId?: string;
    scopedBinding?: ScopedRuntimeBindingAttachment;
    messageType: string;
    payload?: Struct;
    requireAck?: boolean;
  }, options?: RuntimeCallOptions): Promise<SendAppMessageResponse>;
  subscribeMessages(request: {
    appId: string;
    subjectUserId?: string;
    scopedBinding?: ScopedRuntimeBindingAttachment;
    cursor?: string;
    fromAppIds?: string[];
  }, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<{
    fromAppId?: string;
    toAppId?: string;
    messageType?: string;
    payload?: Struct;
  }>>;
};
type ProtectedScopeHelper = {
  getCallOptions(scopes: readonly string[], baseOptions?: RuntimeCallOptions): Promise<RuntimeCallOptions>;
  withScopes<T>(
    scopes: readonly string[],
    operation: (options: RuntimeCallOptions) => Promise<T>,
    baseOptions?: RuntimeCallOptions,
  ): Promise<T>;
};
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function toScopedBindingAttachment(
  input: RuntimeScopedBindingAttachment | undefined,
  defaults: {
    runtimeAppId: string;
    localAgentRef?: string;
    conversationAnchorId?: string;
    worldId?: string;
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
    agentId: optionalString(input?.localAgentRef) || optionalString(defaults.localAgentRef) || '',
    conversationAnchorId: optionalString(input?.conversationAnchorId) || optionalString(defaults.conversationAnchorId) || '',
    worldId: optionalString(input?.worldId) || optionalString(defaults.worldId) || '',
  };
}
function runtimeAgentInputError(message: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint,
    source: 'sdk',
  });
}

function requireLocalAgentIdentity(
  input: Partial<RuntimeAgentLocalIdentity> & { agentId?: unknown },
  actionHint = 'provide_runtime_agent_local_identity',
): RuntimeAgentLocalIdentity {
  if (optionalString(input.agentId)) {
    runtimeAgentInputError('runtime agent request must use localAgentRef, not agentId', actionHint);
  }
  const ownerUserId = optionalString(input.ownerUserId);
  if (!ownerUserId) {
    runtimeAgentInputError('runtime agent request requires ownerUserId', actionHint);
  }
  const realmAgentId = optionalString(input.realmAgentId);
  if (!realmAgentId) {
    runtimeAgentInputError('runtime agent request requires realmAgentId', actionHint);
  }
  const localAgentRef = optionalString(input.localAgentRef);
  if (!localAgentRef) {
    runtimeAgentInputError('runtime agent request requires localAgentRef', actionHint);
  }
  if (!localAgentRef.startsWith('local-agent:')) {
    runtimeAgentInputError('runtime agent request localAgentRef is malformed', actionHint);
  }
  if (localAgentRef === realmAgentId) {
    runtimeAgentInputError('runtime agent request localAgentRef must not be bare realmAgentId', actionHint);
  }
  const expected = `local-agent:${ownerUserId}:${realmAgentId}`;
  if (localAgentRef !== expected) {
    runtimeAgentInputError('runtime agent request localAgentRef must match ownerUserId and realmAgentId', actionHint);
  }
  return { ownerUserId, realmAgentId, localAgentRef };
}

function runtimeAgentRequestContext(
  appId: string,
  subjectUserId: string,
  identity: RuntimeAgentLocalIdentity,
  scopedBinding?: ScopedRuntimeBindingAttachment,
) {
  return {
    appId,
    subjectUserId,
    ownerUserId: identity.ownerUserId,
    realmAgentId: identity.realmAgentId,
    localAgentRef: identity.localAgentRef,
    ...(scopedBinding ? { scopedBinding } : {}),
  };
}

function requireConversationAnchorId(anchorId: unknown, actionHint = 'open_runtime_agent_anchor_first'): string {
  const normalized = optionalString(anchorId);
  if (!normalized) {
    runtimeAgentInputError('runtime agent request requires conversationAnchorId', actionHint);
  }
  return normalized;
}

function requireAvatarInstanceId(avatarInstanceId: unknown, actionHint = 'provide_avatar_instance_id'): string {
  const normalized = optionalString(avatarInstanceId);
  if (!normalized) {
    runtimeAgentInputError('runtime agent request requires avatarInstanceId', actionHint);
  }
  return normalized;
}

function optionalRuntimeCursor(cursor: unknown): string {
  const normalized = optionalString(cursor);
  if (!normalized) {
    return '';
  }
  if (!/^\d+$/.test(normalized)) {
    runtimeAgentInputError('runtime agent stream cursor must be a non-negative integer string', 'use_runtime_agent_returned_cursor');
  }
  return normalized;
}

function normalizeTurnMessages(messages: RuntimeAgentTurnRequest['messages']): RuntimeAgentMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .map((message) => ({
      role: optionalString(message.role) as RuntimeAgentMessage['role'],
      content: optionalString(message.content) || '',
      ...(optionalString(message.name) ? { name: optionalString(message.name) } : {}),
    }))
    .filter((message) => Boolean(message.role && message.content));
}

function toTurnPayload(request: RuntimeAgentTurnRequest): Record<string, unknown> {
  const identity = requireLocalAgentIdentity(request);
  const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
  const messages = normalizeTurnMessages(request.messages);
  if (messages.length === 0) {
    runtimeAgentInputError('runtime agent turn request requires at least one non-empty message', 'provide_runtime_agent_turn_message');
  }
  const hasExecutionBinding = Boolean(request.executionBinding);
  const route = hasExecutionBinding ? normalizeText(request.executionBinding?.route).toLowerCase() : '';
  if (hasExecutionBinding && !TURN_ROUTES.has(route)) {
    runtimeAgentInputError('runtime agent turn request executionBinding.route must be local or cloud', 'select_runtime_agent_route');
  }
  const modelId = hasExecutionBinding ? normalizeText(request.executionBinding?.modelId) : '';
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
    messages: messages.map((message: RuntimeAgentMessage) => ({
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
function makeStreamOptions(base: RuntimeCallOptions, signal?: AbortSignal): RuntimeStreamCallOptions {
  return signal ? { ...base, signal } : base;
}
function baseCallOptions(options?: RuntimeCallOptions): RuntimeCallOptions {
  return options ? { ...options } : {};
}
function assertAccepted(response: SendAppMessageResponse, messageType: string): SendAppMessageResponse {
  if (response.accepted) {
    return response;
  }
  throw createNimiError({
    message: `${messageType} was rejected`,
    reasonCode: normalizeText(response.reasonCode) || ReasonCode.APP_SCOPE_FORBIDDEN,
    actionHint: 'check_runtime_agent_surface_access',
    source: 'runtime',
  });
}
export function createRuntimeAgentAnchorsModule(input: {
  appId: string;
  agent: RuntimeAgentClient;
  protectedAccess: ProtectedScopeHelper;
  resolveSubjectUserId: (explicit?: string) => Promise<string>;
}): RuntimeAgentAnchorsModule {
  return {
    async open(request, options) {
      const identity = requireLocalAgentIdentity(request);
      const subjectUserId = await input.resolveSubjectUserId(request.subjectUserId || identity.ownerUserId);
      const openOptions = options?.protectedAccessToken
        ? baseCallOptions(options)
        : await input.protectedAccess.getCallOptions([AGENT_WRITE_SCOPE], options);
      const response = await input.agent.openConversationAnchor({
        agentId: '',
        localAgentRef: identity.localAgentRef,
        ownerUserId: identity.ownerUserId,
        realmAgentId: identity.realmAgentId,
        subjectUserId,
        ...(request.metadata ? { metadata: toProtoStruct(request.metadata) } : {}),
        context: runtimeAgentRequestContext(input.appId, subjectUserId, identity),
      }, openOptions);
      if (!response.snapshot) {
        throw createNimiError({
          message: 'OpenConversationAnchor response missing snapshot',
          reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
          actionHint: 'check_runtime_agent_anchor_projection',
          source: 'sdk',
        });
      }
      return response.snapshot;
    },
    async getSnapshot(request, options) {
      const identity = requireLocalAgentIdentity(request);
      const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
      const subjectUserId = await input.resolveSubjectUserId(request.subjectUserId || identity.ownerUserId);
      const snapshotOptions = options?.protectedAccessToken
        ? baseCallOptions(options)
        : await input.protectedAccess.getCallOptions([AGENT_READ_SCOPE], options);
      const response = await input.agent.getConversationAnchorSnapshot({
        agentId: '',
        conversationAnchorId,
        context: runtimeAgentRequestContext(input.appId, subjectUserId, identity),
      }, snapshotOptions);
      if (!response.snapshot) {
        throw createNimiError({
          message: 'GetConversationAnchorSnapshot response missing snapshot',
          reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
          actionHint: 'check_runtime_agent_anchor_projection',
          source: 'sdk',
        });
      }
      return response.snapshot;
    },
    async registerAvatarLiveInstance(request, options) {
      const identity = requireLocalAgentIdentity(request);
      const avatarInstanceId = requireAvatarInstanceId(request.avatarInstanceId);
      const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
      const subjectUserId = await input.resolveSubjectUserId(request.subjectUserId || identity.ownerUserId);
      const registerOptions = options?.protectedAccessToken
        ? baseCallOptions(options)
        : await input.protectedAccess.getCallOptions([AGENT_WRITE_SCOPE], options);
      const response = await input.agent.registerAvatarLiveInstanceBinding({
        avatarInstanceId,
        conversationAnchorId,
        context: runtimeAgentRequestContext(input.appId, subjectUserId, identity),
      }, registerOptions);
      if (!response.binding || !response.snapshot) {
        throw createNimiError({
          message: 'RegisterAvatarLiveInstanceBinding response missing binding or snapshot',
          reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
          actionHint: 'check_runtime_agent_avatar_live_instance_binding',
          source: 'sdk',
        });
      }
      return { binding: response.binding, snapshot: response.snapshot };
    },
    async resolveAvatarLiveInstance(request, options) {
      const identity = requireLocalAgentIdentity(request);
      const avatarInstanceId = requireAvatarInstanceId(request.avatarInstanceId);
      const subjectUserId = await input.resolveSubjectUserId(request.subjectUserId || identity.ownerUserId);
      const resolveOptions = options?.protectedAccessToken
        ? baseCallOptions(options)
        : await input.protectedAccess.getCallOptions([AGENT_READ_SCOPE], options);
      const response = await input.agent.resolveAvatarLiveInstanceBinding({
        avatarInstanceId,
        context: runtimeAgentRequestContext(input.appId, subjectUserId, identity),
      }, resolveOptions);
      if (!response.binding || !response.snapshot) {
        throw createNimiError({
          message: 'ResolveAvatarLiveInstanceBinding response missing binding or snapshot',
          reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
          actionHint: 'check_runtime_agent_avatar_live_instance_binding',
          source: 'sdk',
        });
      }
      return { binding: response.binding, snapshot: response.snapshot };
    },
  };
}
export function createRuntimeAgentTurnsModule(input: {
  appId: string;
  agent: RuntimeAgentClient;
  app: RuntimeAgentAppClient;
  protectedAccess: ProtectedScopeHelper;
  resolveSubjectUserId: (explicit?: string) => Promise<string>;
}): RuntimeAgentTurnsModule {
  return {
    async subscribe(request, options) {
      const identity = requireLocalAgentIdentity(request);
      const conversationAnchorId = optionalString(request.conversationAnchorId);
      const cursor = optionalRuntimeCursor(request.cursor);
      const scopedBinding = toScopedBindingAttachment(request.scopedBinding, {
        runtimeAppId: input.appId,
        localAgentRef: identity.localAgentRef,
        conversationAnchorId,
      });
      const subjectUserId = scopedBinding ? undefined : await input.resolveSubjectUserId(request.subjectUserId);
      // A scoped binding identifies the avatar surface but does NOT replace the
      // protected access token that the runtime authz interceptor requires for
      // capability validation. Always issue a protected token; the binding rides
      // alongside as an extra carrier on the request.
      const subscribeBaseOptions = await input.protectedAccess.getCallOptions([TURN_READ_SCOPE], options);
      const appStreamHandle = await input.app.subscribeMessages({
        appId: input.appId,
        ...(subjectUserId ? { subjectUserId } : {}),
        ...(scopedBinding ? { scopedBinding } : {}),
        cursor,
        fromAppIds: [RUNTIME_AGENT_APP_ID],
      }, makeStreamOptions(subscribeBaseOptions, options?.signal));
      const includeAgentEvents = request.includeAgentEvents !== false;
      const agentSubscribeOptions = includeAgentEvents
        ? await input.protectedAccess.getCallOptions([AGENT_READ_SCOPE], options)
        : null;
      const agentStreamHandle = includeAgentEvents
        ? await input.agent.subscribeEvents({
          agentId: '',
          cursor,
          eventFilters: [AgentEventType.HOOK, AgentEventType.STATE, AgentEventType.PRESENTATION],
          context: scopedBinding
            ? runtimeAgentRequestContext(input.appId, '', identity, scopedBinding)
            : runtimeAgentRequestContext(input.appId, subjectUserId || '', identity),
        }, makeStreamOptions(agentSubscribeOptions || {}, options?.signal))
        : null;
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<RuntimeAgentConsumeEvent> {
          const appEvents = {
            async *[Symbol.asyncIterator](): AsyncIterator<RuntimeAgentConsumeEvent> {
              for await (const event of appStreamHandle) {
                const messageType = normalizeText(event.messageType);
                if (!CONSUME_MESSAGE_TYPES.has(messageType)) {
                  continue;
                }
                yield parseAppConsumeEvent(messageType, fromProtoStruct(event.payload));
              }
            },
          };
          const agentEvents = agentStreamHandle
            ? {
              async *[Symbol.asyncIterator](): AsyncIterator<RuntimeAgentConsumeEvent> {
                for await (const event of agentStreamHandle) {
                  yield parseAgentConsumeEvent(event);
                }
              },
            }
            : null;
          const sources = agentEvents ? [appEvents, agentEvents] : [appEvents];
          for await (const event of mergeAsyncIterables(sources)) {
            if (!matchesConsumeRequest(event, request)) {
              continue;
            }
            yield event;
          }
        },
      };
    },
    async request(request, options) {
      const identity = requireLocalAgentIdentity(request);
      const scopedBinding = toScopedBindingAttachment(request.scopedBinding, {
        runtimeAppId: input.appId,
        localAgentRef: identity.localAgentRef,
        conversationAnchorId: request.conversationAnchorId,
        worldId: request.worldId,
      });
      const payload = toProtoStruct(toTurnPayload(request));
      const response = await input.protectedAccess.withScopes([TURN_WRITE_SCOPE], async (writeOptions) => {
        const subjectUserId = scopedBinding ? undefined : await input.resolveSubjectUserId(undefined);
        return input.app.sendMessage({
          fromAppId: input.appId,
          toAppId: RUNTIME_AGENT_APP_ID,
          ...(subjectUserId ? { subjectUserId } : {}),
          ...(scopedBinding ? { scopedBinding } : {}),
          messageType: TURN_REQUEST_TYPE,
          payload,
          requireAck: false,
        }, writeOptions);
      }, options);
      return assertAccepted(response, TURN_REQUEST_TYPE);
    },
    async interrupt(request, options) {
      const identity = requireLocalAgentIdentity(request);
      const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
      const scopedBinding = toScopedBindingAttachment(request.scopedBinding, {
        runtimeAppId: input.appId,
        localAgentRef: identity.localAgentRef,
        conversationAnchorId,
        worldId: request.worldId,
      });
      const payload = toProtoStruct({
        conversation_anchor_id: conversationAnchorId,
        ...(optionalString(request.turnId) ? { turn_id: optionalString(request.turnId) } : {}),
        ...(optionalString(request.reason) ? { reason: optionalString(request.reason) } : {}),
      });
      const response = await input.protectedAccess.withScopes([TURN_WRITE_SCOPE], async (writeOptions) => {
        const subjectUserId = scopedBinding ? undefined : await input.resolveSubjectUserId(undefined);
        return input.app.sendMessage({
          fromAppId: input.appId,
          toAppId: RUNTIME_AGENT_APP_ID,
          ...(subjectUserId ? { subjectUserId } : {}),
          ...(scopedBinding ? { scopedBinding } : {}),
          messageType: TURN_INTERRUPT_TYPE,
          payload,
          requireAck: false,
        }, writeOptions);
      }, options);
      return assertAccepted(response, TURN_INTERRUPT_TYPE);
    },
    async getSessionSnapshot(request, options) {
      const identity = requireLocalAgentIdentity(request);
      const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
      const requestId = optionalString(request.requestId);
      const scopedBinding = toScopedBindingAttachment(request.scopedBinding, {
        runtimeAppId: input.appId,
        localAgentRef: identity.localAgentRef,
        conversationAnchorId,
        worldId: request.worldId,
      });
      const subjectUserId = scopedBinding ? undefined : await input.resolveSubjectUserId(undefined);
      // Always issue a protected access token even when a scoped binding is attached;
      // the runtime gRPC authz interceptor enforces capability-bound tokens, the binding
      // only carries scope/anchor/window relations.
      const callOptions = await input.protectedAccess.getCallOptions([AGENT_READ_SCOPE], options);
      const snapshotRequest: GetPublicChatSessionSnapshotRequest = {
        agentId: identity.localAgentRef,
        conversationAnchorId,
        requestId: requestId || '',
        worldId: optionalString(request.worldId) || '',
        context: scopedBinding
          ? runtimeAgentRequestContext(input.appId, '', identity, scopedBinding)
          : runtimeAgentRequestContext(input.appId, subjectUserId || '', identity),
      };
      const response = await input.agent.getPublicChatSessionSnapshot(snapshotRequest, callOptions);
      return parseSessionSnapshot(fromProtoStruct(response.snapshot));
    },
  };
}
export function attachRuntimeAgentSurface(
  agent: RuntimeAgentClient,
  surface: {
    anchors: RuntimeAgentAnchorsModule;
    turns: RuntimeAgentTurnsModule;
  },
): RuntimeAgentModule {
  return {
    ...agent,
    anchors: surface.anchors,
    turns: surface.turns,
  };
}
