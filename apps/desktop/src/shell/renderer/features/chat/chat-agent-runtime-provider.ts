import type {
  ConversationOrchestrationProvider,
  ConversationTurnEvent,
  ConversationTurnInput,
} from '@nimiplatform/kit/features/chat/headless';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  isNimiRuntimeAgentCanceledError,
  type NimiDesktopAccountProductRuntimeClient,
  type NimiRuntimeAgentResolvedMessageActionEnvelope,
} from '@nimiplatform/sdk/runtime';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { StreamController } from '../turns/stream-controller.js';
import {
  AGENT_RUNTIME_CHAT_PROVIDER_CAPABILITIES,
  type AgentChatUserAttachment,
  type AgentLocalTextMessageState,
  type AgentRuntimeChatTurnAdapter,
} from './chat-agent-runtime-turn-types';
import { streamChatAgentRuntimeAgentTurn } from './chat-agent-runtime-agent';
import { normalizeText } from './chat-agent-runtime-normalize';
import { encodeBytesAsDataUrl } from './chat-agent-runtime-shared';
import { toChatAgentRuntimeError } from './chat-agent-runtime';
import { RUNTIME_AGENT_CHAT_MODE_ID } from './chat-agent-runtime-mode';
import { resolveAgentTurnTotalTimeoutMs } from './chat-agent-timeouts';
import type { TFunction } from 'i18next';

type AgentRuntimeChatProviderOptions = {
  runtimeAdapter?: AgentRuntimeChatTurnAdapter;
  streamController: StreamController;
  t: TFunction;
  sdk?: DesktopRendererSdkPort;
  now?: () => number;
};

type AgentRuntimeChatProviderMetadata = {
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  conversationAnchorId: string;
  runtimeThreadId: string;
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
    runtimeSourceRef: normalizeText(record.runtimeSourceRef),
    localAgentRef: normalizeText(record.localAgentRef),
    conversationAnchorId: normalizeText(record.conversationAnchorId),
    runtimeThreadId: normalizeText(record.runtimeThreadId),
    reasoningPreference: (record.reasoningPreference || 'auto') as AgentRuntimeChatProviderMetadata['reasoningPreference'],
    textMaxOutputTokensRequested: Number.isFinite(Number(record.textMaxOutputTokensRequested))
      ? Math.floor(Number(record.textMaxOutputTokensRequested))
      : null,
  };
}

function textMessageStateFromEnvelope(input: {
  turnId: string;
  envelope: NimiRuntimeAgentResolvedMessageActionEnvelope;
  metadataJson: AgentLocalTextMessageState['metadataJson'];
}): AgentLocalTextMessageState {
  return {
    messageId: input.envelope.message.messageId,
    projectionMessageId: `${input.turnId}:message:0`,
    text: input.envelope.message.text,
    metadataJson: input.metadataJson,
  };
}

function outputTextFromEnvelope(envelope: NimiRuntimeAgentResolvedMessageActionEnvelope): string {
  return normalizeText(envelope.message.text);
}

function beatIndexFromRuntimeActionId(actionId: string): number {
  const match = /^action-(\d+)$/u.exec(normalizeText(actionId));
  const parsed = match ? Number(match[1]) : 0;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed + 1 : 1;
}

function uiBeatId(turnId: string, beatIndex: number): string {
  return `${turnId}:beat:${beatIndex}`;
}

async function* runRuntimeOwnedAgentTurn(input: {
  baseInput: ConversationTurnInput;
  metadata: AgentRuntimeChatProviderMetadata;
  runtimeAdapter: AgentRuntimeChatTurnAdapter;
  userText: string;
  userAttachments: readonly AgentChatUserAttachment[];
  streamController: StreamController;
  readArtifactBytes: NimiDesktopAccountProductRuntimeClient['artifacts']['readArtifactBytes'];
}): AsyncIterable<ConversationTurnEvent> {
  let reasoningText = '';
  let outputText = '';
  let outputDiagnostics: Record<string, unknown> | null = null;
  let textMessageState: AgentLocalTextMessageState | null = null;

  const stopKeepalive = input.streamController.startKeepalive(
    input.baseInput.threadId,
    RUNTIME_AGENT_WAIT_KEEPALIVE_MS,
  );

  try {
    const runtimeResult = await input.runtimeAdapter.streamAgentTurn({
      ownerUserId: input.metadata.ownerUserId,
      runtimeSourceRef: input.metadata.runtimeSourceRef,
      localAgentRef: input.metadata.localAgentRef,
      conversationAnchorId: input.metadata.conversationAnchorId,
      threadId: input.metadata.runtimeThreadId,
      userMessageId: input.baseInput.userMessage.id,
      userText: input.userText,
      userAttachments: input.userAttachments,
      maxOutputTokensRequested: input.metadata.textMaxOutputTokensRequested,
      reasoningPreference: input.metadata.reasoningPreference,
      signal: input.baseInput.signal,
    });
    input.streamController.rearmTotalTimeout(
      input.baseInput.threadId,
      resolveAgentTurnTotalTimeoutMs(),
    );

    for await (const part of runtimeResult.stream) {
      switch (part.type) {
        case 'reasoning-delta': {
          reasoningText += part.textDelta;
          const reasoningEvent: ConversationTurnEvent = {
            type: 'reasoning-delta',
            turnId: input.baseInput.turnId,
            textDelta: part.textDelta,
          };
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
          yield sealedEvent;
          outputDiagnostics = {
            ...(outputDiagnostics || {}),
            ...(part.diagnostics || {}),
          };
          break;
        }
        case 'beat-planned': {
          const beatIndex = beatIndexFromRuntimeActionId(part.beatId);
          yield {
            type: 'beat-planned',
            turnId: input.baseInput.turnId,
            beatId: uiBeatId(input.baseInput.turnId, beatIndex),
            beatIndex,
            modality: 'image',
          };
          break;
        }
        case 'beat-delivery-started': {
          const beatIndex = beatIndexFromRuntimeActionId(part.beatId);
          yield {
            type: 'beat-delivery-started',
            turnId: input.baseInput.turnId,
            beatId: uiBeatId(input.baseInput.turnId, beatIndex),
          };
          break;
        }
        case 'artifact-ready': {
          const beatIndex = beatIndexFromRuntimeActionId(part.beatId);
          const artifact = await input.readArtifactBytes({
            artifactId: part.artifactId,
          });
          const mimeType = normalizeText(artifact.mimeType) || part.mimeType;
          yield {
            type: 'artifact-ready',
            turnId: input.baseInput.turnId,
            beatId: uiBeatId(input.baseInput.turnId, beatIndex),
            artifactId: part.artifactId,
            mimeType,
            uri: encodeBytesAsDataUrl(mimeType, artifact.bytes),
            projectionMessageId: `${input.baseInput.turnId}:message:${beatIndex}`,
          };
          break;
        }
        case 'beat-delivered': {
          const beatIndex = beatIndexFromRuntimeActionId(part.beatId);
          yield {
            type: 'beat-delivered',
            turnId: input.baseInput.turnId,
            beatId: uiBeatId(input.baseInput.turnId, beatIndex),
            projectionMessageId: `${input.baseInput.turnId}:message:${beatIndex}`,
          };
          break;
        }
        case 'beat-delivery-failed': {
          const beatIndex = beatIndexFromRuntimeActionId(part.beatId);
          yield {
            type: 'beat-delivery-failed',
            turnId: input.baseInput.turnId,
            beatId: uiBeatId(input.baseInput.turnId, beatIndex),
            operationId: `${normalizeText(part.turnId) || input.baseInput.turnId}:${normalizeText(part.beatId) || 'image.generate'}`,
            operation: normalizeText(part.operation) || 'image.generate',
            modality: 'image',
            reasonCode: normalizeText(part.reasonCode) || 'AI_PROVIDER_INTERNAL',
            reason: normalizeText(part.reason) || 'image_execution_failed',
            message: normalizeText(part.message) || 'Image generation failed.',
            projectionMessageId: part.projectionMessageId,
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
          yield terminalEvent;
          return;
        }
        default:
          throw new Error(`Unsupported runtime.agent chat turn part: ${JSON.stringify(part)}`);
      }
    }
  } finally {
    stopKeepalive();
  }
  throw new Error('runtime.agent stream ended without a terminal event');
}

export function createRuntimeAgentChatConversationProvider(
  options: AgentRuntimeChatProviderOptions,
): ConversationOrchestrationProvider {
  const runtimeAdapter = options.runtimeAdapter ?? {
    streamAgentTurn: (request) => {
      if (!options.sdk) throw new Error('DESKTOP_RUNTIME_AGENT_SDK_MISSING');
      return streamChatAgentRuntimeAgentTurn(request, options.sdk, options.now);
    },
  };
  return {
    modeId: RUNTIME_AGENT_CHAT_MODE_ID,
    capabilities: AGENT_RUNTIME_CHAT_PROVIDER_CAPABILITIES,
    async *runTurn(input: ConversationTurnInput): AsyncIterable<ConversationTurnEvent> {
      const metadata = requireProviderMetadata(input.metadata);
      const userText = normalizeText(input.userMessage.text);
      const userAttachments = Array.isArray(input.userMessage.attachments)
        ? input.userMessage.attachments as readonly AgentChatUserAttachment[]
        : [];
      if (!metadata.ownerUserId || !metadata.runtimeSourceRef || !metadata.localAgentRef || !metadata.conversationAnchorId || !metadata.runtimeThreadId) {
        throw new Error('runtime.agent chat metadata requires ownerUserId, runtimeSourceRef, localAgentRef, conversationAnchorId, and Runtime-owned threadId');
      }
      if (!userText && userAttachments.length === 0) {
        throw new Error('runtime.agent chat requires a non-empty user message or admitted attachment projection');
      }

      const turnStarted: ConversationTurnEvent = {
        type: 'turn-started',
        modeId: RUNTIME_AGENT_CHAT_MODE_ID,
        threadId: input.threadId,
        turnId: input.turnId,
      };
      yield turnStarted;

      try {
        for await (const event of runRuntimeOwnedAgentTurn({
          baseInput: input,
          metadata,
          runtimeAdapter,
          userText,
          userAttachments,
          streamController: options.streamController,
          readArtifactBytes: (request, callOptions) => {
            if (!options.sdk) throw new Error('DESKTOP_RUNTIME_ARTIFACT_READER_MISSING');
            return options.sdk.accountProduct().artifacts.readArtifactBytes(request, callOptions);
          },
        })) {
          yield event;
        }
      } catch (error) {
        if (isNimiRuntimeAgentCanceledError(error) || input.signal?.aborted) {
          const terminalEvent: ConversationTurnEvent = {
            type: 'turn-canceled',
            turnId: input.turnId,
            scope: 'turn',
          };
          yield terminalEvent;
          return;
        }
        const runtimeError = toChatAgentRuntimeError(error, options.t);
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
        yield terminalEvent;
      }
    },
  };
}
