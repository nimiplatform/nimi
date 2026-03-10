import type { NimiError } from '../types/index.js';
import type { RuntimeClient } from './types-client-interfaces.js';

export type * from './types-media.js';
export type * from './types-client-interfaces.js';
export type * from './types-runtime-modules.js';

export type RuntimeCallerKind =
  | 'desktop-core'
  | 'desktop-mod'
  | 'third-party-app'
  | 'third-party-service';

export type RuntimeMetadata = {
  protocolVersion?: string;
  participantProtocolVersion?: string;
  participantId?: string;
  domain?: string;
  appId?: string;
  traceId?: string;
  idempotencyKey?: string;
  callerKind?: RuntimeCallerKind;
  callerId?: string;
  surfaceId?: string;
  keySource?: 'inline' | 'managed';
  providerType?: string;
  clientId?: string;
  providerEndpoint?: string;
  providerApiKey?: string;
  extra?: Record<string, string>;
};

export type RuntimeResponseMetadataObserver = (metadata: Record<string, string>) => void;

export type RuntimeCallOptions = {
  metadata?: RuntimeMetadata;
  timeoutMs?: number;
  idempotencyKey?: string;
  /** @internal Side-channel for unary response metadata extraction. */
  _responseMetadataObserver?: RuntimeResponseMetadataObserver;
};

export type RuntimeStreamCallOptions = RuntimeCallOptions & {
  signal?: AbortSignal;
};

export type RuntimeNodeGrpcTransportConfig = {
  type: 'node-grpc';
  endpoint: string;
  tls?: {
    enabled: boolean;
    serverName?: string;
    rootCertPem?: string;
  };
  /** @internal Side-channel for response metadata extraction (e.g. x-nimi-runtime-version). */
  _responseMetadataObserver?: RuntimeResponseMetadataObserver;
};

export type RuntimeTauriIpcTransportConfig = {
  type: 'tauri-ipc';
  commandNamespace?: string;
  eventNamespace?: string;
  /** @internal Side-channel for response metadata extraction (e.g. x-nimi-runtime-version). */
  _responseMetadataObserver?: RuntimeResponseMetadataObserver;
};

export type RuntimeTransportConfig = RuntimeNodeGrpcTransportConfig | RuntimeTauriIpcTransportConfig;

export type RuntimeClientDefaults = {
  protocolVersion?: string;
  participantProtocolVersion?: string;
  participantId?: string;
  callerKind?: RuntimeCallerKind;
  callerId?: string;
  surfaceId?: string;
};

export type RuntimeClientConfig = {
  appId: string;
  transport: RuntimeTransportConfig;
  defaults?: RuntimeClientDefaults;
  auth?: RuntimeAuthProvider;
};

export type RuntimeWireMessage = Uint8Array;

export type RuntimeUnaryCall<Request = RuntimeWireMessage> = {
  methodId: string;
  request: Request;
  metadata: RuntimeMetadata;
  authorization?: string;
  timeoutMs?: number;
  /** @internal Side-channel for unary response metadata extraction. */
  _responseMetadataObserver?: RuntimeResponseMetadataObserver;
};

export type RuntimeOpenStreamCall<Request = RuntimeWireMessage> = {
  methodId: string;
  request: Request;
  metadata: RuntimeMetadata;
  authorization?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type RuntimeStreamCloseCall = {
  streamId: string;
};

export type RuntimeTransport = {
  invokeUnary(input: RuntimeUnaryCall<RuntimeWireMessage>): Promise<RuntimeWireMessage>;
  openStream(input: RuntimeOpenStreamCall<RuntimeWireMessage>): Promise<AsyncIterable<RuntimeWireMessage>>;
  closeStream(input: RuntimeStreamCloseCall): Promise<void>;
};

export type RuntimeClientFactory = {
  create(config: RuntimeClientConfig): RuntimeClient;
};

export type RuntimeCallResult<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  error: NimiError;
};

export type RuntimeConnectionMode = 'auto';

export type RuntimeConnectionState = {
  status: 'idle' | 'connecting' | 'ready' | 'closing' | 'closed';
  connectedAt?: string;
  lastReadyAt?: string;
};

export type RuntimeHealth = {
  status: 'healthy' | 'degraded' | 'unavailable';
  reason?: string;
  queueDepth?: number;
  activeWorkflows?: number;
  activeInferenceJobs?: number;
  cpuMilli?: string;
  memoryBytes?: string;
  vramBytes?: string;
  sampledAt?: string;
};

export type RuntimeTelemetryEvent = {
  name: string;
  at: string;
  data?: Record<string, unknown>;
};

export type RuntimeAuthProvider = {
  accessToken?: string | (() => string | Promise<string>);
};

export type RuntimeSubjectContextProvider = {
  subjectUserId?: string;
  getSubjectUserId?: () => string | Promise<string>;
};

export type RuntimeOptions = {
  appId?: string;
  connection?: {
    mode?: RuntimeConnectionMode;
    waitForReadyTimeoutMs?: number;
  };
  transport?: RuntimeTransportConfig;
  defaults?: RuntimeClientDefaults;
  auth?: RuntimeAuthProvider;
  timeoutMs?: number;
  retry?: {
    maxAttempts?: number;
    backoffMs?: number;
  };
  subjectContext?: RuntimeSubjectContextProvider;
  telemetry?: {
    enabled?: boolean;
    onEvent?: (event: RuntimeTelemetryEvent) => void;
  };
};

export type RuntimeAuthMaterial = {
  grantToken: string;
  grantVersion: string;
};

export type RuntimeEventName =
  | 'runtime.connected'
  | 'runtime.disconnected'
  | 'auth.token.issued'
  | 'auth.token.revoked'
  | 'error';

export type RuntimeEventPayloadMap = {
  'runtime.connected': { at: string };
  'runtime.disconnected': { at: string; reasonCode?: string };
  'auth.token.issued': { tokenId: string; at: string };
  'auth.token.revoked': { tokenId: string; at: string };
  error: { error: NimiError; at: string };
};

export type RuntimeEventsModule = {
  on<Name extends RuntimeEventName>(
    name: Name,
    handler: (event: RuntimeEventPayloadMap[Name]) => void,
  ): () => void;
  once<Name extends RuntimeEventName>(
    name: Name,
    handler: (event: RuntimeEventPayloadMap[Name]) => void,
  ): () => void;
};

export type RuntimeRawModule = {
  call<TReq, TRes>(
    methodId: string,
    input: TReq,
    options?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ): Promise<TRes>;
  closeStream(streamId: string): Promise<void>;
};

export type RuntimeMethod<TReq, TRes> = {
  methodId: string;
  kind?: 'unary' | 'stream';
};
