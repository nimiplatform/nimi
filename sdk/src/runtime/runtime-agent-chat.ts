import { ReasonCode } from '../types/index.js';
import { createNimiError } from './errors.js';
import {
  asRecord,
  normalizeText,
  parseCount,
  toProtoStruct,
} from './helpers.js';
import { Struct } from './generated/google/protobuf/struct.js';
import type { SendAppMessageResponse } from './generated/runtime/v1/app';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from './types.js';
import type {
  RuntimeAgentChatExecutionBinding,
  RuntimeAgentChatInterruptAckEvent,
  RuntimeAgentChatInterruptRequest,
  RuntimeAgentChatMessage,
  RuntimeAgentChatModule,
  RuntimeAgentChatPendingFollowUpSnapshot,
  RuntimeAgentChatReasoningConfig,
  RuntimeAgentChatSessionSnapshot,
  RuntimeAgentChatSessionSnapshotRequest,
  RuntimeAgentChatSessionTurnSnapshot,
  RuntimeAgentChatStartedEvent,
  RuntimeAgentChatStreamEvent,
  RuntimeAgentChatTurnRequest,
} from './types-runtime-modules.js';

const RUNTIME_AGENT_APP_ID = 'runtime.agent';
const CHAT_WRITE_SCOPE = 'runtime.agent.chat.write';
const CHAT_READ_SCOPE = 'runtime.agent.chat.read';

const PUBLIC_CHAT_TURN_REQUEST_TYPE = 'agent.chat.turn.request.v1';
const PUBLIC_CHAT_TURN_INTERRUPT_TYPE = 'agent.chat.turn.interrupt.v1';
const PUBLIC_CHAT_TURN_ACCEPTED_TYPE = 'agent.chat.turn.accepted.v1';
const PUBLIC_CHAT_TURN_STARTED_TYPE = 'agent.chat.turn.started.v1';
const PUBLIC_CHAT_TURN_TEXT_DELTA_TYPE = 'agent.chat.turn.text_delta.v1';
const PUBLIC_CHAT_TURN_REASONING_DELTA_TYPE = 'agent.chat.turn.reasoning_delta.v1';
const PUBLIC_CHAT_TURN_STRUCTURED_TYPE = 'agent.chat.turn.structured.v1';
const PUBLIC_CHAT_TURN_POST_TURN_TYPE = 'agent.chat.turn.post_turn.v1';
const PUBLIC_CHAT_TURN_COMPLETED_TYPE = 'agent.chat.turn.completed.v1';
const PUBLIC_CHAT_TURN_FAILED_TYPE = 'agent.chat.turn.failed.v1';
const PUBLIC_CHAT_TURN_INTERRUPTED_TYPE = 'agent.chat.turn.interrupted.v1';
const PUBLIC_CHAT_TURN_INTERRUPT_ACK_TYPE = 'agent.chat.turn.interrupt_ack.v1';
const PUBLIC_CHAT_SESSION_SNAPSHOT_REQUEST_TYPE = 'agent.chat.session.snapshot.request.v1';
const PUBLIC_CHAT_SESSION_SNAPSHOT_TYPE = 'agent.chat.session.snapshot.v1';

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

function parseTrace(payload: Record<string, unknown>): RuntimeAgentChatStartedEvent['trace'] | undefined {
  const traceId = normalizeText(payload.trace_id);
  const modelResolved = normalizeText(payload.model_resolved);
  const routeDecision = normalizeText(payload.route_decision) as RuntimeAgentChatExecutionBinding['route'] | '';
  if (!traceId && !modelResolved && !routeDecision) {
    return undefined;
  }
  return {
    ...(traceId ? { traceId } : {}),
    ...(modelResolved ? { modelResolved } : {}),
    ...(routeDecision ? { routeDecision } : {}),
  };
}

function parseUsage(payload: Record<string, unknown>) {
  const usage = asRecord(payload.usage);
  const inputTokens = parseCount(usage.input_tokens);
  const outputTokens = parseCount(usage.output_tokens);
  const computeMs = parseCount(usage.compute_ms);
  if (inputTokens === undefined && outputTokens === undefined && computeMs === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(computeMs !== undefined ? { totalTokens: inputTokens !== undefined || outputTokens !== undefined ? undefined : computeMs } : {}),
  };
}

function parseExecutionBinding(value: unknown): RuntimeAgentChatExecutionBinding | undefined {
  const payload = asRecord(value);
  const route = normalizeText(payload.route) as RuntimeAgentChatExecutionBinding['route'] | '';
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

function parseReasoning(value: unknown): RuntimeAgentChatReasoningConfig | undefined {
  const payload = asRecord(value);
  const mode = normalizeText(payload.mode) as RuntimeAgentChatReasoningConfig['mode'] | '';
  const traceMode = normalizeText(payload.trace_mode) as RuntimeAgentChatReasoningConfig['traceMode'] | '';
  const budgetTokens = parseCount(payload.budget_tokens);
  if (!mode && !traceMode && budgetTokens === undefined) {
    return undefined;
  }
  return {
    ...(mode ? { mode } : {}),
    ...(traceMode ? { traceMode } : {}),
    ...(budgetTokens !== undefined ? { budgetTokens } : {}),
  };
}

function parseTurnSnapshot(value: unknown): RuntimeAgentChatSessionTurnSnapshot | undefined {
  const payload = asRecord(value);
  const turnId = normalizeText(payload.turn_id);
  if (!turnId) {
    return undefined;
  }
  const streamSequence = parseCount(payload.stream_sequence);
  const followUpDepth = parseCount(payload.follow_up_depth);
  const maxFollowUpTurns = parseCount(payload.max_follow_up_turns);
  return {
    turnId,
    ...(normalizeText(payload.status) ? { status: normalizeText(payload.status) } : {}),
    ...(streamSequence !== undefined ? { streamSequence } : {}),
    ...(normalizeText(payload.turn_origin) ? { turnOrigin: normalizeText(payload.turn_origin) } : {}),
    ...(followUpDepth !== undefined ? { followUpDepth } : {}),
    ...(maxFollowUpTurns !== undefined ? { maxFollowUpTurns } : {}),
    ...(typeof payload.output_observed === 'boolean' ? { outputObserved: payload.output_observed } : {}),
    ...(typeof payload.reasoning_observed === 'boolean' ? { reasoningObserved: payload.reasoning_observed } : {}),
    ...(normalizeText(payload.updated_at) ? { updatedAt: normalizeText(payload.updated_at) } : {}),
    ...(parseTrace(payload) ? { trace: parseTrace(payload) } : {}),
    ...(normalizeText(payload.chain_id) ? { chainId: normalizeText(payload.chain_id) } : {}),
    ...(normalizeText(payload.source_turn_id) ? { sourceTurnId: normalizeText(payload.source_turn_id) } : {}),
    ...(normalizeText(payload.source_action_id) ? { sourceActionId: normalizeText(payload.source_action_id) } : {}),
    ...(normalizeText(payload.message_id) ? { messageId: normalizeText(payload.message_id) } : {}),
    ...(normalizeText(payload.text) ? { text: normalizeText(payload.text) } : {}),
    ...(Object.keys(asRecord(payload.structured)).length > 0 ? { structured: asRecord(payload.structured) } : {}),
    ...(Object.keys(asRecord(payload.assistant_memory)).length > 0 ? { assistantMemory: asRecord(payload.assistant_memory) } : {}),
    ...(Object.keys(asRecord(payload.chat_sidecar)).length > 0 ? { chatSidecar: asRecord(payload.chat_sidecar) } : {}),
    ...(Object.keys(asRecord(payload.follow_up)).length > 0 ? { followUp: asRecord(payload.follow_up) } : {}),
    ...(normalizeText(payload.finish_reason) ? { finishReason: normalizeText(payload.finish_reason) } : {}),
    ...(typeof payload.stream_simulated === 'boolean' ? { streamSimulated: payload.stream_simulated } : {}),
    ...(normalizeText(payload.reason_code) ? { reasonCode: normalizeText(payload.reason_code) } : {}),
    ...(normalizeText(payload.action_hint) ? { actionHint: normalizeText(payload.action_hint) } : {}),
    ...(normalizeText(payload.message) ? { message: normalizeText(payload.message) } : {}),
  };
}

function parsePendingFollowUp(value: unknown): RuntimeAgentChatPendingFollowUpSnapshot | undefined {
  const payload = asRecord(value);
  if (Object.keys(payload).length === 0) {
    return undefined;
  }
  const followUpDepth = parseCount(payload.follow_up_depth);
  const maxFollowUpTurns = parseCount(payload.max_follow_up_turns);
  return {
    ...(normalizeText(payload.status) ? { status: normalizeText(payload.status) } : {}),
    ...(normalizeText(payload.follow_up_id) ? { followUpId: normalizeText(payload.follow_up_id) } : {}),
    ...(normalizeText(payload.scheduled_for) ? { scheduledFor: normalizeText(payload.scheduled_for) } : {}),
    ...(normalizeText(payload.chain_id) ? { chainId: normalizeText(payload.chain_id) } : {}),
    ...(followUpDepth !== undefined ? { followUpDepth } : {}),
    ...(maxFollowUpTurns !== undefined ? { maxFollowUpTurns } : {}),
    ...(normalizeText(payload.source_turn_id) ? { sourceTurnId: normalizeText(payload.source_turn_id) } : {}),
    ...(normalizeText(payload.source_action_id) ? { sourceActionId: normalizeText(payload.source_action_id) } : {}),
  };
}

function toTurnPayload(request: RuntimeAgentChatTurnRequest): Record<string, unknown> {
  return {
    agent_id: request.agentId,
    ...(normalizeText(request.sessionId) ? { session_id: normalizeText(request.sessionId) } : {}),
    ...(normalizeText(request.threadId) ? { thread_id: normalizeText(request.threadId) } : {}),
    ...(normalizeText(request.systemPrompt) ? { system_prompt: normalizeText(request.systemPrompt) } : {}),
    ...(normalizeText(request.worldId) ? { world_id: normalizeText(request.worldId) } : {}),
    ...(parseCount(request.maxOutputTokens) !== undefined ? { max_output_tokens: parseCount(request.maxOutputTokens) } : {}),
    messages: (Array.isArray(request.messages) ? request.messages : []).map((message: RuntimeAgentChatMessage) => ({
      role: message.role,
      content: normalizeText(message.content),
      ...(normalizeText(message.name) ? { name: normalizeText(message.name) } : {}),
    })),
    execution_binding: {
      route: normalizeText(request.executionBinding.route),
      model_id: normalizeText(request.executionBinding.modelId),
      ...(normalizeText(request.executionBinding.connectorId)
        ? { connector_id: normalizeText(request.executionBinding.connectorId) }
        : {}),
    },
    ...(request.reasoning ? {
      reasoning: {
        ...(normalizeText(request.reasoning.mode) ? { mode: normalizeText(request.reasoning.mode) } : {}),
        ...(normalizeText(request.reasoning.traceMode) ? { trace_mode: normalizeText(request.reasoning.traceMode) } : {}),
        ...(parseCount(request.reasoning.budgetTokens) !== undefined
          ? { budget_tokens: parseCount(request.reasoning.budgetTokens) }
          : {}),
      },
    } : {}),
  };
}

function makeStreamOptions(base: RuntimeCallOptions, signal?: AbortSignal): RuntimeStreamCallOptions {
  return signal ? { ...base, signal } : base;
}

export function createRuntimeAgentChatModule(input: {
  appId: string;
  app: RuntimeAgentAppClient;
  protectedAccess: ProtectedScopeHelper;
  resolveSubjectUserId: () => Promise<string>;
}): RuntimeAgentChatModule {
  return {
    async streamTurn(request, options) {
      const subjectUserId = await input.resolveSubjectUserId();
      let sessionId = normalizeText(request.sessionId);
      let turnId = '';
      let interruptSent = false;
      const subscribeBaseOptions = await input.protectedAccess.getCallOptions([CHAT_READ_SCOPE], options);
      const streamHandle = await input.app.subscribeMessages({
        appId: input.appId,
        subjectUserId,
        cursor: '',
        fromAppIds: [RUNTIME_AGENT_APP_ID],
      }, makeStreamOptions(subscribeBaseOptions, options?.signal));

      const sendInterrupt = async (): Promise<void> => {
        if (interruptSent || !sessionId) {
          return;
        }
        interruptSent = true;
        try {
          await input.protectedAccess.withScopes([CHAT_WRITE_SCOPE], (writeOptions) => input.app.sendMessage({
            fromAppId: input.appId,
            toAppId: RUNTIME_AGENT_APP_ID,
            subjectUserId,
            messageType: PUBLIC_CHAT_TURN_INTERRUPT_TYPE,
            payload: Struct.fromJson({
              session_id: sessionId,
              ...(turnId ? { turn_id: turnId } : {}),
              reason: 'interrupt_requested',
            }),
            requireAck: false,
          }, writeOptions), options);
        } catch {
          // Local abort remains authoritative even if the runtime interrupt races.
        }
      };

      if (options?.signal?.aborted) {
        void sendInterrupt();
      } else {
        options?.signal?.addEventListener('abort', () => {
          void sendInterrupt();
        }, { once: true });
      }

      const sendResponse = await input.protectedAccess.withScopes([CHAT_WRITE_SCOPE], (writeOptions) => input.app.sendMessage({
        fromAppId: input.appId,
        toAppId: RUNTIME_AGENT_APP_ID,
        subjectUserId,
        messageType: PUBLIC_CHAT_TURN_REQUEST_TYPE,
        payload: toProtoStruct(toTurnPayload(request)),
        requireAck: false,
      }, writeOptions), options);
      if (!sendResponse.accepted) {
        throw createNimiError({
          message: 'runtime.agent chat turn request was rejected',
          reasonCode: normalizeText(sendResponse.reasonCode) || ReasonCode.APP_SCOPE_FORBIDDEN,
          actionHint: 'check_runtime_agent_chat_access',
          source: 'runtime',
        });
      }

      return {
        async *[Symbol.asyncIterator](): AsyncIterator<RuntimeAgentChatStreamEvent> {
          for await (const event of streamHandle) {
            const messageType = normalizeText(event.messageType);
            switch (messageType) {
              case PUBLIC_CHAT_TURN_ACCEPTED_TYPE:
              case PUBLIC_CHAT_TURN_STARTED_TYPE:
              case PUBLIC_CHAT_TURN_TEXT_DELTA_TYPE:
              case PUBLIC_CHAT_TURN_REASONING_DELTA_TYPE:
              case PUBLIC_CHAT_TURN_STRUCTURED_TYPE:
              case PUBLIC_CHAT_TURN_POST_TURN_TYPE:
              case PUBLIC_CHAT_TURN_COMPLETED_TYPE:
              case PUBLIC_CHAT_TURN_FAILED_TYPE:
              case PUBLIC_CHAT_TURN_INTERRUPTED_TYPE:
              case PUBLIC_CHAT_TURN_INTERRUPT_ACK_TYPE:
                break;
              default:
                continue
            }

            const payload = fromProtoStruct(event.payload);
            const eventSessionID = normalizeText(payload.session_id);
            if (!sessionId && eventSessionID) {
              sessionId = eventSessionID;
            }
            if (sessionId && eventSessionID && sessionId != eventSessionID) {
              continue;
            }
            turnId = normalizeText(payload.turn_id) || turnId;

            switch (messageType) {
              case PUBLIC_CHAT_TURN_ACCEPTED_TYPE:
                yield {
                  type: 'accepted',
                  sessionId,
                  turnId,
                  ...(normalizeText(payload.session_status) ? { sessionStatus: normalizeText(payload.session_status) } : {}),
                  ...(parseCount(payload.transcript_message_count) !== undefined
                    ? { transcriptMessageCount: parseCount(payload.transcript_message_count) }
                    : {}),
                  ...(parseExecutionBinding(payload.execution_binding) ? { executionBinding: parseExecutionBinding(payload.execution_binding)! } : {}),
                  ...(parseCount(payload.max_output_tokens) !== undefined ? { maxOutputTokens: parseCount(payload.max_output_tokens) } : {}),
                  ...(parseReasoning(payload.reasoning) ? { reasoning: parseReasoning(payload.reasoning) } : {}),
                };
                break;
              case PUBLIC_CHAT_TURN_STARTED_TYPE:
                yield {
                  type: 'started',
                  sessionId,
                  turnId,
                  ...(parseTrace(payload) ? { trace: parseTrace(payload) } : {}),
                };
                break;
              case PUBLIC_CHAT_TURN_TEXT_DELTA_TYPE: {
                const textDelta = normalizeText(payload.text);
                if (!textDelta) {
                  continue;
                }
                yield {
                  type: 'text_delta',
                  sessionId,
                  turnId,
                  textDelta,
                };
                break;
              }
              case PUBLIC_CHAT_TURN_REASONING_DELTA_TYPE: {
                const textDelta = normalizeText(payload.text);
                if (!textDelta) {
                  continue;
                }
                yield {
                  type: 'reasoning_delta',
                  sessionId,
                  turnId,
                  textDelta,
                };
                break;
              }
              case PUBLIC_CHAT_TURN_STRUCTURED_TYPE:
                yield {
                  type: 'structured',
                  sessionId,
                  turnId,
                  structured: asRecord(payload.structured),
                  ...(parseTrace(payload) ? { trace: parseTrace(payload) } : {}),
                };
                break;
              case PUBLIC_CHAT_TURN_POST_TURN_TYPE:
                yield {
                  type: 'post_turn',
                  sessionId,
                  turnId,
                  postTurn: payload,
                };
                break;
              case PUBLIC_CHAT_TURN_COMPLETED_TYPE:
                yield {
                  type: 'completed',
                  sessionId,
                  turnId,
                  ...(normalizeText(payload.text) ? { text: normalizeText(payload.text) } : {}),
                  ...(normalizeText(payload.finish_reason) ? { finishReason: normalizeText(payload.finish_reason) as any } : {}),
                  ...(parseUsage(payload) ? { usage: parseUsage(payload) } : {}),
                  ...(parseTrace(payload) ? { trace: parseTrace(payload) } : {}),
                };
                return;
              case PUBLIC_CHAT_TURN_FAILED_TYPE:
                yield {
                  type: 'failed',
                  sessionId,
                  turnId,
                  ...(normalizeText(payload.text) ? { text: normalizeText(payload.text) } : {}),
                  ...(normalizeText(payload.reasoning_text) ? { reasoningText: normalizeText(payload.reasoning_text) } : {}),
                  ...(normalizeText(payload.finish_reason) ? { finishReason: normalizeText(payload.finish_reason) as any } : {}),
                  ...(normalizeText(payload.message) ? { message: normalizeText(payload.message) } : {}),
                  ...(normalizeText(payload.reason_code) ? { reasonCode: normalizeText(payload.reason_code) } : {}),
                  ...(normalizeText(payload.action_hint) ? { actionHint: normalizeText(payload.action_hint) } : {}),
                  ...(parseUsage(payload) ? { usage: parseUsage(payload) } : {}),
                  ...(parseTrace(payload) ? { trace: parseTrace(payload) } : {}),
                };
                return;
              case PUBLIC_CHAT_TURN_INTERRUPTED_TYPE:
                yield {
                  type: 'interrupted',
                  sessionId,
                  turnId,
                  ...(normalizeText(payload.text) ? { text: normalizeText(payload.text) } : {}),
                  ...(normalizeText(payload.reasoning_text) ? { reasoningText: normalizeText(payload.reasoning_text) } : {}),
                  ...(parseTrace(payload) ? { trace: parseTrace(payload) } : {}),
                };
                return;
              case PUBLIC_CHAT_TURN_INTERRUPT_ACK_TYPE:
                yield {
                  type: 'interrupt_ack',
                  sessionId,
                  turnId,
                  accepted: payload.accepted !== false,
                  ...(normalizeText(payload.interrupt_for) ? { interruptFor: normalizeText(payload.interrupt_for) } : {}),
                } satisfies RuntimeAgentChatInterruptAckEvent;
                break;
            }
          }
        },
      };
    },

    async interruptTurn(request, options) {
      const subjectUserId = await input.resolveSubjectUserId()
      return input.protectedAccess.withScopes([CHAT_WRITE_SCOPE], (writeOptions) => input.app.sendMessage({
        fromAppId: input.appId,
        toAppId: RUNTIME_AGENT_APP_ID,
        subjectUserId,
        messageType: PUBLIC_CHAT_TURN_INTERRUPT_TYPE,
        payload: toProtoStruct({
          session_id: normalizeText(request.sessionId),
          ...(normalizeText(request.turnId) ? { turn_id: normalizeText(request.turnId) } : {}),
          ...(normalizeText(request.reason) ? { reason: normalizeText(request.reason) } : {}),
        }),
        requireAck: false,
      }, writeOptions), options);
    },

    async getSessionSnapshot(request, options) {
      const subjectUserId = await input.resolveSubjectUserId();
      const sessionId = normalizeText(request.sessionId);
      const requestId = normalizeText(request.requestId);
      if (!sessionId) {
        throw createNimiError({
          message: 'runtime.agent chat session snapshot requires sessionId',
          reasonCode: ReasonCode.ACTION_INPUT_INVALID,
          actionHint: 'set_session_id',
          source: 'sdk',
        });
      }

      const subscribeBaseOptions = await input.protectedAccess.getCallOptions([CHAT_READ_SCOPE], options);
      const streamHandle = await input.app.subscribeMessages({
        appId: input.appId,
        subjectUserId,
        cursor: '',
        fromAppIds: [RUNTIME_AGENT_APP_ID],
      }, makeStreamOptions(subscribeBaseOptions, options?.signal));

      await input.protectedAccess.withScopes([CHAT_WRITE_SCOPE], (writeOptions) => input.app.sendMessage({
        fromAppId: input.appId,
        toAppId: RUNTIME_AGENT_APP_ID,
        subjectUserId,
        messageType: PUBLIC_CHAT_SESSION_SNAPSHOT_REQUEST_TYPE,
        payload: toProtoStruct({
          session_id: sessionId,
          ...(requestId ? { request_id: requestId } : {}),
        }),
        requireAck: false,
      }, writeOptions), options);

      for await (const event of streamHandle) {
        if (normalizeText(event.messageType) !== PUBLIC_CHAT_SESSION_SNAPSHOT_TYPE) {
          continue;
        }
        const payload = fromProtoStruct(event.payload);
        if (normalizeText(payload.session_id) != sessionId) {
          continue;
        }
        if (requestId && normalizeText(payload.request_id) != requestId) {
          continue;
        }
        return {
          ...(requestId ? { requestId } : {}),
          agentId: normalizeText(payload.agent_id),
          sessionId,
          ...(normalizeText(payload.thread_id) ? { threadId: normalizeText(payload.thread_id) } : {}),
          ...(normalizeText(payload.subject_user_id) ? { subjectUserId: normalizeText(payload.subject_user_id) } : {}),
          ...(normalizeText(payload.session_status) ? { sessionStatus: normalizeText(payload.session_status) } : {}),
          ...(parseCount(payload.transcript_message_count) !== undefined
            ? { transcriptMessageCount: parseCount(payload.transcript_message_count) }
            : {}),
          ...(parseExecutionBinding(payload.execution_binding) ? { executionBinding: parseExecutionBinding(payload.execution_binding) } : {}),
          ...(normalizeText(payload.system_prompt) ? { systemPrompt: normalizeText(payload.system_prompt) } : {}),
          ...(parseCount(payload.max_output_tokens) !== undefined ? { maxOutputTokens: parseCount(payload.max_output_tokens) } : {}),
          ...(parseReasoning(payload.reasoning) ? { reasoning: parseReasoning(payload.reasoning) } : {}),
          ...(parseTurnSnapshot(payload.active_turn) ? { activeTurn: parseTurnSnapshot(payload.active_turn) } : {}),
          ...(parseTurnSnapshot(payload.last_turn) ? { lastTurn: parseTurnSnapshot(payload.last_turn) } : {}),
          ...(parsePendingFollowUp(payload.pending_follow_up) ? { pendingFollowUp: parsePendingFollowUp(payload.pending_follow_up) } : {}),
        } satisfies RuntimeAgentChatSessionSnapshot;
      }

      throw createNimiError({
        message: `runtime.agent chat session snapshot unavailable for session ${sessionId}`,
        reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: 'retry_runtime_agent_chat_snapshot',
        source: 'runtime',
      });
    },
  };
}
