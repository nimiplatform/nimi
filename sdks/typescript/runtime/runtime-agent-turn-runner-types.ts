import type { SendAppMessageResponse } from '../core-generated/runtime-typed-client';
import type { ScopedRuntimeBindingAttachment } from '../core-generated/runtime-protobuf/runtime/v1/common';
import type { JsonObject } from '../types';
import type {
  RuntimeLocalAgentIdentityInput,
} from './agent-local-identity';
import type {
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentSessionSnapshot,
  NimiRuntimeAgentSessionTurnSnapshot,
} from './runtime-agent-consume-types';
import type { NimiRuntimeAgentResolvedMessageActionEnvelope } from './runtime-agent-message-action';

export type NimiRuntimeAgentMessage = {
  readonly id?: string;
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly name?: string;
  readonly status?: 'pending' | 'complete' | 'error' | 'committed' | 'failed';
  readonly kind?: 'text' | 'image' | 'voice' | 'tool' | 'system';
  readonly reasoningText?: string;
  readonly traceId?: string;
  readonly parentMessageId?: string;
  readonly mediaUrl?: string;
  readonly mediaMimeType?: string;
  readonly artifactId?: string;
  readonly metadata?: JsonObject;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type NimiRuntimeAgentTranscriptMessage = NimiRuntimeAgentMessage & {
  readonly id: string;
  readonly status: 'pending' | 'complete' | 'error' | 'committed' | 'failed';
  readonly kind: 'text' | 'image' | 'voice' | 'tool' | 'system';
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type NimiRuntimeAgentExecutionBinding = {
  readonly route: 'local' | 'cloud';
  readonly modelId: string;
  readonly connectorId?: string;
};

export type NimiRuntimeAgentExecutionBindings = Partial<Record<
  'text.generate' | 'image.generate' | 'audio.synthesize',
  NimiRuntimeAgentExecutionBinding
>>;

export type NimiRuntimeAgentReasoningRequest = {
  readonly mode?: string;
  readonly traceMode?: string;
  readonly budgetTokens?: number;
};

export type NimiRuntimeAgentTurnRequest = RuntimeLocalAgentIdentityInput & {
  readonly conversationAnchorId: string;
  readonly requestId?: string;
  readonly threadId?: string;
  readonly systemPrompt?: string;
  readonly worldId?: string;
  readonly maxOutputTokens?: number;
  readonly messages: readonly NimiRuntimeAgentMessage[];
  readonly executionBindings: NimiRuntimeAgentExecutionBindings;
  readonly executionParams?: Partial<Record<'image.generate' | 'audio.synthesize', JsonObject>>;
  readonly reasoning?: NimiRuntimeAgentReasoningRequest;
  readonly scopedBinding?: ScopedRuntimeBindingAttachment;
};

export type NimiRuntimeAgentTurnInterruptRequest = RuntimeLocalAgentIdentityInput & {
  readonly conversationAnchorId: string;
  readonly turnId?: string;
  readonly reason?: string;
  readonly worldId?: string;
  readonly scopedBinding?: ScopedRuntimeBindingAttachment;
};

export type NimiRuntimeAgentTurnVoiceRenderRequest = RuntimeLocalAgentIdentityInput & {
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly messageId: string;
  readonly text?: string;
  readonly playbackTarget?: 'desktop_manual' | 'replay';
  readonly subjectUserId?: string;
  readonly worldId?: string;
  readonly timeoutMs?: number;
  readonly scopedBinding?: ScopedRuntimeBindingAttachment;
};

export type NimiRuntimeAgentTurnVoiceRenderResult =
  | {
    readonly status: 'ready';
    readonly event: NimiRuntimeAgentConsumeEvent & { readonly eventName: 'runtime.agent.presentation.voice_playback_requested' };
    readonly audioArtifactId: string;
    readonly audioMimeType: string;
  }
  | {
    readonly status: 'text_only';
    readonly reason: 'voice_projection_unavailable';
  };

export type NimiRuntimeAgentConsumeRequest = RuntimeLocalAgentIdentityInput & {
  readonly conversationAnchorId?: string;
  readonly subjectUserId?: string;
  readonly cursor?: string;
  readonly includeAgentEvents?: boolean;
  readonly scopedBinding?: ScopedRuntimeBindingAttachment;
};

export type NimiRuntimeAgentSessionSnapshotRequest = RuntimeLocalAgentIdentityInput & {
  readonly conversationAnchorId: string;
  readonly requestId?: string;
  readonly worldId?: string;
  readonly scopedBinding?: ScopedRuntimeBindingAttachment;
};

export type NimiRuntimeAgentTurnsModule = {
  subscribe(
    request: NimiRuntimeAgentConsumeRequest,
  ): Promise<AsyncIterable<NimiRuntimeAgentConsumeEvent>>;
  request(
    request: NimiRuntimeAgentTurnRequest,
  ): Promise<SendAppMessageResponse>;
  interrupt(
    request: NimiRuntimeAgentTurnInterruptRequest,
  ): Promise<SendAppMessageResponse>;
  renderVoice(
    request: NimiRuntimeAgentTurnVoiceRenderRequest,
  ): Promise<NimiRuntimeAgentTurnVoiceRenderResult>;
  getSessionSnapshot(
    request: NimiRuntimeAgentSessionSnapshotRequest,
  ): Promise<NimiRuntimeAgentSessionSnapshot>;
};

export type NimiRuntimeAgentTurnRunnerTrace = {
  readonly traceId?: string | null;
  readonly promptTraceId?: string | null;
  readonly modelResolved?: string | null;
  readonly routeDecision?: string | null;
};

export type NimiRuntimeAgentProjectionSummary = {
  readonly eventName: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string | null;
  readonly runtimeTurnId: string | null;
  readonly runtimeStreamId: string | null;
  readonly detail: JsonObject;
};

export type NimiRuntimeAgentTimelineSummary = {
  readonly turnId: string;
  readonly streamId: string;
  readonly channel: string;
  readonly offsetMs: number;
  readonly sequence: number;
  readonly startedAtWall: string;
  readonly observedAtWall: string;
  readonly timebaseOwner: string;
  readonly projectionRuleId: string;
  readonly clockBasis: string;
  readonly providerNeutral: boolean;
  readonly appLocalAuthority: boolean;
};

export type NimiRuntimeAgentSnapshotRecoveryLogEvent = {
  readonly level: 'info' | 'warn' | 'error';
  readonly area: string;
  readonly message: `action:${string}` | `phase:${string}`;
  readonly details: JsonObject;
};

export type NimiRuntimeAgentSnapshotRecoveryResult = 'none' | 'bound' | 'terminal';

export type NimiRuntimeAgentTurnRunnerCommittedMessage = {
  readonly messageId: string;
  readonly text: string;
  readonly runtimeTurnId: string;
  readonly runtimeStreamId: string;
};

export type NimiRuntimeAgentTurnRunnerContext = {
  readonly request: NimiRuntimeAgentTurnRequest;
  readonly requestId: string;
  readonly requestMessageId: string;
  readonly conversationAnchorId: string;
  readonly runtimeTurnId: string;
  readonly runtimeStreamId: string;
  readonly route: string;
  readonly modelId: string;
  readonly connectorId?: string;
  readonly trace?: NimiRuntimeAgentTurnRunnerTrace;
  readonly runtimeProjectionEvents: NimiRuntimeAgentProjectionSummary[];
  readonly runtimeTurnTimelines: NimiRuntimeAgentTimelineSummary[];
};

export type NimiRuntimeAgentTurnRunnerMetadataInput = NimiRuntimeAgentTurnRunnerContext & {
  readonly envelope: NimiRuntimeAgentResolvedMessageActionEnvelope;
  readonly committedMessage: NimiRuntimeAgentTurnRunnerCommittedMessage;
  readonly latestTimeline?: NimiRuntimeAgentTimelineSummary | null;
};

export type NimiRuntimeAgentTurnRunnerDiagnosticsInput = NimiRuntimeAgentTurnRunnerContext & {
  readonly extra?: JsonObject;
};

export type NimiRuntimeAgentTurnRunnerLogEvent =
  | NimiRuntimeAgentSnapshotRecoveryLogEvent
  | {
    readonly level: 'info' | 'warn' | 'error';
    readonly area: string;
    readonly message: `action:${string}` | `phase:${string}`;
    readonly costMs?: number;
    readonly details: JsonObject;
  };

export type NimiRuntimeAgentTurnRunnerTimingStage =
  | 'subscribe'
  | 'request_ack'
  | 'accepted_to_started'
  | 'started_to_first_delta'
  | 'message_committed_to_message_sealed'
  | 'completed_to_ui_done';

export type NimiRuntimeAgentTurnRunnerPart =
  | {
    readonly type: 'reasoning-delta';
    readonly textDelta: string;
  }
  | {
    readonly type: 'text-delta';
    readonly textDelta: string;
  }
  | {
    readonly type: 'message-sealed';
    readonly envelope: NimiRuntimeAgentResolvedMessageActionEnvelope;
    readonly trace?: NimiRuntimeAgentTurnRunnerTrace;
    readonly metadataJson?: JsonObject | null;
    readonly diagnostics?: JsonObject;
  }
  | {
    readonly type: 'beat-planned';
    readonly beatId: string;
    readonly turnId: string;
    readonly projectionMessageId?: string;
  }
  | {
    readonly type: 'beat-delivery-started';
    readonly beatId: string;
    readonly turnId: string;
    readonly projectionMessageId?: string;
  }
  | {
    readonly type: 'artifact-ready';
    readonly beatId: string;
    readonly turnId: string;
    readonly artifactId: string;
    readonly mimeType: string;
    readonly projectionMessageId?: string;
  }
  | {
    readonly type: 'beat-delivered';
    readonly beatId: string;
    readonly turnId: string;
    readonly projectionMessageId?: string;
    readonly artifactId?: string;
    readonly mimeType?: string;
  }
  | {
    readonly type: 'turn-completed';
    readonly outputText: string;
    readonly finishReason?: string;
    readonly trace?: NimiRuntimeAgentTurnRunnerTrace;
    readonly diagnostics?: JsonObject;
  }
  | {
    readonly type: 'turn-failed';
    readonly error: {
      readonly code: string;
      readonly message: string;
    };
    readonly outputText?: string;
    readonly reasoningText?: string;
    readonly finishReason?: string;
    readonly trace?: NimiRuntimeAgentTurnRunnerTrace;
    readonly diagnostics?: JsonObject;
  }
  | {
    readonly type: 'turn-canceled';
    readonly scope: 'turn';
    readonly outputText?: string;
    readonly reasoningText?: string;
    readonly trace?: NimiRuntimeAgentTurnRunnerTrace;
    readonly diagnostics?: JsonObject;
  };

export type NimiRuntimeAgentTurnRunnerOptions = {
  readonly turns: NimiRuntimeAgentTurnsModule;
  readonly request: NimiRuntimeAgentTurnRequest;
  readonly subscribe?: NimiRuntimeAgentConsumeRequest;
  readonly signal?: AbortSignal;
  readonly interruptReason?: string;
  readonly route?: string;
  readonly modelId?: string;
  readonly connectorId?: string;
  readonly stallRecoveryIntervalMs?: number;
  readonly logEvent?: (event: NimiRuntimeAgentTurnRunnerLogEvent) => void;
  readonly logTiming?: (event: {
    readonly stage: NimiRuntimeAgentTurnRunnerTimingStage;
    readonly startedAt: number;
    readonly details: JsonObject;
  }) => void;
  readonly nowMs?: () => number;
  readonly resolveTrace?: () => NimiRuntimeAgentTurnRunnerTrace | undefined;
  readonly buildMetadata?: (input: NimiRuntimeAgentTurnRunnerMetadataInput) => JsonObject | null | undefined;
  readonly buildDiagnostics?: (input: NimiRuntimeAgentTurnRunnerDiagnosticsInput) => JsonObject | undefined;
};

export type NimiRuntimeAgentSnapshotRecoveryRequestContext = {
  readonly ownerUserId?: unknown;
  readonly realmAgentId?: unknown;
  readonly localAgentRef: unknown;
  readonly conversationAnchorId: string;
  readonly threadId?: string;
};

export type NimiRuntimeAgentSnapshotRecoveryTurn = NimiRuntimeAgentSessionTurnSnapshot;
