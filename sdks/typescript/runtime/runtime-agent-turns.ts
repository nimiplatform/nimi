import {
  ReasonCode as RuntimeGeneratedReasonCode,
  type AppMessageEvent,
  type GetPublicChatSessionSnapshotRequest,
  type GetPublicChatSessionSnapshotResponse,
  type SendAppMessageRequest,
  type SendAppMessageResponse,
  type SubscribeAppMessagesRequest,
  type TranscribeAgentVoiceInputRequest,
  type TranscribeAgentVoiceInputResponse,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiClientId, createNimiError, ReasonCode, type JsonObject } from '../types';
import {
  buildRuntimeAgentRequestContext,
  projectRuntimeLocalAgentIdentity,
  type RuntimeLocalAgentIdentityInput,
} from './agent-local-identity';
import {
  parseNimiRuntimeAgentSessionSnapshot,
  projectNimiRuntimeAgentAppMessageEvent,
} from './runtime-agent-consume-projection';
import type {
  NimiRuntimeAgentConsumeEvent,
} from './runtime-agent-consume-types';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText, toNimiRuntimeIsoFromTimestamp, toNimiRuntimeProtoStruct } from './runtime-agent-values';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs';
import {
  createNimiRuntimeAgentVoiceInputTooLargeError,
  NIMI_RUNTIME_AGENT_VOICE_INPUT_MAX_BYTES,
} from './runtime-agent-voice-input';
import type {
  NimiRuntimeAgentConsumeRequest,
  NimiRuntimeAgentCurrentUserMessage,
  NimiRuntimeAgentSessionSnapshotRequest,
  NimiRuntimeAgentTurnInterruptRequest,
  NimiRuntimeAgentTurnRequest,
  NimiRuntimeAgentVoiceInputTranscriptionRequest,
  NimiRuntimeAgentTurnsModule,
} from './runtime-agent-turn-runner-types';

const RUNTIME_AGENT_APP_ID = 'runtime.agent';
const AGENT_READ_SCOPE = 'runtime.agent.read';
const TURN_WRITE_SCOPE = 'runtime.agent.turn.write';
const TURN_READ_SCOPE = 'runtime.agent.turn.read';
const TURN_REQUEST_TYPE = 'runtime.agent.turn.request';
const TURN_INTERRUPT_TYPE = 'runtime.agent.turn.interrupt';
const TURN_REQUEST_FIELDS = new Set([
  'ownerUserId',
  'runtimeSourceRef',
  'localAgentRef',
  'conversationAnchorId',
  'requestId',
  'threadId',
  'maxOutputTokens',
  'messages',
  'reasoning',
]);
const TURN_MESSAGE_FIELDS = new Set(['role', 'content', 'attachments']);
const TURN_MESSAGE_ATTACHMENT_FIELDS = new Set(['artifactId', 'displayName']);
const TURN_REASONING_FIELDS = new Set(['mode', 'traceMode', 'budgetTokens']);

export interface NimiRuntimeAgentTurnsRuntime {
  readonly appId: string;
  readonly auth?: NimiRuntimeAgentAuthClient;
  readonly agents: {
    getPublicChatSessionSnapshot(
      request: GetPublicChatSessionSnapshotRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetPublicChatSessionSnapshotResponse>;
    transcribeAgentVoiceInput?(
      request: TranscribeAgentVoiceInputRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<TranscribeAgentVoiceInputResponse>;
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

function assertExactObjectFields(
  value: unknown,
  allowedFields: ReadonlySet<string>,
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    runtimeAgentInputError(`${label} must be an object`, 'provide_valid_runtime_agent_turn_input');
  }
  for (const field of Reflect.ownKeys(value)) {
    if (typeof field !== 'string' || !allowedFields.has(field)) {
      runtimeAgentInputError(
        `${label} contains unsupported field ${typeof field === 'string' ? field : String(field)}`,
        'remove_unsupported_runtime_agent_turn_field',
      );
    }
  }
}

function normalizeTurnReasoning(value: unknown): JsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }
  assertExactObjectFields(value, TURN_REASONING_FIELDS, 'runtime agent turn reasoning');
  const mode = optionalString(value.mode);
  const traceMode = optionalString(value.traceMode);
  const budgetTokens = optionalNumber(value.budgetTokens);
  if (value.mode !== undefined && !mode) {
    runtimeAgentInputError('runtime agent turn reasoning mode must be a non-empty string', 'provide_valid_runtime_agent_reasoning');
  }
  if (value.traceMode !== undefined && !traceMode) {
    runtimeAgentInputError('runtime agent turn reasoning traceMode must be a non-empty string', 'provide_valid_runtime_agent_reasoning');
  }
  if (value.budgetTokens !== undefined && (budgetTokens === undefined || budgetTokens < 0)) {
    runtimeAgentInputError('runtime agent turn reasoning budgetTokens must be non-negative', 'provide_valid_runtime_agent_reasoning');
  }
  if (!mode && !traceMode && budgetTokens === undefined) {
    return undefined;
  }
  return {
    ...(mode ? { mode } : {}),
    ...(traceMode ? { trace_mode: traceMode } : {}),
    ...(budgetTokens !== undefined ? { budget_tokens: budgetTokens } : {}),
  };
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

function normalizeTurnMessageAttachments(
  value: unknown,
): NimiRuntimeAgentCurrentUserMessage['attachments'] {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    runtimeAgentInputError(
      'runtime agent turn message attachments must be an array',
      'provide_valid_runtime_agent_turn_attachment',
    );
  }
  if (value.length > 1) {
    runtimeAgentInputError(
      'runtime agent turn message admits at most one attachment',
      'provide_valid_runtime_agent_turn_attachment',
    );
  }
  const attachments = value.map((item) => {
    assertExactObjectFields(item, TURN_MESSAGE_ATTACHMENT_FIELDS, 'runtime agent turn message attachment');
    const artifactId = optionalString(item.artifactId);
    if (!artifactId) {
      runtimeAgentInputError(
        'runtime agent turn message attachment artifactId must be a non-empty string',
        'provide_valid_runtime_agent_turn_attachment',
      );
    }
    if (item.displayName !== undefined && typeof item.displayName !== 'string') {
      runtimeAgentInputError(
        'runtime agent turn message attachment displayName must be a string',
        'provide_valid_runtime_agent_turn_attachment',
      );
    }
    const displayName = optionalString(item.displayName);
    return {
      artifactId,
      ...(displayName ? { displayName } : {}),
    };
  });
  return attachments.length > 0 ? attachments : undefined;
}

function normalizeCurrentUserMessage(messages: unknown): NimiRuntimeAgentCurrentUserMessage {
  if (!Array.isArray(messages) || messages.length !== 1) {
    runtimeAgentInputError(
      'runtime agent turn request requires exactly one current user message',
      'provide_one_runtime_agent_current_user_message',
    );
  }
  const message: unknown = messages[0];
  assertExactObjectFields(message, TURN_MESSAGE_FIELDS, 'runtime agent turn message');
  if (message.role !== 'user') {
    runtimeAgentInputError(
      'runtime agent turn message role must be user',
      'provide_one_runtime_agent_current_user_message',
    );
  }
  const content = optionalString(message.content);
  const attachments = normalizeTurnMessageAttachments(message.attachments);
  if (!content && !attachments) {
    runtimeAgentInputError(
      'runtime agent turn message requires non-empty content or an attachment',
      'provide_one_runtime_agent_current_user_message',
    );
  }
  return {
    role: 'user',
    content: content || '',
    ...(attachments ? { attachments } : {}),
  };
}

export function buildNimiRuntimeAgentTurnPayload(request: NimiRuntimeAgentTurnRequest): JsonObject {
  assertExactObjectFields(request, TURN_REQUEST_FIELDS, 'runtime agent turn request');
  const identity = projectRuntimeLocalAgentIdentity(request);
  const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
  const message = normalizeCurrentUserMessage(request.messages);
  const maxOutputTokens = optionalNumber(request.maxOutputTokens);
  if (maxOutputTokens !== undefined && maxOutputTokens < 0) {
    runtimeAgentInputError('runtime agent turn request maxOutputTokens must be non-negative', 'provide_non_negative_max_output_tokens');
  }
  if (request.maxOutputTokens !== undefined && maxOutputTokens === undefined) {
    runtimeAgentInputError('runtime agent turn request maxOutputTokens must be a finite number', 'provide_non_negative_max_output_tokens');
  }
  const reasoning = normalizeTurnReasoning(request.reasoning);
  return {
    local_agent_ref: identity.localAgentRef,
    owner_user_id: identity.ownerUserId,
    runtime_source_ref: identity.runtimeSourceRef,
    conversation_anchor_id: conversationAnchorId,
    ...(optionalString(request.requestId) ? { request_id: optionalString(request.requestId) } : {}),
    ...(optionalString(request.threadId) ? { thread_id: optionalString(request.threadId) } : {}),
    ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
    messages: [{
      role: message.role,
      content: message.content,
      ...(message.attachments && message.attachments.length > 0
        ? {
          attachments: message.attachments.map((attachment) => ({
            artifact_id: attachment.artifactId,
            ...(attachment.displayName ? { display_name: attachment.displayName } : {}),
          })),
        }
        : {}),
    }],
    ...(reasoning ? { reasoning } : {}),
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
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
}) {
  return buildRuntimeAgentRequestContext(input);
}

function appMessageEvents(
  stream: AsyncIterable<AppMessageEvent>,
  request: NimiRuntimeAgentConsumeRequest,
  liveStartedAtMs?: number,
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return projectRuntimeAgentEventStream(stream, (event) => {
    if (!eventIsAtOrAfterLiveBoundary(event, liveStartedAtMs)) return null;
    const projected = projectNimiRuntimeAgentAppMessageEvent(event, request.localAgentRef);
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

function eventIsAtOrAfterLiveBoundary(event: unknown, liveStartedAtMs?: number): boolean {
  if (liveStartedAtMs === undefined) {
    return true;
  }
  const timestamp = (event as { readonly timestamp?: Parameters<typeof toNimiRuntimeIsoFromTimestamp>[0] } | null)?.timestamp;
  const iso = toNimiRuntimeIsoFromTimestamp(timestamp);
  if (!iso) {
    return true;
  }
  const eventMs = Date.parse(iso);
  if (!Number.isFinite(eventMs) || eventMs <= 0) {
    return true;
  }
  return eventMs >= liveStartedAtMs;
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
      const liveStartedAtMs = cursor ? undefined : Date.now();
      const subjectUserId = await resolveSubjectUserId(options, request.subjectUserId || identity.ownerUserId);
      const appStream = await withTurnScopes(options, subjectUserId, [TURN_READ_SCOPE], async (callOptions) =>
        runtime.appMessages.subscribeAppMessages({
          appId: runtime.appId,
          subjectUserId,
          cursor,
          fromAppIds: [RUNTIME_AGENT_APP_ID],
          localAgentRef: '',
          conversationAnchorId: '',
        }, callOptions),
      );
      return appMessageEvents(appStream, request, liveStartedAtMs);
    },
    async request(request) {
      const payload = toNimiRuntimeProtoStruct(buildNimiRuntimeAgentTurnPayload(request));
      const identity = localIdentity(request);
      const subjectUserId = await resolveSubjectUserId(options, identity.ownerUserId);
      const response = await withTurnScopes(options, subjectUserId, [TURN_WRITE_SCOPE], async (callOptions) =>
        runtime.appMessages.sendAppMessage({
          fromAppId: runtime.appId,
          toAppId: RUNTIME_AGENT_APP_ID,
          subjectUserId,
          messageType: TURN_REQUEST_TYPE,
          payload,
          requireAck: false,
        }, withNimiRuntimeIdempotencyMetadata(
          callOptions,
          optionalString(request.requestId) || createNimiClientId('runtime-agent-turn-request'),
        )),
      );
      return assertAccepted(response, TURN_REQUEST_TYPE);
    },
    async interrupt(request) {
      const identity = localIdentity(request);
      const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
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
          subjectUserId,
          messageType: TURN_INTERRUPT_TYPE,
          payload,
          requireAck: false,
        }, withNimiRuntimeIdempotencyMetadata(
          callOptions,
          createNimiClientId('runtime-agent-turn-interrupt'),
        )),
      );
      return assertAccepted(response, TURN_INTERRUPT_TYPE);
    },
    async transcribeVoiceInput(request: NimiRuntimeAgentVoiceInputTranscriptionRequest) {
      const identity = localIdentity(request);
      const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
      if (!(request.audioBytes instanceof Uint8Array) || request.audioBytes.length === 0) {
        runtimeAgentInputError('runtime agent voice input requires recorded audio bytes', 'record_runtime_agent_voice_input');
      }
      if (request.audioBytes.byteLength > NIMI_RUNTIME_AGENT_VOICE_INPUT_MAX_BYTES) {
        throw createNimiRuntimeAgentVoiceInputTooLargeError();
      }
      const mimeType = optionalString(request.mimeType)?.toLowerCase();
      if (!mimeType?.startsWith('audio/')) {
        runtimeAgentInputError('runtime agent voice input requires an audio MIME type', 'provide_runtime_agent_voice_mime_type');
      }
      const transcribe = runtime.agents.transcribeAgentVoiceInput;
      if (!transcribe) {
        throw createNimiError({
          message: 'Runtime Agent voice input transcription is unavailable.',
          reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
          actionHint: 'use_runtime_agent_voice_input_surface',
          source: 'sdk',
        });
      }
      const subjectUserId = await resolveSubjectUserId(options, identity.ownerUserId);
      const requestId = optionalString(request.requestId) || createNimiClientId('runtime-agent-voice-input');
      const response = await withTurnScopes(options, subjectUserId, [TURN_WRITE_SCOPE], async (callOptions) =>
        transcribe({
          context: requestContext({
            runtimeAppId: runtime.appId,
            subjectUserId,
            ownerUserId: identity.ownerUserId,
            runtimeSourceRef: identity.runtimeSourceRef,
            localAgentRef: identity.localAgentRef,
          }),
          agentId: identity.localAgentRef,
          conversationAnchorId,
          audioBytes: new Uint8Array(request.audioBytes),
          mimeType,
          requestId,
        }, withNimiRuntimeIdempotencyMetadata({
          ...callOptions,
          signal: request.signal,
        }, requestId)),
      );
      const text = optionalString(response.text);
      const jobId = optionalString(response.jobId);
      if (!text || !jobId) {
        throw createNimiError({
          message: 'Runtime Agent voice transcription returned an invalid typed result.',
          reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
          actionHint: 'check_runtime_agent_voice_input_response',
          source: 'runtime',
        });
      }
      const traceId = optionalString(response.traceId);
      return {
        text,
        jobId,
        ...(traceId ? { traceId } : {}),
      };
    },
    async getSessionSnapshot(request) {
      const identity = localIdentity(request);
      const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
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
            ownerUserId: identity.ownerUserId,
            runtimeSourceRef: identity.runtimeSourceRef,
            localAgentRef: identity.localAgentRef,
          }),
        }, callOptions),
      );
      return parseNimiRuntimeAgentSessionSnapshot(response.snapshot, {
        localAgentRef: identity.localAgentRef,
        conversationAnchorId,
      });
    },
  };
}
