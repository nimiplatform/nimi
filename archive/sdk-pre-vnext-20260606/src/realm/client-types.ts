import type { NimiError } from '../types/index.js';
import type { JsonObject } from '../internal/utils.js';
import type {
  RealmGeneratedServiceRegistry,
  RealmRawRequestInput,
} from './generated/service-registry.js';

export type RealmConnectionState = {
  status: 'idle' | 'connecting' | 'ready' | 'closing' | 'closed';
  connectedAt?: string;
  lastReadyAt?: string;
};

export type RealmTelemetryEvent = {
  name: string;
  at: string;
  data?: JsonObject;
};

export type RealmRequestSuccessEvent = {
  method: string;
  path: string;
  at: string;
  httpStatus?: number;
};

export type RealmEventPayloadMap = {
  error: { error: NimiError; at: string };
  'request.success': RealmRequestSuccessEvent;
};

export type RealmTokenRefreshResult = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
};

export type RealmFetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RealmAuthCustodyMode = 'runtime_account' | 'external_principal';

export type RealmAuthOptions = {
  mode: RealmAuthCustodyMode;
  accessToken?: string | (() => Promise<string> | string);
  refreshToken?: string | (() => Promise<string> | string);
  onTokenRefreshed?: (result: RealmTokenRefreshResult) => void;
  onRefreshFailed?: (error: unknown) => void;
};

export type RealmRetryOptions = {
  maxRetries?: number;
  retryableStatuses?: number[];
  backoffMs?: number;
  maxBackoffMs?: number;
};

export type RealmOptions = {
  baseUrl: string;
  auth?: RealmAuthOptions | null;
  headers?: Record<string, string> | (() => Promise<Record<string, string>> | Record<string, string>);
  retry?: RealmRetryOptions;
  timeoutMs?: number;
  fetchImpl?: RealmFetchImpl;
  telemetry?: {
    enabled?: boolean;
    onEvent?: (event: RealmTelemetryEvent) => void;
  };
};

export type RealmResponseParser<T> = (value: unknown) => T;

export type RealmUnsafeRawModule = {
  /**
   * Unsafe escape hatch. Prefer generated `realm.services.*` methods so request and response
   * contracts stay bound to the published OpenAPI schema.
   */
  request(input: RealmRawRequestInput): Promise<unknown>;
  request<T>(input: RealmRawRequestInput & { parseResponse: RealmResponseParser<T> }): Promise<T>;
};

export type RealmServiceRegistry = RealmGeneratedServiceRegistry;

export type RealmEventsModule = {
  on<Name extends keyof RealmEventPayloadMap & string>(
    name: Name,
    handler: (event: RealmEventPayloadMap[Name]) => void,
  ): () => void;
  once<Name extends keyof RealmEventPayloadMap & string>(
    name: Name,
    handler: (event: RealmEventPayloadMap[Name]) => void,
  ): () => void;
};
