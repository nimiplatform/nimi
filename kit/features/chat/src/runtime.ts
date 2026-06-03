import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  getPlatformClient,
  streamAppAiChatResponse as streamSdkAppAiChatResponse,
  submitAppAiChat as submitSdkAppAiChat,
  type AppAiChatMetadataDefaults,
  type AppAiChatPrompt,
  type AppAiChatRequest,
  type AppAiChatStreamRequest,
  type AppAiChatStreamResult,
  type Runtime,
  type TextGenerateOutput,
  type TextStreamPart,
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
    result: TextGenerateOutput;
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
  runtime?: Runtime;
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
  runtime?: Runtime;
  mode?: 'generate' | 'stream';
  model?: string;
  input?: AppAiChatPrompt;
  system?: string;
  subjectUserId?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  route?: AppAiChatRequest['route'];
  timeoutMs?: number;
  connectorId?: string;
  metadata?: AppAiChatRequest['metadata'];
  signal?: AbortSignal;
  resolveRequest?: (
    input: ChatComposerSubmitInput<TAttachment>,
  ) => AppAiChatRequest | AppAiChatStreamRequest;
  resolveInput?: (input: ChatComposerSubmitInput<TAttachment>) => AppAiChatPrompt;
  onChunk?: (part: TextStreamPart, input: ChatComposerSubmitInput<TAttachment>) => void;
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
      const runtime = options.runtime ?? getPlatformClient().runtime;
      const request = resolveAppAiChatRequest(input, options);

      if (options.mode === 'stream') {
        const result = await streamSdkAppAiChatResponse(
          runtime,
          request as AppAiChatStreamRequest,
          {
            onDelta: (_text, part) => {
              options.onChunk?.(part, input);
            },
            onFinish: (_result, part) => {
              if (part) {
                options.onChunk?.(part, input);
              }
            },
            onError: (_error, part) => {
              if (part) {
                options.onChunk?.(part, input);
              }
            },
          },
          { metadataDefaults: KIT_APP_AI_CHAT_METADATA },
        );

        await options.onResponse?.({
          mode: 'stream',
          text: result.text,
          result,
        }, input);
        return;
      }

      const result = await submitSdkAppAiChat(
        runtime,
        request,
        { metadataDefaults: KIT_APP_AI_CHAT_METADATA },
      );
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
  initialMessages = [],
  resolveRequest,
  onMessagesChange,
  onError,
}: UseAppAiChatSessionOptions): UseAppAiChatSessionResult {
  const runtimeClient = runtime ?? getPlatformClient().runtime;
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

      const result = await streamSdkAppAiChatResponse(
        runtimeClient,
        requestWithSignal,
        {
          onDelta: (text) => {
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
        { metadataDefaults: KIT_APP_AI_CHAT_METADATA },
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
  }, [commitMessages, onError, resolveRequest, runtimeClient]);

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

  const model = normalizeRequiredAppAiModel(options.model);
  return {
    model,
    input: options.resolveInput ? options.resolveInput(input) : (options.input ?? input.text),
    system: options.system,
    subjectUserId: options.subjectUserId,
    temperature: options.temperature,
    topP: options.topP,
    maxTokens: options.maxTokens,
    route: options.route,
    timeoutMs: options.timeoutMs,
    connectorId: options.connectorId,
    metadata: options.metadata,
    signal: options.mode === 'stream' ? options.signal : undefined,
  };
}

function normalizeRequiredAppAiModel(model: string | undefined): string {
  const normalized = model?.trim();
  if (!normalized) {
    throw new Error('app AI chat adapter requires an explicit model or resolveRequest');
  }
  if (normalized === 'auto') {
    throw new Error('app AI chat adapter requires a concrete Runtime model, not auto');
  }
  return normalized;
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
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any([existing, next]);
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
