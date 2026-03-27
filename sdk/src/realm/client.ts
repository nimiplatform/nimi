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
  RealmResponseParser,
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
const REALM_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function encodePathValue(value: string | number): string {
  return encodeURIComponent(String(value));
}

function parseRefreshExpiresIn(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resolvePositiveTimeoutMs(value: unknown, fallback: number): number {
  const raw = value ?? fallback;
  const timeoutMs = Number(raw);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw createNimiError({
      message: 'realm timeoutMs must be a positive finite number',
      reasonCode: ReasonCode.SDK_REALM_CONFIG_INVALID,
      actionHint: 'set_positive_realm_timeout_ms',
      source: 'sdk',
    });
  }
  return timeoutMs;
}

type RealmHttpMethod = (typeof REALM_HTTP_METHODS)[number];

function getOpenApiMethod(
  client: Record<string, unknown>,
  methodName: string,
): ((url: string, options?: Record<string, unknown>) => Promise<unknown>) | null {
  if (!REALM_HTTP_METHODS.includes(methodName as RealmHttpMethod)) {
    return null;
  }
  const candidate = client[methodName];
  if (typeof candidate !== 'function') {
    return null;
  }
  return candidate as (url: string, options?: Record<string, unknown>) => Promise<unknown>;
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
    if (!authProvided) {
      throw createNimiError({
        message: 'realm token is required (set auth explicitly to null or undefined for unauthenticated access)',
        reasonCode: ReasonCode.SDK_REALM_TOKEN_REQUIRED,
        actionHint: 'set_realm_auth_access_token',
        source: 'sdk',
      });
    }
    if (options.auth != null && !options.auth.accessToken) {
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

    const requestUnknown = (input: RealmRawRequestInput): Promise<unknown> => this.#requestUnknown(input);
    async function requestUnsafeRaw(input: RealmRawRequestInput): Promise<unknown>;
    async function requestUnsafeRaw<T>(
      input: RealmRawRequestInput & { parseResponse: RealmResponseParser<T> },
    ): Promise<T>;
    async function requestUnsafeRaw<T>(
      input: RealmRawRequestInput & { parseResponse?: RealmResponseParser<T> },
    ): Promise<unknown | T> {
      const value = await requestUnknown(input);
      if (typeof input.parseResponse === 'function') {
        return input.parseResponse(value);
      }
      return value;
    }

    const unsafeRaw: RealmUnsafeRawModule = {
      request: requestUnsafeRaw,
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

    const timeoutMs = resolvePositiveTimeoutMs(
      input?.timeoutMs ?? this.#options.timeoutMs,
      DEFAULT_REALM_TIMEOUT_MS,
    );

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
    const expiresIn = parseRefreshExpiresIn(tokens.expiresIn ?? payload.expiresIn);
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

    const timeoutMs = resolvePositiveTimeoutMs(
      input.timeoutMs ?? this.#options.timeoutMs,
      DEFAULT_REALM_TIMEOUT_MS,
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutController = timeoutMs > 0 ? new AbortController() : undefined;
    let timeoutTriggered = false;
    let externalAbortTriggered = false;
    let refreshAttempted = false;
    let retryAttempt = 0;

    try {
      if (timeoutController) {
        timer = setTimeout(() => {
          timeoutController.abort();
        }, timeoutMs);
      }

      const methodName = normalizeText(input.method).toUpperCase();
      const method = getOpenApiMethod(
        this.#openapiClient as unknown as Record<string, unknown>,
        methodName,
      );

      if (method === null) {
        throw createNimiError({
          message: `unsupported realm HTTP method: ${methodName || '(empty)'}; supported methods: ${REALM_HTTP_METHODS.join(', ')}`,
          reasonCode: ReasonCode.ACTION_INPUT_INVALID,
          actionHint: 'check_realm_request_method',
          source: 'sdk',
        });
      }
      while (true) {
        const requestAbortController = new AbortController();
        const abortRequest = () => {
          if (!requestAbortController.signal.aborted) {
            requestAbortController.abort();
          }
        };
        const onTimeoutAbort = () => {
          timeoutTriggered = true;
          abortRequest();
        };
        const onExternalAbort = () => {
          externalAbortTriggered = true;
          abortRequest();
        };
        timeoutController?.signal.addEventListener('abort', onTimeoutAbort, { once: true });
        if (timeoutController?.signal.aborted) {
          onTimeoutAbort();
        }
        if (input.signal) {
          if (input.signal.aborted) {
            onExternalAbort();
          } else {
            input.signal.addEventListener('abort', onExternalAbort, { once: true });
          }
        }
        const headers = await this.#resolveHeaders(input.headers);
        try {
          const responseTuple = await method(
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
                  retryAttempt += 1;
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

              const bodyRecord = readErrorBody(errorPayload);
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
        } finally {
          timeoutController?.signal.removeEventListener('abort', onTimeoutAbort);
          if (input.signal) {
            input.signal.removeEventListener('abort', onExternalAbort);
          }
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
    }
  }

  async #resolveAccessToken(): Promise<string> {
    if (this.#options.auth == null) {
      return '';
    }
    const accessToken = this.#options.auth?.accessToken;
    // `resolved` is assigned in both branches so we can normalize sync/async token sources once.
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
      const body = readErrorBody(
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
      expiresIn: parseRefreshExpiresIn(tokens.expiresIn),
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

  /**
   * Decodes the unverified JWT payload for UX hints only.
   * Do not use this helper for trust, authorization, or expiry enforcement.
   *
   * @deprecated Prefer {@link Realm.decodeTokenExpiryUnsafe} in new code to make
   * the lack of signature verification explicit.
   */
  static decodeTokenExpiry(jwt: string): { expiresAt: number; expiresInMs: number } | null {
    try {
      const parts = jwt.split('.');
      if (parts.length !== 3) {
        return null;
      }
      const payload = parts[1]!;
      const normalized = payload
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(payload.length / 4) * 4, '=');
      const decoded = typeof atob === 'function'
        ? atob(normalized)
        : Buffer.from(normalized, 'base64').toString('utf8');
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

  // Explicit alias for the unverified UX-only JWT decode path.
  static decodeTokenExpiryUnsafe(jwt: string): { expiresAt: number; expiresInMs: number } | null {
    return Realm.decodeTokenExpiry(jwt);
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
