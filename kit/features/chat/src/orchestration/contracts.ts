import type { TextMessageContentPart } from '@nimiplatform/sdk/runtime';
import type { ConversationMessageRole } from '../types.js';

export const CONVERSATION_ORCHESTRATION_MODE_IDS = [
  'simple-ai',
  'agent-local-chat-v1',
] as const;

export type KnownConversationOrchestrationModeId =
  (typeof CONVERSATION_ORCHESTRATION_MODE_IDS)[number];
export type ConversationOrchestrationModeId =
  | KnownConversationOrchestrationModeId
  | (string & {});

export type ConversationTurnRole = Extract<
  ConversationMessageRole,
  'system' | 'user' | 'assistant' | 'tool'
>;

export type ConversationTurnHistoryMessage = {
  id: string;
  role: ConversationTurnRole;
  text: string;
  name?: string | null;
  metadata?: Record<string, unknown>;
};

export type ConversationTurnInput = {
  modeId: ConversationOrchestrationModeId;
  threadId: string;
  turnId: string;
  userMessage: {
    id: string;
    text: string;
    attachments?: readonly unknown[];
  };
  history: readonly ConversationTurnHistoryMessage[];
  systemPrompt?: string | null;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
};

export type ConversationRuntimeUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ConversationRuntimeTrace = {
  traceId?: string | null;
  promptTraceId?: string | null;
  modelResolved?: string | null;
  routeDecision?: string | null;
};

export type ConversationRuntimeTextMessage = {
  role: ConversationTurnRole;
  text: string;
  content?: string | TextMessageContentPart[];
  name?: string | null;
};

export type ConversationRuntimeTextRequest = {
  modeId: ConversationOrchestrationModeId;
  threadId: string;
  turnId: string;
  messages: readonly ConversationRuntimeTextMessage[];
  systemPrompt?: string | null;
  model?: string;
  route?: 'local' | 'cloud';
  connectorId?: string;
  subjectUserId?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutMs?: number;
  reasoning?: {
    mode?: 'default' | 'off' | 'on';
    traceMode?: 'hide' | 'separate';
    budgetTokens?: number;
  };
  metadata?: Record<string, string>;
  signal?: AbortSignal;
};

export type ConversationTurnError = {
  code: string;
  message: string;
  retriable?: boolean;
};

export type ConversationRuntimeTextStreamPart =
  | { type: 'start' }
  | { type: 'reasoning-delta'; textDelta: string }
  | { type: 'text-delta'; textDelta: string }
  | {
    type: 'finish';
    finishReason: string;
    usage?: ConversationRuntimeUsage;
    trace?: ConversationRuntimeTrace;
  }
  | {
    type: 'error';
    error: ConversationTurnError;
    trace?: ConversationRuntimeTrace;
  };

export interface ConversationRuntimeAdapter {
  streamText: (
    request: ConversationRuntimeTextRequest,
  ) => Promise<{ stream: AsyncIterable<ConversationRuntimeTextStreamPart> }>;
}

export type ConversationContinuityLoadInput = {
  modeId: ConversationOrchestrationModeId;
  threadId: string;
  turnId: string;
  signal?: AbortSignal;
};

export type ConversationContinuityCommitInput = {
  modeId: ConversationOrchestrationModeId;
  threadId: string;
  turnId: string;
  outcome: 'completed' | 'failed' | 'canceled';
  outputText?: string;
  reasoningText?: string;
  error?: ConversationTurnError;
  events: readonly ConversationTurnEvent[];
  signal?: AbortSignal;
};

export type ConversationContinuityCancelInput = {
  modeId: ConversationOrchestrationModeId;
  threadId: string;
  turnId: string;
  scope: 'turn' | 'tail' | 'projection';
  signal?: AbortSignal;
};

export type ConversationProjectionRebuildResult = {
  threadId: string;
  projectionVersion: string;
  bundle?: unknown;
};

export interface ConversationContinuityAdapter<
  TLoadContext = unknown,
  TCommitResult = unknown,
> {
  loadTurnContext: (input: ConversationContinuityLoadInput) => Promise<TLoadContext>;
  commitTurnResult: (input: ConversationContinuityCommitInput) => Promise<TCommitResult>;
  cancelTurn: (input: ConversationContinuityCancelInput) => Promise<void>;
  rebuildProjection: (threadId: string) => Promise<ConversationProjectionRebuildResult>;
}

export interface ConversationVoiceAdapter {
  listVoices?: () => Promise<readonly unknown[]>;
  synthesize?: (input: unknown) => Promise<unknown>;
  streamSynthesis?: (input: unknown) => Promise<unknown>;
  transcribe?: (input: unknown) => Promise<unknown>;
}

export interface ConversationGenerationAdapter {
  submitJob?: (input: unknown) => Promise<unknown>;
  cancelJob?: (jobId: string) => Promise<void>;
  awaitArtifacts?: (jobId: string) => Promise<readonly unknown[]>;
}

export type ConversationBeatModality = 'text' | 'voice' | 'image' | 'video';

export type ConversationTurnEvent =
  | {
    type: 'turn-started';
    modeId: ConversationOrchestrationModeId;
    threadId: string;
    turnId: string;
  }
  | {
    type: 'reasoning-delta';
    turnId: string;
    textDelta: string;
  }
  | {
    type: 'text-delta';
    turnId: string;
    textDelta: string;
  }
  | {
    type: 'message-sealed';
    turnId: string;
    messageId?: string;
    beatId?: string;
    text: string;
  }
  | {
    type: 'beat-planned';
    turnId: string;
    beatId: string;
    beatIndex: number;
    modality: ConversationBeatModality;
  }
  | {
    type: 'beat-delivery-started';
    turnId: string;
    beatId: string;
  }
  | {
    type: 'beat-delivered';
    turnId: string;
    beatId: string;
    projectionMessageId?: string;
  }
  | {
    type: 'artifact-ready';
    turnId: string;
    beatId: string;
    artifactId: string;
    mimeType: string;
    projectionMessageId?: string;
  }
  | {
    type: 'projection-rebuilt';
    threadId: string;
    projectionVersion: string;
    bundle?: unknown;
  }
  | {
    type: 'turn-completed';
    turnId: string;
    outputText: string;
    reasoningText?: string;
    finishReason?: string;
    usage?: ConversationRuntimeUsage;
    trace?: ConversationRuntimeTrace;
    diagnostics?: Record<string, unknown>;
  }
  | {
    type: 'turn-failed';
    turnId: string;
    error: ConversationTurnError;
    outputText?: string;
    reasoningText?: string;
    finishReason?: string;
    usage?: ConversationRuntimeUsage;
    trace?: ConversationRuntimeTrace;
    diagnostics?: Record<string, unknown>;
  }
  | {
    type: 'turn-canceled';
    turnId: string;
    scope: 'turn' | 'tail' | 'projection';
    outputText?: string;
    reasoningText?: string;
    finishReason?: string;
    usage?: ConversationRuntimeUsage;
    trace?: ConversationRuntimeTrace;
    diagnostics?: Record<string, unknown>;
  };

export type ConversationTurnEventByType<TType extends ConversationTurnEvent['type']> = Extract<
  ConversationTurnEvent,
  { type: TType }
>;

export function matchConversationTurnEvent<TResult>(
  event: ConversationTurnEvent,
  handlers: {
    [TType in ConversationTurnEvent['type']]: (
      nextEvent: ConversationTurnEventByType<TType>,
    ) => TResult;
  },
): TResult {
  switch (event.type) {
    case 'turn-started':
      return handlers['turn-started'](event);
    case 'reasoning-delta':
      return handlers['reasoning-delta'](event);
    case 'text-delta':
      return handlers['text-delta'](event);
    case 'message-sealed':
      return handlers['message-sealed'](event);
    case 'beat-planned':
      return handlers['beat-planned'](event);
    case 'beat-delivery-started':
      return handlers['beat-delivery-started'](event);
    case 'beat-delivered':
      return handlers['beat-delivered'](event);
    case 'artifact-ready':
      return handlers['artifact-ready'](event);
    case 'projection-rebuilt':
      return handlers['projection-rebuilt'](event);
    case 'turn-completed':
      return handlers['turn-completed'](event);
    case 'turn-failed':
      return handlers['turn-failed'](event);
    case 'turn-canceled':
      return handlers['turn-canceled'](event);
    default:
      return assertNever(event);
  }
}

export type ConversationProviderCapabilities = {
  reasoning: boolean;
  continuity: boolean;
  firstBeat: boolean;
  voiceInput: boolean;
  voiceOutput: boolean;
  imageGeneration: boolean;
  videoGeneration: boolean;
};

export interface ConversationOrchestrationProvider {
  readonly modeId: ConversationOrchestrationModeId;
  readonly capabilities: ConversationProviderCapabilities;
  runTurn: (
    input: ConversationTurnInput,
  ) => AsyncIterable<ConversationTurnEvent>;
  cancelTurn?: (input: ConversationContinuityCancelInput) => Promise<void>;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled conversation turn event: ${JSON.stringify(value)}`);
}
