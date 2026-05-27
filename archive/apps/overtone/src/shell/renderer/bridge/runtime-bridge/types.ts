export interface RuntimeBridgeMetadata {
  protocolVersion?: string;
  participantProtocolVersion?: string;
  participantId?: string;
  domain?: string;
  appId?: string;
  traceId?: string;
  idempotencyKey?: string;
  callerKind?: string;
  callerId?: string;
  surfaceId?: string;
  keySource?: string;
  providerEndpoint?: string;
  providerApiKey?: string;
  extra?: Record<string, string>;
}

export interface RuntimeBridgeUnaryPayload {
  methodId: string;
  requestBytesBase64: string;
  metadata?: RuntimeBridgeMetadata;
  authorization?: string;
  timeoutMs?: number;
}

export interface RuntimeBridgeUnaryResult {
  responseBytesBase64: string;
  responseMetadata?: Record<string, string>;
}

export interface RuntimeBridgeStreamOpenPayload {
  methodId: string;
  requestBytesBase64: string;
  metadata?: RuntimeBridgeMetadata;
  authorization?: string;
  timeoutMs?: number;
  eventNamespace?: string;
}

export interface RuntimeBridgeStreamOpenResult {
  streamId: string;
}

export interface RuntimeBridgeDaemonStatus {
  running: boolean;
  managed: boolean;
  launchMode: string;
  grpcAddr: string;
  pid?: number;
  lastError?: string;
  debugLogPath?: string;
}

export interface RuntimeBridgeStreamEvent {
  streamId: string;
  eventType: 'next' | 'error' | 'completed';
  payloadBytesBase64?: string;
  error?: {
    reasonCode: string;
    actionHint: string;
    traceId: string;
    retryable: boolean;
    message: string;
  };
}

export interface RuntimeBridgeErrorPayload {
  reasonCode: string;
  actionHint: string;
  traceId: string;
  retryable: boolean;
  message: string;
}
