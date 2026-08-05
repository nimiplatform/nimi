import type {
  AgentConversationSummary,
  AgentEvent,
  AgentRequestContext,
  AppMessageEvent,
  AvatarDebugProbeResultEnvelope,
  AvatarDebugProbeKind,
  AvatarDebugRequestedBy,
  AvatarLiveInstanceBinding,
  CompanionParticipationProjection,
  CompanionParticipationSurfaceKind,
  CompanionParticipationTriggerSource,
  ConversationAnchorStatus,
  ConversationAnchorSnapshot,
  GetAvatarDebugReplayResponse,
  GetAvatarDebugSnapshotResponse,
  ListAvatarDebugProbeResultsResponse,
  RequestAvatarDebugProbeResponse,
  SubmitAvatarDebugProbeResultResponse,
  GetPublicChatSessionSnapshotResponse,
  OpenCompanionParticipationReplayResponse,
  RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
export type {
  GetAvatarDebugSnapshotResponse,
  ListAvatarDebugProbeResultsResponse,
  RequestAvatarDebugProbeResponse,
} from '../core-generated/runtime-typed-client';
import type { JsonObject } from '../types';
import type {
  RuntimeLocalAgentIdentityInput,
  RuntimeLocalAgentIdentityProjection,
} from './agent-local-identity';
import type {
  NimiRuntimeAgentSourceContextStatus,
  NimiRuntimeAgentTurnContextSummary,
} from './runtime-agent-context-projections';

export type NimiRuntimeAgentExecutionStateValue =
  | 'idle'
  | 'chat_active'
  | 'life_pending'
  | 'life_running'
  | 'suspended';

export type NimiRuntimeAgentTimelineChannel = 'text' | 'voice' | 'avatar' | 'state' | 'lipsync';

export interface NimiRuntimeAgentTimelineEnvelope {
  readonly turnId: string;
  readonly streamId: string;
  readonly channel: NimiRuntimeAgentTimelineChannel;
  readonly offsetMs: number;
  readonly sequence: number;
  readonly startedAtWall: string;
  readonly observedAtWall: string;
  readonly timebaseOwner: 'runtime';
  readonly projectionRuleId: 'K-AGCORE-051' | 'K-AGCORE-133';
  readonly clockBasis: 'monotonic_with_wall_anchor';
  readonly providerNeutral: true;
  readonly appLocalAuthority: false;
}

export interface NimiRuntimeAgentSessionTurnSnapshot {
  readonly turnId: string;
  readonly streamId?: string;
  readonly status?: string;
  readonly streamSequence?: number;
  readonly turnOrigin?: string;
  readonly followUpDepth?: number;
  readonly maxFollowUpTurns?: number;
  readonly outputObserved?: boolean;
  readonly reasoningObserved?: boolean;
  readonly updatedAt?: string;
  readonly messageId?: string;
  readonly text?: string;
  readonly structured?: JsonObject;
  readonly finishReason?: string;
  readonly reasonCode?: string;
  readonly actionHint?: string;
  readonly message?: string;
  readonly contextSummary?: NimiRuntimeAgentTurnContextSummary;
}

export interface NimiRuntimeAgentSessionTranscriptMessage {
  readonly id: string;
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly name?: string;
  readonly status: 'pending' | 'complete' | 'error' | 'committed' | 'failed';
  readonly kind: 'text' | 'image' | 'voice' | 'tool' | 'system';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly parentMessageId?: string;
  readonly traceId?: string;
  readonly reasoningText?: string;
  readonly mediaUrl?: string;
  readonly mediaMimeType?: string;
  readonly artifactId?: string;
  readonly metadata?: JsonObject;
}

export interface NimiRuntimeAgentSessionSnapshot {
  readonly requestId?: string;
  readonly threadId?: string;
  readonly subjectUserId?: string;
  readonly sessionStatus?: string;
  readonly transcriptMessageCount?: number;
  readonly transcript?: NimiRuntimeAgentSessionTranscriptMessage[];
  readonly configRevision?: number;
  readonly activeTurn?: NimiRuntimeAgentSessionTurnSnapshot;
  readonly lastTurn?: NimiRuntimeAgentSessionTurnSnapshot;
  readonly pendingFollowUp?: JsonObject;
}

export type NimiRuntimeAgentConversationAnchorSnapshot = Omit<
  ConversationAnchorSnapshot,
  'sourceContextStatus' | 'turnContextSummary'
> & {
  readonly sourceContextStatus?: NimiRuntimeAgentSourceContextStatus;
  readonly turnContextSummary?: NimiRuntimeAgentTurnContextSummary;
};

export type NimiRuntimeAgentConversationSummary = Omit<
  AgentConversationSummary,
  'sourceContextStatus' | 'lastTurnContextSummary'
> & {
  readonly sourceContextStatus?: NimiRuntimeAgentSourceContextStatus;
  readonly lastTurnContextSummary?: NimiRuntimeAgentTurnContextSummary;
};

export type NimiRuntimeAgentConsumeEvent =
  | NimiRuntimeAgentTurnConsumeEvent
  | NimiRuntimeAgentPresentationConsumeEvent
  | NimiRuntimeAgentStateConsumeEvent
  | NimiRuntimeAgentHookConsumeEvent
  | NimiRuntimeAgentAvatarDebugConsumeEvent;

export interface NimiRuntimeAgentBaseConsumeEvent {
  readonly eventName: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId?: string;
  readonly turnId?: string;
  readonly streamId?: string;
  readonly timeline?: NimiRuntimeAgentTimelineEnvelope;
  readonly detail: JsonObject;
}

export interface NimiRuntimeAgentTurnConsumeEvent extends NimiRuntimeAgentBaseConsumeEvent {
  readonly eventName:
    | 'runtime.agent.turn.accepted'
    | 'runtime.agent.turn.started'
    | 'runtime.agent.turn.reasoning_delta'
    | 'runtime.agent.turn.text_delta'
    | 'runtime.agent.turn.structured'
    | 'runtime.agent.turn.message_committed'
    | 'runtime.agent.turn.action_planned'
    | 'runtime.agent.turn.action_started'
    | 'runtime.agent.turn.artifact_ready'
    | 'runtime.agent.turn.action_completed'
    | 'runtime.agent.turn.action_failed'
    | 'runtime.agent.turn.post_turn'
    | 'runtime.agent.turn.completed'
    | 'runtime.agent.turn.failed'
    | 'runtime.agent.turn.interrupted'
    | 'runtime.agent.turn.interrupt_ack'
    | 'runtime.agent.presentation.voice_playback_requested'
    | 'runtime.agent.presentation.voice_stream_chunk_available'
    | 'runtime.agent.presentation.voice_playback_terminal'
    | 'runtime.agent.presentation.lipsync_frame_batch';
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly streamId: string;
  readonly detail: JsonObject;
}

export interface NimiRuntimeAgentPresentationConsumeEvent extends NimiRuntimeAgentBaseConsumeEvent {
  readonly eventName:
    | 'runtime.agent.presentation.activity_requested'
    | 'runtime.agent.presentation.motion_requested'
    | 'runtime.agent.presentation.expression_requested'
    | 'runtime.agent.presentation.pose_requested'
    | 'runtime.agent.presentation.pose_cleared'
    | 'runtime.agent.presentation.lookat_requested'
    | 'runtime.agent.presentation.voice_playback_requested'
    | 'runtime.agent.presentation.voice_stream_chunk_available'
    | 'runtime.agent.presentation.voice_playback_terminal';
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly streamId: string;
  readonly detail: JsonObject;
}

export interface NimiRuntimeAgentStateConsumeEvent extends NimiRuntimeAgentBaseConsumeEvent {
  readonly eventName:
    | 'runtime.agent.state.status_text_changed'
    | 'runtime.agent.state.execution_state_changed'
    | 'runtime.agent.state.emotion_changed'
    | 'runtime.agent.state.posture_changed';
  readonly originatingTurnId?: string;
  readonly originatingStreamId?: string;
  readonly detail: JsonObject;
}

export interface NimiRuntimeAgentHookConsumeEvent extends NimiRuntimeAgentBaseConsumeEvent {
  readonly eventName:
    | 'runtime.agent.hook.intent_proposed'
    | 'runtime.agent.hook.pending'
    | 'runtime.agent.hook.rejected'
    | 'runtime.agent.hook.running'
    | 'runtime.agent.hook.completed'
    | 'runtime.agent.hook.failed'
    | 'runtime.agent.hook.canceled'
    | 'runtime.agent.hook.rescheduled';
  readonly detail: JsonObject;
}

export interface NimiRuntimeAgentAvatarDebugConsumeEvent extends NimiRuntimeAgentBaseConsumeEvent {
  readonly eventName:
    | 'runtime.agent.avatar_debug.probe_requested'
    | 'runtime.agent.avatar_debug.probe_result'
    | 'runtime.agent.avatar_debug.replay_linked';
  readonly conversationAnchorId?: string;
  readonly detail: JsonObject;
}

export interface NimiRuntimeAgentConsumeContextInput extends RuntimeLocalAgentIdentityInput {
  readonly runtimeAppId: unknown;
  readonly subjectUserId?: unknown;
}

export interface NimiRuntimeAgentConsumeContext extends RuntimeLocalAgentIdentityProjection {
  readonly runtimeAppId: string;
  readonly subjectUserId: string;
  readonly requestContext: AgentRequestContext;
}

export type NimiRuntimeAgentConsumeIdentityInput = Omit<NimiRuntimeAgentConsumeContextInput, 'runtimeAppId'>;

export type NimiRuntimeAgentConversationAnchorStatus =
  | 'active'
  | 'closed';

export interface NimiRuntimeAgentConversationSummariesInput extends NimiRuntimeAgentConsumeIdentityInput {
  readonly statusFilter?: readonly (NimiRuntimeAgentConversationAnchorStatus | ConversationAnchorStatus)[];
  readonly pageSize?: unknown;
  readonly pageToken?: unknown;
}

export interface NimiRuntimeAgentConversationSummariesResult {
  readonly summaries: NimiRuntimeAgentConversationSummary[];
  readonly nextPageToken?: string;
}

export type NimiRuntimeAgentCompanionParticipationSurfaceKind =
  | 'avatar_companion'
  | 'desktop_companion_panel'
  | 'avatar_debug_workbench';

export type NimiRuntimeAgentCompanionParticipationTriggerSource =
  | 'user_explicit'
  | 'scheduled_proactive'
  | 'domain_event';

export type NimiRuntimeAgentCompanionParticipationStatus =
  | 'idle'
  | 'admission_pending'
  | 'blocked'
  | 'running'
  | 'candidate_ready'
  | 'committed_by_owner'
  | 'failed'
  | 'canceled';

export interface NimiRuntimeAgentCompanionParticipationProjection {
  readonly projectionId: string;
  readonly agentId: string;
  readonly surfaceKind: NimiRuntimeAgentCompanionParticipationSurfaceKind;
  readonly profileRef: string;
  readonly triggerSource: NimiRuntimeAgentCompanionParticipationTriggerSource;
  readonly status: NimiRuntimeAgentCompanionParticipationStatus;
  readonly candidateRef?: string;
  readonly commitRef?: string;
  readonly refusalReason?: string;
  readonly presentationRef?: string;
  readonly auditRef: string;
  readonly observedAt?: string;
  readonly conversationAnchorId: string;
  readonly turnId?: string;
  readonly streamId?: string;
}

export interface NimiRuntimeAgentCompanionParticipationReplay {
  readonly replayRef: string;
  readonly projection: NimiRuntimeAgentCompanionParticipationProjection;
}

export interface NimiRuntimeAgentCompanionParticipationBaseInput extends NimiRuntimeAgentConsumeIdentityInput {
  readonly conversationAnchorId: unknown;
  readonly surfaceKind?: NimiRuntimeAgentCompanionParticipationSurfaceKind | CompanionParticipationSurfaceKind;
  readonly triggerSource?: NimiRuntimeAgentCompanionParticipationTriggerSource | CompanionParticipationTriggerSource;
  readonly profileRef?: unknown;
  readonly requestId?: unknown;
}

export interface NimiRuntimeAgentCompanionParticipationRequestInput
  extends NimiRuntimeAgentCompanionParticipationBaseInput {
  readonly text: unknown;
  readonly threadId?: unknown;
  readonly worldId?: unknown;
  readonly maxOutputTokens?: unknown;
}

export interface NimiRuntimeAgentCompanionParticipationCancelInput
  extends NimiRuntimeAgentCompanionParticipationBaseInput {
  readonly projectionId?: unknown;
  readonly turnId?: unknown;
  readonly reason?: unknown;
}

export interface NimiRuntimeAgentCompanionParticipationReplayInput
  extends NimiRuntimeAgentCompanionParticipationBaseInput {
  readonly projectionId: unknown;
}

export interface NimiRuntimeAgentAvatarDebugBaseInput extends NimiRuntimeAgentConsumeIdentityInput {
  readonly conversationAnchorId: unknown;
}

export interface NimiRuntimeAgentAvatarDebugRequestProbeInput
  extends NimiRuntimeAgentAvatarDebugBaseInput {
  readonly probeKind: AvatarDebugProbeKind;
  readonly requestedBy: AvatarDebugRequestedBy;
  readonly probeId?: unknown;
  readonly turnId?: unknown;
  readonly streamId?: unknown;
  readonly avatarInstanceId?: unknown;
  readonly replayRequested?: boolean;
}

export interface NimiRuntimeAgentAvatarDebugListProbeResultsInput
  extends NimiRuntimeAgentAvatarDebugBaseInput {
  readonly probeKind?: AvatarDebugProbeKind;
}

export interface NimiRuntimeAgentAvatarDebugReplayInput extends NimiRuntimeAgentAvatarDebugBaseInput {
  readonly probeId: unknown;
}

export interface NimiRuntimeAgentAvatarDebugSubmitProbeResultInput
  extends NimiRuntimeAgentAvatarDebugBaseInput {
  readonly result: AvatarDebugProbeResultEnvelope;
}

export interface NimiRuntimeAgentConsumeRuntime {
  readonly agents: {
    openConversationAnchor(request: unknown, options?: RuntimeTypedCallOptions): Promise<{ snapshot?: ConversationAnchorSnapshot }>;
    getConversationAnchorSnapshot(request: unknown, options?: RuntimeTypedCallOptions): Promise<{ snapshot?: ConversationAnchorSnapshot }>;
    listAgentConversationSummaries?(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<{ summaries?: AgentConversationSummary[]; nextPageToken?: string }>;
    registerAvatarLiveInstanceBinding(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<{ binding?: AvatarLiveInstanceBinding; snapshot?: ConversationAnchorSnapshot }>;
    resolveAvatarLiveInstanceBinding(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<{ binding?: AvatarLiveInstanceBinding; snapshot?: ConversationAnchorSnapshot }>;
    getPublicChatSessionSnapshot(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetPublicChatSessionSnapshotResponse>;
    getCompanionParticipationProjection?(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<{ projection?: CompanionParticipationProjection }>;
    subscribeAgentEvents(request: unknown, options?: RuntimeTypedCallOptions): AsyncIterable<AgentEvent>;
    requestCompanionParticipation?(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<{ projection?: CompanionParticipationProjection }>;
    cancelCompanionParticipation?(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<{ projection?: CompanionParticipationProjection }>;
    openCompanionParticipationReplay?(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<OpenCompanionParticipationReplayResponse>;
    getAvatarDebugSnapshot?(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetAvatarDebugSnapshotResponse>;
    requestAvatarDebugProbe?(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<RequestAvatarDebugProbeResponse>;
    submitAvatarDebugProbeResult?(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<SubmitAvatarDebugProbeResultResponse>;
    listAvatarDebugProbeResults?(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<ListAvatarDebugProbeResultsResponse>;
    getAvatarDebugReplay?(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetAvatarDebugReplayResponse>;
  };
  readonly appMessages?: {
    subscribeAppMessages(request: unknown, options?: RuntimeTypedCallOptions): AsyncIterable<AppMessageEvent>;
  };
}

export interface NimiRuntimeAgentConsumeClientOptions {
  readonly runtime: NimiRuntimeAgentConsumeRuntime;
  readonly runtimeAppId: string;
}

export interface NimiRuntimeAgentConsumeClient {
  readonly anchors: {
    open(
      input: NimiRuntimeAgentConsumeIdentityInput & { readonly metadata?: JsonObject },
      options?: RuntimeTypedCallOptions,
    ): Promise<NimiRuntimeAgentConversationAnchorSnapshot>;
    getSnapshot(
      input: NimiRuntimeAgentConsumeIdentityInput & { readonly conversationAnchorId: unknown },
      options?: RuntimeTypedCallOptions,
    ): Promise<NimiRuntimeAgentConversationAnchorSnapshot>;
    listSummaries(
      input: NimiRuntimeAgentConversationSummariesInput,
      options?: RuntimeTypedCallOptions,
    ): Promise<NimiRuntimeAgentConversationSummariesResult>;
    registerAvatarLiveInstance(
      input: NimiRuntimeAgentConsumeIdentityInput & {
        readonly avatarInstanceId: unknown;
        readonly conversationAnchorId: unknown;
      },
      options?: RuntimeTypedCallOptions,
    ): Promise<{ readonly binding: AvatarLiveInstanceBinding; readonly snapshot: NimiRuntimeAgentConversationAnchorSnapshot }>;
    resolveAvatarLiveInstance(
      input: NimiRuntimeAgentConsumeIdentityInput & { readonly avatarInstanceId: unknown },
      options?: RuntimeTypedCallOptions,
    ): Promise<{ readonly binding: AvatarLiveInstanceBinding; readonly snapshot: NimiRuntimeAgentConversationAnchorSnapshot }>;
  };
  readonly turns: {
    getSessionSnapshot(
      input: NimiRuntimeAgentConsumeIdentityInput & {
        readonly conversationAnchorId: unknown;
        readonly requestId?: unknown;
        readonly worldId?: unknown;
      },
      options?: RuntimeTypedCallOptions,
    ): Promise<NimiRuntimeAgentSessionSnapshot>;
    subscribe(
      input: NimiRuntimeAgentConsumeIdentityInput & {
        readonly conversationAnchorId?: unknown;
        readonly cursor?: unknown;
        readonly includeAgentEvents?: boolean;
      },
      options?: RuntimeTypedCallOptions,
    ): Promise<AsyncIterable<NimiRuntimeAgentConsumeEvent>>;
  };
  readonly companionParticipation: {
    getProjection(
      input: NimiRuntimeAgentCompanionParticipationBaseInput,
      options?: RuntimeTypedCallOptions,
    ): Promise<NimiRuntimeAgentCompanionParticipationProjection>;
    request(
      input: NimiRuntimeAgentCompanionParticipationRequestInput,
      options?: RuntimeTypedCallOptions,
    ): Promise<NimiRuntimeAgentCompanionParticipationProjection>;
    cancel(
      input: NimiRuntimeAgentCompanionParticipationCancelInput,
      options?: RuntimeTypedCallOptions,
    ): Promise<NimiRuntimeAgentCompanionParticipationProjection>;
    openReplay(
      input: NimiRuntimeAgentCompanionParticipationReplayInput,
      options?: RuntimeTypedCallOptions,
    ): Promise<NimiRuntimeAgentCompanionParticipationReplay>;
  };
  readonly avatarDebug: {
    snapshot(
      input: NimiRuntimeAgentAvatarDebugBaseInput,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetAvatarDebugSnapshotResponse>;
    requestProbe(
      input: NimiRuntimeAgentAvatarDebugRequestProbeInput,
      options?: RuntimeTypedCallOptions,
    ): Promise<RequestAvatarDebugProbeResponse>;
    submitProbeResult(
      input: NimiRuntimeAgentAvatarDebugSubmitProbeResultInput,
      options?: RuntimeTypedCallOptions,
    ): Promise<SubmitAvatarDebugProbeResultResponse>;
    listProbeResults(
      input: NimiRuntimeAgentAvatarDebugListProbeResultsInput,
      options?: RuntimeTypedCallOptions,
    ): Promise<ListAvatarDebugProbeResultsResponse>;
    getReplay(
      input: NimiRuntimeAgentAvatarDebugReplayInput,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetAvatarDebugReplayResponse>;
  };
}

export type NimiRuntimeAgentCompanionParticipationInput =
  NimiRuntimeAgentCompanionParticipationBaseInput;
