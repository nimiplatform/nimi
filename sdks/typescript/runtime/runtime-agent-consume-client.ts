import {
  AgentEventType,
  ConversationAnchorStatus,
  type ConversationAnchorSnapshot,
  type AgentConversationSummary,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import {
  buildRuntimeAgentRequestContext,
  projectRuntimeLocalAgentIdentity,
} from './agent-local-identity';
import { toNimiRuntimeProtoStruct } from './runtime-agent-values';
import {
  asRecord,
  normalizeText,
  optionalNumber,
  requireText,
  runtimeAgentError,
} from './runtime-agent-consume-internal';
import {
  parseNimiRuntimeAgentSessionSnapshot,
} from './runtime-agent-consume-projection';
import {
  mergeNimiRuntimeAgentStreams,
  normalizeCursor,
  projectAgentEventStream,
  projectAppMessageStream,
} from './runtime-agent-consume-streams';
import type {
  NimiRuntimeAgentConsumeClient,
  NimiRuntimeAgentConsumeClientOptions,
  NimiRuntimeAgentConsumeContext,
  NimiRuntimeAgentConsumeContextInput,
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentConversationAnchorSnapshot,
  NimiRuntimeAgentConversationSummary,
} from './runtime-agent-consume-types';
import {
  assertNimiRuntimeAgentContextProjectionCorrelation,
  decodeNimiRuntimeAgentSourceContextStatus,
  decodeNimiRuntimeAgentTurnContextSummary,
} from './runtime-agent-context-projections';

const RUNTIME_AGENT_APP_ID = 'runtime.agent';

export function buildNimiRuntimeAgentConsumeContext(input: NimiRuntimeAgentConsumeContextInput): NimiRuntimeAgentConsumeContext {
  const runtimeAppId = requireText(input.runtimeAppId, 'runtimeAppId');
  const identity = projectRuntimeLocalAgentIdentity(input);
  const subjectUserId = normalizeText(input.subjectUserId) || identity.ownerUserId;
  const requestContext = buildRuntimeAgentRequestContext({
    runtimeAppId,
    subjectUserId,
    ownerUserId: identity.ownerUserId,
    runtimeSourceRef: identity.runtimeSourceRef,
    localAgentRef: identity.localAgentRef,
  });
  return {
    ...identity,
    runtimeAppId,
    subjectUserId,
    requestContext,
  };
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r083
// @nimi-authority: rule.nimi.sdks.feature-clients.r078
// @nimi-authority: rule.nimi.sdks.feature-clients.r081
export function createNimiRuntimeAgentConsumeClient(
  options: NimiRuntimeAgentConsumeClientOptions,
): NimiRuntimeAgentConsumeClient {
  const runtimeAppId = requireText(options.runtimeAppId, 'runtimeAppId');
  const runtime = options.runtime;
  return {
    anchors: {
      open: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const response = await runtime.agents.openConversationAnchor({
          context: context.requestContext,
          subjectUserId: context.subjectUserId,
          localAgentRef: context.localAgentRef,
          ownerUserId: context.ownerUserId,
          runtimeSourceRef: context.runtimeSourceRef,
          ...(input.metadata ? { metadata: toNimiRuntimeProtoStruct(input.metadata) } : {}),
        }, callOptions);
        return decodeNimiRuntimeAgentConversationAnchorSnapshot(
          requireProjection(response.snapshot, 'Runtime Agent open conversation anchor returned no snapshot'),
          context.localAgentRef,
        );
      },
      getSnapshot: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const response = await runtime.agents.getConversationAnchorSnapshot({
          context: context.requestContext,
          agentId: context.localAgentRef,
          conversationAnchorId: requireText(input.conversationAnchorId, 'conversationAnchorId'),
        }, callOptions);
        return decodeNimiRuntimeAgentConversationAnchorSnapshot(
          requireProjection(response.snapshot, 'Runtime Agent conversation anchor snapshot is missing'),
          context.localAgentRef,
          requireText(input.conversationAnchorId, 'conversationAnchorId'),
        );
      },
      listSummaries: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const listSummaries = requireAgentMethod(
          runtime.agents.listAgentConversationSummaries,
          'listAgentConversationSummaries',
        );
        const response = await listSummaries({
          context: context.requestContext,
          agentId: context.localAgentRef,
          statusFilter: conversationAnchorStatusFilter(input.statusFilter),
          pageSize: nonNegativeInt(input.pageSize),
          pageToken: pageToken(input.pageToken),
        }, callOptions);
        if (!Array.isArray(response.summaries)) {
          runtimeAgentError(
            'Runtime Agent conversation summaries response missing summaries',
            'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
            'check_runtime_agent_conversation_summaries',
          );
        }
        const nextPageToken = normalizeText(response.nextPageToken);
        return {
          summaries: response.summaries.map((summary) => decodeConversationSummary(summary, context.localAgentRef)),
          ...(nextPageToken ? { nextPageToken } : {}),
        };
      },
    },
    turns: {
      getSessionSnapshot: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const response = await runtime.agents.getPublicChatSessionSnapshot({
          context: context.requestContext,
          agentId: context.localAgentRef,
          conversationAnchorId: requireText(input.conversationAnchorId, 'conversationAnchorId'),
          requestId: normalizeText(input.requestId),
          worldId: normalizeText(input.worldId),
        }, callOptions);
        return parseNimiRuntimeAgentSessionSnapshot(response.snapshot);
      },
      subscribe: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const streams: AsyncIterable<NimiRuntimeAgentConsumeEvent>[] = [];
        const conversationAnchorId = normalizeText(input.conversationAnchorId);
        const cursor = normalizeCursor(input.cursor);
        const liveStartedAtMs = cursor ? undefined : Date.now();
        if (input.includeTurnEvents !== false) {
          if (!runtime.appMessages) {
            runtimeAgentError(
              'Runtime Agent turn consume requires Runtime appMessages module',
              'SDK_RUNTIME_AGENT_APP_MESSAGES_REQUIRED',
              'provide_runtime_app_messages_module',
            );
          }
          streams.push(projectAppMessageStream(runtime.appMessages!.subscribeAppMessages({
            appId: context.runtimeAppId,
            subjectUserId: context.subjectUserId,
            cursor,
            fromAppIds: [RUNTIME_AGENT_APP_ID],
          }, callOptions), input, liveStartedAtMs));
        }

        if (input.includeAgentEvents !== false) {
          streams.push(projectAgentEventStream(runtime.agents.subscribeAgentEvents({
            context: context.requestContext,
            agentId: context.localAgentRef,
            cursor,
            eventFilters: [
              AgentEventType.HOOK,
              AgentEventType.STATE,
              AgentEventType.PRESENTATION,
            ],
          }, callOptions), conversationAnchorId, liveStartedAtMs));
        }
        return mergeNimiRuntimeAgentStreams(streams);
      },
    },
  };
}

export function decodeNimiRuntimeAgentConversationAnchorSnapshot(
  snapshot: ConversationAnchorSnapshot,
  expectedLocalAgentRef: string,
  expectedConversationAnchorId?: string,
): NimiRuntimeAgentConversationAnchorSnapshot {
  const sourceContextStatus = snapshot.sourceContextStatus
    ? decodeNimiRuntimeAgentSourceContextStatus(snapshot.sourceContextStatus)
    : undefined;
  const turnContextSummary = snapshot.turnContextSummary
    ? decodeNimiRuntimeAgentTurnContextSummary(snapshot.turnContextSummary)
    : undefined;
  const anchorId = requireConversationAnchorCorrelation(
    snapshot.anchor,
    expectedLocalAgentRef,
    expectedConversationAnchorId,
  );
  assertNimiRuntimeAgentContextProjectionCorrelation({
    sourceContextStatus,
    turnContextSummary,
    expectedLocalAgentRef,
    expectedConversationAnchorId: expectedConversationAnchorId || anchorId || undefined,
  });
  const { sourceContextStatus: _rawSource, turnContextSummary: _rawTurn, ...bounded } = snapshot;
  return {
    ...bounded,
    ...(sourceContextStatus ? { sourceContextStatus } : {}),
    ...(turnContextSummary ? { turnContextSummary } : {}),
  };
}

function decodeConversationSummary(
  summary: AgentConversationSummary,
  expectedLocalAgentRef: string,
): NimiRuntimeAgentConversationSummary {
  const sourceContextStatus = summary.sourceContextStatus
    ? decodeNimiRuntimeAgentSourceContextStatus(summary.sourceContextStatus)
    : undefined;
  const lastTurnContextSummary = summary.lastTurnContextSummary
    ? decodeNimiRuntimeAgentTurnContextSummary(summary.lastTurnContextSummary)
    : undefined;
  const anchorId = requireConversationAnchorCorrelation(summary.anchor, expectedLocalAgentRef);
  assertNimiRuntimeAgentContextProjectionCorrelation({
    sourceContextStatus,
    turnContextSummary: lastTurnContextSummary,
    expectedLocalAgentRef,
    expectedConversationAnchorId: anchorId,
  });
  const { sourceContextStatus: _rawSource, lastTurnContextSummary: _rawTurn, ...bounded } = summary;
  return {
    ...bounded,
    ...(sourceContextStatus ? { sourceContextStatus } : {}),
    ...(lastTurnContextSummary ? { lastTurnContextSummary } : {}),
  };
}

function requireConversationAnchorCorrelation(
  anchor: ConversationAnchorSnapshot['anchor'],
  expectedLocalAgentRef: string,
  expectedConversationAnchorId?: string,
): string {
  const anchorId = normalizeText(anchor?.conversationAnchorId);
  const localAgentRef = normalizeText(anchor?.localAgentRef);
  const agentId = normalizeText(anchor?.agentId);
  if (!anchorId
      || localAgentRef !== expectedLocalAgentRef
      || agentId !== expectedLocalAgentRef
      || expectedConversationAnchorId && anchorId !== expectedConversationAnchorId) {
    runtimeAgentError(
      'Runtime Agent conversation anchor snapshot identity mismatch',
      'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
      'check_runtime_agent_conversation_anchor_snapshot',
    );
  }
  return anchorId;
}

function requireProjection<T>(value: T | undefined | null, message: string): T {
  if (!value) {
    runtimeAgentError(message, 'SDK_RUNTIME_AGENT_RESPONSE_INVALID', 'check_runtime_agent_projection_shape');
  }
  return value;
}

function conversationAnchorStatusFilter(values: unknown): ConversationAnchorStatus[] {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) {
    runtimeAgentError(
      'Runtime Agent conversation summaries statusFilter must be an array',
      'SDK_RUNTIME_AGENT_INPUT_INVALID',
      'provide_runtime_agent_conversation_status_filter',
    );
  }
  return values.map((value) => conversationAnchorStatus(value));
}

function conversationAnchorStatus(value: unknown): ConversationAnchorStatus {
  if (value === ConversationAnchorStatus.ACTIVE || value === 'active') {
    return ConversationAnchorStatus.ACTIVE;
  }
  if (value === ConversationAnchorStatus.CLOSED || value === 'closed') {
    return ConversationAnchorStatus.CLOSED;
  }
  runtimeAgentError(
    'Runtime Agent conversation summaries statusFilter contains unsupported status',
    'SDK_RUNTIME_AGENT_INPUT_INVALID',
    'provide_runtime_agent_conversation_status_filter',
  );
}

function requireAgentMethod<Response>(
  method: ((request: unknown, options?: RuntimeTypedCallOptions) => Promise<Response>) | undefined,
  methodName: string,
): (request: unknown, options?: RuntimeTypedCallOptions) => Promise<Response> {
  if (!method) {
    runtimeAgentError(
      `Runtime Agent consume requires ${methodName}`,
      'SDK_RUNTIME_AGENT_METHOD_REQUIRED',
      'provide_runtime_agent_method',
    );
  }
  return method;
}

function nonNegativeInt(value: unknown): number {
  const parsed = optionalNumber(value);
  if (parsed === undefined) return 0;
  if (!Number.isInteger(parsed) || parsed < 0) {
    runtimeAgentError(
      'Runtime Agent maxOutputTokens must be a non-negative integer',
      'SDK_RUNTIME_AGENT_INPUT_INVALID',
      'provide_non_negative_max_output_tokens',
    );
  }
  return parsed;
}

function pageToken(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    runtimeAgentError(
      'Runtime Agent pageToken must be a Runtime returned string',
      'SDK_RUNTIME_AGENT_INPUT_INVALID',
      'use_runtime_returned_page_token',
    );
  }
  return value.trim();
}
