import type {
  NimiAiModel,
  NimiGenerateTextRequest,
  NimiJsonObject,
  NimiMessage,
  NimiMessagePart,
  NimiModelRef,
  NimiRuntimeAIModelOptions,
  NimiRuntimeAIReasoningOptions,
  NimiRuntimeAIRoutePolicy,
  NimiTextTurnEvent,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  ConversationOrchestrationProvider,
  ConversationRuntimeAdapter,
  ConversationRuntimeTextMessage,
  ConversationRuntimeTextRequest,
  ConversationRuntimeTrace,
  ConversationRuntimeUsage,
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

type SdkContractModule = typeof import('@nimiplatform/kit/core/sdk-contract');

let sdkContractModulePromise: Promise<SdkContractModule> | null = null;

function loadSdkContract(): Promise<SdkContractModule> {
  sdkContractModulePromise ??= import('@nimiplatform/kit/core/sdk-contract');
  return sdkContractModulePromise;
}

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

export type SdkConversationRuntimeAdapterOptions = {
  runtime: NimiRuntimeAIModelOptions['runtime'];
  appId: string;
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

      const request = toConversationRuntimeTextRequest({
        modeId: 'simple-ai',
        threadId: input.threadId,
        turnId: input.turnId,
        messages,
        systemPrompt,
        signal: input.signal,
        ...runtimeRequest,
      });
      const modelRef = toNimiModelRef(request);
      const textRequest = toNimiGenerateTextRequest(request, modelRef);
      const { runNimiTextTurn } = await loadSdkContract();

      for await (const event of runNimiTextTurn({
        runtime: { model: createAdapterTextModel(options.runtimeAdapter, request, modelRef) },
        request: textRequest,
        threadId: input.threadId,
        turnId: input.turnId,
        signal: input.signal,
      })) {
        const conversationEvent = toConversationTurnEvent(event, input);
        if (conversationEvent) {
          yield conversationEvent;
        }
      }
    },
  };
}

export function createSdkConversationRuntimeAdapter(
  options: SdkConversationRuntimeAdapterOptions,
): ConversationRuntimeAdapter {
  return {
    async streamText(request) {
      const { createNimiRuntimeAIModel } = await loadSdkContract();
      const modelRef = toNimiModelRef(request);
      const model = createNimiRuntimeAIModel({
        runtime: options.runtime,
        appId: normalizeRequiredText(options.appId, 'conversation runtime adapter requires an explicit appId'),
        model: modelRef,
        routePolicy: toRuntimeRoutePolicy(request.route),
        connectorId: normalizeNullableText(request.connectorId) || undefined,
        subjectUserId: normalizeNullableText(request.subjectUserId) || undefined,
        timeoutMs: request.timeoutMs,
        metadata: toNimiJsonObject(request.metadata),
        targetRef: request.targetRef,
        reasoning: toNimiRuntimeReasoning(request.reasoning),
      });
      if (!model.streamText) {
        throw new Error(`conversation runtime model ${model.model.modelId} does not support streaming`);
      }
      return model.streamText(toNimiGenerateTextRequest(request, model.model));
    },
  };
}

function toConversationTurnEvent(
  event: NimiTextTurnEvent,
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
    case 'tool-call':
    case 'warning':
    case 'artifact':
    case 'trace':
      return null;
    case 'turn-completed':
      return {
        type: 'turn-completed',
        turnId: input.turnId,
        outputText: event.snapshot.text,
        reasoningText: event.snapshot.reasoningText || undefined,
        finishReason: event.snapshot.finishReason,
        usage: toConversationRuntimeUsage(event.snapshot.usage),
        trace: toConversationRuntimeTrace(event.snapshot.traceId),
      };
    case 'turn-failed':
      return {
        type: 'turn-failed',
        turnId: input.turnId,
        error: toConversationTurnError(event.error),
        outputText: event.snapshot.text || undefined,
        reasoningText: event.snapshot.reasoningText || undefined,
        finishReason: event.snapshot.finishReason,
        usage: toConversationRuntimeUsage(event.snapshot.usage),
        trace: toConversationRuntimeTrace(event.snapshot.traceId, event.error.cause),
      };
    case 'turn-canceled':
      return {
        type: 'turn-canceled',
        turnId: input.turnId,
        scope: 'turn',
        outputText: event.snapshot.text || undefined,
        reasoningText: event.snapshot.reasoningText || undefined,
        finishReason: event.snapshot.finishReason,
        usage: toConversationRuntimeUsage(event.snapshot.usage),
        trace: toConversationRuntimeTrace(event.snapshot.traceId),
      };
  }
  return null;
}

function toConversationRuntimeUsage(
  usage: {
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly totalTokens?: number;
  } | undefined,
): ConversationRuntimeUsage | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
  };
}

function toConversationRuntimeTrace(
  trace: unknown,
  errorCause?: unknown,
): ConversationRuntimeTrace | undefined {
  const traceRecord = toRecord(trace);
  const errorRecord = toRecord(errorCause);
  const traceId = normalizeNullableText(trace)
    || normalizeNullableText(traceRecord?.traceId)
    || normalizeNullableText(errorRecord?.traceId);
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

function toConversationRuntimeTextRequest(request: ConversationRuntimeTextRequest): ConversationRuntimeTextRequest {
  normalizeRequiredRuntimeModel(request.model);
  return {
    ...request,
    connectorId: normalizeNullableText(request.connectorId) || undefined,
    subjectUserId: normalizeNullableText(request.subjectUserId) || undefined,
    systemPrompt: normalizeNullableText(request.systemPrompt),
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

function createAdapterTextModel(
  adapter: ConversationRuntimeAdapter,
  request: ConversationRuntimeTextRequest,
  model: NimiModelRef,
): NimiAiModel {
  return {
    model,
    async generateText() {
      throw new Error('conversation runtime adapter does not support non-streaming generateText');
    },
    streamText: () => adapter.streamText(request),
  };
}

function toNimiGenerateTextRequest(
  request: ConversationRuntimeTextRequest,
  model: NimiModelRef,
): NimiGenerateTextRequest {
  const messages: NimiMessage[] = [];
  const systemPrompt = normalizeNullableText(request.systemPrompt);
  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: [toTextPart(systemPrompt)],
    });
  }
  messages.push(...request.messages.map(toNimiMessage));
  return {
    model,
    messages,
    parameters: {
      temperature: request.temperature,
      topP: request.topP,
      maxTokens: request.maxTokens,
      metadata: toNimiJsonObject(request.metadata),
    },
  };
}

function toNimiMessage(message: ConversationRuntimeTextMessage): NimiMessage {
  const content = Array.isArray(message.content)
    ? message.content
    : [toTextPart(normalizeText(message.content ?? message.text))];
  return {
    role: message.role,
    content,
    name: normalizeNullableText(message.name) || undefined,
  };
}

function toTextPart(text: string): NimiMessagePart {
  return { type: 'text', text };
}

function toNimiModelRef(request: ConversationRuntimeTextRequest): NimiModelRef {
  return {
    modelId: normalizeRequiredRuntimeModel(request.model),
    providerId: normalizeNullableText(request.connectorId) || undefined,
  };
}

function toRuntimeRoutePolicy(route: ConversationRuntimeTextRequest['route']): NimiRuntimeAIRoutePolicy {
  return route === 'local' || route === 'cloud' ? route : 'unspecified';
}

function toNimiRuntimeReasoning(
  reasoning: ConversationRuntimeTextRequest['reasoning'],
): NimiRuntimeAIReasoningOptions | undefined {
  if (!reasoning) {
    return undefined;
  }
  return {
    mode: reasoning.mode === 'on' ? 'on' : reasoning.mode === 'off' ? 'off' : undefined,
    traceMode: reasoning.traceMode,
    budgetTokens: reasoning.budgetTokens,
  };
}

function toNimiJsonObject(value: Record<string, string> | undefined): NimiJsonObject | undefined {
  if (!value || Object.keys(value).length === 0) {
    return undefined;
  }
  return { ...value };
}

function normalizeRequiredText(value: unknown, message: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}
