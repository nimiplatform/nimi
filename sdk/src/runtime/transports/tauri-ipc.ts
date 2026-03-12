import { asNimiError, createNimiError } from '../errors';
import { ReasonCode } from '../../types/index.js';
import type {
  RuntimeOpenStreamCall,
  RuntimeWireMessage,
  RuntimeStreamCloseCall,
  RuntimeTauriIpcTransportConfig,
  RuntimeTransport,
  RuntimeUnaryCall,
} from '../types';
import type { RuntimeTauriIpcTransportConfigInternal } from '../types-internal.js';

type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type TauriListenUnsubscribe = () => void;
type TauriListen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<TauriListenUnsubscribe> | TauriListenUnsubscribe;

type StreamOpenResponse = {
  streamId: string;
};

type UnaryResponse = {
  responseBytesBase64: string;
  responseMetadata?: Record<string, string>;
};

type StreamEventEnvelope = {
  streamId: string;
  eventType: 'next' | 'error' | 'completed';
  payloadBytesBase64?: string;
  error?: {
    message?: string;
    reasonCode?: string;
    actionHint?: string;
    traceId?: string;
    retryable?: boolean;
  };
};

const DEFAULT_COMMAND_NAMESPACE = 'runtime_bridge';
const DEFAULT_EVENT_NAMESPACE = 'runtime_bridge';

function readGlobalTauriInvoke(): TauriInvoke | null {
  const value = globalThis as {
    window?: { __TAURI__?: { core?: { invoke?: TauriInvoke } } };
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
  };

  const fromWindow = value.window?.__TAURI__?.core?.invoke;
  if (typeof fromWindow === 'function') {
    return fromWindow.bind(value.window?.__TAURI__?.core);
  }
  const fromGlobal = value.__TAURI__?.core?.invoke;
  if (typeof fromGlobal === 'function') {
    return fromGlobal.bind(value.__TAURI__?.core);
  }
  return null;
}

function readGlobalTauriListen(): TauriListen | null {
  const value = globalThis as {
    window?: { __TAURI__?: { event?: { listen?: TauriListen } } };
    __TAURI__?: { event?: { listen?: TauriListen } };
  };

  const fromWindow = value.window?.__TAURI__?.event?.listen;
  if (typeof fromWindow === 'function') {
    return fromWindow.bind(value.window?.__TAURI__?.event);
  }
  const fromGlobal = value.__TAURI__?.event?.listen;
  if (typeof fromGlobal === 'function') {
    return fromGlobal.bind(value.__TAURI__?.event);
  }
  return null;
}

function ensureTauriInvoke(): TauriInvoke {
  const invoke = readGlobalTauriInvoke();
  if (invoke) {
    return invoke;
  }
  throw createNimiError({
    message: 'tauri-ipc transport is unavailable (missing window.__TAURI__.core.invoke)',
    reasonCode: ReasonCode.SDK_RUNTIME_TAURI_INVOKE_MISSING,
    actionHint: 'use_tauri_shell_or_switch_transport',
    source: 'sdk',
  });
}

function ensureTauriListen(): TauriListen {
  const listen = readGlobalTauriListen();
  if (listen) {
    return listen;
  }
  throw createNimiError({
    message: 'tauri-ipc transport is unavailable (missing window.__TAURI__.event.listen)',
    reasonCode: ReasonCode.SDK_RUNTIME_TAURI_LISTEN_MISSING,
    actionHint: 'use_tauri_shell_or_switch_transport',
    source: 'sdk',
  });
}

function createCommandName(config: RuntimeTauriIpcTransportConfig, suffix: string): string {
  const prefix = String(config.commandNamespace || DEFAULT_COMMAND_NAMESPACE).trim();
  return `${prefix}_${suffix}`;
}

function createEventName(config: RuntimeTauriIpcTransportConfig, streamId: string): string {
  const prefix = String(config.eventNamespace || DEFAULT_EVENT_NAMESPACE).trim();
  return `${prefix}:stream:${streamId}`;
}

function createDefaultCommandName(suffix: string): string {
  return `${DEFAULT_COMMAND_NAMESPACE}_${suffix}`;
}

function canRetryWithDefaultCommand(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message || error || '')
    .trim()
    .toLowerCase();
  if (!message) {
    return false;
  }
  const mentionsCommand = message.includes('command');
  const mentionsNotFound = message.includes('not found');
  return (
    message.includes('unknown command')
    || message.includes('command not found')
    || (mentionsCommand && mentionsNotFound)
  );
}

async function invokeCommand(
  invoke: TauriInvoke,
  config: RuntimeTauriIpcTransportConfig,
  suffix: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const command = createCommandName(config, suffix);
  try {
    return await invoke(command, { payload });
  } catch (error) {
    const defaultCommand = createDefaultCommandName(suffix);
    if (
      command === defaultCommand
      || !canRetryWithDefaultCommand(error)
    ) {
      throw error;
    }
    return invoke(defaultCommand, { payload });
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] || 0);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  throw createNimiError({
    message: 'base64 encoder unavailable in current runtime',
    reasonCode: ReasonCode.SDK_RUNTIME_BASE64_ENCODER_UNAVAILABLE,
    actionHint: 'use_node_or_tauri_runtime',
    source: 'sdk',
  });
}

function fromBase64(value: string): Uint8Array {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return new Uint8Array(0);
  }
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(normalized, 'base64'));
  }
  if (typeof atob === 'function') {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  throw createNimiError({
    message: 'base64 decoder unavailable in current runtime',
    reasonCode: ReasonCode.SDK_RUNTIME_BASE64_DECODER_UNAVAILABLE,
    actionHint: 'use_node_or_tauri_runtime',
    source: 'sdk',
  });
}

function normalizeRequestBytes(input: unknown): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (input instanceof DataView) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (
    input
    && typeof input === 'object'
    && 'buffer' in input
    && (input as { buffer: unknown }).buffer instanceof ArrayBuffer
    && typeof (input as { byteOffset?: unknown }).byteOffset === 'number'
    && typeof (input as { byteLength?: unknown }).byteLength === 'number'
  ) {
    const source = input as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  throw createNimiError({
    message: 'runtime request must be protobuf bytes (Uint8Array)',
    reasonCode: ReasonCode.SDK_RUNTIME_REQUEST_BYTES_REQUIRED,
    actionHint: 'encode_protobuf_request_first',
    source: 'sdk',
  });
}

export function createTauriIpcTransport(
  config: RuntimeTauriIpcTransportConfig,
): RuntimeTransport {
  const internalConfig = config as RuntimeTauriIpcTransportConfigInternal;
  return {
    invokeUnary: async (input: RuntimeUnaryCall<RuntimeWireMessage>): Promise<RuntimeWireMessage> => {
      const invoke = ensureTauriInvoke();
      try {
        const result = await invokeCommand(invoke, internalConfig, 'unary', {
          methodId: input.methodId,
          requestBytesBase64: toBase64(normalizeRequestBytes(input.request)),
          metadata: input.metadata,
          authorization: input.authorization,
          timeoutMs: input.timeoutMs,
        });
        const response = asObject(result) as Partial<UnaryResponse>;
        if (typeof response.responseBytesBase64 !== 'string') {
          throw createNimiError({
            message: 'tauri unary response missing responseBytesBase64',
            reasonCode: ReasonCode.SDK_RUNTIME_TAURI_UNARY_BYTES_MISSING,
            actionHint: 'check_runtime_bridge_payload_contract',
            source: 'runtime',
          });
        }
        const observer = input._responseMetadataObserver || internalConfig._responseMetadataObserver;
        if (observer && response.responseMetadata) {
          const meta = response.responseMetadata;
          if (typeof meta === 'object' && Object.keys(meta).length > 0) {
            observer(meta);
          }
        }
        return fromBase64(response.responseBytesBase64);
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_TAURI_UNARY_FAILED,
          actionHint: 'check_runtime_bridge_and_daemon',
          source: 'runtime',
        });
      }
    },
    openStream: async (input: RuntimeOpenStreamCall<RuntimeWireMessage>): Promise<AsyncIterable<RuntimeWireMessage>> => {
      const invoke = ensureTauriInvoke();
      const listen = ensureTauriListen();

      let streamId = '';
      let unsubscribe: TauriListenUnsubscribe | null = null;

      const queue: RuntimeWireMessage[] = [];
      const waiters: Array<{
        resolve: (result: IteratorResult<RuntimeWireMessage>) => void;
        reject: (error: unknown) => void;
      }> = [];
      let done = false;
      let pendingError: unknown = null;
      let closed = false;
      let detachAbortListener: (() => void) | null = null;
      const releaseAbortListener = () => {
        if (!detachAbortListener) {
          return;
        }
        detachAbortListener();
        detachAbortListener = null;
      };

      const closeRemoteStream = async () => {
        if (!streamId) {
          return;
        }
        try {
          await invokeCommand(invoke, internalConfig, 'stream_close', { streamId });
        } catch {
          // best effort
        }
      };

      const flush = () => {
        while (waiters.length > 0 && queue.length > 0) {
          const waiter = waiters.shift();
          const nextValue = queue.shift();
          if (waiter && nextValue !== undefined) {
            waiter.resolve({ done: false, value: nextValue });
          }
        }

        if (pendingError) {
          while (waiters.length > 0) {
            const waiter = waiters.shift();
            if (waiter) {
              waiter.reject(pendingError);
            }
          }
          return;
        }

        if (done) {
          while (waiters.length > 0) {
            const waiter = waiters.shift();
            if (waiter) {
              waiter.resolve({ done: true, value: undefined as unknown as RuntimeWireMessage });
            }
          }
        }
      };

      const onStreamError = (error: unknown) => {
        pendingError = asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_TAURI_STREAM_FAILED,
          actionHint: 'retry_or_reopen_stream',
          source: 'runtime',
        });
        done = true;
        releaseAbortListener();
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        void closeRemoteStream();
        flush();
      };

      try {
        const opened = await invokeCommand(invoke, internalConfig, 'stream_open', {
        methodId: input.methodId,
        requestBytesBase64: toBase64(normalizeRequestBytes(input.request)),
        metadata: input.metadata,
        authorization: input.authorization,
        timeoutMs: input.timeoutMs,
        eventNamespace: internalConfig.eventNamespace,
      });
        const response = asObject(opened) as Partial<StreamOpenResponse>;
        streamId = String(response.streamId || '').trim();
        if (!streamId) {
          throw createNimiError({
            message: 'tauri stream open did not return streamId',
            reasonCode: ReasonCode.SDK_RUNTIME_TAURI_STREAM_ID_MISSING,
            actionHint: 'check_runtime_bridge',
            source: 'runtime',
          });
        }

        unsubscribe = await Promise.resolve(listen(createEventName(internalConfig, streamId), (event) => {
          const payload = asObject(event.payload) as Partial<StreamEventEnvelope>;
          const eventType = String(payload.eventType || '').trim();

          if (eventType === 'next') {
            queue.push(fromBase64(String(payload.payloadBytesBase64 || '')));
            flush();
            return;
          }

          if (eventType === 'error') {
            onStreamError(payload.error || createNimiError({
              message: 'runtime stream reported error',
              reasonCode: ReasonCode.SDK_RUNTIME_TAURI_STREAM_REMOTE_ERROR,
              actionHint: 'retry_or_reopen_stream',
              source: 'runtime',
            }));
            return;
          }

          if (eventType === 'completed') {
            done = true;
            releaseAbortListener();
            if (unsubscribe) {
              unsubscribe();
              unsubscribe = null;
            }
            flush();
          }
        }));
      } catch (error) {
        releaseAbortListener();
        if (unsubscribe) {
          unsubscribe();
        }
        await closeRemoteStream();
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_TAURI_STREAM_OPEN_FAILED,
          actionHint: 'check_runtime_bridge_and_daemon',
          source: 'runtime',
        });
      }

      const close = async () => {
        if (closed) {
          return;
        }
        closed = true;
        done = true;
        flush();
        releaseAbortListener();
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        await closeRemoteStream();
      };

      if (input.signal) {
        if (input.signal.aborted) {
          await close();
        } else {
          const abortHandler = () => {
            void close();
          };
          input.signal.addEventListener('abort', abortHandler, { once: true });
          detachAbortListener = () => {
            input.signal?.removeEventListener('abort', abortHandler);
          };
        }
      }

      const iterator: AsyncIterable<RuntimeWireMessage> = {
        [Symbol.asyncIterator](): AsyncIterator<RuntimeWireMessage> {
          return {
            next: async () => {
              if (pendingError) {
                const error = pendingError;
                pendingError = null;
                throw error;
              }
              if (queue.length > 0) {
                const value = queue.shift() as RuntimeWireMessage;
                return { done: false, value };
              }
              if (done) {
                return { done: true, value: undefined as unknown as RuntimeWireMessage };
              }
              return new Promise<IteratorResult<RuntimeWireMessage>>((resolve, reject) => {
                waiters.push({
                  resolve,
                  reject,
                });
              });
            },
            return: async () => {
              await close();
              return { done: true, value: undefined as unknown as RuntimeWireMessage };
            },
            throw: async (error) => {
              await close();
              throw error;
            },
          };
        },
      };

      return iterator as AsyncIterable<RuntimeWireMessage>;
    },
    closeStream: async (input: RuntimeStreamCloseCall): Promise<void> => {
      const invoke = ensureTauriInvoke();
      try {
        await invokeCommand(invoke, internalConfig, 'stream_close', {
          streamId: input.streamId,
        });
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_TAURI_STREAM_CLOSE_FAILED,
          actionHint: 'retry_close_or_drop_stream',
          source: 'runtime',
        });
      }
    },
  };
}
