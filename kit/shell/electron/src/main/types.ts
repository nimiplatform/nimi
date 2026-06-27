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
