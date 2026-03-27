import { asNimiError, createNimiError } from '../errors.js';
import { asRecord, readString } from '../../internal/utils.js';
import { ReasonCode } from '../../types/index.js';
import type {
  RuntimeNodeGrpcTransportConfig,
  RuntimeWireMessage,
  RuntimeOpenStreamCall,
  RuntimeStreamCloseCall,
  RuntimeTransport,
  RuntimeUnaryCall,
} from '../types.js';
import type { RuntimeNodeGrpcTransportConfigInternal } from '../types-internal.js';
import type {
  CallOptions,
  ChannelCredentials,
  ChannelOptions,
  Client,
  ClientReadableStream,
  Metadata,
  ServiceError,
} from '@grpc/grpc-js';

type GrpcModule = typeof import('@grpc/grpc-js');

export type NodeGrpcBridge = {
  invokeUnary(config: RuntimeNodeGrpcTransportConfig, input: RuntimeUnaryCall<RuntimeWireMessage>): Promise<RuntimeWireMessage>;
  openStream(config: RuntimeNodeGrpcTransportConfig, input: RuntimeOpenStreamCall<RuntimeWireMessage>): Promise<AsyncIterable<RuntimeWireMessage>>;
  closeStream(config: RuntimeNodeGrpcTransportConfig, input: RuntimeStreamCloseCall): Promise<void>;
};

type NodeGrpcRuntime = {
  grpc: GrpcModule;
  client: Client;
};

let nodeGrpcBridge: NodeGrpcBridge | null = null;
let grpcModulePromise: Promise<GrpcModule> | null = null;

export function setNodeGrpcBridge(bridge: NodeGrpcBridge | null): void {
  nodeGrpcBridge = bridge;
}

function normalizeEndpoint(endpoint: string): string {
  const normalized = String(endpoint || '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('http://')) {
    return normalized.slice('http://'.length);
  }
  if (normalized.startsWith('https://')) {
    return normalized.slice('https://'.length);
  }
  return normalized;
}

async function loadGrpcModule(): Promise<GrpcModule> {
  if (grpcModulePromise) {
    return grpcModulePromise;
  }
  grpcModulePromise = import('@grpc/grpc-js');
  return grpcModulePromise;
}

function toChannelCredentials(
  grpc: GrpcModule,
  config: RuntimeNodeGrpcTransportConfig,
): ChannelCredentials {
  const tls = config.tls;
  if (!tls?.enabled) {
    return grpc.credentials.createInsecure();
  }
  const rootCert = tls.rootCertPem ? Buffer.from(tls.rootCertPem, 'utf-8') : undefined;
  return grpc.credentials.createSsl(rootCert);
}

function toChannelOptions(config: RuntimeNodeGrpcTransportConfig): ChannelOptions {
  const options: ChannelOptions = {};
  const serverName = String(config.tls?.serverName || '').trim();
  if (serverName) {
    options['grpc.ssl_target_name_override'] = serverName;
    options['grpc.default_authority'] = serverName;
  }
  return options;
}

function toGrpcMetadata(
  grpc: GrpcModule,
  config: RuntimeNodeGrpcTransportConfig,
  metadata: RuntimeUnaryCall<RuntimeWireMessage>['metadata'],
  authorization?: string,
): Metadata {
  const reservedTypedKeys = new Set([
    'x-nimi-protocol-version',
    'x-nimi-participant-protocol-version',
    'x-nimi-participant-id',
    'x-nimi-domain',
    'x-nimi-app-id',
    'x-nimi-trace-id',
    'x-nimi-idempotency-key',
    'x-nimi-caller-kind',
    'x-nimi-caller-id',
    'x-nimi-surface-id',
    'x-nimi-key-source',
    'x-nimi-provider-type',
    'x-nimi-client-id',
    'x-nimi-provider-endpoint',
    'x-nimi-provider-api-key',
  ]);
  const value = new grpc.Metadata();
  const append = (key: string, input: unknown) => {
    const text = String(input || '').trim();
    if (text) {
      value.set(key, text);
    }
  };

  append('x-nimi-protocol-version', metadata.protocolVersion);
  append('x-nimi-participant-protocol-version', metadata.participantProtocolVersion);
  append('x-nimi-participant-id', metadata.participantId);
  append('x-nimi-domain', metadata.domain);
  append('x-nimi-app-id', metadata.appId);
  append('x-nimi-trace-id', metadata.traceId);
  append('x-nimi-idempotency-key', metadata.idempotencyKey);
  append('x-nimi-caller-kind', metadata.callerKind);
  append('x-nimi-caller-id', metadata.callerId);
  append('x-nimi-surface-id', metadata.surfaceId);
  append('x-nimi-key-source', metadata.keySource);
  append('x-nimi-provider-type', metadata.providerType);
  append('x-nimi-client-id', metadata.clientId);
  append('x-nimi-provider-endpoint', metadata.providerEndpoint);
  const providerApiKey = String(metadata.providerApiKey || '').trim();
  if (providerApiKey && !transportAllowsPlaintextProviderKey(config)) {
    throw createNimiError({
      message: 'providerApiKey requires TLS or a loopback-only node-grpc endpoint',
      reasonCode: ReasonCode.SDK_TRANSPORT_INVALID,
      actionHint: 'enable_tls_or_use_loopback_for_provider_api_key',
      source: 'sdk',
    });
  }
  append('x-nimi-provider-api-key', providerApiKey);
  append('authorization', authorization);

  const extra = metadata.extra || {};
  for (const [key, extraValue] of Object.entries(extra)) {
    const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey.startsWith('x-nimi-')) {
      continue;
    }
    if (reservedTypedKeys.has(normalizedKey)) {
      continue;
    }
    append(normalizedKey, extraValue);
  }

  return value;
}

function transportAllowsPlaintextProviderKey(config: RuntimeNodeGrpcTransportConfig): boolean {
  if (config.tls?.enabled) {
    return true;
  }
  const endpoint = normalizeEndpoint(config.endpoint);
  const host = endpoint.split(':')[0]?.trim().toLowerCase() || '';
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

function toCallOptions(timeoutMs?: number): CallOptions {
  const options: CallOptions = {};
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    options.deadline = Date.now() + timeoutMs;
  }
  return options;
}

function reasonCodeFromServiceError(grpc: GrpcModule, error: ServiceError): string {
  const structured = parseStructuredGrpcDetails(error);
  if (isRetryableTransportCancelledError(grpc, error, structured)) {
    return 'RUNTIME_GRPC_UNAVAILABLE';
  }
  if (structured?.reasonCode) {
    return structured.reasonCode;
  }
  const details = String(error.details || '').trim();
  const prefixedReasonFromDetails = parseReasonCodeFromText(details);
  if (prefixedReasonFromDetails) {
    return prefixedReasonFromDetails;
  }
  const prefixedReasonFromMessage = parseReasonCodeFromText(error.message);
  if (prefixedReasonFromMessage) {
    return prefixedReasonFromMessage;
  }
  if (details && /^[A-Z0-9_]+$/.test(details)) {
    return details;
  }
  const codeName = grpc.status[error.code] || 'UNKNOWN';
  return `RUNTIME_GRPC_${String(codeName).toUpperCase()}`;
}

function isRetryableTransportCancelledError(
  grpc: GrpcModule,
  error: ServiceError,
  structured?: {
    reasonCode?: string;
  } | null,
): boolean {
  if (error.code !== grpc.status.CANCELLED) {
    return false;
  }
  if (String(structured?.reasonCode || '').trim()) {
    return false;
  }
  const message = `${String(error.details || '').trim()} ${String(error.message || '').trim()}`
    .toLowerCase();
  return message.includes('h2 protocol error')
    || message.includes('http2 error')
    || message.includes('transport error');
}

function isRetryableGrpcError(grpc: GrpcModule, error: ServiceError): boolean {
  return error.code === grpc.status.UNAVAILABLE
    || error.code === grpc.status.DEADLINE_EXCEEDED
    || error.code === grpc.status.RESOURCE_EXHAUSTED
    || error.code === grpc.status.ABORTED;
}

function readBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function parseJsonObject(input: string): Record<string, unknown> | null {
  const text = String(input || '').trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    const record = asRecord(parsed);
    return Object.keys(record).length > 0 ? record : null;
  } catch {
    return null;
  }
}

function parseReasonCodeFromText(input: unknown): string {
  const text = String(input || '').trim();
  if (!text) {
    return '';
  }
  const prefixed = text.match(/^([A-Z0-9_]+):/);
  if (prefixed?.[1]) {
    return prefixed[1];
  }
  return '';
}

function parseStructuredGrpcDetails(error: ServiceError): {
  reasonCode?: string;
  actionHint?: string;
  traceId?: string;
  retryable?: boolean;
  message?: string;
} | null {
  const details = String(error.details || '').trim();
  const message = String(error.message || '').trim();
  const candidate = details || message;
  if (!candidate) {
    return null;
  }

  const directParsed = parseJsonObject(candidate);
  const firstBraceIndex = candidate.indexOf('{');
  const lastBraceIndex = candidate.lastIndexOf('}');
  const embeddedParsed = (
    firstBraceIndex >= 0
    && lastBraceIndex > firstBraceIndex
  ) ? parseJsonObject(candidate.slice(firstBraceIndex, lastBraceIndex + 1)) : null;
  const record = directParsed || embeddedParsed;
  if (!record) {
    return null;
  }

  const reasonCode = readString(record, ['reasonCode', 'reason_code']);
  const actionHint = readString(record, ['actionHint', 'action_hint']);
  const traceId = readString(record, ['traceId', 'trace_id']);
  const structuredMessage = readString(record, ['message']);
  const retryable = readBoolean(record, ['retryable']);
  const hasStructuredFields = Boolean(reasonCode || actionHint || traceId || typeof retryable === 'boolean');
  if (!hasStructuredFields) {
    return null;
  }

  return {
    reasonCode: reasonCode || undefined,
    actionHint: actionHint || undefined,
    traceId: traceId || undefined,
    retryable,
    message: structuredMessage || undefined,
  };
}

function normalizeServiceError(
  grpc: GrpcModule,
  error: ServiceError,
): {
  input: unknown;
  reasonCode: string;
  actionHint: string;
  traceId?: string;
  retryable: boolean;
} {
  const structured = parseStructuredGrpcDetails(error);
  const retryableTransportCancelled = isRetryableTransportCancelledError(grpc, error, structured);
  const retryableByStatus = isRetryableGrpcError(grpc, error);
  const retryable = typeof structured?.retryable === 'boolean'
    ? structured.retryable
    : retryableByStatus || retryableTransportCancelled;

  return {
    input: structured || error,
    reasonCode: structured?.reasonCode || reasonCodeFromServiceError(grpc, error),
    actionHint: structured?.actionHint || (
      retryable ? 'retry_or_check_runtime_daemon' : 'check_request_and_app_auth'
    ),
    traceId: structured?.traceId,
    retryable,
  };
}

export function createNodeGrpcTransport(
  config: RuntimeNodeGrpcTransportConfig,
): RuntimeTransport {
  const internalConfig = config as RuntimeNodeGrpcTransportConfigInternal;
  const endpoint = normalizeEndpoint(internalConfig.endpoint);
  if (!endpoint) {
    throw createNimiError({
      message: 'node-grpc transport requires endpoint',
      reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_ENDPOINT_REQUIRED,
      actionHint: 'set_runtime_endpoint',
      source: 'sdk',
    });
  }

  const openStreams = new Map<string, ClientReadableStream<RuntimeWireMessage>>();
  let streamCounter = 0;
  let runtimePromise: Promise<NodeGrpcRuntime> | null = null;

  const nextStreamId = (): string => {
    streamCounter += 1;
    return `runtime-node-stream-${Date.now()}-${streamCounter}`;
  };

  const ensureRuntime = async (): Promise<NodeGrpcRuntime> => {
    if (runtimePromise) {
      return runtimePromise;
    }

    runtimePromise = (async () => {
      const grpc = await loadGrpcModule();
      const client = new grpc.Client(
        endpoint,
        toChannelCredentials(grpc, internalConfig),
        toChannelOptions(internalConfig),
      );
      return { grpc, client };
    })();

    return runtimePromise;
  };

  const invokeUnaryInternal = async (input: RuntimeUnaryCall<RuntimeWireMessage>): Promise<RuntimeWireMessage> => {
    const runtime = await ensureRuntime();
    return new Promise<RuntimeWireMessage>((resolve, reject) => {
      const call = runtime.client.makeUnaryRequest<RuntimeWireMessage, RuntimeWireMessage>(
        input.methodId,
        (value: RuntimeWireMessage) => Buffer.from(value),
        (value: Buffer) => Uint8Array.from(value),
        input.request,
        toGrpcMetadata(runtime.grpc, internalConfig, input.metadata, input.authorization),
        toCallOptions(input.timeoutMs),
        (error: ServiceError | null, response?: RuntimeWireMessage) => {
          if (error) {
            const normalized = normalizeServiceError(runtime.grpc, error);
            reject(asNimiError(normalized.input, {
              reasonCode: normalized.reasonCode,
              actionHint: normalized.actionHint,
              traceId: normalized.traceId,
              retryable: normalized.retryable,
              source: 'runtime',
            }));
            return;
          }
          if (!response) {
            reject(createNimiError({
              message: `${input.methodId} returned empty response payload`,
              reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_EMPTY_RESPONSE,
              actionHint: 'check_runtime_server',
              source: 'runtime',
            }));
            return;
          }
          resolve(response);
        },
      );
      const observer = input._responseMetadataObserver || internalConfig._responseMetadataObserver;
      if (observer) {
        call.on('metadata', (md: { get(key: string): (string | Buffer)[] }) => {
          const collected: Record<string, string> = {};
          const version = md.get('x-nimi-runtime-version');
          if (version.length > 0) {
            collected['x-nimi-runtime-version'] = String(version[0]);
          }
          const voiceCatalogSource = md.get('x-nimi-voice-catalog-source');
          if (voiceCatalogSource.length > 0) {
            collected['x-nimi-voice-catalog-source'] = String(voiceCatalogSource[0]);
          }
          const voiceCatalogVersion = md.get('x-nimi-voice-catalog-version');
          if (voiceCatalogVersion.length > 0) {
            collected['x-nimi-voice-catalog-version'] = String(voiceCatalogVersion[0]);
          }
          const voiceCount = md.get('x-nimi-voice-count');
          if (voiceCount.length > 0) {
            collected['x-nimi-voice-count'] = String(voiceCount[0]);
          }
          if (Object.keys(collected).length > 0) {
            observer(collected);
          }
        });
      }
    });
  };

  const openStreamInternal = async (
    input: RuntimeOpenStreamCall<RuntimeWireMessage>,
  ): Promise<AsyncIterable<RuntimeWireMessage>> => {
    const runtime = await ensureRuntime();
    const streamId = nextStreamId();
    const call = runtime.client.makeServerStreamRequest<RuntimeWireMessage, RuntimeWireMessage>(
      input.methodId,
      (value: RuntimeWireMessage) => Buffer.from(value),
      (value: Buffer) => Uint8Array.from(value),
      input.request,
      toGrpcMetadata(runtime.grpc, internalConfig, input.metadata, input.authorization),
      toCallOptions(input.timeoutMs),
    );

    openStreams.set(streamId, call);

    const queue: RuntimeWireMessage[] = [];
    const waiters: Array<{
      resolve: (result: IteratorResult<RuntimeWireMessage>) => void;
      reject: (error: unknown) => void;
    }> = [];
    let done = false;
    let pendingError: unknown = null;
    let detachAbortListener: (() => void) | null = null;
    const releaseAbortListener = () => {
      if (!detachAbortListener) {
        return;
      }
      detachAbortListener();
      detachAbortListener = null;
    };

    const flush = () => {
      while (waiters.length > 0 && queue.length > 0) {
        const waiter = waiters.shift();
        const value = queue.shift();
        if (waiter && value !== undefined) {
          waiter.resolve({ done: false, value });
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

    const close = () => {
      if (done) {
        return;
      }
      done = true;
      openStreams.delete(streamId);
      releaseAbortListener();
      call.cancel();
      flush();
    };

    call.on('data', (chunk: RuntimeWireMessage) => {
      queue.push(chunk);
      flush();
    });

    call.on('end', () => {
      done = true;
      openStreams.delete(streamId);
      releaseAbortListener();
      flush();
    });

    call.on('error', (error: ServiceError) => {
      if (done && error.code === runtime.grpc.status.CANCELLED) {
        return;
      }
      const normalized = normalizeServiceError(runtime.grpc, error);
      pendingError = asNimiError(normalized.input, {
        reasonCode: normalized.reasonCode,
        actionHint: normalized.actionHint,
        traceId: normalized.traceId,
        retryable: normalized.retryable,
        source: 'runtime',
      });
      done = true;
      openStreams.delete(streamId);
      releaseAbortListener();
      flush();
    });

    if (input.signal) {
      if (input.signal.aborted) {
        close();
      } else {
        const abortHandler = () => {
          close();
        };
        input.signal.addEventListener('abort', abortHandler, { once: true });
        detachAbortListener = () => {
          input.signal?.removeEventListener('abort', abortHandler);
        };
      }
    }

    const iterator: AsyncIterable<RuntimeWireMessage> & { streamId: string } = {
      streamId,
      [Symbol.asyncIterator](): AsyncIterator<RuntimeWireMessage> {
        return {
          next: async () => {
            if (pendingError) {
              // Preserve iterator protocol: surface the terminal stream error once, then finish cleanly.
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
            close();
            return { done: true, value: undefined as unknown as RuntimeWireMessage };
          },
          throw: async (error: unknown) => {
            close();
            throw error;
          },
        };
      },
    };

    return iterator;
  };

  const closeStreamInternal = async (input: RuntimeStreamCloseCall): Promise<void> => {
    const streamId = String(input.streamId || '').trim();
    if (!streamId) {
      return;
    }
    const stream = openStreams.get(streamId);
    if (!stream) {
      return;
    }
    openStreams.delete(streamId);
    stream.cancel();
  };

  const destroyInternal = async (): Promise<void> => {
    const streamIds = Array.from(openStreams.keys());
    await Promise.allSettled(streamIds.map((streamId) => closeStreamInternal({ streamId })));
    const runtime = runtimePromise
      ? await runtimePromise.catch(() => null)
      : null;
    runtimePromise = null;
    if (runtime) {
      runtime.client.close();
    }
    streamCounter = 0;
  };

  return {
    invokeUnary: async (input: RuntimeUnaryCall<RuntimeWireMessage>): Promise<RuntimeWireMessage> => {
      try {
        if (nodeGrpcBridge) {
          return await nodeGrpcBridge.invokeUnary(internalConfig, input);
        }
        return await invokeUnaryInternal(input);
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_UNARY_FAILED,
          actionHint: 'check_runtime_endpoint_and_network',
          source: 'runtime',
        });
      }
    },
    openStream: async (input: RuntimeOpenStreamCall<RuntimeWireMessage>): Promise<AsyncIterable<RuntimeWireMessage>> => {
      try {
        if (nodeGrpcBridge) {
          return await nodeGrpcBridge.openStream(internalConfig, input);
        }
        return await openStreamInternal(input);
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_OPEN_FAILED,
          actionHint: 'check_runtime_endpoint_and_network',
          source: 'runtime',
        });
      }
    },
    closeStream: async (input: RuntimeStreamCloseCall): Promise<void> => {
      try {
        if (nodeGrpcBridge) {
          await nodeGrpcBridge.closeStream(internalConfig, input);
          return;
        }
        await closeStreamInternal(input);
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_CLOSE_FAILED,
          actionHint: 'retry_close_or_drop_stream',
          source: 'runtime',
        });
      }
    },
    destroy: async (): Promise<void> => {
      try {
        await destroyInternal();
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_CLOSE_FAILED,
          actionHint: 'retry_close_or_recreate_runtime_client',
          source: 'runtime',
        });
      }
    },
  };
}
