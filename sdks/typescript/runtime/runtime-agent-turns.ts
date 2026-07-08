import {
  AgentEventType,
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
import { createNimiClientId, createNimiError, ReasonCode, type JsonObject } from '../types';
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
import { normalizeNimiRuntimeAgentText, toNimiRuntimeIsoFromTimestamp, toNimiRuntimeProtoStruct } from './runtime-agent-values';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs';
import type {
  NimiRuntimeAgentConsumeRequest,
  NimiRuntimeAgentMessage,
  NimiRuntimeAgentSessionSnapshotRequest,
  NimiRuntimeAgentTurnInterruptRequest,
  NimiRuntimeAgentTurnRequest,
  NimiRuntimeAgentTurnVoiceRenderResult,
  NimiRuntimeAgentTurnsModule,
} from './runtime-agent-turn-runner-types';

const RUNTIME_AGENT_APP_ID = 'runtime.agent';
const AGENT_READ_SCOPE = 'runtime.agent.read';
const TURN_WRITE_SCOPE = 'runtime.agent.turn.write';
const TURN_READ_SCOPE = 'runtime.agent.turn.read';
const TURN_REQUEST_TYPE = 'runtime.agent.turn.request';
const TURN_INTERRUPT_TYPE = 'runtime.agent.turn.interrupt';
const TURN_VOICE_RENDER_TYPE = 'runtime.agent.turn.voice_render';
const VOICE_RENDER_TIMEOUT_MS = 1500;

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

function mergeRuntimeAgentTurnCallOptions(
  left: RuntimeTypedCallOptions | undefined,
  right: RuntimeTypedCallOptions | undefined,
): RuntimeTypedCallOptions {
  return {
    ...(left ?? {}),
    ...(right ?? {}),
    metadata: {
      ...(left?.metadata ?? {}),
      ...(right?.metadata ?? {}),
    },
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
  // Turn requests never carry execution bindings: the runtime resolves the
  // turn against the committed Runtime Agent AI Config (K-AGCORE-147) and
  // rejects any request-level execution_bindings as InvalidArgument.
  const maxOutputTokens = optionalNumber(request.maxOutputTokens);
  if (maxOutputTokens !== undefined && maxOutputTokens < 0) {
    runtimeAgentInputError('runtime agent turn request maxOutputTokens must be non-negative', 'provide_non_negative_max_output_tokens');
  }
  return {
    local_agent_ref: identity.localAgentRef,
    owner_user_id: identity.ownerUserId,
    runtime_source_ref: identity.runtimeSourceRef,
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
    ...(request.executionParams ? { execution_params: request.executionParams as JsonObject } : {}),
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
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly scopedBinding?: ScopedRuntimeBindingAttachment;
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
  liveStartedAtMs?: number,
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return projectRuntimeAgentEventStream(stream, (event) => {
    if (!eventIsAtOrAfterLiveBoundary(event, liveStartedAtMs)) return null;
    const projected = projectNimiRuntimeAgentServiceEvent(event as Parameters<typeof projectNimiRuntimeAgentServiceEvent>[0]);
    const expectedAnchorId = optionalString(request.conversationAnchorId);
    const projectedAnchorId = optionalString((projected as { readonly conversationAnchorId?: unknown }).conversationAnchorId);
    if (expectedAnchorId && projectedAnchorId && projectedAnchorId !== expectedAnchorId) {
      return null;
    }
    return projected;
  });
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

function nonNegativeTimeoutMs(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

type NimiRuntimeAgentVoicePlaybackConsumeEvent = NimiRuntimeAgentConsumeEvent & {
  readonly eventName: 'runtime.agent.presentation.voice_playback_requested';
};

async function waitForVoiceRenderProjection(
  stream: AsyncIterable<NimiRuntimeAgentConsumeEvent>,
  input: {
    readonly conversationAnchorId: string;
    readonly turnId: string;
    readonly messageId: string;
    readonly playbackTarget: 'desktop_manual' | 'replay';
    readonly timeoutMs: number;
  },
): Promise<NimiRuntimeAgentTurnVoiceRenderResult> {
  const iterator = stream[Symbol.asyncIterator]();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timeout = setTimeout(() => resolve('timeout'), input.timeoutMs);
  });
  try {
    while (true) {
      const next = await Promise.race([
        iterator.next(),
        timeoutPromise,
      ]);
      if (next === 'timeout') {
        return { status: 'text_only', reason: 'voice_projection_unavailable' };
      }
      if (next.done) {
        return { status: 'text_only', reason: 'voice_projection_unavailable' };
      }
      const event = next.value;
      if (
        event.eventName === 'runtime.agent.presentation.voice_playback_requested'
        && event.conversationAnchorId === input.conversationAnchorId
        && event.turnId === input.turnId
        && event.detail.messageId === input.messageId
        && event.detail.playbackTarget === input.playbackTarget
        && typeof event.detail.audioArtifactId === 'string'
        && event.detail.audioArtifactId.trim()
        && typeof event.detail.audioMimeType === 'string'
        && event.detail.audioMimeType.trim().toLowerCase().startsWith('audio/')
      ) {
        const voiceEvent = event as NimiRuntimeAgentVoicePlaybackConsumeEvent;
        const audioArtifactId = event.detail.audioArtifactId;
        const audioMimeType = event.detail.audioMimeType;
        return {
          status: 'ready',
          event: voiceEvent,
          audioArtifactId,
          audioMimeType,
        };
      }
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    await Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
}

function mergeAsyncIterables<T>(sources: readonly AsyncIterable<T>[]): AsyncIterable<T> {
  type NextState = {
    readonly index: number;
    readonly result?: IteratorResult<T>;
    readonly error?: unknown;
  };
  const iterators = sources.map((source) => source[Symbol.asyncIterator]());
  const never = new Promise<NextState>(() => undefined);
  const pull = (iterator: AsyncIterator<T>, index: number): Promise<NextState> =>
    iterator.next().then(
      (result) => ({ index, result }),
      (error) => ({ index, error }),
    );
  const nexts = iterators.map((iterator, index) => pull(iterator, index));
  let active = iterators.length;
  let closed = false;
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: async () => {
          while (!closed && active > 0) {
            const next = await Promise.race(nexts);
            if (next.error) {
              throw next.error;
            }
            const result = next.result;
            if (!result || result.done) {
              active -= 1;
              nexts[next.index] = never;
              continue;
            }
            nexts[next.index] = pull(iterators[next.index]!, next.index);
            return { done: false, value: result.value };
          }
          return { done: true, value: undefined };
        },
        return: async () => {
          closed = true;
          await Promise.allSettled(iterators.map((iterator) => iterator.return?.()));
          return { done: true, value: undefined };
        },
      };
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
      const liveStartedAtMs = cursor ? undefined : Date.now();
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
            eventFilters: [
              AgentEventType.HOOK,
              AgentEventType.STATE,
              AgentEventType.PRESENTATION,
              AgentEventType.AVATAR_DEBUG,
            ],
            context: requestContext({
              runtimeAppId: runtime.appId,
              subjectUserId,
              ownerUserId: identity.ownerUserId,
              runtimeSourceRef: identity.runtimeSourceRef,
              localAgentRef: identity.localAgentRef,
              scopedBinding,
            }),
          }, callOptions),
        )
        : null;
      const sources = agentStream
        ? [
          appMessageEvents(appStream, request, liveStartedAtMs),
          agentEvents(agentStream, request, liveStartedAtMs),
        ]
        : [appMessageEvents(appStream, request, liveStartedAtMs)];
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
    async renderVoice(request) {
      const identity = localIdentity(request);
      const conversationAnchorId = requireConversationAnchorId(request.conversationAnchorId);
      const turnId = optionalString(request.turnId);
      const messageId = optionalString(request.messageId);
      if (!turnId) {
        runtimeAgentInputError('runtime agent voice render request requires turnId', 'select_committed_runtime_agent_message');
      }
      if (!messageId) {
        runtimeAgentInputError('runtime agent voice render request requires messageId', 'select_committed_runtime_agent_message');
      }
      const playbackTarget = request.playbackTarget === 'replay' ? 'replay' : 'desktop_manual';
      const scopedBinding = toScopedBindingAttachment(request.scopedBinding, {
        runtimeAppId: runtime.appId,
        localAgentRef: identity.localAgentRef,
        conversationAnchorId,
        worldId: request.worldId,
      });
      const subjectUserId = await resolveSubjectUserId(options, request.subjectUserId || identity.ownerUserId);
      const appStream = await withTurnScopes(options, subjectUserId, [TURN_READ_SCOPE], async (callOptions) =>
        runtime.appMessages.subscribeAppMessages({
          appId: runtime.appId,
          subjectUserId: scopedBinding ? '' : subjectUserId,
          scopedBinding,
          cursor: '',
          fromAppIds: [RUNTIME_AGENT_APP_ID],
        }, callOptions),
      );
      const agentStream = await withTurnScopes(options, subjectUserId, [AGENT_READ_SCOPE], async (callOptions) =>
        runtime.agents.subscribeAgentEvents({
          agentId: '',
          cursor: '',
          eventFilters: [AgentEventType.PRESENTATION],
          context: requestContext({
            runtimeAppId: runtime.appId,
            subjectUserId,
            ownerUserId: identity.ownerUserId,
            runtimeSourceRef: identity.runtimeSourceRef,
            localAgentRef: identity.localAgentRef,
            scopedBinding,
          }),
        }, callOptions),
      );
      const payload = toNimiRuntimeProtoStruct({
        conversation_anchor_id: conversationAnchorId,
        turn_id: turnId,
        message_id: messageId,
        ...(optionalString(request.text) ? { text: optionalString(request.text) } : {}),
        playback_target: playbackTarget,
      });
      const voiceRenderOptions = withNimiRuntimeIdempotencyMetadata(
        undefined,
        optionalString(request.idempotencyKey) || createNimiClientId('runtime-agent-voice-render'),
      );
      const response = await withTurnScopes(options, subjectUserId, [TURN_WRITE_SCOPE], async (callOptions) =>
        runtime.appMessages.sendAppMessage({
          fromAppId: runtime.appId,
          toAppId: RUNTIME_AGENT_APP_ID,
          subjectUserId: scopedBinding ? '' : subjectUserId,
          scopedBinding,
          messageType: TURN_VOICE_RENDER_TYPE,
          payload,
          requireAck: false,
        }, mergeRuntimeAgentTurnCallOptions(voiceRenderOptions, callOptions)),
      );
      assertAccepted(response, TURN_VOICE_RENDER_TYPE);
      const projectionStream = mergeAsyncIterables([
        appMessageEvents(appStream, {
          ...identity,
          conversationAnchorId,
        }),
        agentEvents(agentStream, {
          ...identity,
          conversationAnchorId,
        }),
      ]);
      return waitForVoiceRenderProjection(projectionStream, {
        conversationAnchorId,
        turnId,
        messageId,
        playbackTarget,
        timeoutMs: nonNegativeTimeoutMs(request.timeoutMs, VOICE_RENDER_TIMEOUT_MS),
      });
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
            ownerUserId: identity.ownerUserId,
            runtimeSourceRef: identity.runtimeSourceRef,
            localAgentRef: identity.localAgentRef,
            scopedBinding,
          }),
        }, callOptions),
      );
      return parseNimiRuntimeAgentSessionSnapshot(response.snapshot);
    },
  };
}
