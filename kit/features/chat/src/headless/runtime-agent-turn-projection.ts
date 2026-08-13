import type {
  ConversationOrchestrationModeId,
  ConversationRuntimeTrace,
  ConversationRuntimeUsage,
  ConversationTurnError,
  ConversationTurnEvent,
} from '../orchestration/contracts.js';
import type {
  ConversationCanonicalMessage,
} from '../types.js';

type JsonRecord = Record<string, unknown>;

export type RuntimeAgentTurnRunnerMessageEnvelopeLike = {
  readonly message?: {
    readonly messageId?: unknown;
    readonly text?: unknown;
  } | null;
};

export type RuntimeAgentTurnRunnerPartLike =
  | {
    readonly type: 'reasoning-delta';
    readonly textDelta?: unknown;
  }
  | {
    readonly type: 'text-delta';
    readonly textDelta?: unknown;
  }
  | {
    readonly type: 'message-sealed';
    readonly envelope?: RuntimeAgentTurnRunnerMessageEnvelopeLike | null;
    readonly trace?: ConversationRuntimeTrace;
    readonly metadataJson?: JsonRecord | null;
    readonly diagnostics?: JsonRecord;
  }
  | {
    readonly type: 'beat-planned';
    readonly beatId?: unknown;
    readonly turnId?: unknown;
    readonly projectionMessageId?: unknown;
  }
  | {
    readonly type: 'beat-delivery-started';
    readonly beatId?: unknown;
    readonly turnId?: unknown;
    readonly projectionMessageId?: unknown;
  }
  | {
    readonly type: 'artifact-ready';
    readonly beatId?: unknown;
    readonly turnId?: unknown;
    readonly artifactId?: unknown;
    readonly mimeType?: unknown;
    readonly projectionMessageId?: unknown;
  }
  | {
    readonly type: 'beat-delivered';
    readonly beatId?: unknown;
    readonly turnId?: unknown;
    readonly projectionMessageId?: unknown;
    readonly artifactId?: unknown;
    readonly mimeType?: unknown;
  }
  | {
    readonly type: 'beat-delivery-failed';
    readonly beatId?: unknown;
    readonly turnId?: unknown;
    readonly operation?: unknown;
    readonly modality?: unknown;
    readonly reasonCode?: unknown;
    readonly reason?: unknown;
    readonly message?: unknown;
    readonly projectionMessageId?: unknown;
  }
  | {
    readonly type: 'turn-completed';
    readonly outputText?: unknown;
    readonly finishReason?: unknown;
    readonly usage?: ConversationRuntimeUsage;
    readonly trace?: ConversationRuntimeTrace;
    readonly diagnostics?: JsonRecord;
  }
  | {
    readonly type: 'turn-failed';
    readonly error?: Partial<ConversationTurnError> | null;
    readonly outputText?: unknown;
    readonly reasoningText?: unknown;
    readonly finishReason?: unknown;
    readonly usage?: ConversationRuntimeUsage;
    readonly trace?: ConversationRuntimeTrace;
    readonly diagnostics?: JsonRecord;
  }
  | {
    readonly type: 'turn-canceled';
    readonly scope?: unknown;
    readonly outputText?: unknown;
    readonly reasoningText?: unknown;
    readonly trace?: ConversationRuntimeTrace;
    readonly diagnostics?: JsonRecord;
  };

export type RuntimeAgentArtifactPreviewInput = {
  readonly artifactId: string;
  readonly mimeType: string;
  readonly beatId: string;
  readonly projectionMessageId?: string;
};

export type RuntimeAgentTurnRunnerProjectionOptions = {
  readonly modeId: ConversationOrchestrationModeId;
  readonly threadId: string;
  readonly turnId: string;
  readonly parts: AsyncIterable<RuntimeAgentTurnRunnerPartLike | unknown>;
  readonly resolveArtifactPreviewUri?: (
    artifact: RuntimeAgentArtifactPreviewInput,
  ) => Promise<string | null | undefined> | string | null | undefined;
};

export type RuntimeAgentConversationProjectionStatus =
  | 'idle'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'canceled';

export type RuntimeAgentConversationProjectionState = {
  readonly modeId: ConversationOrchestrationModeId;
  readonly threadId: string;
  readonly turnId: string;
  readonly sessionId: string;
  readonly targetId: string;
  readonly conversationAnchorId: string | null;
  readonly localAgentRef: string | null;
  readonly status: RuntimeAgentConversationProjectionStatus;
  readonly reasonCode: string;
  readonly message: string;
  readonly outputText: string;
  readonly reasoningText: string;
  readonly diagnostics: JsonRecord | null;
  readonly trace: ConversationRuntimeTrace | null;
  readonly messages: readonly ConversationCanonicalMessage[];
  readonly events: readonly ConversationTurnEvent[];
};

export type RuntimeAgentConversationProjectionInitialInput = {
  readonly modeId: ConversationOrchestrationModeId;
  readonly threadId: string;
  readonly turnId: string;
  readonly sessionId: string;
  readonly targetId: string;
  readonly conversationAnchorId?: string | null;
  readonly localAgentRef?: string | null;
  readonly userMessage: {
    readonly id: string;
    readonly text: string;
    readonly createdAt?: string;
    readonly senderName?: string | null;
  };
  readonly assistantMessageId?: string;
  readonly assistantName?: string | null;
  readonly createdAt?: string;
};

export type RuntimeAgentConversationProjectionReduceOptions = {
  readonly now?: () => string;
};

export function createRuntimeAgentConversationProjectionState(
  input: RuntimeAgentConversationProjectionInitialInput,
): RuntimeAgentConversationProjectionState {
  const createdAt = normalizeText(input.createdAt) || new Date().toISOString();
  const userCreatedAt = normalizeText(input.userMessage.createdAt) || createdAt;
  const assistantMessageId = normalizeText(input.assistantMessageId) || `${input.turnId}:assistant`;
  return {
    modeId: input.modeId,
    threadId: input.threadId,
    turnId: input.turnId,
    sessionId: input.sessionId,
    targetId: input.targetId,
    conversationAnchorId: normalizeText(input.conversationAnchorId) || null,
    localAgentRef: normalizeText(input.localAgentRef) || null,
    status: 'idle',
    reasonCode: 'runtime-agent-turn-idle',
    message: 'Runtime Agent turn has not started.',
    outputText: '',
    reasoningText: '',
    diagnostics: null,
    trace: null,
    events: [],
    messages: [
      {
        id: input.userMessage.id,
        sessionId: input.sessionId,
        targetId: input.targetId,
        source: 'agent',
        role: 'user',
        text: input.userMessage.text,
        createdAt: userCreatedAt,
        updatedAt: userCreatedAt,
        status: 'complete',
        kind: 'text',
        senderName: input.userMessage.senderName ?? 'You',
        senderKind: 'human',
        metadata: runtimeAgentMessageMetadata(input),
      },
      {
        id: assistantMessageId,
        sessionId: input.sessionId,
        targetId: input.targetId,
        source: 'agent',
        role: 'agent',
        text: '',
        createdAt,
        updatedAt: createdAt,
        status: 'pending',
        kind: 'streaming',
        senderName: input.assistantName ?? 'Agent',
        senderKind: 'agent',
        metadata: runtimeAgentMessageMetadata(input),
      },
    ],
  };
}

export function reduceRuntimeAgentConversationProjectionEvent(
  state: RuntimeAgentConversationProjectionState,
  event: ConversationTurnEvent,
  options: RuntimeAgentConversationProjectionReduceOptions = {},
): RuntimeAgentConversationProjectionState {
  const now = options.now?.() || new Date().toISOString();
  const events = [...state.events, event];

  switch (event.type) {
    case 'turn-started':
      return updateAssistantMessage({
        ...state,
        status: 'streaming',
        reasonCode: 'runtime-agent-turn-streaming',
        message: 'Runtime Agent turn is streaming.',
        events,
      }, now, (message) => ({
        ...message,
        status: 'streaming',
        kind: 'streaming',
      }));
    case 'reasoning-delta': {
      const reasoningText = `${state.reasoningText}${event.textDelta}`;
      return updateAssistantMessage({
        ...state,
        status: state.status === 'idle' ? 'streaming' : state.status,
        reasonCode: state.status === 'idle' ? 'runtime-agent-turn-streaming' : state.reasonCode,
        message: state.status === 'idle' ? 'Runtime Agent turn is streaming.' : state.message,
        reasoningText,
        events,
      }, now, (message) => ({
        ...message,
        status: message.status === 'pending' ? 'streaming' : message.status,
        kind: message.kind === 'text' ? 'text' : 'streaming',
        metadata: mergeMessageMetadata(message.metadata, {
          reasoningText,
        }),
      }));
    }
    case 'text-delta': {
      const outputText = `${state.outputText}${event.textDelta}`;
      return updateAssistantMessage({
        ...state,
        status: state.status === 'idle' ? 'streaming' : state.status,
        reasonCode: state.status === 'idle' ? 'runtime-agent-turn-streaming' : state.reasonCode,
        message: state.status === 'idle' ? 'Runtime Agent turn is streaming.' : state.message,
        outputText,
        events,
      }, now, (message) => ({
        ...message,
        text: outputText,
        status: 'streaming',
        kind: 'streaming',
      }));
    }
    case 'message-sealed': {
      const outputText = event.text || state.outputText;
      return updateAssistantMessage({
        ...state,
        outputText,
        events,
      }, now, (message) => ({
        ...message,
        id: normalizeText(event.messageId) || message.id,
        text: outputText,
        status: 'streaming',
        kind: 'text',
      }));
    }
    case 'artifact-ready':
      return reduceArtifactReadyEvent({
        ...state,
        events,
      }, event, now);
    case 'beat-delivery-failed':
      return appendImageFailureMessage({
        ...state,
        events,
      }, event, now);
    case 'turn-completed':
      return updateAssistantMessage({
        ...state,
        status: 'completed',
        reasonCode: 'runtime-agent-turn-completed',
        message: 'Runtime Agent turn completed.',
        outputText: event.outputText || state.outputText,
        reasoningText: event.reasoningText || state.reasoningText,
        diagnostics: mergeRecord(state.diagnostics, event.diagnostics),
        trace: event.trace ?? state.trace,
        events,
      }, now, (message) => ({
        ...message,
        text: event.outputText || state.outputText || message.text,
        status: 'complete',
        kind: 'text',
        metadata: mergeMessageMetadata(message.metadata, {
          reasoningText: event.reasoningText || state.reasoningText || undefined,
          ...(event.diagnostics || {}),
        }),
      }));
    case 'turn-failed': {
      const reasonCode = normalizeText(event.error.code) || 'runtime-agent-turn-failed';
      const errorMessage = normalizeText(event.error.message) || 'Runtime Agent turn failed.';
      return updateAssistantMessage({
        ...state,
        status: 'failed',
        reasonCode,
        message: errorMessage,
        outputText: event.outputText || state.outputText,
        reasoningText: event.reasoningText || state.reasoningText,
        diagnostics: mergeRecord(state.diagnostics, event.diagnostics),
        trace: event.trace ?? state.trace,
        events,
      }, now, (message) => ({
        ...message,
        text: event.outputText || state.outputText || message.text || errorMessage,
        status: 'error',
        error: errorMessage,
        kind: 'text',
        metadata: mergeMessageMetadata(message.metadata, {
          reasoningText: event.reasoningText || state.reasoningText || undefined,
          ...(event.diagnostics || {}),
        }),
      }));
    }
    case 'turn-canceled':
      return updateAssistantMessage({
        ...state,
        status: 'canceled',
        reasonCode: 'runtime-agent-turn-canceled',
        message: 'Runtime Agent turn was canceled.',
        outputText: event.outputText || state.outputText,
        reasoningText: event.reasoningText || state.reasoningText,
        diagnostics: mergeRecord(state.diagnostics, event.diagnostics),
        trace: event.trace ?? state.trace,
        events,
      }, now, (message) => ({
        ...message,
        text: event.outputText || state.outputText || message.text,
        status: 'canceled',
        kind: 'text',
        metadata: mergeMessageMetadata(message.metadata, {
          reasoningText: event.reasoningText || state.reasoningText || undefined,
          ...(event.diagnostics || {}),
        }),
      }));
    case 'beat-planned':
    case 'beat-delivery-started':
    case 'beat-delivered':
    case 'projection-rebuilt':
      return { ...state, events };
    default:
      return assertNever(event);
  }
}

export async function* streamRuntimeAgentTurnRunnerPartsAsConversationEvents(
  input: RuntimeAgentTurnRunnerProjectionOptions,
): AsyncIterable<ConversationTurnEvent> {
  yield {
    type: 'turn-started',
    modeId: input.modeId,
    threadId: input.threadId,
    turnId: input.turnId,
  };

  let reasoningText = '';
  let outputText = '';
  let messageSealed = false;
  let outputDiagnostics: JsonRecord | null = null;

  for await (const rawPart of input.parts) {
    const part = asRuntimeAgentTurnPart(rawPart);
    switch (part.type) {
      case 'reasoning-delta': {
        const textDelta = normalizeText(part.textDelta);
        if (!textDelta) break;
        reasoningText += textDelta;
        yield {
          type: 'reasoning-delta',
          turnId: input.turnId,
          textDelta,
        };
        break;
      }
      case 'text-delta': {
        const textDelta = stringValue(part.textDelta);
        if (!textDelta) break;
        outputText += textDelta;
        yield {
          type: 'text-delta',
          turnId: input.turnId,
          textDelta,
        };
        break;
      }
      case 'message-sealed': {
        const messageText = normalizeText(part.envelope?.message?.text);
        const messageId = normalizeText(part.envelope?.message?.messageId);
        outputText = messageText || outputText;
        messageSealed = true;
        outputDiagnostics = mergeRecord(outputDiagnostics, part.diagnostics);
        yield {
          type: 'message-sealed',
          turnId: input.turnId,
          ...(messageId ? { messageId } : {}),
          beatId: `${input.turnId}:beat:0`,
          text: outputText,
        };
        break;
      }
      case 'beat-planned': {
        const beatIndex = beatIndexFromRuntimeActionId(part.beatId);
        yield {
          type: 'beat-planned',
          turnId: input.turnId,
          beatId: uiBeatId(input.turnId, beatIndex),
          beatIndex,
          modality: 'image',
        };
        break;
      }
      case 'beat-delivery-started': {
        const beatIndex = beatIndexFromRuntimeActionId(part.beatId);
        yield {
          type: 'beat-delivery-started',
          turnId: input.turnId,
          beatId: uiBeatId(input.turnId, beatIndex),
        };
        break;
      }
      case 'artifact-ready': {
        const artifactId = normalizeText(part.artifactId);
        const mimeType = normalizeText(part.mimeType);
        const projectionMessageId = normalizeText(part.projectionMessageId) || undefined;
        const beatIndex = beatIndexFromRuntimeActionId(part.beatId);
        const beatId = uiBeatId(input.turnId, beatIndex);
        const uri = artifactId && input.resolveArtifactPreviewUri
          ? normalizeText(await input.resolveArtifactPreviewUri({
            artifactId,
            mimeType,
            beatId,
            projectionMessageId,
          })) || undefined
          : undefined;
        yield {
          type: 'artifact-ready',
          turnId: input.turnId,
          beatId,
          artifactId,
          mimeType,
          ...(uri ? { uri } : {}),
          ...(projectionMessageId ? { projectionMessageId } : {}),
        };
        break;
      }
      case 'beat-delivered': {
        const beatIndex = beatIndexFromRuntimeActionId(part.beatId);
        const projectionMessageId = normalizeText(part.projectionMessageId) || undefined;
        yield {
          type: 'beat-delivered',
          turnId: input.turnId,
          beatId: uiBeatId(input.turnId, beatIndex),
          ...(projectionMessageId ? { projectionMessageId } : {}),
        };
        break;
      }
      case 'beat-delivery-failed': {
        const runtimeTurnId = normalizeText(part.turnId) || input.turnId;
        const actionId = normalizeText(part.beatId) || 'image.generate';
        const beatIndex = beatIndexFromRuntimeActionId(actionId);
        const projectionMessageId = normalizeText(part.projectionMessageId) || undefined;
        yield {
          type: 'beat-delivery-failed',
          turnId: input.turnId,
          beatId: uiBeatId(input.turnId, beatIndex),
          operationId: `${runtimeTurnId}:${actionId}`,
          operation: normalizeText(part.operation) || 'image.generate',
          modality: 'image',
          reasonCode: normalizeText(part.reasonCode) || 'AI_PROVIDER_INTERNAL',
          reason: normalizeText(part.reason) || 'image_execution_failed',
          message: normalizeText(part.message) || 'Image generation failed.',
          ...(projectionMessageId ? { projectionMessageId } : {}),
        };
        break;
      }
      case 'turn-completed':
        outputDiagnostics = mergeRecord(outputDiagnostics, part.diagnostics);
        outputText = normalizeText(part.outputText) || outputText;
        if (!messageSealed) {
          yield {
            type: 'turn-failed',
            turnId: input.turnId,
            error: {
              code: 'RUNTIME_AGENT_CHAT_INVALID',
              message: 'runtime.agent completed without structured message-sealed event',
            },
            outputText: outputText || undefined,
            reasoningText: reasoningText || undefined,
            finishReason: normalizeText(part.finishReason) || undefined,
            usage: part.usage,
            trace: part.trace,
            diagnostics: {
              ...(outputDiagnostics || {}),
              missingStructuredProjection: true,
            },
          };
          return;
        }
        yield {
          type: 'turn-completed',
          turnId: input.turnId,
          outputText,
          reasoningText: reasoningText || undefined,
          finishReason: normalizeText(part.finishReason) || undefined,
          usage: part.usage,
          trace: part.trace,
          diagnostics: outputDiagnostics || undefined,
        };
        return;
      case 'turn-failed': {
        outputDiagnostics = mergeRecord(outputDiagnostics, part.diagnostics);
        yield {
          type: 'turn-failed',
          turnId: input.turnId,
          error: {
            code: normalizeText(part.error?.code) || 'RUNTIME_AGENT_TURN_FAILED',
            message: normalizeText(part.error?.message) || 'Runtime Agent turn failed.',
          },
          outputText: normalizeText(part.outputText) || outputText || undefined,
          reasoningText: normalizeText(part.reasoningText) || reasoningText || undefined,
          finishReason: normalizeText(part.finishReason) || undefined,
          usage: part.usage,
          trace: part.trace,
          diagnostics: outputDiagnostics || undefined,
        };
        return;
      }
      case 'turn-canceled':
        outputDiagnostics = mergeRecord(outputDiagnostics, part.diagnostics);
        yield {
          type: 'turn-canceled',
          turnId: input.turnId,
          scope: part.scope === 'tail' || part.scope === 'projection' ? part.scope : 'turn',
          outputText: normalizeText(part.outputText) || outputText || undefined,
          reasoningText: normalizeText(part.reasoningText) || reasoningText || undefined,
          trace: part.trace,
          diagnostics: outputDiagnostics || undefined,
        };
        return;
      default:
        assertNever(part);
    }
  }

  throw new Error('runtime.agent stream ended without a terminal event');
}

function asRuntimeAgentTurnPart(value: unknown): RuntimeAgentTurnRunnerPartLike {
  if (!value || typeof value !== 'object' || !('type' in value)) {
    throw new Error('Runtime Agent turn projection received an invalid stream part');
  }
  return value as RuntimeAgentTurnRunnerPartLike;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeText(value: unknown): string {
  return stringValue(value).trim();
}

function beatIndexFromRuntimeActionId(value: unknown): number {
  const actionId = normalizeText(value);
  const match = /^action-(\d+)$/u.exec(actionId);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed + 1 : 1;
}

function uiBeatId(turnId: string, beatIndex: number): string {
  return `${turnId}:beat:${beatIndex}`;
}

function mergeRecord(
  current: JsonRecord | null | undefined,
  next: JsonRecord | null | undefined,
): JsonRecord | null {
  if (!current && !next) return null;
  return {
    ...(current || {}),
    ...(next || {}),
  };
}

function mergeMessageMetadata(
  current: ConversationCanonicalMessage['metadata'] | undefined,
  next: JsonRecord,
): JsonRecord {
  const out: JsonRecord = {
    ...(current || {}),
  };
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function runtimeAgentMessageMetadata(input: {
  readonly conversationAnchorId?: string | null;
  readonly localAgentRef?: string | null;
  readonly turnId: string;
}): JsonRecord {
  return {
    transport: 'runtime.agent.turns',
    turnId: input.turnId,
    conversationAnchorId: normalizeText(input.conversationAnchorId) || null,
    localAgentRef: normalizeText(input.localAgentRef) || null,
  };
}

function appendArtifact(
  current: unknown,
  artifact: JsonRecord,
): readonly JsonRecord[] {
  const existing = Array.isArray(current) ? current.filter(isRecord) : [];
  return [...existing, artifact];
}

function reduceArtifactReadyEvent(
  state: RuntimeAgentConversationProjectionState,
  event: Extract<ConversationTurnEvent, { type: 'artifact-ready' }>,
  updatedAt: string,
): RuntimeAgentConversationProjectionState {
  const artifactRecord = {
    artifactId: event.artifactId,
    mimeType: event.mimeType,
    uri: event.uri ?? null,
    beatId: event.beatId,
    projectionMessageId: event.projectionMessageId ?? null,
  };
  const withArtifactMetadata = updateAssistantMessage(state, updatedAt, (message) => ({
    ...message,
    metadata: mergeMessageMetadata(message.metadata, {
      artifacts: appendArtifact(message.metadata?.artifacts, artifactRecord),
    }),
  }));

  if (!isRenderableImageArtifact(event)) {
    return withArtifactMetadata;
  }

  return appendImageArtifactMessage(withArtifactMetadata, event, updatedAt);
}

function appendImageFailureMessage(
  state: RuntimeAgentConversationProjectionState,
  event: Extract<ConversationTurnEvent, { type: 'beat-delivery-failed' }>,
  updatedAt: string,
): RuntimeAgentConversationProjectionState {
  if (event.modality !== 'image') {
    return state;
  }
  const primaryAssistantIndex = primaryAssistantMessageIndex(state.messages, state.turnId);
  const primaryAssistant = state.messages[primaryAssistantIndex];
  const preferredId = normalizeText(event.projectionMessageId);
  const messageId = preferredId || `${event.turnId}:action-error:${normalizeText(event.beatId) || 'image'}`;
  const errorMessage = normalizeText(event.message) || 'Image generation failed.';
  const failureMessage: ConversationCanonicalMessage = {
    id: messageId,
    sessionId: state.sessionId,
    targetId: state.targetId,
    source: 'agent',
    role: 'agent',
    text: errorMessage,
    createdAt: state.messages.find((message) => message.id === messageId)?.createdAt || updatedAt,
    updatedAt,
    status: 'error',
    error: errorMessage,
    kind: 'image',
    senderName: primaryAssistant?.senderName ?? 'Agent',
    senderKind: 'agent',
    metadata: mergeMessageMetadata(runtimeAgentMessageMetadata(state), {
      beatId: event.beatId,
      projectionMessageId: event.projectionMessageId ?? null,
      operationId: event.operationId,
      operation: event.operation,
      modality: event.modality,
      reasonCode: event.reasonCode,
      reason: event.reason,
      imageTerminalState: 'failed',
    }),
  };
  const existingIndex = state.messages.findIndex((message) => message.id === messageId);
  return {
    ...state,
    messages: existingIndex >= 0
      ? state.messages.map((message, index) => (index === existingIndex ? failureMessage : message))
      : [...state.messages, failureMessage],
  };
}

function isRenderableImageArtifact(
  event: Extract<ConversationTurnEvent, { type: 'artifact-ready' }>,
): boolean {
  return Boolean(normalizeText(event.uri) && normalizeText(event.mimeType).toLowerCase().startsWith('image/'));
}

function appendImageArtifactMessage(
  state: RuntimeAgentConversationProjectionState,
  event: Extract<ConversationTurnEvent, { type: 'artifact-ready' }>,
  createdAt: string,
): RuntimeAgentConversationProjectionState {
  const primaryAssistantIndex = primaryAssistantMessageIndex(state.messages, state.turnId);
  const primaryAssistant = state.messages[primaryAssistantIndex];
  const messageId = uniqueArtifactMessageId(state.messages, event);
  if (state.messages.some((message) => message.id === messageId)) {
    return state;
  }

  const artifactMessage: ConversationCanonicalMessage = {
    id: messageId,
    sessionId: state.sessionId,
    targetId: state.targetId,
    source: 'agent',
    role: 'agent',
    text: primaryAssistant?.text || 'Generated image',
    createdAt,
    updatedAt: createdAt,
    status: 'complete',
    kind: 'image',
    senderName: primaryAssistant?.senderName ?? 'Agent',
    senderKind: 'agent',
    metadata: mergeMessageMetadata(runtimeAgentMessageMetadata(state), {
      artifactProjection: 'runtime.agent.turn.artifact_ready',
      artifactId: event.artifactId,
      mimeType: event.mimeType,
      mediaUrl: normalizeText(event.uri),
      beatId: event.beatId,
      projectionMessageId: event.projectionMessageId ?? null,
      beatIndex: beatIndexFromUiBeatId(event.beatId),
    }),
  };

  return {
    ...state,
    messages: [...state.messages, artifactMessage],
  };
}

function primaryAssistantMessageIndex(
  messages: readonly ConversationCanonicalMessage[],
  turnId: string,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (!isAssistantLikeRole(message.role)) {
      continue;
    }
    if (isMediaMessageKind(message.kind)) {
      continue;
    }
    const messageTurnId = normalizeText(message.metadata?.turnId);
    if (messageTurnId && messageTurnId !== turnId) {
      continue;
    }
    return index;
  }
  return Math.max(0, messages.length - 1);
}

function isAssistantLikeRole(role: ConversationCanonicalMessage['role']): boolean {
  return role === 'agent' || role === 'assistant';
}

function isMediaMessageKind(kind: ConversationCanonicalMessage['kind']): boolean {
  return kind === 'image'
    || kind === 'image-pending'
    || kind === 'video'
    || kind === 'video-pending'
    || kind === 'voice';
}

function uniqueArtifactMessageId(
  messages: readonly ConversationCanonicalMessage[],
  event: Extract<ConversationTurnEvent, { type: 'artifact-ready' }>,
): string {
  const preferred = normalizeText(event.projectionMessageId);
  if (preferred && !messages.some((message) => message.id === preferred)) {
    return preferred;
  }
  const base = `${event.turnId}:artifact:${normalizeText(event.artifactId) || normalizeText(event.beatId) || 'image'}`;
  if (!messages.some((message) => message.id === base)) {
    return base;
  }
  let index = 2;
  while (messages.some((message) => message.id === `${base}:${index}`)) {
    index += 1;
  }
  return `${base}:${index}`;
}

function beatIndexFromUiBeatId(beatId: string): number {
  const match = /:beat:(\d+)$/u.exec(beatId);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function updateAssistantMessage(
  state: RuntimeAgentConversationProjectionState,
  updatedAt: string,
  update: (message: ConversationCanonicalMessage) => ConversationCanonicalMessage,
): RuntimeAgentConversationProjectionState {
  const assistantIndex = primaryAssistantMessageIndex(state.messages, state.turnId);
  return {
    ...state,
    messages: state.messages.map((message, index) => (
      index === assistantIndex
        ? update({ ...message, updatedAt })
        : message
    )),
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Runtime Agent conversation projection input: ${JSON.stringify(value)}`);
}
