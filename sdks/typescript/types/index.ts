export type CoreMethodKind = 'unary' | 'server_stream' | 'client_stream' | 'bidi_stream';

export interface CoreMetadata {
  readonly [key: string]: string;
}

export interface CoreResponseMetadata {
  readonly [key: string]: string;
}

export type CoreResponseMetadataObserver = (metadata: CoreResponseMetadata) => void;

export interface CoreUnaryRequest<Body = unknown> {
  readonly methodId: string;
  readonly metadata?: CoreMetadata;
  readonly body: Body;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly responseMetadataObserver?: CoreResponseMetadataObserver;
}

export interface CoreStreamRequest<Body = unknown> {
  readonly methodId: string;
  readonly metadata?: CoreMetadata;
  readonly body: Body;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly responseMetadataObserver?: CoreResponseMetadataObserver;
}

export interface CoreErrorShape {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
} from './json';
export {
  isJsonObject,
  asJsonObject,
  parseJsonObjectResponse,
  tryParseJsonLike,
} from './json';
export {
  createNimiClientId,
  createNimiUlid,
} from './ids';
export {
  getRetryDelayMs,
  normalizeApiError,
  requestWithRetry,
} from './network-retry';
export type {
  RetryEvent,
  RetryOptions,
  RetryReasonKind,
} from './network-retry';
export * from './errors';
export {
  ReasonCode,
  classifyOfflineReasonCode,
  isRealmOfflineReasonCode,
  isRetryableReasonCode,
  isRuntimeOfflineReasonCode,
} from './reason-code';
export type {
  NimiErrorCode,
  OfflineReasonCodeOwner,
  ReasonCodeValue,
} from './reason-code';
export {
  classifyOfflineError,
  getNimiErrorMessage,
  isRealmOfflineErrorLike,
  isRuntimeOfflineErrorLike,
} from './offline';
export type { OfflineErrorClassificationOptions } from './offline';
