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
  JsonObject,
  NimiError,
} from '../types';

type GrpcModule = typeof import('@grpc/grpc-js');

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

export class RuntimeNodeGrpcTransportError extends Error {
  readonly code: string;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly traceId: string;
  readonly retryable: boolean;
  readonly source = 'runtime';
  readonly details?: JsonObject;

  constructor(
    code: string,
    message: string,
    details?: JsonObject,
    fields: {
      readonly reasonCode?: string;
      readonly actionHint?: string;
      readonly traceId?: string;
      readonly retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'RuntimeNodeGrpcTransportError';
    this.code = code;
    this.reasonCode = fields.reasonCode ?? code;
    this.actionHint = fields.actionHint ?? 'check_runtime_endpoint_and_network';
    this.traceId = fields.traceId ?? '';
    this.retryable = Boolean(fields.retryable);
    this.details = details;
  }
}

let grpcModulePromise: Promise<GrpcModule> | undefined;

function loadGrpcModule(): Promise<GrpcModule> {
  grpcModulePromise ??= import('@grpc/grpc-js');
  return grpcModulePromise;
}

function normalizeEndpoint(endpoint: string | undefined): string {
  const value = String(endpoint || '127.0.0.1:46371').trim();
  if (!value) {
    return '';
  }
  if (value.startsWith('http://')) {
    return value.slice('http://'.length);
  }
  if (value.startsWith('https://')) {
    return value.slice('https://'.length);
  }
  return value;
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
    if (compactKey === 'providerapikey' && !transportAllowsPlaintextProviderKey(options)) {
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
      ?? (normalizedKey === 'authorization' || normalizedKey.startsWith('x-nimi-') ? normalizedKey : '');
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
    if (key.trim().toLowerCase().replaceAll('-', '') === 'providerapikey' && !transportAllowsPlaintextProviderKey(options)) {
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

function transportAllowsPlaintextProviderKey(options: RuntimeNodeGrpcTransportOptions): boolean {
  if (options.tls?.enabled) {
    return true;
  }
  const endpoint = normalizeEndpoint(options.endpoint);
  const host = endpoint.split(':')[0]?.trim().toLowerCase() || '';
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

const RUNTIME_RESPONSE_METADATA_HEADERS = [
  'x-nimi-runtime-version',
  'x-nimi-voice-catalog-source',
  'x-nimi-voice-catalog-version',
  'x-nimi-voice-count',
  'x-nimi-route-describe-result',
] as const;

function collectResponseMetadata(metadata: { get(key: string): (string | Buffer)[] }): CoreResponseMetadata {
  const result: Record<string, string> = {};
  for (const key of RUNTIME_RESPONSE_METADATA_HEADERS) {
    const values = metadata.get(key);
    if (values.length > 0) {
      const value = String(values[0] || '').trim();
      if (value) {
        result[key] = value;
      }
    }
  }
  return result;
}

function emitResponseMetadata(
  observer: ((metadata: CoreResponseMetadata) => void) | undefined,
  metadata: CoreResponseMetadata,
): void {
  if (observer && Object.keys(metadata).length > 0) {
    observer(metadata);
  }
}

function toCallOptions(timeoutMs: number | undefined): CallOptions {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {};
  }
  return { deadline: Date.now() + timeoutMs };
}

function toTransportError(
  code: string,
  message: string,
  details?: JsonObject,
  fields?: ConstructorParameters<typeof RuntimeNodeGrpcTransportError>[3],
): RuntimeNodeGrpcTransportError {
  return new RuntimeNodeGrpcTransportError(code, message, details, fields);
}

function normalizeServiceError(grpc: GrpcModule, error: ServiceError): NimiError {
  const structured = parseStructuredGrpcDetails(error);
  const retryableTransportCancelled = isRetryableTransportCancelledError(grpc, error, structured);
  const retryableByStatus = isRetryableGrpcError(grpc, error);
  const retryable = typeof structured?.retryable === 'boolean'
    ? structured.retryable
    : retryableByStatus || retryableTransportCancelled;
  const reasonCode = structured?.reasonCode || reasonCodeFromServiceError(grpc, error, structured);
  return asNimiError(structured || error, {
    reasonCode,
    actionHint: structured?.actionHint || (
      retryable ? 'retry_or_check_runtime_daemon' : 'check_request_and_app_auth'
    ),
    traceId: structured?.traceId,
    retryable,
    source: 'runtime',
    details: {
      grpcCode: error.code,
      grpcDetails: String(error.details || '').trim(),
    },
  });
}

function isRetryableGrpcError(grpc: GrpcModule, error: ServiceError): boolean {
  return error.code === grpc.status.UNAVAILABLE
    || error.code === grpc.status.DEADLINE_EXCEEDED
    || error.code === grpc.status.RESOURCE_EXHAUSTED
    || error.code === grpc.status.ABORTED;
}

function isRetryableTransportCancelledError(
  grpc: GrpcModule,
  error: ServiceError,
  structured?: { readonly reasonCode?: string } | null,
): boolean {
  if (error.code !== grpc.status.CANCELLED || structured?.reasonCode) {
    return false;
  }
  const message = `${String(error.details || '').trim()} ${String(error.message || '').trim()}`.toLowerCase();
  return message.includes('h2 protocol error')
    || message.includes('http2 error')
    || message.includes('transport error');
}

function reasonCodeFromServiceError(
  grpc: GrpcModule,
  error: ServiceError,
  structured?: { readonly reasonCode?: string } | null,
): string {
  if (isRetryableTransportCancelledError(grpc, error, structured)) {
    return 'RUNTIME_GRPC_UNAVAILABLE';
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

function parseReasonCodeFromText(input: unknown): string {
  return String(input || '').trim().match(/^([A-Z0-9_]+):/)?.[1] ?? '';
}

function parseStructuredGrpcDetails(error: ServiceError): {
  readonly reasonCode?: string;
  readonly actionHint?: string;
  readonly traceId?: string;
  readonly retryable?: boolean;
  readonly message?: string;
} | null {
  const record = parseJsonObject(String(error.details || '').trim())
    ?? parseJsonObject(String(error.message || '').trim())
    ?? parseEmbeddedJsonObject(String(error.details || '').trim())
    ?? parseEmbeddedJsonObject(String(error.message || '').trim());
  if (!record) {
    return null;
  }
  const reasonCode = readString(record, ['reasonCode', 'reason_code']);
  const actionHint = readString(record, ['actionHint', 'action_hint']);
  const traceId = readString(record, ['traceId', 'trace_id']);
  const message = readString(record, ['message']);
  const retryable = typeof record.retryable === 'boolean' ? record.retryable : undefined;
  if (!reasonCode && !actionHint && !traceId && typeof retryable !== 'boolean') {
    return null;
  }
  return {
    reasonCode: reasonCode || undefined,
    actionHint: actionHint || undefined,
    traceId: traceId || undefined,
    retryable,
    message: message || undefined,
  };
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = String(record[key] || '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function parseJsonObject(input: string): Record<string, unknown> | null {
  const text = String(input || '').trim();
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseEmbeddedJsonObject(input: string): Record<string, unknown> | null {
  const text = String(input || '').trim();
  const firstBraceIndex = text.indexOf('{');
  const lastBraceIndex = text.lastIndexOf('}');
  if (firstBraceIndex < 0 || lastBraceIndex <= firstBraceIndex) {
    return null;
  }
  return parseJsonObject(text.slice(firstBraceIndex, lastBraceIndex + 1));
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
  const endpoint = normalizeEndpoint(options.endpoint);
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
      const call = runtime.client.makeUnaryRequest<Uint8Array, Uint8Array>(
        request.methodId,
        (value) => Buffer.from(value),
        (value) => Uint8Array.from(value),
        request.body,
        toGrpcMetadata(runtime.grpc, options, request.metadata),
        toCallOptions(request.timeoutMs),
        (error: ServiceError | null, response?: Uint8Array) => {
          if (error) {
            reject(normalizeServiceError(runtime.grpc, error));
            return;
          }
          if (!response) {
            reject(toTransportError(
              'SDK_RUNTIME_NODE_GRPC_EMPTY_RESPONSE',
              `${request.methodId} returned empty response payload`,
              { methodId: request.methodId },
            ));
            return;
          }
          resolve(response);
        },
      );

      call.on('metadata', (metadata: { get(key: string): (string | Buffer)[] }) => {
        emitResponseMetadata(request.responseMetadataObserver, collectResponseMetadata(metadata));
      });

      if (request.signal) {
        if (request.signal.aborted) {
          call.cancel();
          reject(toTransportError(
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
        request.signal.addEventListener('abort', () => call.cancel(), { once: true });
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

    async *serverStream<Response = unknown, Body = unknown>(
      request: CoreStreamRequest<Body>,
    ): AsyncIterable<Response> {
      let codec: ReturnType<typeof getRuntimeWireCodec>;
      let stream: AsyncIterable<Uint8Array>;
      try {
        codec = getRuntimeWireCodec(request.methodId);
        assertMethodKind(request.methodId, codec.kind, 'server_stream');
        const body = codec.encodeRequest(request.body);
        stream = await openStreamBytes({
          endpoint,
          methodId: request.methodId,
          body,
          metadata: request.metadata,
          timeoutMs: request.timeoutMs,
          signal: request.signal,
          responseMetadataObserver: request.responseMetadataObserver,
        });
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_OPEN_FAILED,
          actionHint: 'check_runtime_endpoint_and_network',
          source: 'runtime',
        });
      }
      try {
        for await (const response of stream) {
          yield codec.decodeResponse(response) as Response;
        }
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_OPEN_FAILED,
          actionHint: 'retry_or_reopen_stream',
          source: 'runtime',
        });
      }
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

  call.on('data', (chunk: Uint8Array) => {
    queue.push(chunk);
    flush();
  });
  call.on('metadata', (metadata: { get(key: string): (string | Buffer)[] }) => {
    emitResponseMetadata(responseMetadataObserver, collectResponseMetadata(metadata));
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
