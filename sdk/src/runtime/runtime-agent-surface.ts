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
  AgentStateEventFamily,
  HookAdmissionState,
  HookEffect,
  HookTriggerFamily,
  type AgentEvent,
  type AgentPostureProjection,
  type HookTriggerDetail,
} from './generated/runtime/v1/agent_service.js';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from './types.js';
import type {
  RuntimeAgentAnchorsModule,
  RuntimeAgentConsumeEvent,
  RuntimeAgentConsumeRequest,
  RuntimeAgentMessage,
  RuntimeAgentModule,
  RuntimeAgentSessionSnapshotRequest,
  RuntimeAgentTurnInterruptRequest,
  RuntimeAgentTurnRequest,
  RuntimeAgentTurnsModule,
} from './types-runtime-modules.js';
import type { RuntimeAgentClient } from './types-client-interfaces.js';
import type { SendAppMessageResponse } from './generated/runtime/v1/app.js';
import { fromProtoStruct, matchesConsumeRequest, mergeAsyncIterables, parseAgentConsumeEvent, parseAppConsumeEvent } from './runtime-agent-surface-parsers.js';
const RUNTIME_AGENT_APP_ID = 'runtime.agent';
const AGENT_READ_SCOPE = 'runtime.agent.read';
const TURN_WRITE_SCOPE = 'runtime.agent.turn.write';
const TURN_READ_SCOPE = 'runtime.agent.turn.read';
const TURN_REQUEST_TYPE = 'runtime.agent.turn.request';
const TURN_INTERRUPT_TYPE = 'runtime.agent.turn.interrupt';
const SESSION_SNAPSHOT_REQUEST_TYPE = 'runtime.agent.session.snapshot.request';
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
  'runtime.agent.session.snapshot',
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
    subjectUserId: string;
    messageType: string;
    payload?: Struct;
    requireAck?: boolean;
  }, options?: RuntimeCallOptions): Promise<SendAppMessageResponse>;
  subscribeMessages(request: {
    appId: string;
    subjectUserId?: string;
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
function toTurnPayload(request: RuntimeAgentTurnRequest): Record<string, unknown> {
  return {
    agent_id: request.agentId,
    conversation_anchor_id: request.conversationAnchorId,
    ...(optionalString(request.requestId) ? { request_id: optionalString(request.requestId) } : {}),
    ...(optionalString(request.threadId) ? { thread_id: optionalString(request.threadId) } : {}),
    ...(optionalString(request.systemPrompt) ? { system_prompt: optionalString(request.systemPrompt) } : {}),
    ...(optionalString(request.worldId) ? { world_id: optionalString(request.worldId) } : {}),
    ...(optionalNumber(request.maxOutputTokens) !== undefined ? { max_output_tokens: optionalNumber(request.maxOutputTokens) } : {}),
    messages: (Array.isArray(request.messages) ? request.messages : []).map((message: RuntimeAgentMessage) => ({
      role: message.role,
      content: message.content,
      ...(optionalString(message.name) ? { name: optionalString(message.name) } : {}),
    })),
    execution_binding: {
      route: normalizeText(request.executionBinding.route),
      model_id: normalizeText(request.executionBinding.modelId),
      ...(optionalString(request.executionBinding.connectorId)
        ? { connector_id: optionalString(request.executionBinding.connectorId) }
        : {}),
    },
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
  resolveSubjectUserId: (explicit?: string) => Promise<string>;
}): RuntimeAgentAnchorsModule {
  return {
    async open(request, options) {
      const subjectUserId = await input.resolveSubjectUserId(request.subjectUserId);
      const response = await input.agent.openConversationAnchor({
        agentId: request.agentId,
        subjectUserId,
        ...(request.metadata ? { metadata: toProtoStruct(request.metadata) } : {}),
        context: {
          appId: input.appId,
          subjectUserId,
        },
      }, options);
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
      const subjectUserId = await input.resolveSubjectUserId(request.subjectUserId);
      const response = await input.agent.getConversationAnchorSnapshot({
        agentId: request.agentId,
        conversationAnchorId: request.conversationAnchorId,
        context: {
          appId: input.appId,
          subjectUserId,
        },
      }, options);
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
      const subjectUserId = await input.resolveSubjectUserId(request.subjectUserId);
      const subscribeBaseOptions = await input.protectedAccess.getCallOptions([TURN_READ_SCOPE], options);
      const appStreamHandle = await input.app.subscribeMessages({
        appId: input.appId,
        subjectUserId,
        cursor: optionalString(request.cursor) || '',
        fromAppIds: [RUNTIME_AGENT_APP_ID],
      }, makeStreamOptions(subscribeBaseOptions, options?.signal));
      const includeAgentEvents = request.includeAgentEvents !== false;
      const agentSubscribeOptions = includeAgentEvents
        ? await input.protectedAccess.getCallOptions([AGENT_READ_SCOPE], options)
        : null;
      const agentStreamHandle = includeAgentEvents
        ? await input.agent.subscribeEvents({
          agentId: request.agentId,
          cursor: optionalString(request.cursor) || '',
          eventFilters: [AgentEventType.HOOK, AgentEventType.STATE],
          context: {
            appId: input.appId,
            subjectUserId,
          },
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
      const subjectUserId = await input.resolveSubjectUserId(undefined);
      const response = await input.protectedAccess.withScopes([TURN_WRITE_SCOPE], (writeOptions) => input.app.sendMessage({
        fromAppId: input.appId,
        toAppId: RUNTIME_AGENT_APP_ID,
        subjectUserId,
        messageType: TURN_REQUEST_TYPE,
        payload: toProtoStruct(toTurnPayload(request)),
        requireAck: false,
      }, writeOptions), options);
      return assertAccepted(response, TURN_REQUEST_TYPE);
    },
    async interrupt(request, options) {
      const subjectUserId = await input.resolveSubjectUserId(undefined);
      const response = await input.protectedAccess.withScopes([TURN_WRITE_SCOPE], (writeOptions) => input.app.sendMessage({
        fromAppId: input.appId,
        toAppId: RUNTIME_AGENT_APP_ID,
        subjectUserId,
        messageType: TURN_INTERRUPT_TYPE,
        payload: toProtoStruct({
          conversation_anchor_id: request.conversationAnchorId,
          ...(optionalString(request.turnId) ? { turn_id: optionalString(request.turnId) } : {}),
          ...(optionalString(request.reason) ? { reason: optionalString(request.reason) } : {}),
        }),
        requireAck: false,
      }, writeOptions), options);
      return assertAccepted(response, TURN_INTERRUPT_TYPE);
    },
    async getSessionSnapshot(request, options) {
      const subjectUserId = await input.resolveSubjectUserId(undefined);
      const requestId = optionalString(request.requestId);
      const subscribeBaseOptions = await input.protectedAccess.getCallOptions([TURN_READ_SCOPE], options);
      const streamHandle = await input.app.subscribeMessages({
        appId: input.appId,
        subjectUserId,
        cursor: '',
        fromAppIds: [RUNTIME_AGENT_APP_ID],
      }, makeStreamOptions(subscribeBaseOptions, options?.signal));
      await input.protectedAccess.withScopes([TURN_WRITE_SCOPE], (writeOptions) => input.app.sendMessage({
        fromAppId: input.appId,
        toAppId: RUNTIME_AGENT_APP_ID,
        subjectUserId,
        messageType: SESSION_SNAPSHOT_REQUEST_TYPE,
        payload: toProtoStruct({
          conversation_anchor_id: request.conversationAnchorId,
          ...(requestId ? { request_id: requestId } : {}),
        }),
        requireAck: false,
      }, writeOptions), options);
      for await (const event of streamHandle) {
        const messageType = normalizeText(event.messageType);
        if (messageType !== 'runtime.agent.session.snapshot') {
          continue;
        }
        const parsed = parseAppConsumeEvent(messageType, fromProtoStruct(event.payload));
        if (parsed.eventName !== 'runtime.agent.session.snapshot') {
          continue;
        }
        if (parsed.agentId !== request.agentId || parsed.conversationAnchorId !== request.conversationAnchorId) {
          continue;
        }
        if (requestId && parsed.detail.snapshot.requestId !== requestId) {
          continue;
        }
        return parsed.detail.snapshot;
      }
      throw createNimiError({
        message: `runtime.agent.session.snapshot unavailable for anchor ${request.conversationAnchorId}`,
        reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: 'retry_runtime_agent_session_snapshot',
        source: 'runtime',
      });
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
