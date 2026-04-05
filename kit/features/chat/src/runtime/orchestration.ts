import { getPlatformClient } from '@nimiplatform/sdk';
import type {
  Runtime,
  TextMessage,
  TextStreamInput,
  TextStreamPart,
} from '@nimiplatform/sdk/runtime';
import type {
  ConversationOrchestrationProvider,
  ConversationRuntimeAdapter,
  ConversationRuntimeTextMessage,
  ConversationRuntimeTextRequest,
  ConversationRuntimeTextStreamPart,
  ConversationTurnError,
  ConversationTurnEvent,
  ConversationTurnHistoryMessage,
  ConversationTurnInput,
} from '../orchestration/contracts.js';
import {
  buildConversationHistoryWindow,
  type ConversationHistoryBudget,
  type ConversationTokenCounter,
} from '../orchestration/history-window.js';

const SIMPLE_AI_PROVIDER_CAPABILITIES = {
  reasoning: true,
  continuity: false,
  firstBeat: false,
  voiceInput: false,
  voiceOutput: false,
  imageGeneration: false,
  videoGeneration: false,
} as const;

export type SimpleAiConversationProviderOptions = {
  runtimeAdapter: ConversationRuntimeAdapter;
  historyBudget?: Partial<ConversationHistoryBudget>;
  countTokens?: ConversationTokenCounter;
  resolveSystemPrompt?: (input: ConversationTurnInput) => string | null | undefined;
  resolveRuntimeRequest?: (
    input: ConversationTurnInput,
    context: {
      historyWindow: readonly ConversationTurnHistoryMessage[];
      messages: readonly ConversationRuntimeTextMessage[];
      systemPrompt: string | null;
    },
  ) => Omit<
    ConversationRuntimeTextRequest,
    'modeId' | 'threadId' | 'turnId' | 'messages' | 'systemPrompt' | 'signal'
  >;
};

export function createSimpleAiConversationProvider(
  options: SimpleAiConversationProviderOptions,
): ConversationOrchestrationProvider {
  return {
    modeId: 'simple-ai',
    capabilities: SIMPLE_AI_PROVIDER_CAPABILITIES,
    async *runTurn(input: ConversationTurnInput): AsyncIterable<ConversationTurnEvent> {
      const normalizedUserText = normalizeText(input.userMessage.text);
      if (!normalizedUserText) {
        throw new Error('simple-ai conversation turn requires a non-empty user message');
      }

      const visibleHistory = input.history.filter((message) => (
        message.role !== 'system' && normalizeText(message.text).length > 0
      ));
      const historyWindow = buildConversationHistoryWindow({
        history: visibleHistory,
        budget: options.historyBudget,
        countTokens: options.countTokens,
      }).messages;
      const systemPrompt = normalizeNullableText(
        options.resolveSystemPrompt ? options.resolveSystemPrompt(input) : input.systemPrompt,
      );
      const messages: ConversationRuntimeTextMessage[] = [
        ...historyWindow.map(toRuntimeTextMessage),
        {
          role: 'user',
          text: normalizedUserText,
          name: null,
        },
      ];
      const runtimeRequest = options.resolveRuntimeRequest
        ? options.resolveRuntimeRequest(input, {
          historyWindow,
          messages,
          systemPrompt,
        })
        : {};

      yield {
        type: 'turn-started',
        modeId: 'simple-ai',
        threadId: input.threadId,
        turnId: input.turnId,
      };

      let outputText = '';
      let reasoningText = '';
      let terminalEventSeen = false;

      try {
        const runtimeResult = await options.runtimeAdapter.streamText({
          modeId: 'simple-ai',
          threadId: input.threadId,
          turnId: input.turnId,
          messages,
          systemPrompt,
          signal: input.signal,
          ...runtimeRequest,
        });

        for await (const part of runtimeResult.stream) {
          switch (part.type) {
            case 'start':
              break;
            case 'reasoning-delta':
              reasoningText += part.textDelta;
              yield {
                type: 'reasoning-delta',
                turnId: input.turnId,
                textDelta: part.textDelta,
              };
              break;
            case 'text-delta':
              outputText += part.textDelta;
              yield {
                type: 'text-delta',
                turnId: input.turnId,
                textDelta: part.textDelta,
              };
              break;
            case 'finish':
              terminalEventSeen = true;
              yield {
                type: 'turn-completed',
                turnId: input.turnId,
                outputText,
                reasoningText: reasoningText || undefined,
                finishReason: part.finishReason,
                usage: part.usage,
                trace: part.trace,
              };
              break;
            case 'error':
              terminalEventSeen = true;
              yield {
                type: 'turn-failed',
                turnId: input.turnId,
                error: part.error,
                outputText: outputText || undefined,
                reasoningText: reasoningText || undefined,
                trace: part.trace,
              };
              break;
            default:
              assertNever(part);
          }
        }

        if (!terminalEventSeen) {
          yield {
            type: 'turn-failed',
            turnId: input.turnId,
            error: {
              code: 'STREAM_TERMINATED_WITHOUT_TERMINAL_EVENT',
              message: 'conversation runtime stream ended without a terminal event',
            },
            outputText: outputText || undefined,
            reasoningText: reasoningText || undefined,
          };
        }
      } catch (error) {
        if (isAbortLikeError(error) || input.signal?.aborted) {
          yield {
            type: 'turn-canceled',
            turnId: input.turnId,
            scope: 'turn',
            outputText: outputText || undefined,
            reasoningText: reasoningText || undefined,
          };
          return;
        }
        yield {
          type: 'turn-failed',
          turnId: input.turnId,
          error: toConversationTurnError(error),
          outputText: outputText || undefined,
          reasoningText: reasoningText || undefined,
        };
      }
    },
  };
}

export function createSdkConversationRuntimeAdapter(runtime?: Runtime): ConversationRuntimeAdapter {
  const runtimeClient = runtime ?? getPlatformClient().runtime;
  return {
    async streamText(request) {
      const streamOutput = await runtimeClient.ai.text.stream(toSdkTextStreamRequest(request));
      return {
        stream: normalizeConversationRuntimeStream(streamOutput.stream),
      };
    },
  };
}

export function normalizeConversationRuntimeTextStreamPart(
  part: TextStreamPart,
): ConversationRuntimeTextStreamPart {
  switch (part.type) {
    case 'start':
      return { type: 'start' };
    case 'reasoning-delta':
      return {
        type: 'reasoning-delta',
        textDelta: part.text,
      };
    case 'delta':
      return {
        type: 'text-delta',
        textDelta: part.text,
      };
    case 'finish':
      return {
        type: 'finish',
        finishReason: part.finishReason,
        usage: part.usage,
        trace: {
          traceId: normalizeNullableText(part.trace.traceId),
          modelResolved: normalizeNullableText(part.trace.modelResolved),
          routeDecision: normalizeNullableText(part.trace.routeDecision),
        },
      };
    case 'error':
      return {
        type: 'error',
        error: {
          code: normalizeNullableText(part.error.reasonCode) || 'RUNTIME_CALL_FAILED',
          message: normalizeNullableText(part.error.message) || 'conversation runtime stream failed',
        },
        trace: {
          traceId: normalizeNullableText(part.error.traceId),
        },
      };
    default:
      return assertNever(part);
  }
}

async function* normalizeConversationRuntimeStream(
  stream: AsyncIterable<TextStreamPart>,
): AsyncIterable<ConversationRuntimeTextStreamPart> {
  for await (const part of stream) {
    yield normalizeConversationRuntimeTextStreamPart(part);
  }
}

function toSdkTextStreamRequest(request: ConversationRuntimeTextRequest): TextStreamInput {
  return {
    model: request.model || 'auto',
    input: request.messages.map(toSdkTextMessage),
    system: normalizeNullableText(request.systemPrompt) || undefined,
    route: request.route,
    connectorId: normalizeNullableText(request.connectorId) || undefined,
    subjectUserId: normalizeNullableText(request.subjectUserId) || undefined,
    temperature: request.temperature,
    topP: request.topP,
    maxTokens: request.maxTokens,
    timeoutMs: request.timeoutMs,
    reasoning: request.reasoning,
    metadata: request.metadata,
    signal: request.signal,
  };
}

function toSdkTextMessage(message: ConversationRuntimeTextMessage): TextMessage {
  return {
    role: message.role,
    content: message.text,
    name: normalizeNullableText(message.name) || undefined,
  };
}

function toRuntimeTextMessage(
  message: ConversationTurnHistoryMessage,
): ConversationRuntimeTextMessage {
  return {
    role: message.role,
    text: normalizeText(message.text),
    name: normalizeNullableText(message.name),
  };
}

function toConversationTurnError(error: unknown): ConversationTurnError {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const code = normalizeNullableText(record.code) || normalizeNullableText(record.reasonCode);
    const message = normalizeNullableText(record.message);
    if (code || message) {
      return {
        code: code || 'RUNTIME_CALL_FAILED',
        message: message || 'conversation runtime stream failed',
      };
    }
  }
  if (error instanceof Error) {
    return {
      code: error.name || 'RUNTIME_CALL_FAILED',
      message: error.message || 'conversation runtime stream failed',
    };
  }
  return {
    code: 'RUNTIME_CALL_FAILED',
    message: String(error || 'conversation runtime stream failed'),
  };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function isAbortLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message === 'Aborted';
  }
  return false;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled runtime orchestration value: ${JSON.stringify(value)}`);
}
