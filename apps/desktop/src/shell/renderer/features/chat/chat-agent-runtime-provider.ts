import type {
  ConversationOrchestrationProvider,
  ConversationTurnEvent,
  ConversationTurnInput,
} from '@nimiplatform/kit/features/chat/headless';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import type { AgentResolvedMessageActionEnvelope } from '@nimiplatform/sdk/runtime';
import { feedStreamEvent } from '../turns/stream-controller';
import { createAgentLocalChatContinuityAdapter, commitProviderOutcome } from './chat-agent-continuity';
import {
  AGENT_RUNTIME_CHAT_PROVIDER_CAPABILITIES,
  type AgentChatUserAttachment,
  type AgentLocalTextMessageState,
  type AgentRuntimeChatTurnAdapter,
} from './chat-agent-runtime-turn-types';
import { streamChatAgentRuntimeAgentTurn } from './chat-agent-runtime-agent';
import { normalizeText } from './chat-agent-runtime-normalize';
import { toChatAgentRuntimeError } from './chat-agent-runtime';
import { RUNTIME_AGENT_CHAT_MODE_ID } from './chat-agent-runtime-mode';

type AgentRuntimeChatProviderOptions = {
  runtimeAdapter?: AgentRuntimeChatTurnAdapter;
  continuityAdapter?: ReturnType<typeof createAgentLocalChatContinuityAdapter>;
};

type AgentRuntimeChatProviderMetadata = {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  conversationAnchorId: string;
  textExecutionSnapshot: import('./conversation-capability').AISnapshot | null;
  reasoningPreference: import('./chat-shared-thinking').ChatThinkingPreference;
  textMaxOutputTokensRequested: number | null;
};

const RUNTIME_AGENT_WAIT_KEEPALIVE_MS = 10_000;

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireProviderMetadata(value: unknown): AgentRuntimeChatProviderMetadata {
  const record = requireRecord(value, 'agent runtime chat metadata');
  return {
    ownerUserId: normalizeText(record.ownerUserId),
    realmAgentId: normalizeText(record.realmAgentId),
    localAgentRef: normalizeText(record.localAgentRef),
    conversationAnchorId: normalizeText(record.conversationAnchorId),
    textExecutionSnapshot: (record.textExecutionSnapshot || null) as AgentRuntimeChatProviderMetadata['textExecutionSnapshot'],
    reasoningPreference: (record.reasoningPreference || 'auto') as AgentRuntimeChatProviderMetadata['reasoningPreference'],
    textMaxOutputTokensRequested: Number.isFinite(Number(record.textMaxOutputTokensRequested))
      ? Math.floor(Number(record.textMaxOutputTokensRequested))
      : null,
  };
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as { name?: unknown; code?: unknown; message?: unknown };
  return record.name === 'AbortError'
    || record.code === 'ABORT_ERR'
    || /abort|cancel/i.test(String(record.message || ''));
}

function toAbortLikeErrorMessage(error: unknown): string {
  return error instanceof Error && normalizeText(error.message)
    ? error.message
    : 'Generation stopped.';
}

function textMessageStateFromEnvelope(input: {
  turnId: string;
  envelope: AgentResolvedMessageActionEnvelope;
  metadataJson: AgentLocalTextMessageState['metadataJson'];
}): AgentLocalTextMessageState {
  return {
    messageId: input.envelope.message.messageId,
    projectionMessageId: `${input.turnId}:message:0`,
    text: input.envelope.message.text,
    metadataJson: input.metadataJson,
  };
}

function outputTextFromEnvelope(envelope: AgentResolvedMessageActionEnvelope): string {
  return normalizeText(envelope.message.text);
}

async function* runRuntimeOwnedAgentTurn(input: {
  baseInput: ConversationTurnInput;
  metadata: AgentRuntimeChatProviderMetadata;
  runtimeAdapter: AgentRuntimeChatTurnAdapter;
  continuityAdapter: ReturnType<typeof createAgentLocalChatContinuityAdapter>;
  emittedEvents: ConversationTurnEvent[];
  userText: string;
  userAttachments: readonly AgentChatUserAttachment[];
}): AsyncIterable<ConversationTurnEvent> {
  let reasoningText = '';
  let outputText = '';
  let outputDiagnostics: Record<string, unknown> | null = null;
  let textMessageState: AgentLocalTextMessageState | null = null;

  if (input.userAttachments.length > 0) {
    throw new Error('runtime.agent.turns does not yet admit Desktop-submitted image attachments');
  }

  const runtimeResult = await input.runtimeAdapter.streamAgentTurn({
    ownerUserId: input.metadata.ownerUserId,
    realmAgentId: input.metadata.realmAgentId,
    localAgentRef: input.metadata.localAgentRef,
    conversationAnchorId: input.metadata.conversationAnchorId,
    threadId: input.baseInput.threadId,
    userMessageId: input.baseInput.userMessage.id,
    userText: input.userText,
    userAttachments: input.userAttachments,
    maxOutputTokensRequested: input.metadata.textMaxOutputTokensRequested,
    textExecutionSnapshot: input.metadata.textExecutionSnapshot,
    reasoningPreference: input.metadata.reasoningPreference,
    signal: input.baseInput.signal,
  });

  const keepaliveIntervalId = setInterval(() => {
    feedStreamEvent(input.baseInput.threadId, { type: 'keepalive' });
  }, RUNTIME_AGENT_WAIT_KEEPALIVE_MS);

  try {
    for await (const part of runtimeResult.stream) {
      switch (part.type) {
        case 'reasoning-delta': {
          reasoningText += part.textDelta;
          const reasoningEvent: ConversationTurnEvent = {
            type: 'reasoning-delta',
            turnId: input.baseInput.turnId,
            textDelta: part.textDelta,
          };
          input.emittedEvents.push(reasoningEvent);
          yield reasoningEvent;
          break;
        }
        case 'text-delta': {
          const textDelta = normalizeText(part.textDelta);
          if (!textDelta) {
            break;
          }
          outputText += textDelta;
          const textDeltaEvent: ConversationTurnEvent = {
            type: 'text-delta',
            turnId: input.baseInput.turnId,
            textDelta,
          };
          input.emittedEvents.push(textDeltaEvent);
          yield textDeltaEvent;
          break;
        }
        case 'message-sealed': {
          textMessageState = textMessageStateFromEnvelope({
            turnId: input.baseInput.turnId,
            envelope: part.envelope,
            metadataJson: part.metadataJson ?? null,
          });
          outputText = outputTextFromEnvelope(part.envelope);
          const sealedEvent: ConversationTurnEvent = {
            type: 'message-sealed',
            turnId: input.baseInput.turnId,
            messageId: textMessageState.messageId,
            beatId: `${input.baseInput.turnId}:beat:0`,
            text: outputText,
          };
          input.emittedEvents.push(sealedEvent);
          yield sealedEvent;
          outputDiagnostics = {
            ...(outputDiagnostics || {}),
            ...(part.diagnostics || {}),
          };
          break;
        }
        case 'turn-completed': {
          outputText = part.outputText || outputText;
          outputDiagnostics = {
            ...(outputDiagnostics || {}),
            ...(part.diagnostics || {}),
          };
          if (!textMessageState) {
            const terminalEvent: ConversationTurnEvent = {
              type: 'turn-failed',
              turnId: input.baseInput.turnId,
              error: {
                code: 'RUNTIME_AGENT_CHAT_INVALID',
                message: 'runtime.agent completed without structured message-sealed event',
              },
              outputText: outputText || undefined,
              reasoningText: reasoningText || undefined,
              finishReason: part.finishReason,
              usage: part.usage,
              trace: part.trace,
              diagnostics: {
                ...(outputDiagnostics || {}),
                missingStructuredProjection: true,
              },
            };
            const commitResult = await commitProviderOutcome({
              continuityAdapter: input.continuityAdapter,
              baseInput: input.baseInput,
              emittedEvents: input.emittedEvents,
              terminalEvent,
              outcome: 'failed',
              outputText,
              reasoningText,
              error: terminalEvent.error,
            });
            yield {
              type: 'projection-rebuilt',
              threadId: input.baseInput.threadId,
              projectionVersion: commitResult.projectionVersion,
              bundle: commitResult.bundle,
            };
            yield terminalEvent;
            return;
          }
          const terminalEvent: ConversationTurnEvent = {
            type: 'turn-completed',
            turnId: input.baseInput.turnId,
            outputText,
            reasoningText: reasoningText || undefined,
            finishReason: part.finishReason,
            usage: part.usage,
            trace: part.trace,
            diagnostics: outputDiagnostics || undefined,
          };
          const commitResult = await commitProviderOutcome({
            continuityAdapter: input.continuityAdapter,
            baseInput: input.baseInput,
            emittedEvents: input.emittedEvents,
            terminalEvent,
            outcome: 'completed',
            outputText,
            reasoningText,
            textMessageState,
          });
          yield {
            type: 'projection-rebuilt',
            threadId: input.baseInput.threadId,
            projectionVersion: commitResult.projectionVersion,
            bundle: commitResult.bundle,
          };
          yield terminalEvent;
          return;
        }
        case 'turn-failed': {
          const terminalEvent: ConversationTurnEvent = {
            type: 'turn-failed',
            turnId: input.baseInput.turnId,
            error: part.error,
            outputText: part.outputText || outputText || undefined,
            reasoningText: part.reasoningText || reasoningText || undefined,
            finishReason: part.finishReason,
            usage: part.usage,
            trace: part.trace,
            diagnostics: {
              ...(outputDiagnostics || {}),
              ...(part.diagnostics || {}),
            },
          };
          const commitResult = await commitProviderOutcome({
            continuityAdapter: input.continuityAdapter,
            baseInput: input.baseInput,
            emittedEvents: input.emittedEvents,
            terminalEvent,
            outcome: 'failed',
            outputText,
            reasoningText,
            error: part.error,
            textMessageState: textMessageState || undefined,
          });
          yield {
            type: 'projection-rebuilt',
            threadId: input.baseInput.threadId,
            projectionVersion: commitResult.projectionVersion,
            bundle: commitResult.bundle,
          };
          yield terminalEvent;
          return;
        }
        case 'turn-canceled': {
          const terminalEvent: ConversationTurnEvent = {
            type: 'turn-canceled',
            turnId: input.baseInput.turnId,
            scope: part.scope,
            outputText: part.outputText || outputText || undefined,
            reasoningText: part.reasoningText || reasoningText || undefined,
            trace: part.trace,
            diagnostics: {
              ...(outputDiagnostics || {}),
              ...(part.diagnostics || {}),
            },
          };
          const commitResult = await commitProviderOutcome({
            continuityAdapter: input.continuityAdapter,
            baseInput: input.baseInput,
            emittedEvents: input.emittedEvents,
            terminalEvent,
            outcome: 'canceled',
            outputText,
            reasoningText,
            error: {
              code: 'OPERATION_ABORTED',
              message: 'Generation stopped.',
            },
            textMessageState: textMessageState || undefined,
          });
          yield {
            type: 'projection-rebuilt',
            threadId: input.baseInput.threadId,
            projectionVersion: commitResult.projectionVersion,
            bundle: commitResult.bundle,
          };
          yield terminalEvent;
          return;
        }
        default:
          throw new Error(`Unsupported runtime.agent chat turn part: ${JSON.stringify(part)}`);
      }
    }
  } finally {
    clearInterval(keepaliveIntervalId);
  }
  throw new Error('runtime.agent stream ended without a terminal event');
}

export function createRuntimeAgentChatConversationProvider(
  options: AgentRuntimeChatProviderOptions = {},
): ConversationOrchestrationProvider {
  const runtimeAdapter = options.runtimeAdapter ?? { streamAgentTurn: streamChatAgentRuntimeAgentTurn };
  const continuityAdapter = options.continuityAdapter ?? createAgentLocalChatContinuityAdapter();
  return {
    modeId: RUNTIME_AGENT_CHAT_MODE_ID,
    capabilities: AGENT_RUNTIME_CHAT_PROVIDER_CAPABILITIES,
    async *runTurn(input: ConversationTurnInput): AsyncIterable<ConversationTurnEvent> {
      const metadata = requireProviderMetadata(input.metadata);
      const userText = normalizeText(input.userMessage.text);
      const userAttachments = Array.isArray(input.userMessage.attachments)
        ? input.userMessage.attachments as readonly AgentChatUserAttachment[]
        : [];
      if (!metadata.ownerUserId || !metadata.realmAgentId || !metadata.localAgentRef || !metadata.conversationAnchorId) {
        throw new Error('runtime.agent chat metadata requires ownerUserId, realmAgentId, localAgentRef, and conversationAnchorId');
      }
      if (!userText && userAttachments.length === 0) {
        throw new Error('runtime.agent chat requires a non-empty user message or admitted attachment projection');
      }

      const emittedEvents: ConversationTurnEvent[] = [];
      const turnStarted: ConversationTurnEvent = {
        type: 'turn-started',
        modeId: RUNTIME_AGENT_CHAT_MODE_ID,
        threadId: input.threadId,
        turnId: input.turnId,
      };
      emittedEvents.push(turnStarted);
      yield turnStarted;

      try {
        for await (const event of runRuntimeOwnedAgentTurn({
          baseInput: input,
          metadata,
          runtimeAdapter,
          continuityAdapter,
          emittedEvents,
          userText,
          userAttachments,
        })) {
          yield event;
        }
      } catch (error) {
        if (isAbortLikeError(error) || input.signal?.aborted) {
          const cancelError = {
            code: 'OPERATION_ABORTED',
            message: toAbortLikeErrorMessage(error),
          };
          const terminalEvent: ConversationTurnEvent = {
            type: 'turn-canceled',
            turnId: input.turnId,
            scope: 'turn',
          };
          const commitResult = await commitProviderOutcome({
            continuityAdapter,
            baseInput: input,
            emittedEvents,
            terminalEvent,
            outcome: 'canceled',
            outputText: '',
            reasoningText: '',
            error: cancelError,
          });
          yield {
            type: 'projection-rebuilt',
            threadId: input.threadId,
            projectionVersion: commitResult.projectionVersion,
            bundle: commitResult.bundle,
          };
          yield terminalEvent;
          return;
        }
        const runtimeError = toChatAgentRuntimeError(error);
        logRendererEvent({
          level: 'warn',
          area: 'agent-chat-runtime',
          message: 'action:runtime-agent-turn:failed',
          details: {
            reasonCode: runtimeError.code,
            message: runtimeError.message,
          },
        });
        const terminalEvent: ConversationTurnEvent = {
          type: 'turn-failed',
          turnId: input.turnId,
          error: runtimeError,
        };
        const commitResult = await commitProviderOutcome({
          continuityAdapter,
          baseInput: input,
          emittedEvents,
          terminalEvent,
          outcome: 'failed',
          outputText: '',
          reasoningText: '',
          error: runtimeError,
        });
        yield {
          type: 'projection-rebuilt',
          threadId: input.threadId,
          projectionVersion: commitResult.projectionVersion,
          bundle: commitResult.bundle,
        };
        yield terminalEvent;
      }
    },
  };
}
