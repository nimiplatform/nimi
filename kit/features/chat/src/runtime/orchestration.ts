import type {
  Runtime,
  TextMessage,
  TextStreamInput,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  runAppAiTextTurn,
  type AppAiTextTurnEvent,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  ConversationOrchestrationProvider,
  ConversationRuntimeAdapter,
  ConversationRuntimeTextMessage,
  ConversationRuntimeTextRequest,
  ConversationRuntimeTrace,
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
  resolveRuntimeUserMessage?: (
    input: ConversationTurnInput,
    context: {
      normalizedUserText: string;
    },
  ) => ConversationRuntimeTextMessage;
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
      const userRuntimeMessage = options.resolveRuntimeUserMessage
        ? normalizeRuntimeUserMessage(
          options.resolveRuntimeUserMessage(input, { normalizedUserText }),
          normalizedUserText,
        )
        : {
          role: 'user' as const,
          text: normalizedUserText,
          name: null,
        };
      const messages: ConversationRuntimeTextMessage[] = [
        ...historyWindow.map(toRuntimeTextMessage),
        userRuntimeMessage,
      ];
      const runtimeRequest = options.resolveRuntimeRequest
        ? options.resolveRuntimeRequest(input, {
          historyWindow,
          messages,
          systemPrompt,
        })
        : {};

      const request = toSdkTextStreamRequest({
        modeId: 'simple-ai',
        threadId: input.threadId,
        turnId: input.turnId,
        messages,
        systemPrompt,
        signal: input.signal,
        ...runtimeRequest,
      });

      for await (const event of runAppAiTextTurn({
        runtime: {
          streamText: (nextRequest) => options.runtimeAdapter.streamText({
            ...nextRequest,
            modeId: 'simple-ai',
            threadId: input.threadId,
            turnId: input.turnId,
            messages,
            systemPrompt,
          }),
        },
        request,
        threadId: input.threadId,
        turnId: input.turnId,
      })) {
        const conversationEvent = toConversationTurnEvent(event, input);
        if (conversationEvent) {
          yield conversationEvent;
        }
      }
    },
  };
}

export function createSdkConversationRuntimeAdapter(runtime?: Runtime): ConversationRuntimeAdapter {
  const runtimeClient = runtime
    ? Promise.resolve(runtime)
    : import('@nimiplatform/kit/core/sdk-contract').then((mod) => mod.getPlatformClient().runtime);
  return {
    async streamText(request) {
      const resolvedRuntimeClient = await runtimeClient;
      return resolvedRuntimeClient.ai.text.stream(toSdkTextStreamRequest(request));
    },
  };
}

function toConversationTurnEvent(
  event: AppAiTextTurnEvent,
  input: ConversationTurnInput,
): ConversationTurnEvent | null {
  switch (event.type) {
    case 'turn-started':
      return {
        type: 'turn-started',
        modeId: 'simple-ai',
        threadId: input.threadId,
        turnId: input.turnId,
      };
    case 'reasoning-delta':
      return {
        type: 'reasoning-delta',
        turnId: input.turnId,
        textDelta: event.textDelta,
      };
    case 'text-delta':
      return {
        type: 'text-delta',
        turnId: input.turnId,
        textDelta: event.textDelta,
      };
    case 'structured-output-parsed':
    case 'structured-output-repair-required':
      return null;
    case 'turn-completed':
      return {
        type: 'turn-completed',
        turnId: input.turnId,
        outputText: event.snapshot.text,
        reasoningText: event.snapshot.reasoningText || undefined,
        finishReason: event.snapshot.finishReason,
        usage: event.snapshot.usage,
        trace: toConversationRuntimeTrace(event.snapshot.trace),
      };
    case 'turn-failed':
      return {
        type: 'turn-failed',
        turnId: input.turnId,
        error: toConversationTurnError(event.error),
        outputText: event.snapshot.text || undefined,
        reasoningText: event.snapshot.reasoningText || undefined,
        finishReason: event.snapshot.finishReason,
        usage: event.snapshot.usage,
        trace: toConversationRuntimeTrace(event.snapshot.trace, event.error.cause),
      };
    case 'turn-canceled':
      return {
        type: 'turn-canceled',
        turnId: input.turnId,
        scope: 'turn',
        outputText: event.snapshot.text || undefined,
        reasoningText: event.snapshot.reasoningText || undefined,
        finishReason: event.snapshot.finishReason,
        usage: event.snapshot.usage,
        trace: toConversationRuntimeTrace(event.snapshot.trace),
      };
    default:
      return assertNever(event);
  }
}

function toConversationRuntimeTrace(
  trace: unknown,
  errorCause?: unknown,
): ConversationRuntimeTrace | undefined {
  const traceRecord = toRecord(trace);
  const errorRecord = toRecord(errorCause);
  const traceId = normalizeNullableText(traceRecord?.traceId) || normalizeNullableText(errorRecord?.traceId);
  const promptTraceId = normalizeNullableText(traceRecord?.promptTraceId)
    || normalizeNullableText(errorRecord?.promptTraceId);
  const modelResolved = normalizeNullableText(traceRecord?.modelResolved);
  const routeDecision = normalizeNullableText(traceRecord?.routeDecision);
  return traceId || promptTraceId || modelResolved || routeDecision
    ? {
      ...(traceId ? { traceId } : {}),
      ...(promptTraceId ? { promptTraceId } : {}),
      ...(modelResolved ? { modelResolved } : {}),
      ...(routeDecision ? { routeDecision } : {}),
    }
    : undefined;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function toSdkTextStreamRequest(request: ConversationRuntimeTextRequest): TextStreamInput {
  const model = normalizeRequiredRuntimeModel(request.model);
  return {
    model,
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

function normalizeRequiredRuntimeModel(model: string | undefined): string {
  const normalized = normalizeNullableText(model);
  if (!normalized) {
    throw new Error('conversation runtime request requires an explicit model');
  }
  if (normalized === 'auto') {
    throw new Error('conversation runtime request requires a concrete Runtime model, not auto');
  }
  return normalized;
}

function toSdkTextMessage(message: ConversationRuntimeTextMessage): TextMessage {
  return {
    role: message.role,
    content: message.content ?? message.text,
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

function normalizeRuntimeUserMessage(
  message: ConversationRuntimeTextMessage,
  fallbackText: string,
): ConversationRuntimeTextMessage {
  if (message.role !== 'user') {
    throw new Error('simple-ai runtime user message resolver must return a user message');
  }
  const text = normalizeText(message.text) || fallbackText;
  if (!text) {
    throw new Error('simple-ai runtime user message resolver returned an empty message');
  }
  return {
    ...message,
    role: 'user',
    text,
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

function assertNever(value: never): never {
  throw new Error(`Unhandled runtime orchestration value: ${JSON.stringify(value)}`);
}
