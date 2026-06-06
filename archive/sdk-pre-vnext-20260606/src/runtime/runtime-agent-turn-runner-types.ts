import type { AgentResolvedMessageActionEnvelope } from './runtime-agent-message-action.js';
import type {
  RuntimeAgentProjectionSummary,
  RuntimeAgentSnapshotRecoveryLogEvent,
  RuntimeAgentTimelineSummary,
} from './runtime-agent-consumer-helpers.js';
import type {
  RuntimeAgentConsumeRequest,
  RuntimeAgentTurnRequest,
  RuntimeAgentTurnsModule,
} from './types-runtime-agent.js';

export type RuntimeAgentTurnRunnerTrace = {
  traceId?: string | null;
  promptTraceId?: string | null;
  modelResolved?: string | null;
  routeDecision?: string | null;
};

export type RuntimeAgentTurnRunnerCommittedMessage = {
  messageId: string;
  text: string;
  runtimeTurnId: string;
  runtimeStreamId: string;
};

export type RuntimeAgentTurnRunnerContext = {
  request: RuntimeAgentTurnRequest;
  requestId: string;
  requestMessageId: string;
  conversationAnchorId: string;
  runtimeTurnId: string;
  runtimeStreamId: string;
  route: string;
  modelId: string;
  connectorId?: string;
  trace?: RuntimeAgentTurnRunnerTrace;
  runtimeProjectionEvents: RuntimeAgentProjectionSummary[];
  runtimeTurnTimelines: RuntimeAgentTimelineSummary[];
};

export type RuntimeAgentTurnRunnerMetadataInput = RuntimeAgentTurnRunnerContext & {
  envelope: AgentResolvedMessageActionEnvelope;
  committedMessage: RuntimeAgentTurnRunnerCommittedMessage;
  latestTimeline?: RuntimeAgentTimelineSummary | null;
};

export type RuntimeAgentTurnRunnerDiagnosticsInput = RuntimeAgentTurnRunnerContext & {
  extra?: Record<string, unknown>;
};

export type RuntimeAgentTurnRunnerLogEvent =
  | RuntimeAgentSnapshotRecoveryLogEvent
  | {
    level: 'info' | 'warn' | 'error';
    area: string;
    message: `action:${string}` | `phase:${string}`;
    costMs?: number;
    details: Record<string, unknown>;
  };

export type RuntimeAgentTurnRunnerTimingStage =
  | 'subscribe'
  | 'request_ack'
  | 'accepted_to_started'
  | 'started_to_first_delta'
  | 'message_committed_to_message_sealed'
  | 'completed_to_ui_done';

export type RuntimeAgentTurnRunnerPart =
  | {
    type: 'reasoning-delta';
    textDelta: string;
  }
  | {
    type: 'text-delta';
    textDelta: string;
  }
  | {
    type: 'message-sealed';
    envelope: AgentResolvedMessageActionEnvelope;
    trace?: RuntimeAgentTurnRunnerTrace;
    metadataJson?: Record<string, unknown> | null;
    diagnostics?: Record<string, unknown>;
  }
  | {
    type: 'turn-completed';
    outputText: string;
    finishReason?: string;
    trace?: RuntimeAgentTurnRunnerTrace;
    diagnostics?: Record<string, unknown>;
  }
  | {
    type: 'turn-failed';
    error: {
      code: string;
      message: string;
    };
    outputText?: string;
    reasoningText?: string;
    finishReason?: string;
    trace?: RuntimeAgentTurnRunnerTrace;
    diagnostics?: Record<string, unknown>;
  }
  | {
    type: 'turn-canceled';
    scope: 'turn';
    outputText?: string;
    reasoningText?: string;
    trace?: RuntimeAgentTurnRunnerTrace;
    diagnostics?: Record<string, unknown>;
  };

export type RuntimeAgentTurnRunnerOptions = {
  turns: RuntimeAgentTurnsModule;
  request: RuntimeAgentTurnRequest;
  subscribe?: RuntimeAgentConsumeRequest;
  signal?: AbortSignal;
  interruptReason?: string;
  route?: string;
  modelId?: string;
  connectorId?: string;
  stallRecoveryIntervalMs?: number;
  logEvent?: (event: RuntimeAgentTurnRunnerLogEvent) => void;
  logTiming?: (event: {
    stage: RuntimeAgentTurnRunnerTimingStage;
    startedAt: number;
    details: Record<string, unknown>;
  }) => void;
  nowMs?: () => number;
  resolveTrace?: () => RuntimeAgentTurnRunnerTrace | undefined;
  buildMetadata?: (input: RuntimeAgentTurnRunnerMetadataInput) => Record<string, unknown> | null | undefined;
  buildDiagnostics?: (input: RuntimeAgentTurnRunnerDiagnosticsInput) => Record<string, unknown> | undefined;
};
