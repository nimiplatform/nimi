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
export type {
  SimpleAiConversationProviderOptions,
} from './runtime/orchestration.js';
export {
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
  initialMessages = [],
  resolveRequest,
  onMessagesChange,
  onError,
}: UseAppAiChatSessionOptions): UseAppAiChatSessionResult {
  const [messages, setMessagesState] = useState<readonly AppAiChatSessionMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef(messages);
  const isStreamingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const commitMessages = useCallback((
    next:
      | readonly AppAiChatSessionMessage[]
      | ((current: readonly AppAiChatSessionMessage[]) => readonly AppAiChatSessionMessage[]),
  ) => {
    setMessagesState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      messagesRef.current = resolved;
      return resolved;
    });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const resetMessages = useCallback((nextMessages: readonly AppAiChatSessionMessage[] = []) => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    commitMessages([...nextMessages]);
    isStreamingRef.current = false;
    setIsStreaming(false);
    setError(null);
  }, [commitMessages]);

  const cancelCurrent = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const sendPrompt = useCallback(async (input: string | AppAiChatSessionSendInput) => {
    const payload = typeof input === 'string' ? { prompt: input } : input;
    const prompt = String(payload.prompt || '').trim();
    if (!prompt || isStreamingRef.current) {
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

    commitMessages([...nextMessages, assistantPlaceholder]);
    isStreamingRef.current = true;
    setIsStreaming(true);
    setError(null);

    try {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const request = (payload.resolveRequest ?? resolveRequest)({
        prompt,
        displayPrompt: userMessage.content,
        messages: nextMessages,
      });
      const requestWithSignal = withAppAiChatAbortSignal(request, abortController.signal);
      const model = createAppAiChatModel(requireAppAiRuntime(runtime), requestWithSignal, appId);
      const textRequest = toNimiGenerateTextRequest(requestWithSignal);

      const result = await streamNimiTextResponse(
        {
          runtime: { model },
          request: textRequest,
          signal: requestWithSignal.signal,
        },
        {
          onDelta: (text: string) => {
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

      commitMessages((current) => current.map((message) => (
        message.id === assistantMessageId
          ? {
            ...message,
            content: result.text,
            status: 'complete',
            error: undefined,
          }
          : message
      )));
    } catch (nextError) {
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
      abortControllerRef.current = null;
      isStreamingRef.current = false;
      setIsStreaming(false);
    }
  }, [appId, commitMessages, onError, resolveRequest, runtime]);

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

function toNimiGenerateTextRequest(
  request: AppAiChatRequest,
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
  return {
    messages,
    parameters: {
      temperature: request.temperature,
      topP: request.topP,
      maxTokens: request.maxTokens,
      metadata: withDefaultAppAiChatMetadata(request.metadata),
    },
  };
}

function toNimiMessage(message: AppAiChatMessage): NimiMessage {
  return {
    role: message.role,
    content: typeof message.content === 'string' ? [textPart(message.content)] : message.content,
    name: normalizeNullableText(message.name) || undefined,
    toolCallId: normalizeNullableText(message.toolCallId) || undefined,
    toolCalls: message.toolCalls,
    metadata: message.metadata,
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
