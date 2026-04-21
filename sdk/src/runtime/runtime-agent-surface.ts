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
import { ReasonCode as RuntimeProtoReasonCode } from './generated/runtime/v1/common.js';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from './types.js';
import type {
  RuntimeAgentAnchorsModule,
  RuntimeAgentConsumeEvent,
  RuntimeAgentConsumeRequest,
  RuntimeAgentExecutionBinding,
  RuntimeAgentHookAdmissionState,
  RuntimeAgentMessage,
  RuntimeAgentModule,
  RuntimeAgentPendingFollowUpSnapshot,
  RuntimeAgentReasoningConfig,
  RuntimeAgentSessionSnapshot,
  RuntimeAgentSessionSnapshotRequest,
  RuntimeAgentSessionTurnSnapshot,
  RuntimeAgentTurnInterruptRequest,
  RuntimeAgentTurnRequest,
  RuntimeAgentTurnsModule,
} from './types-runtime-modules.js';
import type { RuntimeAgentClient } from './types-client-interfaces.js';
import type { SendAppMessageResponse } from './generated/runtime/v1/app.js';

const RUNTIME_AGENT_APP_ID = 'runtime.agent';
const TURN_WRITE_SCOPE = 'runtime.agent.chat.write';
const TURN_READ_SCOPE = 'runtime.agent.chat.read';

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

function fromProtoStruct(payload?: Struct): Record<string, unknown> {
  if (!payload) {
    return {};
  }
  return Struct.toJson(payload) as Record<string, unknown>;
}

function expectString(value: unknown, fieldName: string, messageType: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `${messageType} requires ${fieldName}`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_projection_shape',
      source: 'sdk',
    });
  }
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function optionalContentString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return parseCount(value);
}

function parseExecutionBinding(value: unknown): RuntimeAgentExecutionBinding | undefined {
  const payload = asRecord(value);
  const route = normalizeText(payload.route) as RuntimeAgentExecutionBinding['route'] | '';
  const modelId = normalizeText(payload.model_id);
  if (!route || !modelId) {
    return undefined;
  }
  const connectorId = normalizeText(payload.connector_id);
  return {
    route,
    modelId,
    ...(connectorId ? { connectorId } : {}),
  };
}

function parseReasoning(value: unknown): RuntimeAgentReasoningConfig | undefined {
  const payload = asRecord(value);
  const mode = normalizeText(payload.mode) as RuntimeAgentReasoningConfig['mode'] | '';
  const traceMode = normalizeText(payload.trace_mode) as RuntimeAgentReasoningConfig['traceMode'] | '';
  const budgetTokens = optionalNumber(payload.budget_tokens);
  if (!mode && !traceMode && budgetTokens === undefined) {
    return undefined;
  }
  return {
    ...(mode ? { mode } : {}),
    ...(traceMode ? { traceMode } : {}),
    ...(budgetTokens !== undefined ? { budgetTokens } : {}),
  };
}

function parseTrace(value: unknown): RuntimeAgentSessionTurnSnapshot['trace'] | undefined {
  const payload = asRecord(value);
  const traceId = optionalString(payload.trace_id);
  const modelResolved = optionalString(payload.model_resolved);
  const routeDecision = optionalString(payload.route_decision) as RuntimeAgentExecutionBinding['route'] | undefined;
  if (!traceId && !modelResolved && !routeDecision) {
    return undefined;
  }
  return {
    ...(traceId ? { traceId } : {}),
    ...(modelResolved ? { modelResolved } : {}),
    ...(routeDecision ? { routeDecision } : {}),
  };
}

function parseTurnSnapshot(value: unknown): RuntimeAgentSessionTurnSnapshot | undefined {
  const payload = asRecord(value);
  const turnId = optionalString(payload.turn_id);
  if (!turnId) {
    return undefined;
  }
  return {
    turnId,
    ...(optionalString(payload.status) ? { status: optionalString(payload.status) } : {}),
    ...(optionalNumber(payload.stream_sequence) !== undefined ? { streamSequence: optionalNumber(payload.stream_sequence) } : {}),
    ...(optionalString(payload.turn_origin) ? { turnOrigin: optionalString(payload.turn_origin) } : {}),
    ...(optionalNumber(payload.follow_up_depth) !== undefined ? { followUpDepth: optionalNumber(payload.follow_up_depth) } : {}),
    ...(optionalNumber(payload.max_follow_up_turns) !== undefined ? { maxFollowUpTurns: optionalNumber(payload.max_follow_up_turns) } : {}),
    ...(typeof payload.output_observed === 'boolean' ? { outputObserved: payload.output_observed } : {}),
    ...(typeof payload.reasoning_observed === 'boolean' ? { reasoningObserved: payload.reasoning_observed } : {}),
    ...(optionalString(payload.updated_at) ? { updatedAt: optionalString(payload.updated_at) } : {}),
    ...(parseTrace(payload) ? { trace: parseTrace(payload) } : {}),
    ...(optionalString(payload.chain_id) ? { chainId: optionalString(payload.chain_id) } : {}),
    ...(optionalString(payload.source_turn_id) ? { sourceTurnId: optionalString(payload.source_turn_id) } : {}),
    ...(optionalString(payload.source_action_id) ? { sourceActionId: optionalString(payload.source_action_id) } : {}),
    ...(optionalString(payload.message_id) ? { messageId: optionalString(payload.message_id) } : {}),
    ...(optionalContentString(payload.text) !== undefined ? { text: optionalContentString(payload.text) } : {}),
    ...(Object.keys(asRecord(payload.structured)).length > 0 ? { structured: asRecord(payload.structured) } : {}),
    ...(Object.keys(asRecord(payload.assistant_memory)).length > 0 ? { assistantMemory: asRecord(payload.assistant_memory) } : {}),
    ...(Object.keys(asRecord(payload.chat_sidecar)).length > 0 ? { chatSidecar: asRecord(payload.chat_sidecar) } : {}),
    ...(Object.keys(asRecord(payload.follow_up)).length > 0 ? { followUp: asRecord(payload.follow_up) } : {}),
    ...(optionalString(payload.finish_reason) ? { finishReason: optionalString(payload.finish_reason) } : {}),
    ...(typeof payload.stream_simulated === 'boolean' ? { streamSimulated: payload.stream_simulated } : {}),
    ...(optionalString(payload.reason_code) ? { reasonCode: optionalString(payload.reason_code) } : {}),
    ...(optionalString(payload.action_hint) ? { actionHint: optionalString(payload.action_hint) } : {}),
    ...(optionalString(payload.message) ? { message: optionalString(payload.message) } : {}),
  };
}

function parsePendingFollowUp(value: unknown): RuntimeAgentPendingFollowUpSnapshot | undefined {
  const payload = asRecord(value);
  if (Object.keys(payload).length === 0) {
    return undefined;
  }
  return {
    ...(optionalString(payload.status) ? { status: optionalString(payload.status) } : {}),
    ...(optionalString(payload.follow_up_id) ? { followUpId: optionalString(payload.follow_up_id) } : {}),
    ...(optionalString(payload.scheduled_for) ? { scheduledFor: optionalString(payload.scheduled_for) } : {}),
    ...(optionalString(payload.chain_id) ? { chainId: optionalString(payload.chain_id) } : {}),
    ...(optionalNumber(payload.follow_up_depth) !== undefined ? { followUpDepth: optionalNumber(payload.follow_up_depth) } : {}),
    ...(optionalNumber(payload.max_follow_up_turns) !== undefined ? { maxFollowUpTurns: optionalNumber(payload.max_follow_up_turns) } : {}),
    ...(optionalString(payload.source_turn_id) ? { sourceTurnId: optionalString(payload.source_turn_id) } : {}),
    ...(optionalString(payload.source_action_id) ? { sourceActionId: optionalString(payload.source_action_id) } : {}),
  };
}

function parseSessionSnapshot(value: unknown): RuntimeAgentSessionSnapshot {
  const payload = asRecord(value);
  return {
    ...(optionalString(payload.request_id) ? { requestId: optionalString(payload.request_id) } : {}),
    ...(optionalString(payload.thread_id) ? { threadId: optionalString(payload.thread_id) } : {}),
    ...(optionalString(payload.subject_user_id) ? { subjectUserId: optionalString(payload.subject_user_id) } : {}),
    ...(optionalString(payload.session_status) ? { sessionStatus: optionalString(payload.session_status) } : {}),
    ...(optionalNumber(payload.transcript_message_count) !== undefined
      ? { transcriptMessageCount: optionalNumber(payload.transcript_message_count) }
      : {}),
    ...(parseExecutionBinding(payload.execution_binding) ? { executionBinding: parseExecutionBinding(payload.execution_binding) } : {}),
    ...(optionalString(payload.system_prompt) ? { systemPrompt: optionalString(payload.system_prompt) } : {}),
    ...(optionalNumber(payload.max_output_tokens) !== undefined ? { maxOutputTokens: optionalNumber(payload.max_output_tokens) } : {}),
    ...(parseReasoning(payload.reasoning) ? { reasoning: parseReasoning(payload.reasoning) } : {}),
    ...(parseTurnSnapshot(payload.active_turn) ? { activeTurn: parseTurnSnapshot(payload.active_turn) } : {}),
    ...(parseTurnSnapshot(payload.last_turn) ? { lastTurn: parseTurnSnapshot(payload.last_turn) } : {}),
    ...(parsePendingFollowUp(payload.pending_follow_up) ? { pendingFollowUp: parsePendingFollowUp(payload.pending_follow_up) } : {}),
  };
}

function toTurnPayload(request: RuntimeAgentTurnRequest): Record<string, unknown> {
  return {
    agent_id: request.agentId,
    conversation_anchor_id: request.conversationAnchorId,
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

function durationToMilliseconds(value: unknown): number | undefined {
  const payload = asRecord(value);
  const seconds = parseCount(payload.seconds);
  const nanos = typeof payload.nanos === 'number' ? payload.nanos : undefined;
  if (seconds === undefined && nanos === undefined) {
    return undefined;
  }
  return ((seconds ?? 0) * 1000) + Math.trunc((nanos ?? 0) / 1_000_000);
}

function parsePostureProjection(value?: AgentPostureProjection): { actionFamily: string; interruptMode: string } | undefined {
  if (!value) {
    return undefined;
  }
  const actionFamily = normalizeText(value.actionFamily);
  const interruptMode = normalizeText(value.interruptMode);
  if (!actionFamily || !interruptMode) {
    return undefined;
  }
  return {
    actionFamily,
    interruptMode,
  };
}

function parseHookTriggerDetail(value?: HookTriggerDetail): Record<string, unknown> {
  switch (value?.detail.oneofKind) {
    case 'time':
      return {
        kind: 'time',
        ...(durationToMilliseconds(value.detail.time.delay) !== undefined
          ? { delayMs: durationToMilliseconds(value.detail.time.delay) }
          : {}),
      };
    case 'eventUserIdle':
      return {
        kind: 'event_user_idle',
        ...(durationToMilliseconds(value.detail.eventUserIdle.idleFor) !== undefined
          ? { idleForMs: durationToMilliseconds(value.detail.eventUserIdle.idleFor) }
          : {}),
      };
    case 'eventChatEnded':
      return {
        kind: 'event_chat_ended',
      };
    default:
      return {};
  }
}

function parseHookTriggerFamily(value: HookTriggerFamily): 'time' | 'event' | '' {
  switch (value) {
    case HookTriggerFamily.TIME:
      return 'time';
    case HookTriggerFamily.EVENT:
      return 'event';
    default:
      return '';
  }
}

function parseHookEffect(value: HookEffect): 'follow-up-turn' | '' {
  switch (value) {
    case HookEffect.FOLLOW_UP_TURN:
      return 'follow-up-turn';
    default:
      return '';
  }
}

function parseHookAdmissionState(
  value: HookAdmissionState,
): RuntimeAgentHookEventName | '' {
  switch (value) {
    case HookAdmissionState.PROPOSED:
      return 'runtime.agent.hook.intent_proposed';
    case HookAdmissionState.PENDING:
      return 'runtime.agent.hook.pending';
    case HookAdmissionState.REJECTED:
      return 'runtime.agent.hook.rejected';
    case HookAdmissionState.RUNNING:
      return 'runtime.agent.hook.running';
    case HookAdmissionState.COMPLETED:
      return 'runtime.agent.hook.completed';
    case HookAdmissionState.FAILED:
      return 'runtime.agent.hook.failed';
    case HookAdmissionState.CANCELED:
      return 'runtime.agent.hook.canceled';
    case HookAdmissionState.RESCHEDULED:
      return 'runtime.agent.hook.rescheduled';
    default:
      return '';
  }
}

function parseHookAdmissionStateValue(value: HookAdmissionState): RuntimeAgentHookAdmissionState | '' {
  switch (value) {
    case HookAdmissionState.PROPOSED:
      return 'proposed';
    case HookAdmissionState.PENDING:
      return 'pending';
    case HookAdmissionState.REJECTED:
      return 'rejected';
    case HookAdmissionState.RUNNING:
      return 'running';
    case HookAdmissionState.COMPLETED:
      return 'completed';
    case HookAdmissionState.FAILED:
      return 'failed';
    case HookAdmissionState.CANCELED:
      return 'canceled';
    case HookAdmissionState.RESCHEDULED:
      return 'rescheduled';
    default:
      return '';
  }
}

function parseExecutionState(
  value: AgentExecutionState,
): 'idle' | 'chat_active' | 'life_pending' | 'life_running' | 'suspended' | '' {
  switch (value) {
    case AgentExecutionState.IDLE:
      return 'idle';
    case AgentExecutionState.CHAT_ACTIVE:
      return 'chat_active';
    case AgentExecutionState.LIFE_PENDING:
      return 'life_pending';
    case AgentExecutionState.LIFE_RUNNING:
      return 'life_running';
    case AgentExecutionState.SUSPENDED:
      return 'suspended';
    default:
      return '';
  }
}

function optionalRuntimeReasonCode(value: RuntimeProtoReasonCode): string | undefined {
  if (value === RuntimeProtoReasonCode.REASON_CODE_UNSPECIFIED) {
    return undefined;
  }
  const normalized = RuntimeProtoReasonCode[value];
  return typeof normalized === 'string' ? normalized : undefined;
}

function eventHasConversationAnchor(
  event: RuntimeAgentConsumeEvent,
): event is RuntimeAgentConsumeEvent & { conversationAnchorId: string } {
  return typeof (event as { conversationAnchorId?: unknown }).conversationAnchorId === 'string'
    && normalizeText((event as { conversationAnchorId?: string }).conversationAnchorId).length > 0;
}

function matchesConsumeRequest(event: RuntimeAgentConsumeEvent, request: RuntimeAgentConsumeRequest): boolean {
  if (event.agentId !== request.agentId) {
    return false;
  }
  const requestedAnchorId = optionalString(request.conversationAnchorId);
  if (!requestedAnchorId) {
    return true;
  }
  return eventHasConversationAnchor(event) && event.conversationAnchorId === requestedAnchorId;
}

async function* mergeAsyncIterables<T>(iterables: AsyncIterable<T>[]): AsyncIterable<T> {
  const iterators = iterables.map((iterable) => iterable[Symbol.asyncIterator]());
  const idlePull = new Promise<{ index: number; result: IteratorResult<T> }>(() => {});
  const pulls = iterators.map((iterator, index) => iterator.next().then((result) => ({ index, result })));
  let active = pulls.length;

  try {
    while (active > 0) {
      const { index, result } = await Promise.race(pulls);
      if (result.done) {
        pulls[index] = idlePull;
        active -= 1;
        continue;
      }
      pulls[index] = iterators[index].next().then((nextResult) => ({ index, result: nextResult }));
      yield result.value;
    }
  } finally {
    await Promise.all(iterators.map(async (iterator) => {
      if (typeof iterator.return === 'function') {
        await iterator.return();
      }
    }));
  }
}

function parseAppConsumeEvent(messageType: string, payload: Record<string, unknown>): RuntimeAgentConsumeEvent {
  const agentId = expectString(payload.agent_id, 'agent_id', messageType);
  const conversationAnchorId = expectString(payload.conversation_anchor_id, 'conversation_anchor_id', messageType);
  const detail = asRecord(payload.detail);

  switch (messageType) {
    case 'runtime.agent.turn.accepted':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          requestId: expectString(detail.request_id, 'detail.request_id', messageType),
        },
      };
    case 'runtime.agent.turn.started': {
      const track = expectString(detail.track, 'detail.track', messageType);
      if (track !== 'chat' && track !== 'life') {
        throw createNimiError({
          message: `${messageType} detail.track must be chat or life`,
          reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
          actionHint: 'check_runtime_agent_projection_shape',
          source: 'sdk',
        });
      }
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: { track },
      };
    }
    case 'runtime.agent.turn.reasoning_delta':
    case 'runtime.agent.turn.text_delta':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          text: optionalContentString(detail.text) ?? '',
        },
      } as RuntimeAgentConsumeEvent;
    case 'runtime.agent.turn.structured':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          kind: expectString(detail.kind, 'detail.kind', messageType),
          payload: asRecord(detail.payload),
        },
      };
    case 'runtime.agent.turn.message_committed': {
      const messageId = expectString(payload.message_id || detail.message_id, 'message_id', messageType);
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        messageId,
        detail: {
          messageId,
          text: optionalContentString(detail.text) ?? '',
        },
      };
    }
    case 'runtime.agent.turn.post_turn':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          ...(Object.keys(asRecord(detail.action)).length > 0 ? { action: asRecord(detail.action) } : {}),
          ...(Object.keys(asRecord(detail.hook_intent)).length > 0 ? { hookIntent: asRecord(detail.hook_intent) } : {}),
        },
      };
    case 'runtime.agent.turn.completed':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          ...(optionalString(detail.terminal_reason) ? { terminalReason: optionalString(detail.terminal_reason) } : {}),
        },
      };
    case 'runtime.agent.turn.failed':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          reasonCode: expectString(detail.reason_code, 'detail.reason_code', messageType),
          ...(optionalString(detail.message) ? { message: optionalString(detail.message) } : {}),
        },
      };
    case 'runtime.agent.turn.interrupted':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          reason: expectString(detail.reason, 'detail.reason', messageType),
        },
      };
    case 'runtime.agent.turn.interrupt_ack':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          interruptedTurnId: expectString(detail.interrupted_turn_id, 'detail.interrupted_turn_id', messageType),
        },
      };
    case 'runtime.agent.session.snapshot':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        detail: {
          snapshot: parseSessionSnapshot(detail.snapshot),
        },
      };
    case 'runtime.agent.presentation.activity_requested':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          activityName: expectString(detail.activity_name, 'detail.activity_name', messageType),
          category: expectString(detail.category, 'detail.category', messageType),
          ...(optionalString(detail.intensity) ? { intensity: optionalString(detail.intensity) } : {}),
          source: expectString(detail.source, 'detail.source', messageType),
        },
      };
    case 'runtime.agent.presentation.motion_requested':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          motionId: expectString(detail.motion_id, 'detail.motion_id', messageType),
          ...(optionalString(detail.priority) ? { priority: optionalString(detail.priority) } : {}),
          ...(optionalNumber(detail.expected_duration_ms) !== undefined
            ? { expectedDurationMs: optionalNumber(detail.expected_duration_ms) }
            : {}),
        },
      };
    case 'runtime.agent.presentation.expression_requested':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          expressionId: expectString(detail.expression_id, 'detail.expression_id', messageType),
          ...(optionalNumber(detail.expected_duration_ms) !== undefined
            ? { expectedDurationMs: optionalNumber(detail.expected_duration_ms) }
            : {}),
        },
      };
    case 'runtime.agent.presentation.pose_requested':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          poseId: expectString(detail.pose_id, 'detail.pose_id', messageType),
          ...(optionalNumber(detail.expected_duration_ms) !== undefined
            ? { expectedDurationMs: optionalNumber(detail.expected_duration_ms) }
            : {}),
        },
      };
    case 'runtime.agent.presentation.pose_cleared':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          ...(optionalString(detail.previous_pose_id) ? { previousPoseId: optionalString(detail.previous_pose_id) } : {}),
        },
      };
    case 'runtime.agent.presentation.lookat_requested':
      return {
        eventName: messageType,
        agentId,
        conversationAnchorId,
        turnId: expectString(payload.turn_id, 'turn_id', messageType),
        streamId: expectString(payload.stream_id, 'stream_id', messageType),
        detail: {
          targetKind: expectString(detail.target_kind, 'detail.target_kind', messageType),
          ...(typeof detail.x === 'number' ? { x: detail.x } : {}),
          ...(typeof detail.y === 'number' ? { y: detail.y } : {}),
          ...(typeof detail.z === 'number' ? { z: detail.z } : {}),
        },
      };
    default:
      throw createNimiError({
        message: `unsupported runtime agent consume family: ${messageType}`,
        reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
        actionHint: 'check_runtime_agent_projection_shape',
        source: 'sdk',
      });
  }
}

function parseAgentConsumeEvent(event: AgentEvent): RuntimeAgentConsumeEvent {
  const agentId = normalizeText(event.agentId);
  if (!agentId) {
    throw createNimiError({
      message: 'runtime agent consume event requires agent_id',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_runtime_agent_projection_shape',
      source: 'sdk',
    });
  }

  switch (event.detail.oneofKind) {
    case 'state': {
      const detail = event.detail.state;
      const origin = {
        ...(optionalString(detail.conversationAnchorId) ? { conversationAnchorId: optionalString(detail.conversationAnchorId) } : {}),
        ...(optionalString(detail.originatingTurnId) ? { originatingTurnId: optionalString(detail.originatingTurnId) } : {}),
        ...(optionalString(detail.originatingStreamId) ? { originatingStreamId: optionalString(detail.originatingStreamId) } : {}),
      };
      switch (detail.family) {
        case AgentStateEventFamily.STATUS_TEXT_CHANGED:
          return {
            eventName: 'runtime.agent.state.status_text_changed',
            agentId,
            ...origin,
            detail: {
              currentStatusText: normalizeText(detail.currentStatusText),
              ...(detail.hasPreviousStatusText && normalizeText(detail.previousStatusText)
                ? { previousStatusText: normalizeText(detail.previousStatusText) }
                : {}),
            },
          };
        case AgentStateEventFamily.EXECUTION_STATE_CHANGED: {
          const currentExecutionState = parseExecutionState(detail.currentExecutionState);
          if (!currentExecutionState) {
            break;
          }
          const previousExecutionState = parseExecutionState(detail.previousExecutionState);
          return {
            eventName: 'runtime.agent.state.execution_state_changed',
            agentId,
            ...origin,
            detail: {
              currentExecutionState,
              ...(previousExecutionState ? { previousExecutionState } : {}),
            },
          };
        }
        case AgentStateEventFamily.EMOTION_CHANGED:
          return {
            eventName: 'runtime.agent.state.emotion_changed',
            agentId,
            ...origin,
            detail: {
              currentEmotion: normalizeText(detail.currentEmotion),
              ...(normalizeText(detail.previousEmotion) ? { previousEmotion: normalizeText(detail.previousEmotion) } : {}),
              source: normalizeText(detail.emotionSource),
            },
          };
        case AgentStateEventFamily.POSTURE_CHANGED: {
          const currentPosture = parsePostureProjection(detail.currentPosture);
          if (!currentPosture) {
            break;
          }
          const previousPosture = parsePostureProjection(detail.previousPosture);
          return {
            eventName: 'runtime.agent.state.posture_changed',
            agentId,
            ...origin,
            detail: {
              currentPosture,
              ...(previousPosture ? { previousPosture } : {}),
            },
          };
        }
        default:
          break;
      }
      break;
    }
    case 'hook': {
      const detail = event.detail.hook;
      const eventName = parseHookAdmissionState(detail.family);
      const admissionState = parseHookAdmissionStateValue(detail.family);
      const triggerFamily = detail.intent ? parseHookTriggerFamily(detail.intent.triggerFamily) : '';
      const effect = detail.intent ? parseHookEffect(detail.intent.effect) : '';
      const intentId = normalizeText(detail.intent?.intentId);
      if (!eventName || !admissionState || !triggerFamily || !effect || !intentId) {
        break;
      }
      return {
        eventName,
        agentId,
        ...(detail.intent && optionalString(detail.intent.conversationAnchorId)
          ? { conversationAnchorId: optionalString(detail.intent.conversationAnchorId) }
          : {}),
        ...(detail.intent && optionalString(detail.intent.originatingTurnId)
          ? { originatingTurnId: optionalString(detail.intent.originatingTurnId) }
          : {}),
        ...(detail.intent && optionalString(detail.intent.originatingStreamId)
          ? { originatingStreamId: optionalString(detail.intent.originatingStreamId) }
          : {}),
        detail: {
          intentId,
          triggerFamily,
          triggerDetail: parseHookTriggerDetail(detail.intent?.triggerDetail),
          effect,
          admissionState,
          ...(optionalRuntimeReasonCode(detail.reasonCode) ? { reasonCode: optionalRuntimeReasonCode(detail.reasonCode) } : {}),
          ...(normalizeText(detail.message) ? { message: normalizeText(detail.message) } : {}),
          ...(normalizeText(detail.reason) ? { reason: normalizeText(detail.reason) } : {}),
          ...(toIsoFromTimestamp(detail.observedAt) ? { observedAt: toIsoFromTimestamp(detail.observedAt) } : {}),
        },
      };
    }
    default:
      break;
  }

  throw createNimiError({
    message: `unsupported runtime agent consume family: ${event.detail.oneofKind || 'unknown'}`,
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'check_runtime_agent_projection_shape',
    source: 'sdk',
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
      const agentStreamHandle = await input.agent.subscribeEvents({
        agentId: request.agentId,
        cursor: optionalString(request.cursor) || '',
        eventFilters: [AgentEventType.HOOK, AgentEventType.STATE],
        context: {
          appId: input.appId,
          subjectUserId,
        },
      }, makeStreamOptions(options || {}, options?.signal));

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
          const agentEvents = {
            async *[Symbol.asyncIterator](): AsyncIterator<RuntimeAgentConsumeEvent> {
              for await (const event of agentStreamHandle) {
                yield parseAgentConsumeEvent(event);
              }
            },
          };
          for await (const event of mergeAsyncIterables([appEvents, agentEvents])) {
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
