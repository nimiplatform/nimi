import type {
  AgentConversationSummary,
  AgentEvent,
  AgentRequestContext,
  AppMessageEvent,
  ConversationAnchorStatus,
  ConversationAnchorSnapshot,
  GetPublicChatSessionSnapshotResponse,
  RuntimeTypedCallOptions,
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
  | NimiRuntimeAgentHookConsumeEvent;

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
    | 'runtime.agent.conversation.voice_timing_ready'
    | 'runtime.agent.conversation.voice_artifact_available'
    | 'runtime.agent.conversation.voice_timing_terminal';
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
    | 'runtime.agent.conversation.voice_timing_ready'
    | 'runtime.agent.conversation.voice_artifact_available'
    | 'runtime.agent.conversation.voice_timing_terminal';
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

export interface NimiRuntimeAgentConsumeRuntime {
  readonly agents: {
    openConversationAnchor(request: unknown, options?: RuntimeTypedCallOptions): Promise<{ snapshot?: ConversationAnchorSnapshot }>;
    getConversationAnchorSnapshot(request: unknown, options?: RuntimeTypedCallOptions): Promise<{ snapshot?: ConversationAnchorSnapshot }>;
    listAgentConversationSummaries?(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<{ summaries?: AgentConversationSummary[]; nextPageToken?: string }>;
    getPublicChatSessionSnapshot(
      request: unknown,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetPublicChatSessionSnapshotResponse>;
    subscribeAgentEvents(request: unknown, options?: RuntimeTypedCallOptions): AsyncIterable<AgentEvent>;
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
        readonly includeTurnEvents?: boolean;
        readonly includeAgentEvents?: boolean;
      },
      options?: RuntimeTypedCallOptions,
    ): Promise<AsyncIterable<NimiRuntimeAgentConsumeEvent>>;
  };
}
