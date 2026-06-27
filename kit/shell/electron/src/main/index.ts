export type ElectronRuntimeBridgeCommandSuffix =
  | 'unary'
  | 'stream_open'
  | 'stream_close'
  | 'status'
  | 'start'
  | 'stop'
  | 'restart'
  | 'config_get'
  | 'config_set';

export type ElectronRuntimeBridgeCommandNames = Readonly<Record<ElectronRuntimeBridgeCommandSuffix, string>>;

export type ElectronRuntimeBridgeMetadata = {
  readonly protocolVersion?: string;
  readonly participantProtocolVersion?: string;
  readonly domain?: string;
  readonly traceId?: string;
  readonly idempotencyKey?: string;
  readonly surfaceId?: string;
  readonly keySource?: string;
  readonly providerType?: string;
  readonly clientId?: string;
  readonly providerEndpoint?: string;
  readonly extra?: Readonly<Record<string, string>>;
};

export type ElectronRuntimeBridgeTrustedIdentityMetadata = ElectronRuntimeBridgeMetadata & {
  readonly participantId?: string;
  readonly callerKind?: string;
  readonly callerId?: string;
};

export type ElectronRuntimeBridgeProtectedAccessToken = {
  readonly tokenId: string;
  readonly secret: string;
};

export type ElectronRuntimeBridgeAppSession = {
  readonly sessionId: string;
  readonly sessionToken: string;
};

export type ElectronRuntimeBridgeUnaryRequest = {
  readonly methodId: string;
  readonly requestBytesBase64: string;
  readonly metadata?: ElectronRuntimeBridgeMetadata;
  readonly timeoutMs?: number;
};

export type ElectronRuntimeBridgeUnaryResponse = {
  readonly responseBytesBase64: string;
  readonly responseMetadata?: Readonly<Record<string, string>>;
};

export type ElectronRuntimeBridgeStreamOpenRequest = ElectronRuntimeBridgeUnaryRequest & {
  readonly streamId: string;
  readonly eventNamespace?: string;
};

export type ElectronRuntimeBridgeStreamOpenResponse = {
  readonly streamId: string;
};

export type ElectronRuntimeBridgeStreamCloseRequest = {
  readonly streamId: string;
};

export type ElectronRuntimeBridgeTrustedMetadata = {
  readonly metadata?: ElectronRuntimeBridgeTrustedIdentityMetadata;
  readonly authorization?: string;
  readonly protectedAccessToken?: ElectronRuntimeBridgeProtectedAccessToken;
  readonly appSession?: ElectronRuntimeBridgeAppSession;
};

export type ElectronRuntimeBridgeTrustedMetadataProviderInput = {
  readonly command: string;
  readonly methodId: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly appId: string;
  readonly runtimeEndpoint: string;
};

export type ElectronRuntimeBridgeTrustedMetadataProvider = (
  input: ElectronRuntimeBridgeTrustedMetadataProviderInput,
) => Promise<ElectronRuntimeBridgeTrustedMetadata | undefined> | ElectronRuntimeBridgeTrustedMetadata | undefined;

export type NimiElectronIpcMainInvokeEvent = {
  readonly senderFrame?: {
    readonly origin?: string;
    readonly url?: string;
  } | null;
  readonly sender?: {
    readonly send?: (channel: string, payload: unknown) => void;
  };
};

export type NimiElectronIpcMain = {
  readonly handle: (
    channel: string,
    listener: (event: NimiElectronIpcMainInvokeEvent, payload: unknown) => Promise<unknown> | unknown,
  ) => void;
  readonly removeHandler?: (channel: string) => void;
};

export type RuntimeGrpcBridgeUnaryRequest = {
  readonly methodId: string;
  readonly requestBytes: Uint8Array;
  readonly metadata: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
};

export type RuntimeGrpcBridgeUnaryResponse = {
  readonly responseBytes: Uint8Array;
  readonly responseMetadata?: Readonly<Record<string, string>>;
};

export type RuntimeGrpcBridgeStreamRequest = RuntimeGrpcBridgeUnaryRequest;

export type RuntimeGrpcBridgeStreamHandlers = {
  readonly onData: (bytes: Uint8Array) => void;
  readonly onError: (error: unknown) => void;
  readonly onEnd: () => void;
};

export type RuntimeGrpcBridgeStream = {
  readonly start: (handlers: RuntimeGrpcBridgeStreamHandlers) => void;
  readonly cancel: () => void;
};

export type RuntimeGrpcBridgeClient = {
  readonly unary: (request: RuntimeGrpcBridgeUnaryRequest) => Promise<RuntimeGrpcBridgeUnaryResponse>;
  readonly serverStream: (request: RuntimeGrpcBridgeStreamRequest) => RuntimeGrpcBridgeStream;
  readonly close: () => void;
};

export type NimiElectronCommandHandlerInput = {
  readonly command: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly appId: string;
  readonly runtimeEndpoint: string;
};

export type NimiElectronCommandHandler = (
  input: NimiElectronCommandHandlerInput,
) => Promise<unknown> | unknown;

export type RegisterNimiElectronRuntimeBridgeInput = {
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly allowedOrigins: readonly string[];
  readonly allowedRendererUrls?: readonly string[];
  readonly ipcMain: NimiElectronIpcMain;
  readonly commandNamespace?: string;
  readonly eventNamespace?: string;
  readonly invokeChannel?: string;
  readonly eventChannelPrefix?: string;
  readonly createGrpcClient?: (endpoint: string) => Promise<RuntimeGrpcBridgeClient> | RuntimeGrpcBridgeClient;
  readonly trustedRuntimeMetadataProvider?: ElectronRuntimeBridgeTrustedMetadataProvider;
  readonly commandHandlers?: Readonly<Record<string, NimiElectronCommandHandler>>;
};

export type RegisteredNimiElectronRuntimeBridge = {
  readonly invokeChannel: string;
  readonly unregister: () => void;
};

export type ElectronShellHostErrorCode =
  | 'NIMI_ELECTRON_APP_ID_REQUIRED'
  | 'NIMI_ELECTRON_HOST_OPTION_REQUIRED'
  | 'NIMI_ELECTRON_RUNTIME_BRIDGE_INVALID'
  | 'NIMI_ELECTRON_ORIGIN_NOT_ALLOWED'
  | 'NIMI_ELECTRON_EXTERNAL_DAEMON_REQUIRED';

export class NimiElectronShellHostError extends Error {
  readonly code: ElectronShellHostErrorCode;
  readonly reasonCode: ElectronShellHostErrorCode | 'external-daemon-required';
  readonly actionHint: string;
  readonly source = 'host';
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(input: {
    readonly code: ElectronShellHostErrorCode;
    readonly message: string;
    readonly reasonCode?: ElectronShellHostErrorCode | 'external-daemon-required';
    readonly actionHint: string;
    readonly details?: Readonly<Record<string, unknown>>;
  }) {
    super(input.message);
    this.name = 'NimiElectronShellHostError';
    this.code = input.code;
    this.reasonCode = input.reasonCode ?? input.code;
    this.actionHint = input.actionHint;
    this.details = input.details;
  }
}

export function createElectronRuntimeBridgeCommandNames(
  commandNamespace = 'runtime_bridge',
): ElectronRuntimeBridgeCommandNames {
  const namespace = normalizeRequiredToken(commandNamespace, 'commandNamespace');
  return {
    unary: `${namespace}_unary`,
    stream_open: `${namespace}_stream_open`,
    stream_close: `${namespace}_stream_close`,
    status: `${namespace}_status`,
    start: `${namespace}_start`,
    stop: `${namespace}_stop`,
    restart: `${namespace}_restart`,
    config_get: `${namespace}_config_get`,
    config_set: `${namespace}_config_set`,
  };
}

export function createElectronRuntimeBridgeEventName(
  streamId: string,
  eventNamespace = 'runtime_bridge',
): string {
  return `${normalizeRequiredToken(eventNamespace, 'eventNamespace')}:stream:${normalizeRequiredToken(streamId, 'streamId')}`;
}

export function normalizeElectronShellAppId(appId: unknown): string {
  const normalized = normalizeText(appId);
  if (!normalized) {
    throw new NimiElectronShellHostError({
      code: 'NIMI_ELECTRON_APP_ID_REQUIRED',
      message: 'Electron shell host requires an explicit appId',
      actionHint: 'provide_app_id_when_registering_electron_host',
    });
  }
  return normalized;
}

export function isAllowedElectronRendererOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  const normalizedOrigin = normalizeText(origin);
  if (!normalizedOrigin) {
    return false;
  }
  return allowedOrigins.some((allowed) => {
    const normalizedAllowed = normalizeText(allowed);
    return normalizedAllowed === normalizedOrigin;
  });
}

export function isAllowedElectronRendererUrl(
  url: string | undefined,
  allowedUrls: readonly string[] | undefined,
): boolean {
  if (!allowedUrls || allowedUrls.length === 0) {
    return true;
  }
  const normalizedUrl = normalizeRendererUrlForComparison(url);
  if (!normalizedUrl) {
    return false;
  }
  return allowedUrls.some((allowedUrl) => normalizeRendererUrlForComparison(allowedUrl) === normalizedUrl);
}

export function assertAllowedElectronRendererOrigin(input: {
  readonly origin: string | undefined;
  readonly allowedOrigins: readonly string[];
}): string {
  const origin = normalizeText(input.origin);
  if (isAllowedElectronRendererOrigin(origin, input.allowedOrigins)) {
    return origin;
  }
  throw new NimiElectronShellHostError({
    code: 'NIMI_ELECTRON_ORIGIN_NOT_ALLOWED',
    message: `Electron renderer origin is not allowed: ${origin || '<missing>'}`,
    actionHint: 'add_renderer_origin_to_electron_host_allowlist',
    details: {
      origin,
      allowedOrigins: [...input.allowedOrigins],
    },
  });
}

export function assertAllowedElectronRendererUrl(input: {
  readonly url: string | undefined;
  readonly allowedUrls: readonly string[] | undefined;
}): string {
  const url = normalizeText(input.url);
  if (isAllowedElectronRendererUrl(url, input.allowedUrls)) {
    return url;
  }
  throw new NimiElectronShellHostError({
    code: 'NIMI_ELECTRON_ORIGIN_NOT_ALLOWED',
    message: `Electron renderer URL is not allowed: ${url || '<missing>'}`,
    actionHint: 'add_renderer_url_to_electron_host_allowlist',
    details: {
      url,
      allowedUrls: [...(input.allowedUrls ?? [])],
    },
  });
}

export function createElectronExternalDaemonRequiredError(command: string): NimiElectronShellHostError {
  return new NimiElectronShellHostError({
    code: 'NIMI_ELECTRON_EXTERNAL_DAEMON_REQUIRED',
    message: `Electron Runtime daemon command ${normalizeRequiredToken(command, 'command')} requires an external daemon in Phase 1`,
    reasonCode: 'external-daemon-required',
    actionHint: 'start_runtime_daemon_outside_electron_or_use_tauri_host_lifecycle',
    details: { command },
  });
}

export function registerNimiElectronRuntimeBridge(
  input: RegisterNimiElectronRuntimeBridgeInput,
): RegisteredNimiElectronRuntimeBridge {
  const appId = normalizeElectronShellAppId(input.appId);
  const runtimeEndpoint = normalizeRequiredToken(input.runtimeEndpoint, 'runtimeEndpoint');
  const allowedOrigins = input.allowedOrigins.map((origin) => normalizeText(origin)).filter(Boolean);
  const allowedRendererUrls = input.allowedRendererUrls?.map((url) => normalizeText(url)).filter(Boolean) ?? [];
  if (allowedOrigins.length === 0) {
    throw new NimiElectronShellHostError({
      code: 'NIMI_ELECTRON_HOST_OPTION_REQUIRED',
      message: 'Electron shell host requires at least one allowed renderer origin',
      actionHint: 'provide_renderer_origin_allowlist',
    });
  }
  const commandNames = createElectronRuntimeBridgeCommandNames(input.commandNamespace);
  const eventNamespace = normalizeText(input.eventNamespace) || 'runtime_bridge';
  const invokeChannel = normalizeText(input.invokeChannel) || 'nimi:runtime:invoke';
  const eventChannelPrefix = normalizeText(input.eventChannelPrefix) || 'nimi:runtime:event:';
  const createGrpcClient = input.createGrpcClient ?? createDefaultRuntimeGrpcBridgeClient;
  let clientPromise: Promise<RuntimeGrpcBridgeClient> | undefined;
  const ensureClient = () => {
    clientPromise ??= Promise.resolve(createGrpcClient(runtimeEndpoint));
    return clientPromise;
  };
  const streams = new Map<string, RuntimeGrpcBridgeStream>();

  input.ipcMain.handle(invokeChannel, async (event, message) => {
    assertAllowedElectronRendererOrigin({
      origin: resolveElectronRendererOrigin(event),
      allowedOrigins,
    });
    assertAllowedElectronRendererUrl({
      url: event.senderFrame?.url,
      allowedUrls: allowedRendererUrls,
    });
    const envelope = asRecord(message, 'Electron Runtime bridge message must be an object');
    const command = normalizeRequiredToken(envelope.command, 'command');
    const payload = asRecord(envelope.payload ?? {}, `Electron Runtime bridge command ${command} payload must be an object`);
    if (command === commandNames.unary) {
      return invokeElectronRuntimeUnary({
        client: await ensureClient(),
        payload: electronRuntimeCommandPayload(payload, command),
        appId,
        event,
        runtimeEndpoint,
        command,
        trustedRuntimeMetadataProvider: input.trustedRuntimeMetadataProvider,
      });
    }
    if (command === commandNames.stream_open) {
      return openElectronRuntimeStream({
        client: await ensureClient(),
        payload: electronRuntimeCommandPayload(payload, command),
        appId,
        runtimeEndpoint,
        command,
        event,
        eventNamespace,
        eventChannelPrefix,
        streams,
        trustedRuntimeMetadataProvider: input.trustedRuntimeMetadataProvider,
      });
    }
    if (command === commandNames.stream_close) {
      return closeElectronRuntimeStream(electronRuntimeCommandPayload(payload, command), streams);
    }
    if (command === commandNames.status) {
      try {
        return await probeElectronRuntimeStatus({
          client: await ensureClient(),
          appId,
          runtimeEndpoint,
        });
      } catch (error) {
        return electronRuntimeUnavailableStatus(runtimeEndpoint, error);
      }
    }
    if (
      command === commandNames.start
      || command === commandNames.stop
      || command === commandNames.restart
      || command === commandNames.config_get
      || command === commandNames.config_set
    ) {
      throw createElectronExternalDaemonRequiredError(command);
    }
    const commandHandler = input.commandHandlers?.[command];
    if (commandHandler) {
      return await commandHandler({
        command,
        payload,
        event,
        appId,
        runtimeEndpoint,
      });
    }
    throw new NimiElectronShellHostError({
      code: 'NIMI_ELECTRON_RUNTIME_BRIDGE_INVALID',
      message: `Unsupported Electron Runtime bridge command: ${command}`,
      actionHint: 'use_registered_runtime_bridge_command',
      details: { command },
    });
  });

  return {
    invokeChannel,
    unregister: () => {
      input.ipcMain.removeHandler?.(invokeChannel);
      for (const stream of streams.values()) {
        stream.cancel();
      }
      streams.clear();
      void clientPromise?.then((client) => client.close()).catch(() => undefined);
    },
  };
}

async function invokeElectronRuntimeUnary(input: {
  readonly client: RuntimeGrpcBridgeClient;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly appId: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly runtimeEndpoint: string;
  readonly command: string;
  readonly trustedRuntimeMetadataProvider?: ElectronRuntimeBridgeTrustedMetadataProvider;
}): Promise<ElectronRuntimeBridgeUnaryResponse> {
  const request = parseElectronRuntimeUnaryRequest(input.payload);
  const trusted = await resolveTrustedRuntimeMetadata({
    provider: input.trustedRuntimeMetadataProvider,
    command: input.command,
    methodId: request.methodId,
    event: input.event,
    appId: input.appId,
    runtimeEndpoint: input.runtimeEndpoint,
  });
  const response = await input.client.unary({
    methodId: request.methodId,
    requestBytes: fromBase64(request.requestBytesBase64),
    metadata: buildElectronRuntimeGrpcMetadata(request, input.appId, trusted),
    timeoutMs: request.timeoutMs,
  });
  return {
    responseBytesBase64: toBase64(response.responseBytes),
    responseMetadata: response.responseMetadata,
  };
}

async function openElectronRuntimeStream(input: {
  readonly client: RuntimeGrpcBridgeClient;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly command: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly eventNamespace: string;
  readonly eventChannelPrefix: string;
  readonly streams: Map<string, RuntimeGrpcBridgeStream>;
  readonly trustedRuntimeMetadataProvider?: ElectronRuntimeBridgeTrustedMetadataProvider;
}): Promise<ElectronRuntimeBridgeStreamOpenResponse> {
  const request = parseElectronRuntimeStreamOpenRequest(input.payload);
  const trusted = await resolveTrustedRuntimeMetadata({
    provider: input.trustedRuntimeMetadataProvider,
    command: input.command,
    methodId: request.methodId,
    event: input.event,
    appId: input.appId,
    runtimeEndpoint: input.runtimeEndpoint,
  });
  const stream = input.client.serverStream({
    methodId: request.methodId,
    requestBytes: fromBase64(request.requestBytesBase64),
    metadata: buildElectronRuntimeGrpcMetadata(request, input.appId, trusted),
    timeoutMs: request.timeoutMs,
  });
  const eventName = createElectronRuntimeBridgeEventName(request.streamId, request.eventNamespace || input.eventNamespace);
  const channel = `${input.eventChannelPrefix}${eventName}`;
  input.streams.set(request.streamId, stream);
  try {
    stream.start({
      onData: (bytes) => {
        input.event.sender?.send?.(channel, {
          streamId: request.streamId,
          eventType: 'next',
          payloadBytesBase64: toBase64(bytes),
        });
      },
      onError: (error) => {
        input.streams.delete(request.streamId);
        input.event.sender?.send?.(channel, {
          streamId: request.streamId,
          eventType: 'error',
          error: toElectronRuntimeBridgeError(error),
        });
      },
      onEnd: () => {
        input.streams.delete(request.streamId);
        input.event.sender?.send?.(channel, {
          streamId: request.streamId,
          eventType: 'completed',
        });
      },
    });
  } catch (error) {
    input.streams.delete(request.streamId);
    throw error;
  }
  return { streamId: request.streamId };
}

function closeElectronRuntimeStream(
  payload: Readonly<Record<string, unknown>>,
  streams: Map<string, RuntimeGrpcBridgeStream>,
): Record<string, never> {
  const streamId = normalizeRequiredToken(payload.streamId, 'streamId');
  const stream = streams.get(streamId);
  if (stream) {
    stream.cancel();
    streams.delete(streamId);
  }
  return {};
}

function electronRuntimeCommandPayload(
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Readonly<Record<string, unknown>> {
  if ('payload' in payload && !('methodId' in payload) && !('streamId' in payload)) {
    return asRecord(payload.payload ?? {}, `Electron Runtime bridge command ${command} nested payload must be an object`);
  }
  return payload;
}

function parseElectronRuntimeUnaryRequest(payload: Readonly<Record<string, unknown>>): ElectronRuntimeBridgeUnaryRequest {
  assertNoRendererSensitiveRuntimeBridgePayload(payload);
  return {
    methodId: normalizeGrpcMethodId(payload.methodId),
    requestBytesBase64: normalizeBase64Text(payload.requestBytesBase64, 'requestBytesBase64'),
    metadata: parseRuntimeBridgeMetadata(payload.metadata),
    timeoutMs: parseOptionalPositiveNumber(payload.timeoutMs),
  };
}

function parseElectronRuntimeStreamOpenRequest(
  payload: Readonly<Record<string, unknown>>,
): ElectronRuntimeBridgeStreamOpenRequest {
  return {
    ...parseElectronRuntimeUnaryRequest(payload),
    streamId: normalizeRequiredToken(payload.streamId, 'streamId'),
    eventNamespace: normalizeText(payload.eventNamespace) || undefined,
  };
}

function buildElectronRuntimeGrpcMetadata(
  request: ElectronRuntimeBridgeUnaryRequest,
  fallbackAppId: string,
  trusted?: ElectronRuntimeBridgeTrustedMetadata,
): Record<string, string> {
  const metadata: Record<string, string> = {};
  addMetadata(metadata, 'x-nimi-protocol-version', request.metadata?.protocolVersion || trusted?.metadata?.protocolVersion || '1.0.0');
  addMetadata(metadata, 'x-nimi-participant-protocol-version', request.metadata?.participantProtocolVersion || trusted?.metadata?.participantProtocolVersion || '1.0.0');
  addMetadata(metadata, 'x-nimi-participant-id', trusted?.metadata?.participantId || fallbackAppId);
  addMetadata(metadata, 'x-nimi-domain', request.metadata?.domain || trusted?.metadata?.domain || 'runtime.rpc');
  addMetadata(metadata, 'x-nimi-app-id', fallbackAppId);
  addMetadata(metadata, 'x-nimi-trace-id', request.metadata?.traceId);
  addMetadata(metadata, 'x-nimi-idempotency-key', request.metadata?.idempotencyKey);
  addMetadata(metadata, 'x-nimi-caller-kind', trusted?.metadata?.callerKind || 'third-party-app');
  addMetadata(metadata, 'x-nimi-caller-id', trusted?.metadata?.callerId || fallbackAppId);
  addMetadata(metadata, 'x-nimi-surface-id', request.metadata?.surfaceId);
  addMetadata(metadata, 'x-nimi-key-source', request.metadata?.keySource);
  addMetadata(metadata, 'x-nimi-provider-type', request.metadata?.providerType);
  addMetadata(metadata, 'x-nimi-client-id', request.metadata?.clientId);
  addMetadata(metadata, 'x-nimi-provider-endpoint', request.metadata?.providerEndpoint);
  addMetadata(metadata, 'authorization', trusted?.authorization);
  addMetadata(metadata, 'x-nimi-access-token-id', trusted?.protectedAccessToken?.tokenId);
  addMetadata(metadata, 'x-nimi-access-token-secret', trusted?.protectedAccessToken?.secret);
  addMetadata(metadata, 'x-nimi-session-id', trusted?.appSession?.sessionId);
  addMetadata(metadata, 'x-nimi-session-token', trusted?.appSession?.sessionToken);
  for (const [key, value] of Object.entries(request.metadata?.extra ?? {})) {
    assertRendererMetadataKeyAllowed(key);
    const normalizedKey = normalizeText(key).toLowerCase();
    if (!normalizedKey.startsWith('x-nimi-') || RESERVED_METADATA_KEYS.has(normalizedKey)) {
      throw new NimiElectronShellHostError({
        code: 'NIMI_ELECTRON_RUNTIME_BRIDGE_INVALID',
        message: `Electron Runtime bridge metadata extra key is not allowed: ${key}`,
        actionHint: 'use_supported_runtime_metadata_field',
        details: { key },
      });
    }
    addMetadata(metadata, normalizedKey, value);
  }
  return metadata;
}

async function resolveTrustedRuntimeMetadata(input: {
  readonly provider: ElectronRuntimeBridgeTrustedMetadataProvider | undefined;
  readonly command: string;
  readonly methodId: string;
  readonly event: NimiElectronIpcMainInvokeEvent;
  readonly appId: string;
  readonly runtimeEndpoint: string;
}): Promise<ElectronRuntimeBridgeTrustedMetadata | undefined> {
  return input.provider?.({
    command: input.command,
    methodId: input.methodId,
    event: input.event,
    appId: input.appId,
    runtimeEndpoint: input.runtimeEndpoint,
  });
}

async function probeElectronRuntimeStatus(input: {
  readonly client: RuntimeGrpcBridgeClient;
  readonly appId: string;
  readonly runtimeEndpoint: string;
}): Promise<Record<string, unknown>> {
  try {
    const response = await input.client.unary({
      methodId: ELECTRON_RUNTIME_STATUS_METHOD_ID,
      requestBytes: new Uint8Array(),
      metadata: buildElectronRuntimeGrpcMetadata({
        methodId: ELECTRON_RUNTIME_STATUS_METHOD_ID,
        requestBytesBase64: '',
      }, input.appId),
      timeoutMs: ELECTRON_RUNTIME_STATUS_TIMEOUT_MS,
    });
    return {
      running: true,
      managed: false,
      launchMode: 'RUNTIME',
      grpcAddr: input.runtimeEndpoint,
      version: response.responseMetadata?.['x-nimi-runtime-version'],
    };
  } catch (error) {
    return electronRuntimeUnavailableStatus(input.runtimeEndpoint, error);
  }
}

function electronRuntimeUnavailableStatus(runtimeEndpoint: string, error: unknown): Record<string, unknown> {
  return {
    running: false,
    managed: false,
    launchMode: 'RUNTIME',
    grpcAddr: runtimeEndpoint,
    lastError: errorMessage(error),
    actionHint: 'start_external_runtime_daemon',
  };
}

async function createDefaultRuntimeGrpcBridgeClient(endpoint: string): Promise<RuntimeGrpcBridgeClient> {
  const grpc = await import('@grpc/grpc-js');
  const client = new grpc.Client(endpoint, grpc.credentials.createInsecure());
  return {
    unary: (request) => invokeRawGrpcUnary(grpc, client, request),
    serverStream: (request) => createRawGrpcServerStream(grpc, client, request),
    close: () => client.close(),
  };
}

function invokeRawGrpcUnary(
  grpc: typeof import('@grpc/grpc-js'),
  client: import('@grpc/grpc-js').Client,
  request: RuntimeGrpcBridgeUnaryRequest,
): Promise<RuntimeGrpcBridgeUnaryResponse> {
  return new Promise((resolve, reject) => {
    let responseMetadata: Record<string, string> = {};
    const call = client.makeUnaryRequest(
      request.methodId,
      identityBuffer,
      identityBuffer,
      Buffer.from(request.requestBytes),
      toGrpcMetadata(grpc, request.metadata),
      toGrpcCallOptions(request.timeoutMs),
      (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({
          responseBytes: Uint8Array.from(response ?? Buffer.alloc(0)),
          responseMetadata,
        });
      },
    );
    call.on('metadata', (metadata) => {
      responseMetadata = {
        ...responseMetadata,
        ...fromGrpcMetadata(metadata),
      };
    });
    call.on('status', (status) => {
      responseMetadata = {
        ...responseMetadata,
        ...fromGrpcMetadata(status.metadata),
      };
    });
  });
}

function createRawGrpcServerStream(
  grpc: typeof import('@grpc/grpc-js'),
  client: import('@grpc/grpc-js').Client,
  request: RuntimeGrpcBridgeStreamRequest,
): RuntimeGrpcBridgeStream {
  let call: import('@grpc/grpc-js').ClientReadableStream<Buffer> | undefined;
  return {
    start: ({ onData, onError, onEnd }) => {
      call = client.makeServerStreamRequest(
        request.methodId,
        identityBuffer,
        identityBuffer,
        Buffer.from(request.requestBytes),
        toGrpcMetadata(grpc, request.metadata),
        toGrpcCallOptions(request.timeoutMs),
      );
      call.on('data', (bytes) => onData(Uint8Array.from(bytes)));
      call.on('error', onError);
      call.on('end', onEnd);
    },
    cancel: () => {
      call?.cancel();
    },
  };
}

const RESERVED_METADATA_KEYS = new Set([
  'authorization',
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
  'x-nimi-access-token-id',
  'x-nimi-access-token-secret',
  'x-nimi-session-id',
  'x-nimi-session-token',
]);

function normalizeRequiredToken(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new NimiElectronShellHostError({
      code: 'NIMI_ELECTRON_HOST_OPTION_REQUIRED',
      message: `${field} is required`,
      actionHint: 'provide_required_electron_shell_host_option',
      details: { field },
    });
  }
  return normalized;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function asRecord(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NimiElectronShellHostError({
      code: 'NIMI_ELECTRON_RUNTIME_BRIDGE_INVALID',
      message,
      actionHint: 'send_structured_runtime_bridge_payload',
      details: { valueType: typeof value },
    });
  }
  return value as Readonly<Record<string, unknown>>;
}

function resolveElectronRendererOrigin(event: NimiElectronIpcMainInvokeEvent): string {
  const explicitOrigin = normalizeText(event.senderFrame?.origin);
  if (explicitOrigin) {
    return explicitOrigin;
  }
  const url = normalizeText(event.senderFrame?.url);
  if (!url) {
    return '';
  }
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function normalizeRendererUrlForComparison(value: unknown): string {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  try {
    const url = new URL(text);
    url.hash = '';
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/') {
      url.search = '';
    }
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeGrpcMethodId(value: unknown): string {
  const methodId = normalizeRequiredToken(value, 'methodId');
  if (!methodId.startsWith('/')) {
    throw new NimiElectronShellHostError({
      code: 'NIMI_ELECTRON_RUNTIME_BRIDGE_INVALID',
      message: `Runtime gRPC method id must be absolute: ${methodId}`,
      actionHint: 'use_generated_runtime_method_id',
      details: { methodId },
    });
  }
  return methodId;
}

function normalizeBase64Text(value: unknown, field: string): string {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  if (!BASE64_PATTERN.test(text)) {
    throw new NimiElectronShellHostError({
      code: 'NIMI_ELECTRON_RUNTIME_BRIDGE_INVALID',
      message: `${field} must be base64`,
      actionHint: 'encode_runtime_bridge_bytes_as_base64',
      details: { field },
    });
  }
  return text;
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

function toBase64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function parseOptionalPositiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : undefined;
}

function parseRuntimeBridgeMetadata(value: unknown): ElectronRuntimeBridgeMetadata | undefined {
  if (value == null) {
    return undefined;
  }
  const record = asRecord(value, 'Electron Runtime bridge metadata must be an object');
  assertNoRendererSensitiveMetadata(record);
  const extraRecord = record.extra == null
    ? undefined
    : asRecord(record.extra, 'Electron Runtime bridge metadata extra must be an object');
  return {
    protocolVersion: normalizeText(record.protocolVersion) || undefined,
    participantProtocolVersion: normalizeText(record.participantProtocolVersion) || undefined,
    domain: normalizeText(record.domain) || undefined,
    traceId: normalizeText(record.traceId) || undefined,
    idempotencyKey: normalizeText(record.idempotencyKey) || undefined,
    surfaceId: normalizeText(record.surfaceId) || undefined,
    keySource: normalizeText(record.keySource) || undefined,
    providerType: normalizeText(record.providerType) || undefined,
    clientId: normalizeText(record.clientId) || undefined,
    providerEndpoint: normalizeText(record.providerEndpoint) || undefined,
    extra: extraRecord ? normalizeMetadataExtra(extraRecord) : undefined,
  };
}

function normalizeMetadataExtra(record: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  assertNoRendererSensitiveMetadataExtra(record);
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const normalizedValue = normalizeText(value);
    if (normalizedValue) {
      extra[key] = normalizedValue;
    }
  }
  return extra;
}

function parseProtectedAccessToken(value: unknown): ElectronRuntimeBridgeProtectedAccessToken | undefined {
  if (value == null) {
    return undefined;
  }
  const record = asRecord(value, 'Electron Runtime bridge protected access token must be an object');
  const tokenId = normalizeText(record.tokenId);
  const secret = normalizeText(record.secret);
  return tokenId && secret ? { tokenId, secret } : undefined;
}

function parseAppSession(value: unknown): ElectronRuntimeBridgeAppSession | undefined {
  if (value == null) {
    return undefined;
  }
  const record = asRecord(value, 'Electron Runtime bridge app session must be an object');
  const sessionId = normalizeText(record.sessionId);
  const sessionToken = normalizeText(record.sessionToken);
  return sessionId && sessionToken ? { sessionId, sessionToken } : undefined;
}

function addMetadata(target: Record<string, string>, key: string, value: unknown): void {
  const normalized = normalizeText(value);
  if (normalized) {
    target[key] = normalized;
  }
}

function assertNoRendererSensitiveRuntimeBridgePayload(payload: Readonly<Record<string, unknown>>): void {
  for (const key of ['authorization', 'protectedAccessToken', 'appSession']) {
    if (payload[key] !== undefined && payload[key] !== null) {
      throw new NimiElectronShellHostError({
        code: 'NIMI_ELECTRON_RUNTIME_BRIDGE_INVALID',
        message: `Electron Runtime bridge renderer payload cannot provide sensitive field: ${key}`,
        actionHint: 'provide_sensitive_runtime_metadata_from_electron_host',
        details: { field: key },
      });
    }
  }
}

function assertNoRendererSensitiveMetadata(record: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(record)) {
    if (key === 'extra') {
      continue;
    }
    assertRendererMetadataKeyAllowed(key);
  }
}

function assertNoRendererSensitiveMetadataExtra(record: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(record)) {
    assertRendererMetadataKeyAllowed(key);
  }
}

function assertRendererMetadataKeyAllowed(key: string): void {
  const normalized = key.toLowerCase().replace(/[-_]/gu, '');
  const forbiddenKind = rendererForbiddenMetadataKind(normalized);
  if (!forbiddenKind) {
    return;
  }
  throw new NimiElectronShellHostError({
    code: 'NIMI_ELECTRON_RUNTIME_BRIDGE_INVALID',
    message: `Electron Runtime bridge renderer metadata cannot provide host-owned ${forbiddenKind} field: ${key}`,
    actionHint: forbiddenKind === 'identity'
      ? 'provide_identity_metadata_from_electron_host'
      : 'provide_sensitive_runtime_metadata_from_electron_host',
    details: { field: key },
  });
}

function identityBuffer(value: Buffer): Buffer {
  return value;
}

function toGrpcMetadata(
  grpc: typeof import('@grpc/grpc-js'),
  values: Readonly<Record<string, string>>,
): import('@grpc/grpc-js').Metadata {
  const metadata = new grpc.Metadata();
  for (const [key, value] of Object.entries(values)) {
    metadata.set(key, value);
  }
  return metadata;
}

function fromGrpcMetadata(metadata: import('@grpc/grpc-js').Metadata | undefined): Record<string, string> {
  if (!metadata) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata.getMap())) {
    if (typeof value === 'string') {
      out[key] = value;
    } else if (Buffer.isBuffer(value)) {
      out[key] = value.toString('base64');
    }
  }
  return out;
}

function toGrpcCallOptions(timeoutMs: number | undefined): import('@grpc/grpc-js').CallOptions {
  return timeoutMs ? { deadline: new Date(Date.now() + timeoutMs) } : {};
}

function toElectronRuntimeBridgeError(error: unknown): Record<string, unknown> {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return {
      message: normalizeText(record.message) || 'Runtime stream failed',
      reasonCode: normalizeText(record.reasonCode ?? record.code) || 'RUNTIME_CALL_FAILED',
      actionHint: normalizeText(record.actionHint) || 'check_runtime_daemon',
      traceId: normalizeText(record.traceId) || undefined,
      retryable: typeof record.retryable === 'boolean' ? record.retryable : undefined,
    };
  }
  return {
    message: normalizeText(error) || 'Runtime stream failed',
    reasonCode: 'RUNTIME_CALL_FAILED',
    actionHint: 'check_runtime_daemon',
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : normalizeText(error) || 'unknown error';
}

function rendererForbiddenMetadataKind(key: string): 'auth' | 'identity' | undefined {
  if (RENDERER_FORBIDDEN_IDENTITY_METADATA_KEYS.has(key)) {
    return 'identity';
  }
  if (
    RENDERER_FORBIDDEN_AUTH_METADATA_KEYS.has(key)
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

const ELECTRON_RUNTIME_STATUS_METHOD_ID = '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth';
const ELECTRON_RUNTIME_STATUS_TIMEOUT_MS = 1_000;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const RENDERER_FORBIDDEN_IDENTITY_METADATA_KEYS = new Set([
  'appid',
  'participantid',
  'callerkind',
  'callerid',
  'xnimiappid',
  'xnimiparticipantid',
  'xnimicallerkind',
  'xnimicallerid',
]);
const RENDERER_FORBIDDEN_AUTH_METADATA_KEYS = new Set([
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
