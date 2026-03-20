import createClient from 'openapi-fetch';
import { createEventBus } from '../internal/event-bus.js';
import type { JsonObject } from '../internal/utils.js';
import { ReasonCode } from '../types/index.js';
import { createNimiError } from '../runtime/errors.js';
import type { NimiError } from '../types/index.js';
import type { paths } from './generated/schema.js';
import {
  createRealmServiceRegistry,
  type RealmRawRequestInput,
} from './generated/service-registry.js';
import type {
  RealmAuthOptions,
  RealmConnectionState,
  RealmEventsModule,
  RealmOptions,
  RealmRetryOptions,
  RealmServiceRegistry,
  RealmTokenRefreshResult,
  RealmUnsafeRawModule,
} from './client-types.js';
import {
  DEFAULT_REALM_TIMEOUT_MS,
  asRecord,
  extractResponseReasonCode,
  hasValue,
  isResponse,
  mapRealmError,
  normalizeText,
  nowIso,
  readErrorBody,
  resolveBaseUrl,
} from './client-helpers.js';

type RealmEventPayloadMap = {
  error: { error: NimiError; at: string };
};

type OpenApiClient = ReturnType<typeof createClient<paths>>;

const DEFAULT_RETRY_STATUSES = [429, 502, 503, 504];
const DEFAULT_RETRY_MAX_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS = 1000;
const DEFAULT_RETRY_MAX_BACKOFF_MS = 10000;

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function encodePathValue(value: string | number): string {
  return encodeURIComponent(String(value));
}

export class Realm {
  readonly services: RealmServiceRegistry;

  readonly events: RealmEventsModule;

  readonly unsafeRaw: RealmUnsafeRawModule;

  readonly baseUrl: string;

  #state: RealmConnectionState = {
    status: 'idle',
  };

  #refreshPromise: Promise<RealmTokenRefreshResult> | null = null;

  readonly #options: RealmOptions;

  readonly #eventBus = createEventBus<RealmEventPayloadMap>();

  readonly #openapiClient: OpenApiClient;

  constructor(options: RealmOptions) {
    this.baseUrl = resolveBaseUrl(options.baseUrl);
    const authProvided = hasOwn(options, 'auth');
    const unauthenticated = authProvided && (options.auth == null || options.auth.accessToken == null);
    if (!authProvided || (!unauthenticated && !options.auth?.accessToken)) {
      throw createNimiError({
        message: 'realm token is required (set auth explicitly to null or undefined for unauthenticated access)',
        reasonCode: ReasonCode.SDK_REALM_TOKEN_REQUIRED,
        actionHint: 'set_realm_auth_access_token',
        source: 'sdk',
      });
    }
    this.#options = options;

    this.#openapiClient = createClient<paths>({
      baseUrl: this.baseUrl,
      fetch: options.fetchImpl || globalThis.fetch.bind(globalThis),
    });

    this.services = createRealmServiceRegistry(async (input) => this.#requestUnknown(input)) as RealmServiceRegistry;

    this.events = {
      on: (name, handler) => this.#eventBus.on(name, handler),
      once: (name, handler) => this.#eventBus.once(name, handler),
    };

    const unsafeRaw: RealmUnsafeRawModule = {
      request: async <T = unknown>(input: RealmRawRequestInput): Promise<T> => {
        const value = await this.#requestUnknown(input);
        return value as T;
      },
    };
    this.unsafeRaw = unsafeRaw;
  }

  async connect(): Promise<void> {
    if (this.#state.status === 'ready') {
      return;
    }

    this.#state = {
      ...this.#state,
      status: 'connecting',
    };

    this.#state = {
      ...this.#state,
      status: 'ready',
      connectedAt: nowIso(),
    };
    this.#emitTelemetry('realm.connected', { baseUrl: this.baseUrl });
  }

  async ready(input?: { timeoutMs?: number }): Promise<void> {
    await this.connect();

    const timeoutMs = Number(input?.timeoutMs || this.#options.timeoutMs || DEFAULT_REALM_TIMEOUT_MS)
      || DEFAULT_REALM_TIMEOUT_MS;

    await this.#requestUnknown({
      method: 'GET',
      path: '/',
      timeoutMs,
    });

    this.#state = {
      ...this.#state,
      status: 'ready',
      lastReadyAt: nowIso(),
    };
  }

  async close(): Promise<void> {
    if (this.#state.status === 'closed') {
      return;
    }

    this.#state = {
      ...this.#state,
      status: 'closing',
    };

    this.#state = {
      ...this.#state,
      status: 'closed',
    };
    this.#emitTelemetry('realm.disconnected', { baseUrl: this.baseUrl });
  }

  state(): RealmConnectionState {
    return { ...this.#state };
  }

  updateAuth(patch: Partial<RealmAuthOptions>): void {
    if (!this.#options.auth) {
      this.#options.auth = { ...patch };
      return;
    }
    Object.assign(this.#options.auth, patch);
  }

  clearAuth(): void {
    this.#options.auth = undefined;
  }

  static async refreshAccessToken(input: {
    realmBaseUrl: string;
    refreshToken: string;
    fetchImpl?: typeof fetch;
  }): Promise<RealmTokenRefreshResult> {
    const baseUrl = resolveBaseUrl(input.realmBaseUrl);
    const refreshToken = normalizeText(input.refreshToken);
    if (!refreshToken) {
      throw createNimiError({
        message: 'realm refresh token is required',
        reasonCode: ReasonCode.SDK_REALM_TOKEN_REQUIRED,
        actionHint: 'set_realm_refresh_token',
        source: 'sdk',
      });
    }

    const fetchFn = input.fetchImpl || globalThis.fetch.bind(globalThis);
    const response = await fetchFn(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      throw createNimiError({
        message: `realm refresh failed: ${response.status}`,
        reasonCode: ReasonCode.REALM_UNAVAILABLE,
        actionHint: 'check_realm_refresh_token',
        source: 'realm',
        details: {
          httpStatus: response.status,
        },
      });
    }

    const payload = asRecord(await response.json());
    const tokens = asRecord(payload.tokens);
    const accessToken = normalizeText(tokens.accessToken || payload.accessToken);
    if (!accessToken) {
      throw createNimiError({
        message: 'realm refresh response missing accessToken',
        reasonCode: ReasonCode.REALM_UNAVAILABLE,
        actionHint: 'check_realm_refresh_response',
        source: 'realm',
      });
    }
    const nextRefreshToken = normalizeText(tokens.refreshToken || payload.refreshToken);
    const expiresIn = Number(tokens.expiresIn || payload.expiresIn || 0) || undefined;
    return {
      accessToken,
      refreshToken: nextRefreshToken || undefined,
      expiresIn,
    };
  }

  async #requestUnknown(input: RealmRawRequestInput): Promise<unknown> {
    if (this.#state.status === 'idle') {
      await this.connect();
    }

    let path = normalizeText(input.path);
    if (!path) {
      throw createNimiError({
        message: 'realm path is required',
        reasonCode: ReasonCode.ACTION_INPUT_INVALID,
        actionHint: 'set_realm_request_path',
        source: 'sdk',
      });
    }
    if (input.pathParams) {
      for (const [key, value] of Object.entries(input.pathParams)) {
        const placeholder = `{${key}}`;
        if (!path.includes(placeholder)) {
          continue;
        }
        path = path.replaceAll(placeholder, encodePathValue(value));
      }
    }

    const timeoutMs = Number(input.timeoutMs || this.#options.timeoutMs || DEFAULT_REALM_TIMEOUT_MS)
      || DEFAULT_REALM_TIMEOUT_MS;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutController = timeoutMs > 0 ? new AbortController() : undefined;
    const requestAbortController = new AbortController();
    let timeoutTriggered = false;
    let externalAbortTriggered = false;
    let refreshAttempted = false;
    let retryAttempt = 0;

    const onTimeoutAbort = () => {
      timeoutTriggered = true;
      if (!requestAbortController.signal.aborted) {
        requestAbortController.abort();
      }
    };
    const onExternalAbort = () => {
      externalAbortTriggered = true;
      if (!requestAbortController.signal.aborted) {
        requestAbortController.abort();
      }
    };

    try {
      if (timeoutController) {
        timeoutController.signal.addEventListener('abort', onTimeoutAbort, { once: true });
        timer = setTimeout(() => {
          timeoutController.abort();
        }, timeoutMs);
      }
      if (input.signal) {
        if (input.signal.aborted) {
          onExternalAbort();
        } else {
          input.signal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }

      const methodName = normalizeText(input.method).toUpperCase();
      const method = (this.#openapiClient as unknown as Record<string, unknown>)[methodName]
        || (this.#openapiClient as unknown as Record<string, unknown>)[methodName.toLowerCase()];

      if (typeof method !== 'function') {
        throw createNimiError({
          message: `unsupported realm HTTP method: ${methodName}`,
          reasonCode: ReasonCode.ACTION_INPUT_INVALID,
          actionHint: 'check_realm_request_method',
          source: 'sdk',
        });
      }
      while (true) {
        const headers = await this.#resolveHeaders(input.headers);
        try {
          const responseTuple = await (method as (url: string, options?: Record<string, unknown>) => Promise<unknown>)(
            path,
            {
              params: input.query ? { query: input.query } : undefined,
              body: input.body,
              headers,
              signal: requestAbortController.signal,
            },
          );

          const responseTupleRecord = asRecord(responseTuple);
          const response = responseTupleRecord.response;
          const errorPayload = responseTupleRecord.error;
          const dataPayload = responseTupleRecord.data;

          if (isResponse(response)) {
            if (!response.ok) {
              if (!refreshAttempted && response.status === 401 && this.#options.auth?.refreshToken) {
                try {
                  const refreshResult = await this.#attemptRefresh();
                  refreshAttempted = true;
                  if (this.#options.auth) {
                    if (typeof this.#options.auth.accessToken !== 'function') {
                      this.#options.auth.accessToken = refreshResult.accessToken;
                    }
                    if (refreshResult.refreshToken && typeof this.#options.auth.refreshToken !== 'function') {
                      this.#options.auth.refreshToken = refreshResult.refreshToken;
                    }
                  }
                  try {
                    this.#options.auth?.onTokenRefreshed?.(refreshResult);
                  } catch { /* observer callback must not break retry */ }
                  this.#emitTelemetry('realm.token_refreshed');
                  continue;
                } catch (refreshError) {
                  try {
                    this.#options.auth?.onRefreshFailed?.(refreshError);
                  } catch { /* observer callback must not break error flow */ }
                }
              }

              const retryDelayMs = this.#resolveRetryDelay(response, retryAttempt);
              if (retryDelayMs !== null) {
                retryAttempt += 1;
                await this.#sleep(retryDelayMs, requestAbortController.signal);
                continue;
              }

              const bodyRecord = await readErrorBody(errorPayload);
              const mapped = extractResponseReasonCode(bodyRecord, response);
              throw createNimiError({
                message: mapped.message,
                code: mapped.code,
                reasonCode: mapped.reasonCode,
                actionHint: mapped.actionHint,
                traceId: mapped.traceId || undefined,
                retryable: mapped.retryable,
                source: 'realm',
                details: mapped.details,
              });
            }

            if (hasValue(dataPayload)) {
              return dataPayload;
            }

            if (response.status === 204) {
              return undefined;
            }

            const contentType = normalizeText(response.headers.get('content-type')).toLowerCase();
            if (contentType.includes('application/json')) {
              return await response.json();
            }
            return await response.text();
          }

          if (hasValue(errorPayload)) {
            throw errorPayload;
          }

          if (hasValue(dataPayload)) {
            return dataPayload;
          }

          return responseTuple;
        } catch (requestError) {
          throw requestError;
        }
      }
    } catch (error) {
      const mapped = timeoutTriggered
        ? createNimiError({
          message: `realm request timeout after ${timeoutMs}ms`,
          code: ReasonCode.REALM_UNAVAILABLE,
          reasonCode: ReasonCode.REALM_UNAVAILABLE,
          actionHint: 'retry_after_backoff',
          source: 'realm',
          retryable: true,
          details: { timeoutMs },
        })
        : externalAbortTriggered
          ? createNimiError({
            message: normalizeText(asRecord(error).message) || 'realm request aborted',
            code: ReasonCode.OPERATION_ABORTED,
            reasonCode: ReasonCode.OPERATION_ABORTED,
            actionHint: 'retry_if_needed',
            source: 'realm',
            retryable: false,
          })
          : mapRealmError(error);
      this.#eventBus.emit('error', {
        error: mapped,
        at: nowIso(),
      });
      this.#emitTelemetry('realm.error', {
        reasonCode: mapped.reasonCode,
        actionHint: mapped.actionHint,
        traceId: mapped.traceId,
      });
      throw mapped;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      if (timeoutController) {
        timeoutController.signal.removeEventListener('abort', onTimeoutAbort);
      }
      if (input.signal) {
        input.signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  async #resolveAccessToken(): Promise<string> {
    if (this.#options.auth == null) {
      return '';
    }
    const accessToken = this.#options.auth?.accessToken;
    let resolved: string;
    if (typeof accessToken === 'function') {
      resolved = normalizeText(await accessToken());
    } else {
      resolved = normalizeText(accessToken);
    }
    return resolved;
  }

  async #resolveRefreshToken(): Promise<string> {
    const refreshToken = this.#options.auth?.refreshToken;
    if (typeof refreshToken === 'function') {
      return normalizeText(await refreshToken());
    }
    return normalizeText(refreshToken);
  }

  async #doRefresh(): Promise<RealmTokenRefreshResult> {
    const refreshToken = await this.#resolveRefreshToken();
    if (!refreshToken) {
      throw createNimiError({
        message: 'refresh token is not available',
        reasonCode: ReasonCode.AUTH_DENIED,
        actionHint: 'reauthenticate',
        source: 'sdk',
      });
    }

    const fetchFn = this.#options.fetchImpl || globalThis.fetch.bind(globalThis);
    const response = await fetchFn(`${this.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      const body = await readErrorBody(
        await response.text().catch(() => ''),
      );
      const mapped = extractResponseReasonCode(body, response);
      throw createNimiError({
        message: mapped.message || 'token refresh failed',
        code: mapped.code,
        reasonCode: mapped.reasonCode,
        actionHint: mapped.actionHint,
        traceId: mapped.traceId || undefined,
        source: 'realm',
        details: mapped.details,
      });
    }

    const data = asRecord(await response.json());
    const tokens = asRecord(data.tokens || data);
    const accessToken = normalizeText(tokens.accessToken);
    if (!accessToken) {
      throw createNimiError({
        message: 'refresh response missing accessToken',
        reasonCode: ReasonCode.AUTH_DENIED,
        actionHint: 'reauthenticate',
        source: 'realm',
      });
    }

    return {
      accessToken,
      refreshToken: normalizeText(tokens.refreshToken) || undefined,
      expiresIn: typeof tokens.expiresIn === 'number' ? tokens.expiresIn : undefined,
    };
  }

  async #attemptRefresh(): Promise<RealmTokenRefreshResult> {
    if (this.#refreshPromise) {
      return this.#refreshPromise;
    }
    this.#refreshPromise = this.#doRefresh().finally(() => {
      this.#refreshPromise = null;
    });
    return this.#refreshPromise;
  }

  #resolveRetryConfig(): Required<RealmRetryOptions> {
    return {
      maxRetries: Number(this.#options.retry?.maxRetries ?? DEFAULT_RETRY_MAX_RETRIES),
      retryableStatuses: this.#options.retry?.retryableStatuses ?? DEFAULT_RETRY_STATUSES,
      backoffMs: Number(this.#options.retry?.backoffMs ?? DEFAULT_RETRY_BACKOFF_MS),
      maxBackoffMs: Number(this.#options.retry?.maxBackoffMs ?? DEFAULT_RETRY_MAX_BACKOFF_MS),
    };
  }

  #resolveRetryDelay(response: Response, attempt: number): number | null {
    const config = this.#resolveRetryConfig();
    if (attempt >= config.maxRetries) {
      return null;
    }
    if (!config.retryableStatuses.includes(response.status)) {
      return null;
    }
    if (response.status === 429) {
      const retryAfterMs = this.#parseRetryAfter(response.headers.get('retry-after'));
      if (retryAfterMs !== null) {
        return retryAfterMs;
      }
    }
    const backoff = config.backoffMs * (2 ** attempt);
    return Math.min(backoff, config.maxBackoffMs);
  }

  #parseRetryAfter(value: string | null): number | null {
    const normalized = normalizeText(value);
    if (!normalized) {
      return null;
    }
    const seconds = Number(normalized);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
    const retryAt = Date.parse(normalized);
    if (Number.isNaN(retryAt)) {
      return null;
    }
    return Math.max(retryAt - Date.now(), 0);
  }

  async #sleep(delayMs: number, signal: AbortSignal): Promise<void> {
    if (delayMs <= 0) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(createNimiError({
          message: 'realm request aborted',
          code: ReasonCode.OPERATION_ABORTED,
          reasonCode: ReasonCode.OPERATION_ABORTED,
          actionHint: 'retry_if_needed',
          source: 'realm',
          retryable: false,
        }));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(createNimiError({
          message: 'realm request aborted',
          code: ReasonCode.OPERATION_ABORTED,
          reasonCode: ReasonCode.OPERATION_ABORTED,
          actionHint: 'retry_if_needed',
          source: 'realm',
          retryable: false,
        }));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  static decodeTokenExpiry(jwt: string): { expiresAt: number; expiresInMs: number } | null {
    try {
      const parts = jwt.split('.');
      if (parts.length !== 3) {
        return null;
      }
      const payload = parts[1]!;
      const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = atob(padded);
      const parsed = asRecord(JSON.parse(decoded));
      const exp = Number(parsed.exp);
      if (!Number.isFinite(exp) || exp <= 0) {
        return null;
      }
      const expiresAt = exp * 1000;
      const expiresInMs = expiresAt - Date.now();
      return { expiresAt, expiresInMs };
    } catch {
      return null;
    }
  }

  async #resolveHeaders(overrides?: Record<string, string>): Promise<Record<string, string>> {
    const sourceHeaders = this.#options.headers;
    let baseHeaders: Record<string, string> = {};

    if (sourceHeaders) {
      if (typeof sourceHeaders === 'function') {
        const resolved = await sourceHeaders();
        baseHeaders = Object.keys(resolved || {}).length > 0 ? resolved : {};
      } else {
        baseHeaders = Object.keys(sourceHeaders).length > 0 ? sourceHeaders : {};
      }
    }

    const merged: Record<string, string> = {
      ...baseHeaders,
      ...(overrides || {}),
    };

    const accessToken = await this.#resolveAccessToken();
    if (accessToken && !Object.keys(merged).some((name) => name.toLowerCase() === 'authorization')) {
      merged.Authorization = `Bearer ${accessToken}`;
    }

    return merged;
  }

  #emitTelemetry(name: string, data?: JsonObject): void {
    if (!this.#options.telemetry?.enabled || typeof this.#options.telemetry.onEvent !== 'function') {
      return;
    }
    this.#options.telemetry.onEvent({
      name,
      at: nowIso(),
      data,
    });
  }
}
