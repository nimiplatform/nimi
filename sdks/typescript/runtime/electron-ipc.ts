import type { CoreTransport } from '../core-client';
import { getRuntimeWireCodec } from '../core-generated/runtime-wire-codecs';
import { asNimiError, ReasonCode } from '../types';
import type {
  CoreMetadata,
  CoreResponseMetadata,
  CoreStreamRequest,
  CoreUnaryRequest,
  JsonObject,
} from '../types';

type ElectronInvoke = (command: string, payload?: unknown) => Promise<unknown>;
type ElectronListenUnsubscribe = () => void;
const RUNTIME_ELECTRON_MAX_BUFFERED_STREAM_CHUNKS = 1024;
type ElectronListen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<ElectronListenUnsubscribe> | ElectronListenUnsubscribe;

type ElectronRuntimeHook = {
  invoke?: ElectronInvoke;
  listen?: ElectronListen;
};

type ElectronGlobal = typeof globalThis & {
  __NIMI_ELECTRON_TEST__?: ElectronRuntimeHook;
  __NIMI_ELECTRON_RUNTIME__?: ElectronRuntimeHook;
  window?: ElectronGlobal;
};

type RuntimeBridgeMetadata = {
  protocolVersion?: string;
  participantProtocolVersion?: string;
  domain?: string;
  traceId?: string;
  idempotencyKey?: string;
  surfaceId?: string;
  keySource?: string;
  providerType?: string;
  clientId?: string;
  providerEndpoint?: string;
  extra?: Record<string, string>;
};

type RuntimeBridgeAppSession = {
  sessionId: string;
  sessionToken: string;
};

type RuntimeBridgeProtectedAccessToken = {
  tokenId: string;
  secret: string;
};

type RuntimeBridgeMetadataScalarField = Exclude<keyof RuntimeBridgeMetadata, 'extra'>;

type RuntimeBridgeUnaryResponse = {
  responseBytesBase64?: string;
  response_bytes_base64?: string;
  responseMetadata?: Record<string, string>;
  response_metadata?: Record<string, string>;
};

type RuntimeBridgeStreamOpenResponse = {
  streamId?: string;
  stream_id?: string;
};

type RuntimeBridgeStreamEvent = {
  streamId?: string;
  stream_id?: string;
  eventType?: string;
  event_type?: string;
  payloadBytesBase64?: string;
  payload_bytes_base64?: string;
  error?: unknown;
};

const DEFAULT_EVENT_NAMESPACE = 'nimi.shell.runtime';
const STANDARD_ELECTRON_RUNTIME_COMMANDS = {
  unary: 'nimi.shell.runtime.unary',
  stream_open: 'nimi.shell.runtime.stream.open',
  stream_close: 'nimi.shell.runtime.stream.close',
} as const;
let runtimeElectronStreamCounter = 0;
let runtimeElectronUnaryCounter = 0;

const BRIDGE_METADATA_FIELDS: Record<string, RuntimeBridgeMetadataScalarField> = {
  protocolversion: 'protocolVersion',
  'x-nimi-protocol-version': 'protocolVersion',
  participantprotocolversion: 'participantProtocolVersion',
  'x-nimi-participant-protocol-version': 'participantProtocolVersion',
  domain: 'domain',
  'x-nimi-domain': 'domain',
  traceid: 'traceId',
  'x-nimi-trace-id': 'traceId',
  idempotencykey: 'idempotencyKey',
  'x-nimi-idempotency-key': 'idempotencyKey',
  surfaceid: 'surfaceId',
  'x-nimi-surface-id': 'surfaceId',
  keysource: 'keySource',
  'x-nimi-key-source': 'keySource',
  providertype: 'providerType',
  'x-nimi-provider-type': 'providerType',
  clientid: 'clientId',
  'x-nimi-client-id': 'clientId',
  providerendpoint: 'providerEndpoint',
  'x-nimi-provider-endpoint': 'providerEndpoint',
};

const RESERVED_EXTRA_KEYS = new Set(Object.keys(BRIDGE_METADATA_FIELDS).filter((key) => key.startsWith('x-nimi-')));
const ELECTRON_RENDERER_FORBIDDEN_AUTH_METADATA_KEYS = new Set([
  'authorization',
  'protectedaccesstoken',
  'appsession',
  'accesstokenid',
  'accesstokensecret',
  'sessionid',
  'sessiontoken',
  'providerapikey',
  'xnimiauthorization',
  'xnimiprotectedaccesstoken',
  'xnimiappsession',
  'xnimiaccesstokenid',
  'xnimiaccesstokensecret',
  'xnimisessionid',
  'xnimisessiontoken',
  'xnimiproviderapikey',
]);
const ELECTRON_RENDERER_FORBIDDEN_IDENTITY_METADATA_KEYS = new Set([
  'appid',
  'participantid',
  'callerkind',
  'callerid',
  'xnimiappid',
  'xnimiparticipantid',
  'xnimicallerkind',
  'xnimicallerid',
]);

export interface RuntimeElectronIpcTransportOptions {
  readonly type?: 'electron-ipc';
  /** SDK-owned named intent used only for the dual-profile ListConnectors RPC. */
  readonly firstPartyListConnectorsIntent?: 'machine.route-connectors.list' | 'account.connector-admin.list';
}

export class RuntimeElectronIpcTransportError extends Error {
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
    this.name = 'RuntimeElectronIpcTransportError';
    this.code = code;
    this.reasonCode = fields.reasonCode ?? code;
    this.actionHint = fields.actionHint ?? 'check_runtime_bridge_and_daemon';
    this.traceId = fields.traceId ?? '';
    this.retryable = Boolean(fields.retryable);
    this.details = details;
  }
}

function readHook(): ElectronRuntimeHook {
  const root = globalThis as ElectronGlobal;
  return root.window?.__NIMI_ELECTRON_TEST__
    ?? root.__NIMI_ELECTRON_TEST__
    ?? root.window?.__NIMI_ELECTRON_RUNTIME__
    ?? root.__NIMI_ELECTRON_RUNTIME__
    ?? {};
}

function ensureInvoke(): ElectronInvoke {
  const invoke = readHook().invoke;
  if (typeof invoke !== 'function') {
    throw new RuntimeElectronIpcTransportError(
      'SDK_RUNTIME_ELECTRON_INVOKE_MISSING',
      'electron-ipc Runtime transport requires window.__NIMI_ELECTRON_RUNTIME__.invoke',
    );
  }
  return invoke;
}

function ensureListen(): ElectronListen {
  const listen = readHook().listen;
  if (typeof listen !== 'function') {
    throw new RuntimeElectronIpcTransportError(
      'SDK_RUNTIME_ELECTRON_LISTEN_MISSING',
      'electron-ipc Runtime transport requires window.__NIMI_ELECTRON_RUNTIME__.listen',
    );
  }
  return listen;
}

function createCommandName(suffix: string): string {
  const command = STANDARD_ELECTRON_RUNTIME_COMMANDS[suffix as keyof typeof STANDARD_ELECTRON_RUNTIME_COMMANDS];
  if (!command) {
    throw new RuntimeElectronIpcTransportError(
      'SDK_RUNTIME_ELECTRON_COMMAND_UNSUPPORTED',
      `electron-ipc Runtime transport does not define command suffix ${suffix}`,
      { suffix },
    );
  }
  return command;
}

function createEventName(streamId: string): string {
  return `${DEFAULT_EVENT_NAMESPACE}:stream:${streamId}`;
}

function createClientStreamId(): string {
  runtimeElectronStreamCounter += 1;
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replaceAll('-', '')
    : Math.random().toString(36).slice(2);
  return `runtime-client-stream-${Date.now()}-${runtimeElectronStreamCounter}-${random}`;
}

function createClientUnaryRequestId(idempotencyKey: string | undefined): string {
  const admittedIdempotencyKey = normalizeText(idempotencyKey);
  if (admittedIdempotencyKey
    && admittedIdempotencyKey.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(admittedIdempotencyKey)) {
    return admittedIdempotencyKey;
  }
  runtimeElectronUnaryCounter += 1;
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replaceAll('-', '')
    : Math.random().toString(36).slice(2);
  return `runtime-client-unary-${Date.now()}-${runtimeElectronUnaryCounter}-${random}`;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Runtime unary request was canceled', 'AbortError');
}

function isBottomUnaryCancellation(error: unknown): boolean {
  const direct = asObject(error);
  const envelope = asObject(direct.envelope);
  const details = asObject(direct.details);
  return [
    direct.reasonCode,
    direct.code,
    envelope.reasonCode,
    envelope.code,
    details.reasonCode,
    details.code,
  ].includes('runtime-request-canceled');
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text ? text : undefined;
}

function normalizeBase64Field(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  throw new RuntimeElectronIpcTransportError(
    'SDK_RUNTIME_BASE64_ENCODER_UNAVAILABLE',
    'base64 encoder unavailable for electron-ipc Runtime transport',
  );
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
  throw new RuntimeElectronIpcTransportError(
    'SDK_RUNTIME_BASE64_DECODER_UNAVAILABLE',
    'base64 decoder unavailable for electron-ipc Runtime transport',
  );
}

function splitRuntimeMetadata(metadata: CoreMetadata | undefined): {
  readonly metadata?: RuntimeBridgeMetadata;
} {
  const bridgeMetadata: RuntimeBridgeMetadata = {};
  const extra: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(metadata ?? {})) {
    const value = normalizeText(rawValue);
    if (!value) {
      continue;
    }
    const key = rawKey.trim();
    const lookup = key.toLowerCase();
    const compactLookup = lookup.replaceAll('-', '');
    const forbiddenKind = electronRendererForbiddenMetadataKind(compactLookup);
    if (forbiddenKind) {
      throwInvalidRendererMetadata(
        rawKey,
        `Runtime metadata field ${rawKey} must use the host-owned ${forbiddenKind} channel`,
        forbiddenKind,
      );
    }
    const bridgeField = BRIDGE_METADATA_FIELDS[compactLookup] ?? BRIDGE_METADATA_FIELDS[lookup];
    if (bridgeField) {
      bridgeMetadata[bridgeField] = value;
      continue;
    }
    if (lookup.startsWith('x-nimi-') && !RESERVED_EXTRA_KEYS.has(lookup)) {
      extra[lookup] = value;
    }
  }

  if (Object.keys(extra).length > 0) {
    bridgeMetadata.extra = extra;
  }

  return {
    metadata: Object.keys(bridgeMetadata).length > 0 ? bridgeMetadata : undefined,
  };
}

function electronRendererForbiddenMetadataKind(key: string): 'auth' | 'identity' | undefined {
  if (ELECTRON_RENDERER_FORBIDDEN_IDENTITY_METADATA_KEYS.has(key)) {
    return 'identity';
  }
  if (
    ELECTRON_RENDERER_FORBIDDEN_AUTH_METADATA_KEYS.has(key)
    || key.includes('authorization')
    || key.includes('accesstoken')
    || key.includes('session')
    || key.includes('providerapikey')
    || key.includes('secret')
  ) {
    return 'auth';
  }
  return undefined;
}

function throwInvalidRendererMetadata(
  metadataKey: string,
  message: string,
  forbiddenKind: 'auth' | 'identity' = 'auth',
): never {
  throw new RuntimeElectronIpcTransportError(
    'SDK_TRANSPORT_INVALID',
    message,
    { metadataKey },
    {
      reasonCode: ReasonCode.SDK_TRANSPORT_INVALID,
      actionHint: forbiddenKind === 'identity'
        ? 'provide_runtime_identity_from_electron_host'
        : 'provide_runtime_auth_from_electron_host',
      retryable: false,
    },
  );
}

function normalizeResponseMetadata(response: RuntimeBridgeUnaryResponse): CoreResponseMetadata {
  const candidates = [response.responseMetadata, response.response_metadata];
  for (const metadata of candidates) {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata) && Object.keys(metadata).length > 0) {
      return metadata;
    }
  }
  return {};
}

function emitResponseMetadata(
  observer: ((metadata: CoreResponseMetadata) => void) | undefined,
  metadata: CoreResponseMetadata,
): void {
  if (observer && Object.keys(metadata).length > 0) {
    observer(metadata);
  }
}

function toStreamError(error: unknown): RuntimeElectronIpcTransportError {
  const input = asObject(error);
  const reasonCode = normalizeText(input.reasonCode ?? input.reason_code) ?? 'SDK_RUNTIME_ELECTRON_STREAM_REMOTE_ERROR';
  return new RuntimeElectronIpcTransportError(
    reasonCode,
    normalizeText(input.message) ?? 'Runtime stream reported an error',
    {
      actionHint: normalizeText(input.actionHint ?? input.action_hint),
      traceId: normalizeText(input.traceId ?? input.trace_id),
      retryable: typeof input.retryable === 'boolean' ? input.retryable : undefined,
    },
    {
      reasonCode,
      actionHint: normalizeText(input.actionHint ?? input.action_hint) ?? 'retry_or_reopen_stream',
      traceId: normalizeText(input.traceId ?? input.trace_id),
      retryable: typeof input.retryable === 'boolean' ? input.retryable : undefined,
    },
  );
}

function assertMethodKind(methodId: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new RuntimeElectronIpcTransportError(
      'SDK_RUNTIME_METHOD_UNAVAILABLE',
      `${methodId} is ${actual}, not ${expected}`,
      { methodId, actual, expected },
    );
  }
}

export function createRuntimeElectronIpcTransport(
  options: RuntimeElectronIpcTransportOptions = {},
): CoreTransport {
  const invokeUnaryBytes = async (methodId: string, body: Uint8Array, request: CoreUnaryRequest): Promise<Uint8Array> => {
    const invoke = ensureInvoke();
    const { metadata } = splitRuntimeMetadata(request.metadata);
    const requestId = createClientUnaryRequestId(metadata?.idempotencyKey);
    const signal = request.signal;
    if (signal?.aborted) {
      throw abortReason(signal);
    }
    let detachAbort: (() => void) | undefined;
    if (signal) {
      const abort = () => {
        void invoke(createCommandName('unary'), {
          payload: { cancel: true, requestId },
        }).catch(() => undefined);
      };
      signal.addEventListener('abort', abort, { once: true });
      detachAbort = () => signal.removeEventListener('abort', abort);
    }
    let rawResponse: unknown;
    try {
      rawResponse = await invoke(createCommandName('unary'), {
        payload: {
          methodId,
          requestId,
          requestBytesBase64: toBase64(body),
          productIntent: methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors'
            ? options.firstPartyListConnectorsIntent
            : undefined,
          metadata,
          timeoutMs: request.timeoutMs,
        },
      });
    } catch (error) {
      if (signal?.aborted && isBottomUnaryCancellation(error)) {
        throw abortReason(signal);
      }
      throw error;
    } finally {
      detachAbort?.();
    }
    const response = asObject(rawResponse) as RuntimeBridgeUnaryResponse;
    const responseBytesBase64 = normalizeBase64Field(response.responseBytesBase64)
      ?? normalizeBase64Field(response.response_bytes_base64);
    if (responseBytesBase64 === undefined) {
      throw new RuntimeElectronIpcTransportError(
        'SDK_RUNTIME_ELECTRON_UNARY_BYTES_MISSING',
        `${methodId} electron-ipc unary response missing responseBytesBase64`,
      );
    }
    emitResponseMetadata(request.responseMetadataObserver, normalizeResponseMetadata(response));
    return fromBase64(responseBytesBase64);
  };

  const openStreamBytes = async (
    methodId: string,
    body: Uint8Array,
    request: CoreStreamRequest,
  ): Promise<AsyncIterable<Uint8Array>> => {
    const invoke = ensureInvoke();
    const listen = ensureListen();
    const { metadata } = splitRuntimeMetadata(request.metadata);

    let streamId = createClientStreamId();
    let unsubscribe: ElectronListenUnsubscribe | undefined;
    let done = false;
    let pendingError: unknown;
    let detachAbort: (() => void) | undefined;
    const queue: Uint8Array[] = [];
    const waiters: Array<{
      resolve: (result: IteratorResult<Uint8Array>) => void;
      reject: (error: unknown) => void;
    }> = [];

    const closeRemoteStream = async () => {
      if (!streamId) {
        return;
      }
      try {
        await invoke(createCommandName('stream_close'), {
          payload: { streamId },
        });
      } catch {
        // Best effort close mirrors the existing Runtime bridge contract.
      }
    };

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

    const close = async () => {
      if (done) {
        return;
      }
      done = true;
      detachAbort?.();
      unsubscribe?.();
      unsubscribe = undefined;
      await closeRemoteStream();
      flush();
    };

    const fail = (error: unknown) => {
      pendingError = error instanceof RuntimeElectronIpcTransportError
        ? error
        : toStreamError(error);
      done = true;
      detachAbort?.();
      unsubscribe?.();
      unsubscribe = undefined;
      void closeRemoteStream();
      flush();
    };

    const failBackpressure = () => {
      fail(new RuntimeElectronIpcTransportError(
        ReasonCode.SDK_RUNTIME_ELECTRON_STREAM_BACKPRESSURE,
        `${methodId} stream consumer is not draining fast enough`,
        {
          methodId,
          bufferedChunks: queue.length,
          maxBufferedChunks: RUNTIME_ELECTRON_MAX_BUFFERED_STREAM_CHUNKS,
        },
        {
          reasonCode: ReasonCode.SDK_RUNTIME_ELECTRON_STREAM_BACKPRESSURE,
          actionHint: 'consume_stream_events_or_cancel_the_stream',
          retryable: false,
        },
      ));
    };

    try {
      unsubscribe = await Promise.resolve(listen(createEventName(streamId), (event) => {
        const payload = asObject(event.payload) as RuntimeBridgeStreamEvent;
        const eventType = normalizeText(payload.eventType ?? payload.event_type);
        if (eventType === 'next') {
          if (queue.length >= RUNTIME_ELECTRON_MAX_BUFFERED_STREAM_CHUNKS && waiters.length === 0) {
            failBackpressure();
            return;
          }
          queue.push(fromBase64(normalizeText(payload.payloadBytesBase64 ?? payload.payload_bytes_base64) ?? ''));
          flush();
          return;
        }
        if (eventType === 'error') {
          fail(payload.error);
          return;
        }
        if (eventType === 'completed') {
          done = true;
          detachAbort?.();
          unsubscribe?.();
          unsubscribe = undefined;
          flush();
        }
      }));
      const opened = asObject(await invoke(createCommandName('stream_open'), {
        payload: {
          methodId,
          streamId,
          requestBytesBase64: toBase64(body),
          metadata,
          timeoutMs: request.timeoutMs,
          eventNamespace: DEFAULT_EVENT_NAMESPACE,
        },
      })) as RuntimeBridgeStreamOpenResponse;
      const openedStreamId = normalizeText(opened.streamId ?? opened.stream_id) ?? '';
      if (!openedStreamId) {
        throw new RuntimeElectronIpcTransportError(
          'SDK_RUNTIME_ELECTRON_STREAM_ID_MISSING',
          `${methodId} electron-ipc stream open response missing streamId`,
        );
      }
      if (openedStreamId !== streamId) {
        throw new RuntimeElectronIpcTransportError(
          'SDK_RUNTIME_ELECTRON_STREAM_ID_MISMATCH',
          `${methodId} electron-ipc stream open response returned a different streamId`,
          { requestedStreamId: streamId, openedStreamId },
          {
            reasonCode: ReasonCode.SDK_RUNTIME_ELECTRON_STREAM_ID_MISMATCH,
            actionHint: 'check_runtime_bridge_stream_identity',
            retryable: false,
          },
        );
      }
    } catch (error) {
      unsubscribe?.();
      await closeRemoteStream();
      throw error instanceof RuntimeElectronIpcTransportError
        ? error
        : new RuntimeElectronIpcTransportError(
          'SDK_RUNTIME_ELECTRON_STREAM_OPEN_FAILED',
          error instanceof Error ? error.message : String(error),
          { cause: error instanceof Error ? error.message : String(error) },
        );
    }

    if (request.signal) {
      if (request.signal.aborted) {
        await close();
      } else {
        const abort = () => {
          void close();
        };
        request.signal.addEventListener('abort', abort, { once: true });
        detachAbort = () => request.signal?.removeEventListener('abort', abort);
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
            await close();
            return { done: true, value: undefined };
          },
        };
      },
    };
  };

  return {
    async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
      try {
        const codec = getRuntimeWireCodec(request.methodId);
        assertMethodKind(request.methodId, codec.kind, 'unary');
        const response = await invokeUnaryBytes(request.methodId, codec.encodeRequest(request.body), request);
        return codec.decodeResponse(response) as Response;
      } catch (error) {
        if (error && typeof error === 'object' && (error as { readonly name?: unknown }).name === 'AbortError') {
          throw error;
        }
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_ELECTRON_UNARY_FAILED,
          actionHint: 'check_runtime_bridge_and_daemon',
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
        stream = await openStreamBytes(request.methodId, codec.encodeRequest(request.body), request);
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_ELECTRON_STREAM_OPEN_FAILED,
          actionHint: 'check_runtime_bridge_and_daemon',
          source: 'runtime',
        });
      }
      try {
        for await (const response of stream) {
          yield codec.decodeResponse(response) as Response;
        }
      } catch (error) {
        throw asNimiError(error, {
          reasonCode: ReasonCode.SDK_RUNTIME_ELECTRON_STREAM_FAILED,
          actionHint: 'retry_or_reopen_stream',
          source: 'runtime',
        });
      }
    },
  };
}
