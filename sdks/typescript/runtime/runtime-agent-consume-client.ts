import {
  AgentEventType,
  AvatarDebugProbeKind,
  AvatarDebugRequestedBy,
  CompanionParticipationStatus,
  CompanionParticipationSurfaceKind,
  CompanionParticipationTriggerSource,
  ConversationAnchorStatus,
  type AgentEvent,
  type AppMessageEvent,
  type CompanionParticipationProjection,
  type ConversationAnchorSnapshot,
  type AgentConversationSummary,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import {
  buildRuntimeAgentRequestContext,
  projectRuntimeLocalAgentIdentity,
} from './agent-local-identity';
import {
  toNimiRuntimeIsoFromTimestamp,
  toNimiRuntimeProtoStruct,
} from './runtime-agent-values';
import {
  asRecord,
  normalizeText,
  optionalNumber,
  requireText,
  runtimeAgentError,
} from './runtime-agent-consume-internal';
import {
  parseNimiRuntimeAgentSessionSnapshot,
  projectNimiRuntimeAgentAppMessageEvent,
  projectNimiRuntimeAgentServiceEvent,
} from './runtime-agent-consume-projection';
import type {
  NimiRuntimeAgentCompanionParticipationInput,
  NimiRuntimeAgentConsumeClient,
  NimiRuntimeAgentConsumeClientOptions,
  NimiRuntimeAgentConsumeContext,
  NimiRuntimeAgentConsumeContextInput,
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentCompanionParticipationProjection,
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
    scopedBinding: input.scopedBinding,
  });
  return {
    ...identity,
    runtimeAppId,
    subjectUserId,
    requestContext,
    ...(input.scopedBinding ? { scopedBinding: input.scopedBinding } : {}),
  };
}

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
      registerAvatarLiveInstance: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const response = await runtime.agents.registerAvatarLiveInstanceBinding({
          context: context.requestContext,
          avatarInstanceId: requireText(input.avatarInstanceId, 'avatarInstanceId'),
          conversationAnchorId: requireText(input.conversationAnchorId, 'conversationAnchorId'),
        }, callOptions);
        return {
          binding: requireProjection(response.binding, 'Runtime Agent Avatar live instance binding is missing'),
          snapshot: decodeNimiRuntimeAgentConversationAnchorSnapshot(
            requireProjection(response.snapshot, 'Runtime Agent Avatar live instance snapshot is missing'),
            context.localAgentRef,
            requireText(input.conversationAnchorId, 'conversationAnchorId'),
          ),
        };
      },
      resolveAvatarLiveInstance: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const response = await runtime.agents.resolveAvatarLiveInstanceBinding({
          context: context.requestContext,
          avatarInstanceId: requireText(input.avatarInstanceId, 'avatarInstanceId'),
        }, callOptions);
        const binding = requireProjection(
          response.binding,
          'Runtime Agent Avatar live instance binding is missing',
        );
        return {
          binding,
          snapshot: decodeNimiRuntimeAgentConversationAnchorSnapshot(
            requireProjection(response.snapshot, 'Runtime Agent Avatar live instance snapshot is missing'),
            context.localAgentRef,
            requireText(binding.conversationAnchorId, 'binding.conversationAnchorId'),
          ),
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
        if (!runtime.appMessages) {
          runtimeAgentError(
            'Runtime Agent turn consume requires Runtime appMessages module',
            'SDK_RUNTIME_AGENT_APP_MESSAGES_REQUIRED',
            'provide_runtime_app_messages_module',
          );
        }
        streams.push(projectAppMessageStream(runtime.appMessages.subscribeAppMessages({
          appId: context.runtimeAppId,
          subjectUserId: context.scopedBinding ? '' : context.subjectUserId,
          ...(context.scopedBinding ? { scopedBinding: context.scopedBinding } : {}),
          cursor,
          fromAppIds: [RUNTIME_AGENT_APP_ID],
        }, callOptions), input, liveStartedAtMs));

        if (input.includeAgentEvents !== false) {
          streams.push(projectAgentEventStream(runtime.agents.subscribeAgentEvents({
            context: context.requestContext,
            agentId: context.localAgentRef,
            cursor,
            eventFilters: [
              AgentEventType.HOOK,
              AgentEventType.STATE,
              AgentEventType.PRESENTATION,
              AgentEventType.AVATAR_DEBUG,
            ],
          }, callOptions), conversationAnchorId, liveStartedAtMs));
        }
        return mergeNimiRuntimeAgentStreams(streams);
      },
    },
    companionParticipation: {
      getProjection: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const getProjection = requireAgentMethod(
          runtime.agents.getCompanionParticipationProjection,
          'getCompanionParticipationProjection',
        );
        const response = await getProjection(companionParticipationRequest(context, input), callOptions);
        return decodeNimiRuntimeAgentCompanionParticipationProjection(response.projection);
      },
      request: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const response = await runtime.agents.requestCompanionParticipation({
          ...companionParticipationRequest(context, input),
          text: requireText(input.text, 'text'),
          threadId: normalizeText(input.threadId),
          worldId: normalizeText(input.worldId),
          maxOutputTokens: nonNegativeInt(input.maxOutputTokens),
        }, callOptions);
        return decodeNimiRuntimeAgentCompanionParticipationProjection(response.projection);
      },
      cancel: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const response = await runtime.agents.cancelCompanionParticipation({
          ...companionParticipationRequest(context, input),
          projectionId: normalizeText(input.projectionId),
          turnId: normalizeText(input.turnId),
          reason: normalizeText(input.reason),
        }, callOptions);
        return decodeNimiRuntimeAgentCompanionParticipationProjection(response.projection);
      },
      openReplay: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const openReplay = requireAgentMethod(
          runtime.agents.openCompanionParticipationReplay,
          'openCompanionParticipationReplay',
        );
        const response = await openReplay({
          ...companionParticipationRequest(context, input),
          projectionId: requireText(input.projectionId, 'projectionId'),
        }, callOptions);
        return {
          replayRef: requireText(response.replayRef, 'replayRef'),
          projection: decodeNimiRuntimeAgentCompanionParticipationProjection(response.projection),
        };
      },
    },
    avatarDebug: {
      snapshot: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const snapshot = requireAgentMethod(runtime.agents.getAvatarDebugSnapshot, 'getAvatarDebugSnapshot');
        return snapshot({
          context: context.requestContext,
          agentId: context.localAgentRef,
          conversationAnchorId: requireText(input.conversationAnchorId, 'conversationAnchorId'),
        }, callOptions);
      },
      requestProbe: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const requestProbe = requireAgentMethod(runtime.agents.requestAvatarDebugProbe, 'requestAvatarDebugProbe');
        return requestProbe({
          context: context.requestContext,
          agentId: context.localAgentRef,
          conversationAnchorId: requireText(input.conversationAnchorId, 'conversationAnchorId'),
          probeKind: avatarDebugProbeKind(input.probeKind, { allowUnspecified: false }),
          requestedBy: avatarDebugRequestedBy(input.requestedBy),
          probeId: normalizeText(input.probeId),
          turnId: normalizeText(input.turnId),
          streamId: normalizeText(input.streamId),
          avatarInstanceId: normalizeText(input.avatarInstanceId),
          replayRequested: Boolean(input.replayRequested),
        }, callOptions);
      },
      submitProbeResult: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const submitProbeResult = requireAgentMethod(
          runtime.agents.submitAvatarDebugProbeResult,
          'submitAvatarDebugProbeResult',
        );
        return submitProbeResult({
          context: context.requestContext,
          agentId: context.localAgentRef,
          conversationAnchorId: requireText(input.conversationAnchorId, 'conversationAnchorId'),
          result: input.result,
        }, callOptions);
      },
      listProbeResults: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const listProbeResults = requireAgentMethod(
          runtime.agents.listAvatarDebugProbeResults,
          'listAvatarDebugProbeResults',
        );
        return listProbeResults({
          context: context.requestContext,
          agentId: context.localAgentRef,
          conversationAnchorId: requireText(input.conversationAnchorId, 'conversationAnchorId'),
          probeKind: avatarDebugProbeKind(input.probeKind, {
            allowUnspecified: true,
            fallback: AvatarDebugProbeKind.UNSPECIFIED,
          }),
        }, callOptions);
      },
      getReplay: async (input, callOptions) => {
        const context = buildNimiRuntimeAgentConsumeContext({ ...input, runtimeAppId });
        const getReplay = requireAgentMethod(runtime.agents.getAvatarDebugReplay, 'getAvatarDebugReplay');
        return getReplay({
          context: context.requestContext,
          agentId: context.localAgentRef,
          conversationAnchorId: requireText(input.conversationAnchorId, 'conversationAnchorId'),
          probeId: requireText(input.probeId, 'probeId'),
        }, callOptions);
      },
    },
  };
}

export function decodeNimiRuntimeAgentCompanionParticipationProjection(
  projection: CompanionParticipationProjection | undefined,
): NimiRuntimeAgentCompanionParticipationProjection {
  if (!projection) {
    runtimeAgentError(
      'Runtime Agent companion participation projection is missing',
      'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
      'check_runtime_agent_companion_projection',
    );
  }
  const status = companionStatus(projection.status);
  const candidateRef = normalizeText(projection.candidateRef);
  const commitRef = normalizeText(projection.commitRef);
  if (status === 'candidate_ready' && !candidateRef) {
    runtimeAgentError(
      'Runtime Agent companion participation candidate_ready projection missing candidateRef',
      'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
      'check_runtime_agent_companion_projection',
    );
  }
  if (status === 'committed_by_owner' && !commitRef) {
    runtimeAgentError(
      'Runtime Agent companion participation committed_by_owner projection missing commitRef',
      'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
      'check_runtime_agent_companion_projection',
    );
  }
  const observedAt = toNimiRuntimeIsoFromTimestamp(projection.observedAt);
  return {
    projectionId: requiredProjectionText(projection.projectionId, 'projectionId'),
    agentId: requiredProjectionText(projection.agentId, 'agentId'),
    surfaceKind: companionSurfaceKindId(projection.surfaceKind),
    profileRef: requiredProjectionText(projection.profileRef, 'profileRef'),
    roomOrchestrationRef: requiredProjectionText(projection.roomOrchestrationRef, 'roomOrchestrationRef'),
    triggerSource: companionTriggerSourceId(projection.triggerSource),
    status,
    ...(candidateRef ? { candidateRef } : {}),
    ...(commitRef ? { commitRef } : {}),
    ...(normalizeText(projection.refusalReason) ? { refusalReason: normalizeText(projection.refusalReason) } : {}),
    ...(normalizeText(projection.presentationRef) ? { presentationRef: normalizeText(projection.presentationRef) } : {}),
    auditRef: requiredProjectionText(projection.auditRef, 'auditRef'),
    ...(observedAt ? { observedAt } : {}),
    conversationAnchorId: requiredProjectionText(projection.conversationAnchorId, 'conversationAnchorId'),
    ...(normalizeText(projection.turnId) ? { turnId: normalizeText(projection.turnId) } : {}),
    ...(normalizeText(projection.streamId) ? { streamId: normalizeText(projection.streamId) } : {}),
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

function companionParticipationRequest(
  context: NimiRuntimeAgentConsumeContext,
  input: NimiRuntimeAgentCompanionParticipationInput,
) {
  return {
    context: context.requestContext,
    agentId: context.localAgentRef,
    conversationAnchorId: requireText(input.conversationAnchorId, 'conversationAnchorId'),
    surfaceKind: companionSurfaceKind(input.surfaceKind),
    triggerSource: companionTriggerSource(input.triggerSource),
    profileRef: normalizeText(input.profileRef),
    roomOrchestrationRef: normalizeText(input.roomOrchestrationRef),
    requestId: normalizeText(input.requestId),
  };
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

function companionSurfaceKind(value: unknown): CompanionParticipationSurfaceKind {
  if (value === CompanionParticipationSurfaceKind.AVATAR_COMPANION || value === 'avatar_companion') {
    return CompanionParticipationSurfaceKind.AVATAR_COMPANION;
  }
  if (value === CompanionParticipationSurfaceKind.DESKTOP_COMPANION_PANEL || value === 'desktop_companion_panel') {
    return CompanionParticipationSurfaceKind.DESKTOP_COMPANION_PANEL;
  }
  if (value === CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH || value === 'avatar_debug_workbench') {
    return CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH;
  }
  if (value === undefined || value === null || value === '') {
    return CompanionParticipationSurfaceKind.AVATAR_COMPANION;
  }
  runtimeAgentError(
    'Runtime Agent companion participation surfaceKind is unsupported',
    'SDK_RUNTIME_AGENT_INPUT_INVALID',
    'provide_supported_companion_surface_kind',
  );
}

function companionTriggerSource(value: unknown): CompanionParticipationTriggerSource {
  if (value === CompanionParticipationTriggerSource.USER_EXPLICIT || value === 'user_explicit') {
    return CompanionParticipationTriggerSource.USER_EXPLICIT;
  }
  if (value === CompanionParticipationTriggerSource.SCHEDULED_PROACTIVE || value === 'scheduled_proactive') {
    return CompanionParticipationTriggerSource.SCHEDULED_PROACTIVE;
  }
  if (value === CompanionParticipationTriggerSource.DOMAIN_EVENT || value === 'domain_event') {
    return CompanionParticipationTriggerSource.DOMAIN_EVENT;
  }
  if (value === undefined || value === null || value === '') {
    return CompanionParticipationTriggerSource.USER_EXPLICIT;
  }
  runtimeAgentError(
    'Runtime Agent companion participation triggerSource is unsupported',
    'SDK_RUNTIME_AGENT_INPUT_INVALID',
    'provide_supported_companion_trigger_source',
  );
}

function companionSurfaceKindId(value: CompanionParticipationSurfaceKind | string) {
  if (value === CompanionParticipationSurfaceKind.AVATAR_COMPANION || value === 'avatar_companion') {
    return 'avatar_companion';
  }
  if (value === CompanionParticipationSurfaceKind.DESKTOP_COMPANION_PANEL || value === 'desktop_companion_panel') {
    return 'desktop_companion_panel';
  }
  if (value === CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH || value === 'avatar_debug_workbench') {
    return 'avatar_debug_workbench';
  }
  runtimeAgentError(
    'Runtime Agent companion participation projection has unsupported surfaceKind',
    'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
    'check_runtime_agent_companion_projection',
  );
}

function companionTriggerSourceId(value: CompanionParticipationTriggerSource | string) {
  if (value === CompanionParticipationTriggerSource.USER_EXPLICIT || value === 'user_explicit') {
    return 'user_explicit';
  }
  if (value === CompanionParticipationTriggerSource.SCHEDULED_PROACTIVE || value === 'scheduled_proactive') {
    return 'scheduled_proactive';
  }
  if (value === CompanionParticipationTriggerSource.DOMAIN_EVENT || value === 'domain_event') {
    return 'domain_event';
  }
  runtimeAgentError(
    'Runtime Agent companion participation projection has unsupported triggerSource',
    'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
    'check_runtime_agent_companion_projection',
  );
}

function companionStatus(value: CompanionParticipationStatus | string) {
  if (value === CompanionParticipationStatus.IDLE || value === 'idle') {
    return 'idle';
  }
  if (value === CompanionParticipationStatus.ADMISSION_PENDING || value === 'admission_pending') {
    return 'admission_pending';
  }
  if (value === CompanionParticipationStatus.BLOCKED || value === 'blocked') {
    return 'blocked';
  }
  if (value === CompanionParticipationStatus.RUNNING || value === 'running') {
    return 'running';
  }
  if (value === CompanionParticipationStatus.CANDIDATE_READY || value === 'candidate_ready') {
    return 'candidate_ready';
  }
  if (value === CompanionParticipationStatus.COMMITTED_BY_OWNER || value === 'committed_by_owner') {
    return 'committed_by_owner';
  }
  if (value === CompanionParticipationStatus.FAILED || value === 'failed') {
    return 'failed';
  }
  if (value === CompanionParticipationStatus.CANCELED || value === 'canceled') {
    return 'canceled';
  }
  runtimeAgentError(
    'Runtime Agent companion participation projection has unsupported status',
    'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
    'check_runtime_agent_companion_projection',
  );
}

function requiredProjectionText(value: unknown, field: string): string {
  const text = normalizeText(value);
  if (!text) {
    runtimeAgentError(
      `Runtime Agent companion participation projection missing ${field}`,
      'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
      'check_runtime_agent_companion_projection',
    );
  }
  return text;
}

function avatarDebugProbeKind(
  value: unknown,
  options: { readonly allowUnspecified: boolean; readonly fallback?: AvatarDebugProbeKind },
): AvatarDebugProbeKind {
  if (value === undefined || value === null || value === '') {
    if (options.fallback !== undefined) return options.fallback;
    runtimeAgentError(
      'Runtime Agent avatar debug probeKind is required',
      'SDK_RUNTIME_AGENT_INPUT_INVALID',
      'provide_runtime_agent_avatar_debug_probe_kind',
    );
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !isAvatarDebugProbeKind(parsed)) {
    runtimeAgentError(
      'Runtime Agent avatar debug probeKind is unsupported',
      'SDK_RUNTIME_AGENT_INPUT_INVALID',
      'provide_runtime_agent_avatar_debug_probe_kind',
    );
  }
  if (parsed === AvatarDebugProbeKind.UNSPECIFIED && !options.allowUnspecified) {
    runtimeAgentError(
      'Runtime Agent avatar debug probeKind must name a concrete probe',
      'SDK_RUNTIME_AGENT_INPUT_INVALID',
      'provide_runtime_agent_avatar_debug_probe_kind',
    );
  }
  return parsed as AvatarDebugProbeKind;
}

function avatarDebugRequestedBy(value: unknown): AvatarDebugRequestedBy {
  if (value === AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH || value === AvatarDebugRequestedBy.RUNTIME_POLICY) {
    return value;
  }
  runtimeAgentError(
    'Runtime Agent avatar debug requestedBy is unsupported',
    'SDK_RUNTIME_AGENT_INPUT_INVALID',
    'provide_runtime_agent_avatar_debug_requested_by',
  );
}

function isAvatarDebugProbeKind(value: number): value is AvatarDebugProbeKind {
  switch (value) {
    case AvatarDebugProbeKind.UNSPECIFIED:
    case AvatarDebugProbeKind.PACKAGE_VALIDATION:
    case AvatarDebugProbeKind.LAUNCH_READINESS:
    case AvatarDebugProbeKind.BACKEND_LOAD:
    case AvatarDebugProbeKind.CAPABILITY_PROFILE:
    case AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX:
    case AvatarDebugProbeKind.GENERATED_MOTION:
    case AvatarDebugProbeKind.EMOTION_EXPRESSION:
    case AvatarDebugProbeKind.SPEECH_LIPSYNC:
    case AvatarDebugProbeKind.WINDOW_HIT_REGION:
      return true;
    default:
      return false;
  }
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

function normalizeCursor(value: unknown): string {
  const cursor = normalizeText(value);
  if (!cursor) return '';
  if (!/^\d+$/u.test(cursor)) {
    runtimeAgentError(
      'Runtime Agent stream cursor must be a non-negative integer string',
      'SDK_RUNTIME_AGENT_INPUT_INVALID',
      'use_runtime_agent_returned_cursor',
    );
  }
  return cursor;
}

function projectAppMessageStream(
  stream: AsyncIterable<AppMessageEvent>,
  request: { readonly conversationAnchorId?: unknown },
  liveStartedAtMs?: number,
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return projectRuntimeAgentConsumeEventStream(stream, (event) => {
    if (!eventIsAtOrAfterLiveBoundary(event, liveStartedAtMs)) return null;
    const projected = projectNimiRuntimeAgentAppMessageEvent(event);
    if (!projected) return null;
    const expectedAnchorId = normalizeText(request.conversationAnchorId);
    if (expectedAnchorId && projected.conversationAnchorId !== expectedAnchorId) {
      return null;
    }
    return projected;
  });
}

function projectAgentEventStream(
  stream: AsyncIterable<AgentEvent>,
  conversationAnchorId: string,
  liveStartedAtMs?: number,
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return projectRuntimeAgentConsumeEventStream(stream, (event) => {
    if (!eventIsAtOrAfterLiveBoundary(event, liveStartedAtMs)) return null;
    const projected = projectNimiRuntimeAgentServiceEvent(event);
    if (conversationAnchorId && projected.conversationAnchorId && projected.conversationAnchorId !== conversationAnchorId) {
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

function projectRuntimeAgentConsumeEventStream<Input>(
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

function mergeNimiRuntimeAgentStreams(
  sources: readonly AsyncIterable<NimiRuntimeAgentConsumeEvent>[],
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  type NextState = {
    readonly index: number;
    readonly result?: IteratorResult<NimiRuntimeAgentConsumeEvent>;
    readonly error?: unknown;
  };
  const entries = sources.map((source, index) => ({
    index,
    iterator: source[Symbol.asyncIterator](),
    next: undefined as Promise<NextState> | undefined,
  }));
  const pull = (
    iterator: AsyncIterator<NimiRuntimeAgentConsumeEvent>,
    index: number,
  ): Promise<NextState> =>
    iterator.next().then(
      (result) => ({ index, result }),
      (error) => ({ index, error }),
    );
  for (const entry of entries) {
    entry.next = pull(entry.iterator, entry.index);
  }
  let closed = false;
  return {
    [Symbol.asyncIterator](): AsyncIterator<NimiRuntimeAgentConsumeEvent> {
      return {
        next: async () => {
          while (!closed && entries.length > 0) {
            const next = await Promise.race(entries.map((entry) => entry.next!));
            if (next.error) {
              throw next.error;
            }
            const result = next.result;
            if (!result) {
              continue;
            }
            const entryIndex = entries.findIndex((entry) => entry.index === next.index);
            if (entryIndex < 0) continue;
            if (result.done) {
              entries.splice(entryIndex, 1);
              continue;
            }
            const entry = entries[entryIndex];
            if (!entry) {
              continue;
            }
            entry.next = pull(entry.iterator, entry.index);
            return { done: false, value: result.value };
          }
          return { done: true, value: undefined };
        },
        return: async () => {
          closed = true;
          await Promise.allSettled(entries.map((entry) => entry.iterator.return?.()));
          entries.splice(0, entries.length);
          return { done: true, value: undefined };
        },
      };
    },
  };
}
