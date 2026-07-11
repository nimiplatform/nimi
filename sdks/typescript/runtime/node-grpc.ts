import type {
  CallOptions,
  ChannelCredentials,
  ChannelOptions,
  Client,
  ClientReadableStream,
  Metadata,
  ServiceError,
} from '@grpc/grpc-js';
import type { CoreTransport } from '../core-client';
import { getRuntimeWireCodec } from '../core-generated/runtime-wire-codecs';
import { asNimiError, ReasonCode } from '../types';
import type {
  CoreMetadata,
  CoreResponseMetadata,
  CoreStreamRequest,
  CoreUnaryRequest,
} from '../types';
import {
  collectResponseMetadata,
  collectStatusResponseMetadata,
  emitResponseMetadata,
  normalizeServiceError,
  toTransportError,
  type GrpcMetadataLike,
  type GrpcStatusLike,
} from './node-grpc-errors';
import {
  normalizeRuntimeNodeGrpcEndpoint,
  runtimeNodeGrpcTransportAllowsSensitiveCredentials,
} from './node-grpc-security';

export { RuntimeNodeGrpcTransportError } from './node-grpc-errors';

type GrpcModule = typeof import('@grpc/grpc-js');
const RUNTIME_NODE_GRPC_MAX_BUFFERED_STREAM_CHUNKS = 1024;

export interface RuntimeNodeGrpcTlsOptions {
  readonly enabled?: boolean;
  readonly rootCertPem?: string;
  readonly serverName?: string;
}

export interface RuntimeNodeGrpcTransportOptions {
  readonly endpoint?: string;
  readonly tls?: RuntimeNodeGrpcTlsOptions;
  readonly bridge?: RuntimeNodeGrpcBridge;
}

export interface RuntimeNodeGrpcBridgeRequest {
  readonly endpoint: string;
  readonly methodId: string;
  readonly body: Uint8Array;
  readonly metadata?: CoreMetadata;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly responseMetadataObserver?: (metadata: CoreResponseMetadata) => void;
}

export interface RuntimeNodeGrpcBridge {
  unary(request: RuntimeNodeGrpcBridgeRequest): Promise<Uint8Array>;
  serverStream(request: RuntimeNodeGrpcBridgeRequest): AsyncIterable<Uint8Array>;
}

let grpcModulePromise: Promise<GrpcModule> | undefined;

function loadGrpcModule(): Promise<GrpcModule> {
  grpcModulePromise ??= import('@grpc/grpc-js');
  return grpcModulePromise;
}

function toChannelCredentials(grpc: GrpcModule, options: RuntimeNodeGrpcTransportOptions): ChannelCredentials {
  if (!options.tls?.enabled) {
    return grpc.credentials.createInsecure();
  }
  const rootCert = options.tls.rootCertPem ? Buffer.from(options.tls.rootCertPem, 'utf8') : undefined;
  return grpc.credentials.createSsl(rootCert);
}

function toChannelOptions(options: RuntimeNodeGrpcTransportOptions): ChannelOptions {
  const channelOptions: ChannelOptions = {
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
    'grpc.max_send_message_length': 64 * 1024 * 1024,
  };
  const serverName = String(options.tls?.serverName || '').trim();
  if (serverName) {
    channelOptions['grpc.ssl_target_name_override'] = serverName;
    channelOptions['grpc.default_authority'] = serverName;
  }
  return channelOptions;
}

function toGrpcMetadata(
  grpc: GrpcModule,
  options: RuntimeNodeGrpcTransportOptions,
  metadata: CoreMetadata | undefined,
): Metadata {
  const result = new grpc.Metadata();
  for (const [key, value] of runtimeMetadataEntries(metadata, options)) {
    result.set(key, value);
  }
  return result;
}

const RUNTIME_METADATA_HEADERS: Record<string, string> = {
  protocolversion: 'x-nimi-protocol-version',
  participantprotocolversion: 'x-nimi-participant-protocol-version',
  participantid: 'x-nimi-participant-id',
  domain: 'x-nimi-domain',
  appid: 'x-nimi-app-id',
  appinstanceid: 'x-nimi-app-instance-id',
  traceid: 'x-nimi-trace-id',
  idempotencykey: 'x-nimi-idempotency-key',
  callerkind: 'x-nimi-caller-kind',
  callerid: 'x-nimi-caller-id',
  surfaceid: 'x-nimi-surface-id',
  keysource: 'x-nimi-key-source',
  providertype: 'x-nimi-provider-type',
  clientid: 'x-nimi-client-id',
  providerendpoint: 'x-nimi-provider-endpoint',
  providerapikey: 'x-nimi-provider-api-key',
};

function runtimeMetadataEntries(
  metadata: CoreMetadata | undefined,
  options: RuntimeNodeGrpcTransportOptions,
): Array<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = [];
  for (const [key, value] of Object.entries(metadata ?? {})) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      continue;
    }
    const normalizedKey = key.trim().toLowerCase();
    const compactKey = normalizedKey.replaceAll('-', '');
    if (compactKey === 'providerapikey' && !runtimeNodeGrpcTransportAllowsSensitiveCredentials(options)) {
      throw toTransportError(
        'SDK_TRANSPORT_INVALID',
        'providerApiKey requires TLS or a loopback-only node-grpc endpoint',
        undefined,
        {
          actionHint: 'enable_tls_or_use_loopback_for_provider_api_key',
          retryable: false,
        },
      );
    }
    const header = RUNTIME_METADATA_HEADERS[compactKey]
      ?? (normalizedKey.startsWith('x-nimi-') ? normalizedKey : '');
    if (header) {
      entries.push([header, normalizedValue]);
    }
  }
  return entries;
}

function validateRuntimeMetadataSecurity(
  metadata: CoreMetadata | undefined,
  options: RuntimeNodeGrpcTransportOptions,
): void {
  for (const [key, value] of Object.entries(metadata ?? {})) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
      continue;
    }
    const normalizedKey = key.trim().toLowerCase();
    if (normalizedKey === 'authorization') {
      throw toTransportError(
        'SDK_TRANSPORT_INVALID',
        'Runtime authorization must use the transport auth channel, not metadata.authorization',
        { metadataKey: key },
        {
          actionHint: 'move_runtime_authorization_to_transport_auth',
          retryable: false,
        },
      );
    }
    if (normalizedKey.replaceAll('-', '') === 'providerapikey' && !runtimeNodeGrpcTransportAllowsSensitiveCredentials(options)) {
      throw toTransportError(
        'SDK_TRANSPORT_INVALID',
        'providerApiKey requires TLS or a loopback-only node-grpc endpoint',
        undefined,
        {
          actionHint: 'enable_tls_or_use_loopback_for_provider_api_key',
          retryable: false,
        },
      );
    }
  }
}

function toCallOptions(timeoutMs: number | undefined): CallOptions {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {};
  }
  return { deadline: Date.now() + timeoutMs };
}

function assertMethodKind(methodId: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw toTransportError(
      'SDK_RUNTIME_METHOD_UNAVAILABLE',
      `${methodId} is ${actual}, not ${expected}`,
      { methodId, actual, expected },
    );
  }
}

export function createRuntimeNodeGrpcTransport(
  options: RuntimeNodeGrpcTransportOptions = {},
): CoreTransport {
  const endpoint = normalizeRuntimeNodeGrpcEndpoint(options.endpoint);
  if (!endpoint) {
    throw toTransportError(
      'SDK_RUNTIME_NODE_GRPC_ENDPOINT_REQUIRED',
      'node-grpc Runtime transport requires endpoint',
    );
  }
  let runtimePromise: Promise<{ readonly grpc: GrpcModule; readonly client: Client }> | undefined;
  const ensureRuntime = async () => {
    runtimePromise ??= (async () => {
      const grpc = await loadGrpcModule();
      return {
        grpc,
        client: new grpc.Client(endpoint, toChannelCredentials(grpc, options), toChannelOptions(options)),
      };
    })();
    return runtimePromise;
  };

  const invokeUnaryBytes = async (request: RuntimeNodeGrpcBridgeRequest): Promise<Uint8Array> => {
    validateRuntimeMetadataSecurity(request.metadata, options);
    if (options.bridge) {
      return options.bridge.unary(request);
    }
    const runtime = await ensureRuntime();
    return new Promise<Uint8Array>((resolve, reject) => {
      let responseBytes: Uint8Array | undefined;
      let statusSeen = false;
      let settled = false;

      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const resolveAfterStatus = () => {
        if (settled || !statusSeen) return;
        if (!responseBytes) {
          rejectOnce(toTransportError(
            'SDK_RUNTIME_NODE_GRPC_EMPTY_RESPONSE',
            `${request.methodId} returned empty response payload`,
            { methodId: request.methodId },
          ));
          return;
        }
        settled = true;
        resolve(responseBytes);
      };

      const call = runtime.client.makeUnaryRequest<Uint8Array, Uint8Array>(
        request.methodId,
        (value) => Buffer.from(value),
        (value) => Uint8Array.from(value),
        request.body,
        toGrpcMetadata(runtime.grpc, options, request.metadata),
        toCallOptions(request.timeoutMs),
        (error: ServiceError | null, response?: Uint8Array) => {
          if (error) {
            rejectOnce(normalizeServiceError(runtime.grpc, error));
            return;
          }
          responseBytes = response;
          resolveAfterStatus();
        },
      );

      call.on('metadata', (metadata: GrpcMetadataLike) => {
        emitResponseMetadata(request.responseMetadataObserver, collectResponseMetadata(metadata));
      });
      call.on('status', (status: GrpcStatusLike) => {
        statusSeen = true;
        emitResponseMetadata(request.responseMetadataObserver, collectStatusResponseMetadata(status));
        resolveAfterStatus();
      });

      if (request.signal) {
        if (request.signal.aborted) {
          call.cancel();
          rejectOnce(toTransportError(
            'OPERATION_ABORTED',
            `${request.methodId} was aborted`,
            { methodId: request.methodId },
            {
              actionHint: 'retry_if_still_needed',
              retryable: false,
            },
          ));
          return;
        }
        request.signal.addEventListener('abort', () => {
          call.cancel();
          rejectOnce(toTransportError(
            'OPERATION_ABORTED',
            `${request.methodId} was aborted`,
            { methodId: request.methodId },
            {
              actionHint: 'retry_if_still_needed',
              retryable: false,
            },
          ));
        }, { once: true });
      }
    });
  };

  const openStreamBytes = async (request: RuntimeNodeGrpcBridgeRequest): Promise<AsyncIterable<Uint8Array>> => {
    validateRuntimeMetadataSecurity(request.metadata, options);
    if (options.bridge) {
      return options.bridge.serverStream(request);
    }
    const runtime = await ensureRuntime();
    const call = runtime.client.makeServerStreamRequest<Uint8Array, Uint8Array>(
      request.methodId,
      (value) => Buffer.from(value),
      (value) => Uint8Array.from(value),
      request.body,
      toGrpcMetadata(runtime.grpc, options, request.metadata),
      toCallOptions(request.timeoutMs),
    );
    return nodeGrpcReadableStream(
      runtime.grpc,
      call,
      request.methodId,
      request.signal,
      request.responseMetadataObserver,
    );
  };

  return {
    async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
      try {
        const codec = getRuntimeWireCodec(request.methodId);
        assertMethodKind(request.methodId, codec.kind, 'unary');
        const body = codec.encodeRequest(request.body);
        const response = await invokeUnaryBytes({
          endpoint,
          methodId: request.methodId,
          body,
          metadata: request.metadata,
          timeoutMs: request.timeoutMs,
          signal: request.signal,
          responseMetadataObserver: request.responseMetadataObserver,
        });
        return codec.decodeResponse(response) as Response;
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_UNARY_FAILED,
          actionHint: 'check_runtime_endpoint_and_network',
          source: 'runtime',
        });
      }
    },

    serverStream<Response = unknown, Body = unknown>(
      request: CoreStreamRequest<Body>,
    ): AsyncIterable<Response> {
      return decodeNodeGrpcServerStream<Response>(async () => {
        try {
          const codec = getRuntimeWireCodec(request.methodId);
          assertMethodKind(request.methodId, codec.kind, 'server_stream');
          const body = codec.encodeRequest(request.body);
          const stream = await openStreamBytes({
            endpoint,
            methodId: request.methodId,
            body,
            metadata: request.metadata,
            timeoutMs: request.timeoutMs,
            signal: request.signal,
            responseMetadataObserver: request.responseMetadataObserver,
          });
          return { codec, stream };
        } catch (error) {
          throw asNimiError(error, {
            reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_OPEN_FAILED,
            actionHint: 'check_runtime_endpoint_and_network',
            source: 'runtime',
          });
        }
      });
    },
  };
}

function decodeNodeGrpcServerStream<Response>(
  open: () => Promise<{
    readonly codec: ReturnType<typeof getRuntimeWireCodec>;
    readonly stream: AsyncIterable<Uint8Array>;
  }>,
): AsyncIterable<Response> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Response> {
      let closed = false;
      let source: Promise<{
        readonly codec: ReturnType<typeof getRuntimeWireCodec>;
        readonly stream: AsyncIterable<Uint8Array>;
      }> | undefined;
      let sourceIterator: AsyncIterator<Uint8Array> | undefined;

      const ensureIterator = async (): Promise<{
        readonly codec: ReturnType<typeof getRuntimeWireCodec>;
        readonly iterator: AsyncIterator<Uint8Array>;
      }> => {
        source ??= open();
        const opened = await source;
        sourceIterator ??= opened.stream[Symbol.asyncIterator]();
        return { codec: opened.codec, iterator: sourceIterator };
      };

      const closeSource = () => {
        const closeIterator = (iterator: AsyncIterator<Uint8Array>) => {
          if (typeof iterator.return === 'function') {
            void Promise.resolve(iterator.return()).catch(() => undefined);
          }
        };
        if (sourceIterator) {
          closeIterator(sourceIterator);
          return;
        }
        if (source) {
          void source.then((opened) => {
            sourceIterator ??= opened.stream[Symbol.asyncIterator]();
            closeIterator(sourceIterator);
          }).catch(() => undefined);
        }
      };

      return {
        next: async (): Promise<IteratorResult<Response>> => {
          if (closed) {
            return { done: true, value: undefined };
          }
          try {
            const { codec, iterator } = await ensureIterator();
            if (closed) {
              return { done: true, value: undefined };
            }
            const result = await iterator.next();
            if (closed || result.done) {
              return { done: true, value: undefined };
            }
            return { done: false, value: codec.decodeResponse(result.value) as Response };
          } catch (error) {
            if (closed) {
              return { done: true, value: undefined };
            }
            throw asNimiError(error, {
              reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_OPEN_FAILED,
              actionHint: 'retry_or_reopen_stream',
              source: 'runtime',
            });
          }
        },
        return: async (): Promise<IteratorResult<Response>> => {
          if (!closed) {
            closed = true;
            closeSource();
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function nodeGrpcReadableStream(
  grpc: GrpcModule,
  call: ClientReadableStream<Uint8Array>,
  methodId: string,
  signal: AbortSignal | undefined,
  responseMetadataObserver: ((metadata: CoreResponseMetadata) => void) | undefined,
): AsyncIterable<Uint8Array> {
  const queue: Uint8Array[] = [];
  const waiters: Array<{
    resolve: (result: IteratorResult<Uint8Array>) => void;
    reject: (error: unknown) => void;
  }> = [];
  let done = false;
  let pendingError: unknown;

  const flush = () => {
    while (queue.length > 0 && waiters.length > 0) {
      const waiter = waiters.shift();
      const value = queue.shift();
      if (waiter && value) {
        waiter.resolve({ done: false, value });
      }
    }
    if (pendingError) {
      while (waiters.length > 0) {
        waiters.shift()?.reject(pendingError);
      }
      return;
    }
    if (done) {
      while (waiters.length > 0) {
        waiters.shift()?.resolve({ done: true, value: undefined });
      }
    }
  };

  const close = () => {
    if (done) {
      return;
    }
    done = true;
    call.cancel();
    flush();
  };

  const failBackpressure = () => {
    if (done) {
      return;
    }
    pendingError = toTransportError(
      ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_BACKPRESSURE,
      `${methodId} stream consumer is not draining fast enough`,
      {
        methodId,
        bufferedChunks: queue.length,
        maxBufferedChunks: RUNTIME_NODE_GRPC_MAX_BUFFERED_STREAM_CHUNKS,
      },
      {
        reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_BACKPRESSURE,
        actionHint: 'consume_stream_events_or_cancel_the_stream',
        retryable: false,
      },
    );
    done = true;
    call.cancel();
    flush();
  };

  call.on('data', (chunk: Uint8Array) => {
    if (done) {
      return;
    }
    if (queue.length >= RUNTIME_NODE_GRPC_MAX_BUFFERED_STREAM_CHUNKS && waiters.length === 0) {
      failBackpressure();
      return;
    }
    queue.push(chunk);
    flush();
  });
  call.on('metadata', (metadata: GrpcMetadataLike) => {
    emitResponseMetadata(responseMetadataObserver, collectResponseMetadata(metadata));
  });
  call.on('status', (status: GrpcStatusLike) => {
    emitResponseMetadata(responseMetadataObserver, collectStatusResponseMetadata(status));
  });
  call.on('end', () => {
    done = true;
    flush();
  });
  call.on('error', (error: ServiceError) => {
    if (done) {
      return;
    }
    pendingError = normalizeServiceError(grpc, error);
    done = true;
    flush();
  });

  if (signal) {
    if (signal.aborted) {
      close();
      pendingError = toTransportError(
        'OPERATION_ABORTED',
        `${methodId} was aborted`,
        { methodId },
        {
          actionHint: 'retry_if_still_needed',
          retryable: false,
        },
      );
      flush();
    } else {
      signal.addEventListener('abort', () => {
        pendingError = toTransportError(
          'OPERATION_ABORTED',
          `${methodId} was aborted`,
          { methodId },
          {
            actionHint: 'retry_if_still_needed',
            retryable: false,
          },
        );
        close();
      }, { once: true });
    }
  }

  return {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      return {
        next: async () => {
          if (queue.length > 0) {
            return { done: false, value: queue.shift() as Uint8Array };
          }
          if (pendingError) {
            const error = pendingError;
            pendingError = undefined;
            throw error;
          }
          if (done) {
            return { done: true, value: undefined };
          }
          return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
        },
        return: async () => {
          close();
          return { done: true, value: undefined };
        },
      };
    },
  };
}
