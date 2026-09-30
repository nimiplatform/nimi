import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  createNimiRuntimeAIModel,
  runNimiTextGenerate,
  streamNimiTextResponse,
  textPart,
  type NimiAiModel,
  type NimiGenerateTextRequest,
  type NimiGenerateTextResult,
  type NimiJsonObject,
  type NimiMessage,
  type NimiMessagePart,
  type NimiRunEvent,
  type NimiRuntimeAIModelOptions,
  type NimiRuntimeAIReasoningOptions,
  type NimiTextError,
  type NimiTextStreamResponseResult,
  type NimiTextTurnEvent,
  type NimiError,
} from '@nimiplatform/kit/core/sdk-contract';
import type { ChatComposerAdapter, ChatComposerSubmitInput } from './types.js';
import type { ConversationAssistantOutputItem } from './orchestration/contracts.js';
import {
  createAssistantOutputCollector,
  toAssistantTurnItems,
  type AssistantOutputCollector,
} from './runtime/assistant-output.js';
export type {
  ModelConversationRuntimeAdapterOptions,
  SimpleAiConversationProviderOptions,
} from './runtime/orchestration.js';
export {
  createModelConversationRuntimeAdapter,
  createSdkConversationRuntimeAdapter,
  createSimpleAiConversationProvider,
} from './runtime/orchestration.js';

const KIT_APP_AI_CHAT_METADATA: AppAiChatMetadataDefaults = {
  callerKind: 'third-party-app',
  callerId: 'nimi-kit.chat.app-ai',
  surfaceId: 'kit.features.chat',
} as const;

export type AppAiChatRuntime = NimiRuntimeAIModelOptions['runtime'];
export type AppAiChatMetadataDefaults = Record<string, string>;
export type AppAiChatMessage = Omit<NimiMessage, 'content'> & {
  readonly content: string | readonly NimiMessagePart[];
  /** An earlier assistant turn's stored ordered output, replayed unmodified. */
  readonly outputItems?: readonly ConversationAssistantOutputItem[];
};
export type AppAiChatPrompt = string | readonly AppAiChatMessage[];
export type AppAiChatGenerateResult = NimiGenerateTextResult;
export type AppAiChatStreamChunk = NimiRunEvent;
export type AppAiChatRequest = {
  readonly input: AppAiChatPrompt;
  readonly system?: string;
  readonly subjectUserId?: string;
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly metadata?: Record<string, string>;
  readonly reasoning?: NimiRuntimeAIReasoningOptions;
  readonly signal?: AbortSignal;
};
export type AppAiChatStreamRequest = AppAiChatRequest;
export type AppAiChatStreamResult = NimiTextStreamResponseResult;
export type AppAiChatError = NimiError | Error;
export type AppAiChatSessionMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  status?: 'streaming' | 'complete' | 'error' | 'canceled';
  error?: string;
  /**
   * Set on a completed assistant message when the model returned opaque
   * reasoning continuity; pass it back as that message's `outputItems`.
   */
  outputItems?: readonly ConversationAssistantOutputItem[];
};

export type AppAiChatComposerResponse =
  | {
    mode: 'generate';
    text: string;
    result: AppAiChatGenerateResult;
  }
  | {
    mode: 'stream';
    text: string;
    result: AppAiChatStreamResult;
  };

export type AppAiChatSessionSendInput = {
  prompt: string;
  displayPrompt?: string;
  resolveRequest?: (
    context: AppAiChatSessionResolveRequestContext,
  ) => AppAiChatStreamRequest;
};

export type AppAiChatSessionResolveRequestContext = {
  prompt: string;
  displayPrompt: string;
  messages: readonly AppAiChatSessionMessage[];
};

export type UseAppAiChatSessionOptions = {
  runtime?: AppAiChatRuntime;
  appId?: string;
  /**
   * A text model already bound to its caller, such as the protected App model
   * from `createNimiLocalAppTextModel`, used instead of `runtime` and `appId`.
   * It carries the App identity and configured route itself, so a request that
   * sets `subjectUserId`, `timeoutMs`, `metadata` or `reasoning` fails.
   */
  model?: NimiAiModel;
  initialMessages?: readonly AppAiChatSessionMessage[];
  resolveRequest: (
    context: AppAiChatSessionResolveRequestContext,
  ) => AppAiChatStreamRequest;
  onMessagesChange?: (messages: readonly AppAiChatSessionMessage[]) => void;
  onError?: (error: AppAiChatError) => void;
};

export type UseAppAiChatSessionResult = {
  messages: readonly AppAiChatSessionMessage[];
  isStreaming: boolean;
  canCancel: boolean;
  error: string | null;
  sendPrompt: (input: string | AppAiChatSessionSendInput) => Promise<void>;
  cancelCurrent: () => void;
  resetMessages: (messages?: readonly AppAiChatSessionMessage[]) => void;
  setMessages: (messages: readonly AppAiChatSessionMessage[]) => void;
  clearError: () => void;
};

export type AppAiChatComposerAdapterOptions<TAttachment = never> = {
  runtime?: AppAiChatRuntime;
  appId?: string;
  mode?: 'generate' | 'stream';
  input?: AppAiChatPrompt;
  system?: string;
  subjectUserId?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutMs?: number;
  metadata?: AppAiChatRequest['metadata'];
  reasoning?: NimiRuntimeAIReasoningOptions;
  signal?: AbortSignal;
  resolveRequest?: (
    input: ChatComposerSubmitInput<TAttachment>,
  ) => AppAiChatRequest | AppAiChatStreamRequest;
  resolveInput?: (input: ChatComposerSubmitInput<TAttachment>) => AppAiChatPrompt;
  onChunk?: (part: AppAiChatStreamChunk, input: ChatComposerSubmitInput<TAttachment>) => void;
  onResponse?: (
    response: AppAiChatComposerResponse,
    input: ChatComposerSubmitInput<TAttachment>,
  ) => Promise<void> | void;
};

export function createAppAiChatComposerAdapter<TAttachment = never>(
  options: AppAiChatComposerAdapterOptions<TAttachment> = {},
): ChatComposerAdapter<TAttachment> {
  return {
    submit: async (input) => {
      const runtime = requireAppAiRuntime(options.runtime);
      const request = resolveAppAiChatRequest(input, options);
      const model = createAppAiChatModel(runtime, request, options.appId);
      const textRequest = toNimiGenerateTextRequest(request);

      if (options.mode === 'stream') {
        const result = await streamNimiTextResponse(
          {
            runtime: { model },
            request: textRequest,
            signal: request.signal,
          },
          {
            onDelta: (
              _text: string,
              event: Extract<NimiTextTurnEvent, { readonly type: 'text-delta' }>,
            ) => {
              options.onChunk?.(event.runEvent, input);
            },
          },
        );

        await options.onResponse?.({
          mode: 'stream',
          text: result.text,
          result,
        }, input);
        return;
      }

      const generated = await runNimiTextGenerate({
        runtime: { model },
        request: textRequest,
      });
      if (!generated.ok) {
        throw toError(generated.error);
      }
      const result = generated.result;
      await options.onResponse?.({
        mode: 'generate',
        text: result.text,
        result,
      }, input);
    },
  };
}

export function useAppAiChatSession({
  runtime,
  appId,
  model: boundModel,
  initialMessages = [],
  resolveRequest,
  onMessagesChange,
  onError,
}: UseAppAiChatSessionOptions): UseAppAiChatSessionResult {
  const [messages, setMessagesState] = useState<readonly AppAiChatSessionMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef(messages);
  // The request that owns the session's streaming state. Only it may finish,
  // fail, cancel or clear that state; a reset or unmount revokes it, so a
  // revoked request that ends late cannot touch the next one.
  const activeRequestRef = useRef<{ readonly controller: AbortController } | null>(null);

  // messagesRef is updated at once, not when React next renders, so a prompt
  // sent right after a reset builds on the reset messages.
  const commitMessages = useCallback((
    next:
      | readonly AppAiChatSessionMessage[]
      | ((current: readonly AppAiChatSessionMessage[]) => readonly AppAiChatSessionMessage[]),
  ) => {
    const resolved = typeof next === 'function' ? next(messagesRef.current) : next;
    messagesRef.current = resolved;
    setMessagesState(resolved);
  }, []);

  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  // An unmounted session closes the reply it is still streaming.
  useEffect(() => () => {
    const active = activeRequestRef.current;
    activeRequestRef.current = null;
    active?.controller.abort();
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const resetMessages = useCallback((nextMessages: readonly AppAiChatSessionMessage[] = []) => {
    const active = activeRequestRef.current;
    activeRequestRef.current = null;
    active?.controller.abort();
    commitMessages([...nextMessages]);
    setIsStreaming(false);
    setError(null);
  }, [commitMessages]);

  const cancelCurrent = useCallback(() => {
    activeRequestRef.current?.controller.abort();
  }, []);

  const sendPrompt = useCallback(async (input: string | AppAiChatSessionSendInput) => {
    const payload = typeof input === 'string' ? { prompt: input } : input;
    const prompt = String(payload.prompt || '').trim();
    if (!prompt || activeRequestRef.current) {
      return;
    }

    const userMessage: AppAiChatSessionMessage = {
      id: createAppAiChatSessionMessageId(),
      role: 'user',
      content: String(payload.displayPrompt || prompt).trim() || prompt,
      timestamp: new Date().toISOString(),
      status: 'complete',
    };
    const assistantMessageId = createAppAiChatSessionMessageId();
    const assistantPlaceholder: AppAiChatSessionMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'streaming',
    };
    const nextMessages = [...messagesRef.current, userMessage];
    const active = { controller: new AbortController() };
    const owns = () => activeRequestRef.current === active;

    activeRequestRef.current = active;
    commitMessages([...nextMessages, assistantPlaceholder]);
    setIsStreaming(true);
    setError(null);

    try {
      const request = (payload.resolveRequest ?? resolveRequest)({
        prompt,
        displayPrompt: userMessage.content,
        messages: nextMessages,
      });
      const requestWithSignal = withAppAiChatAbortSignal(request, active.controller.signal);
      const output = createAssistantOutputCollector();
      const model = observeAssistantOutput(
        boundModel
          ? requireCallerBoundAppAiChat(boundModel, runtime, requestWithSignal)
          : createAppAiChatModel(requireAppAiRuntime(runtime), requestWithSignal, appId),
        output,
      );
      const textRequest = toNimiGenerateTextRequest(requestWithSignal, { metadata: !boundModel });

      const result = await streamNimiTextResponse(
        {
          runtime: { model },
          request: textRequest,
          signal: requestWithSignal.signal,
        },
        {
          onDelta: (text: string) => {
            if (!owns()) {
              return;
            }
            commitMessages((current) => current.map((message) => (
              message.id === assistantMessageId
                ? {
                  ...message,
                  content: message.content + text,
                  status: 'streaming',
                }
                : message
            )));
          },
        },
      );

      if (!owns()) {
        return;
      }
      const outputItems = output.complete();
      commitMessages((current) => current.map((message) => (
        message.id === assistantMessageId
          ? {
            ...message,
            content: result.text,
            status: 'complete',
            error: undefined,
            ...(outputItems ? { outputItems } : {}),
          }
          : message
      )));
    } catch (nextError) {
      if (!owns()) {
        return;
      }
      if (isAbortLikeError(nextError)) {
        commitMessages((current) => current.map((message) => (
          message.id === assistantMessageId
            ? {
              ...message,
              status: 'canceled',
              error: undefined,
            }
            : message
        )));
        return;
      }
      const resolvedError = toAppAiChatError(nextError instanceof Error ? nextError : String(nextError));
      const errorMessage = resolvedError.message || 'app AI chat stream failed';
      setError(errorMessage);
      commitMessages((current) => current.map((message) => (
        message.id === assistantMessageId
          ? {
            ...message,
            content: `Error: ${errorMessage}`,
            status: 'error',
            error: errorMessage,
          }
          : message
      )));
      onError?.(resolvedError);
    } finally {
      if (owns()) {
        activeRequestRef.current = null;
        setIsStreaming(false);
      }
    }
  }, [appId, boundModel, commitMessages, onError, resolveRequest, runtime]);

  return {
    messages,
    isStreaming,
    canCancel: isStreaming,
    error,
    sendPrompt,
    cancelCurrent,
    resetMessages,
    setMessages: resetMessages,
    clearError,
  };
}

function resolveAppAiChatRequest<TAttachment>(
  input: ChatComposerSubmitInput<TAttachment>,
  options: AppAiChatComposerAdapterOptions<TAttachment>,
): AppAiChatRequest | AppAiChatStreamRequest {
  if (options.resolveRequest) {
    return options.resolveRequest(input);
  }

  if (input.attachments.length > 0 && !options.resolveInput) {
    throw new Error('app AI chat adapter requires resolveInput or resolveRequest when attachments are present');
  }

  return {
    input: options.resolveInput ? options.resolveInput(input) : (options.input ?? input.text),
    system: options.system,
    subjectUserId: options.subjectUserId,
    temperature: options.temperature,
    topP: options.topP,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs,
    metadata: options.metadata,
    reasoning: options.reasoning,
    signal: options.mode === 'stream' ? options.signal : undefined,
  };
}

function createAppAiChatModel(
  runtime: AppAiChatRuntime,
  request: AppAiChatRequest,
  appId: string | undefined,
) {
  return createNimiRuntimeAIModel({
    runtime,
    appId: normalizeRequiredText(appId, 'app AI chat requires an explicit appId'),
    subjectUserId: normalizeNullableText(request.subjectUserId) || undefined,
    timeoutMs: request.timeoutMs,
    metadata: withDefaultAppAiChatMetadata(request.metadata),
    reasoning: request.reasoning,
  });
}

// A caller-bound model carries its caller's identity and route; Runtime
// request options it cannot carry fail the turn instead of being dropped.
function requireCallerBoundAppAiChat(
  model: NimiAiModel,
  runtime: AppAiChatRuntime | undefined,
  request: AppAiChatRequest,
): NimiAiModel {
  if (runtime) {
    throw new Error('app AI chat takes either a Runtime AI surface or a caller-bound model, not both');
  }
  const unsupported = [
    normalizeNullableText(request.subjectUserId) ? 'subjectUserId' : '',
    request.timeoutMs !== undefined ? 'timeoutMs' : '',
    request.metadata && Object.keys(request.metadata).length > 0 ? 'metadata' : '',
    request.reasoning ? 'reasoning' : '',
  ].filter(Boolean);
  if (unsupported.length > 0) {
    throw new Error(`a caller-bound app AI chat model cannot carry ${unsupported.join(', ')}`);
  }
  return model;
}

// Only fields that are set are sent: a caller-bound model such as the
// protected App model refuses keys it cannot represent, even when undefined.
function toNimiGenerateTextRequest(
  request: AppAiChatRequest,
  options: { readonly metadata: boolean } = { metadata: true },
): NimiGenerateTextRequest {
  const messages: NimiMessage[] = [];
  const system = normalizeNullableText(request.system);
  if (system) {
    messages.push({ role: 'system', content: [textPart(system)] });
  }
  if (typeof request.input === 'string') {
    messages.push({ role: 'user', content: [textPart(request.input)] });
  } else {
    messages.push(...request.input.map(toNimiMessage));
  }
  const parameters = {
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.topP === undefined ? {} : { topP: request.topP }),
    ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
    ...(options.metadata ? { metadata: withDefaultAppAiChatMetadata(request.metadata) } : {}),
  };
  return {
    messages,
    ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
  };
}

function toNimiMessage(message: AppAiChatMessage): NimiMessage {
  const name = normalizeNullableText(message.name);
  const common = {
    ...(name ? { name } : {}),
    ...(message.metadata === undefined ? {} : { metadata: message.metadata }),
  };
  if (message.role === 'assistant') {
    // An earlier assistant turn is replayed as its canonical ordered output.
    const text = typeof message.content === 'string'
      ? message.content
      : message.content.map((part) => {
        if (part.type !== 'text') {
          throw new Error('app AI chat assistant history accepts only text content');
        }
        return part.text;
      }).join('');
    return {
      role: 'assistant',
      content: [],
      ...common,
      turnItems: message.turnItems?.length
        ? message.turnItems
        : toAssistantTurnItems(text.trim(), message.outputItems),
    };
  }
  const toolCallId = normalizeNullableText(message.toolCallId);
  return {
    role: message.role,
    content: typeof message.content === 'string' ? [textPart(message.content)] : message.content,
    ...common,
    ...(toolCallId ? { toolCallId } : {}),
    ...(message.toolCalls === undefined ? {} : { toolCalls: message.toolCalls }),
  };
}

// Records the assistant turn's ordered text and continuity as the stream passes.
function observeAssistantOutput<TModel extends { streamText?: (request: NimiGenerateTextRequest) => AsyncIterable<NimiRunEvent> | Promise<AsyncIterable<NimiRunEvent>> }>(
  model: TModel,
  output: AssistantOutputCollector,
): TModel {
  const streamText = model.streamText?.bind(model);
  if (!streamText) {
    return model;
  }
  return {
    ...model,
    async streamText(request: NimiGenerateTextRequest) {
      const events = await streamText(request);
      return (async function* observed() {
        for await (const event of events) {
          if (event.type === 'text-delta') {
            output.text(event.text, event.itemIndex);
          } else if (event.type === 'reasoning-continuity') {
            output.continuity(event.carrier, event.itemIndex);
          }
          yield event;
        }
      })();
    },
  };
}

function requireAppAiRuntime(runtime: AppAiChatRuntime | undefined): AppAiChatRuntime {
  if (!runtime) {
    throw new Error('app AI chat requires an explicit Runtime AI surface');
  }
  return runtime;
}

function withDefaultAppAiChatMetadata(
  metadata: Record<string, string> | undefined,
): NimiJsonObject {
  return {
    ...KIT_APP_AI_CHAT_METADATA,
    ...(metadata || {}),
  };
}

function normalizeRequiredText(value: unknown, message: string): string {
  const normalized = normalizeNullableText(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function toError(error: NimiTextError): Error {
  const next = new Error(error.message);
  next.name = error.code;
  return next;
}

function toAppAiChatError(error: NimiError | Error | string): AppAiChatError {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error || 'app AI chat stream failed'));
}

function withAppAiChatAbortSignal<T extends AppAiChatStreamRequest>(request: T, signal: AbortSignal): T {
  return {
    ...request,
    signal: combineAbortSignals(request.signal, signal),
  };
}

function combineAbortSignals(existing: AbortSignal | undefined, next: AbortSignal): AbortSignal {
  if (!existing) {
    return next;
  }
  const abortSignalCtor = typeof AbortSignal === 'undefined'
    ? null
    : AbortSignal as typeof AbortSignal & { any?: (signals: readonly AbortSignal[]) => AbortSignal };
  if (abortSignalCtor && typeof abortSignalCtor.any === 'function') {
    return abortSignalCtor.any([existing, next]);
  }

  const fallback = new AbortController();
  const abort = () => {
    if (!fallback.signal.aborted) {
      fallback.abort();
    }
  };
  if (existing.aborted || next.aborted) {
    abort();
  } else {
    existing.addEventListener('abort', abort, { once: true });
    next.addEventListener('abort', abort, { once: true });
  }
  return fallback.signal;
}

function isAbortLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message === 'Aborted';
  }
  return false;
}

function createAppAiChatSessionMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export { useAgentActivityReferences, type AgentActivityReferencesState } from './runtime/agent-activity-references.js';

export { useAgentIntroduction } from './runtime/agent-introduction.js';
