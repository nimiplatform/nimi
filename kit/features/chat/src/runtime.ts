import { getPlatformClient } from '@nimiplatform/sdk';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  Runtime,
  TextGenerateInput,
  TextGenerateOutput,
  TextMessage,
  TextStreamInput,
  TextStreamPart,
} from '@nimiplatform/sdk/runtime';
import type { NimiError } from '@nimiplatform/sdk/types';
import type { ChatComposerAdapter, ChatComposerSubmitInput } from './types.js';

const DEFAULT_RUNTIME_CHAT_METADATA = {
  callerKind: 'third-party-app',
  callerId: 'nimi-kit.chat.runtime',
  surfaceId: 'kit.features.chat',
} as const;

export type RuntimeChatRequest = TextGenerateInput;
export type RuntimeChatStreamRequest = TextStreamInput;
export type RuntimeChatPrompt = string | TextMessage[];
export type RuntimeChatDeltaPart = Extract<TextStreamPart, { type: 'delta' }>;
export type RuntimeChatFinishPart = Extract<TextStreamPart, { type: 'finish' }>;
export type RuntimeChatErrorPart = Extract<TextStreamPart, { type: 'error' }>;
export type RuntimeChatError = NimiError | Error;
export type RuntimeChatSessionMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  status?: 'streaming' | 'complete' | 'error' | 'canceled';
  error?: string;
};

export type RuntimeChatStreamResult = {
  text: string;
  finish: RuntimeChatFinishPart | null;
};

export type RuntimeChatStreamHandlers = {
  onDelta?: (text: string, part: RuntimeChatDeltaPart) => void;
  onFinish?: (result: RuntimeChatStreamResult, part: RuntimeChatFinishPart | null) => void;
  onError?: (error: RuntimeChatError, part: RuntimeChatErrorPart | null) => void;
};

export type RuntimeChatComposerResponse =
  | {
    mode: 'generate';
    text: string;
    result: TextGenerateOutput;
  }
  | {
    mode: 'stream';
    text: string;
    result: RuntimeChatStreamResult;
  };

export type RuntimeChatSessionSendInput = {
  prompt: string;
  displayPrompt?: string;
  resolveRequest?: (
    context: RuntimeChatSessionResolveRequestContext,
  ) => RuntimeChatStreamRequest;
};

export type RuntimeChatSessionResolveRequestContext = {
  prompt: string;
  displayPrompt: string;
  messages: readonly RuntimeChatSessionMessage[];
};

export type UseRuntimeChatSessionOptions = {
  runtime?: Runtime;
  initialMessages?: readonly RuntimeChatSessionMessage[];
  resolveRequest: (
    context: RuntimeChatSessionResolveRequestContext,
  ) => RuntimeChatStreamRequest;
  onMessagesChange?: (messages: readonly RuntimeChatSessionMessage[]) => void;
  onError?: (error: RuntimeChatError) => void;
};

export type UseRuntimeChatSessionResult = {
  messages: readonly RuntimeChatSessionMessage[];
  isStreaming: boolean;
  canCancel: boolean;
  error: string | null;
  sendPrompt: (input: string | RuntimeChatSessionSendInput) => Promise<void>;
  cancelCurrent: () => void;
  resetMessages: (messages?: readonly RuntimeChatSessionMessage[]) => void;
  setMessages: (messages: readonly RuntimeChatSessionMessage[]) => void;
  clearError: () => void;
};

export type RuntimeChatComposerAdapterOptions<TAttachment = never> = {
  runtime?: Runtime;
  mode?: 'generate' | 'stream';
  model?: string;
  input?: RuntimeChatPrompt;
  system?: string;
  subjectUserId?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  route?: TextGenerateInput['route'];
  timeoutMs?: number;
  connectorId?: string;
  metadata?: TextGenerateInput['metadata'];
  signal?: AbortSignal;
  resolveRequest?: (
    input: ChatComposerSubmitInput<TAttachment>,
  ) => RuntimeChatRequest | RuntimeChatStreamRequest;
  resolveInput?: (input: ChatComposerSubmitInput<TAttachment>) => RuntimeChatPrompt;
  onChunk?: (part: TextStreamPart, input: ChatComposerSubmitInput<TAttachment>) => void;
  onResponse?: (
    response: RuntimeChatComposerResponse,
    input: ChatComposerSubmitInput<TAttachment>,
  ) => Promise<void> | void;
};

export async function submitRuntimeChat(
  runtime: Runtime,
  request: RuntimeChatRequest,
): Promise<TextGenerateOutput> {
  return runtime.ai.text.generate(withDefaultRuntimeChatMetadata(request));
}

export async function submitPlatformChat(
  request: RuntimeChatRequest,
): Promise<TextGenerateOutput> {
  return submitRuntimeChat(getPlatformClient().runtime, request);
}

export async function streamRuntimeChatResponse(
  runtime: Runtime,
  request: RuntimeChatStreamRequest,
  handlers: RuntimeChatStreamHandlers = {},
): Promise<RuntimeChatStreamResult> {
  const output = await runtime.ai.text.stream(withDefaultRuntimeChatMetadata(request));
  let fullText = '';
  let finish: RuntimeChatFinishPart | null = null;

  for await (const part of output.stream) {
    if (part.type === 'delta') {
      fullText += part.text;
      handlers.onDelta?.(part.text, part);
      continue;
    }
    if (part.type === 'finish') {
      finish = part;
      const result = { text: fullText, finish };
      handlers.onFinish?.(result, part);
      return result;
    }
    if (part.type === 'error') {
      const error = toRuntimeChatError(part.error);
      handlers.onError?.(error, part);
      throw error;
    }
  }

  const result = { text: fullText, finish };
  if (fullText.length > 0) {
    handlers.onFinish?.(result, null);
  }
  return result;
}

export async function streamPlatformChatResponse(
  request: RuntimeChatStreamRequest,
  handlers: RuntimeChatStreamHandlers = {},
): Promise<RuntimeChatStreamResult> {
  return streamRuntimeChatResponse(getPlatformClient().runtime, request, handlers);
}

export function createRuntimeChatComposerAdapter<TAttachment = never>(
  options: RuntimeChatComposerAdapterOptions<TAttachment> = {},
): ChatComposerAdapter<TAttachment> {
  return {
    submit: async (input) => {
      const runtime = options.runtime ?? getPlatformClient().runtime;
      const request = resolveRuntimeChatRequest(input, options);

      if (options.mode === 'stream') {
        const result = await streamRuntimeChatResponse(runtime, request as RuntimeChatStreamRequest, {
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
        });

        await options.onResponse?.({
          mode: 'stream',
          text: result.text,
          result,
        }, input);
        return;
      }

      const result = await submitRuntimeChat(runtime, request);
      await options.onResponse?.({
        mode: 'generate',
        text: result.text,
        result,
      }, input);
    },
  };
}

export function useRuntimeChatSession({
  runtime,
  initialMessages = [],
  resolveRequest,
  onMessagesChange,
  onError,
}: UseRuntimeChatSessionOptions): UseRuntimeChatSessionResult {
  const runtimeClient = runtime ?? getPlatformClient().runtime;
  const [messages, setMessagesState] = useState<readonly RuntimeChatSessionMessage[]>(initialMessages);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef(messages);
  const abortControllerRef = useRef<AbortController | null>(null);

  const commitMessages = useCallback((
    next:
      | readonly RuntimeChatSessionMessage[]
      | ((current: readonly RuntimeChatSessionMessage[]) => readonly RuntimeChatSessionMessage[]),
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

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const resetMessages = useCallback((nextMessages: readonly RuntimeChatSessionMessage[] = []) => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    commitMessages([...nextMessages]);
    setIsStreaming(false);
    setError(null);
  }, [commitMessages]);

  const cancelCurrent = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const sendPrompt = useCallback(async (input: string | RuntimeChatSessionSendInput) => {
    const payload = typeof input === 'string' ? { prompt: input } : input;
    const prompt = String(payload.prompt || '').trim();
    if (!prompt || isStreaming) {
      return;
    }

    const userMessage: RuntimeChatSessionMessage = {
      id: createRuntimeChatSessionMessageId(),
      role: 'user',
      content: String(payload.displayPrompt || prompt).trim() || prompt,
      timestamp: new Date().toISOString(),
      status: 'complete',
    };
    const assistantMessageId = createRuntimeChatSessionMessageId();
    const assistantPlaceholder: RuntimeChatSessionMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'streaming',
    };
    const nextMessages = [...messagesRef.current, userMessage];

    commitMessages([...nextMessages, assistantPlaceholder]);
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
      const requestWithSignal = withRuntimeChatAbortSignal(request, abortController.signal);

      const result = await streamRuntimeChatResponse(runtimeClient, requestWithSignal, {
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
      });

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
      const resolvedError = toRuntimeChatError(nextError instanceof Error ? nextError : String(nextError));
      const errorMessage = resolvedError.message || 'runtime chat stream failed';
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
      setIsStreaming(false);
    }
  }, [commitMessages, isStreaming, onError, resolveRequest, runtimeClient]);

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

function resolveRuntimeChatRequest<TAttachment>(
  input: ChatComposerSubmitInput<TAttachment>,
  options: RuntimeChatComposerAdapterOptions<TAttachment>,
): RuntimeChatRequest | RuntimeChatStreamRequest {
  if (options.resolveRequest) {
    return options.resolveRequest(input);
  }

  if (input.attachments.length > 0 && !options.resolveInput) {
    throw new Error('runtime chat adapter requires resolveInput or resolveRequest when attachments are present');
  }

  return {
    model: options.model || 'auto',
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

function withDefaultRuntimeChatMetadata<T extends RuntimeChatRequest | RuntimeChatStreamRequest>(request: T): T {
  return {
    ...request,
    metadata: {
      ...DEFAULT_RUNTIME_CHAT_METADATA,
      ...(request.metadata || {}),
    },
  };
}

function toRuntimeChatError(error: NimiError | Error | string): RuntimeChatError {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error || 'runtime chat stream failed'));
}

function withRuntimeChatAbortSignal<T extends RuntimeChatStreamRequest>(request: T, signal: AbortSignal): T {
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

function createRuntimeChatSessionMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
