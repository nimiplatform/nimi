import createClient from 'openapi-fetch';
import { createEventBus } from '../internal/event-bus.js';
import { ReasonCode } from '../types/index.js';
import { createNimiError } from '../runtime/errors.js';
import type { NimiError } from '../types/index.js';
import type { paths } from './generated/schema.js';
import {
  createRealmServiceRegistry,
  type RealmRawRequestInput,
} from './generated/service-registry.js';
import type {
  RealmAuthApi,
  RealmConnectionState,
  RealmEventsModule,
  RealmMediaApi,
  RealmNotificationApi,
  RealmOptions,
  RealmPostApi,
  RealmRawModule,
  RealmSearchApi,
  RealmServiceRegistry,
  RealmTokenRefreshResult,
  RealmTransitsApi,
  RealmUserApi,
  RealmWorldApi,
} from './client-types.js';
import {
  DEFAULT_REALM_TIMEOUT_MS,
  asRecord,
  extractResponseReasonCode,
  hasValue,
  isResponse,
  mapRealmError,
  mergeHandles,
  normalizeText,
  nowIso,
  readErrorBody,
  resolveBaseUrl,
} from './client-helpers.js';

type RealmEventPayloadMap = {
  error: { error: NimiError; at: string };
};

type OpenApiClient = ReturnType<typeof createClient<paths>>;

export class Realm {
  static readonly NO_AUTH = '__NIMI_REALM_NO_AUTH__';

  readonly auth: RealmAuthApi;

  readonly users: RealmUserApi;

  readonly posts: RealmPostApi;

  readonly worlds: RealmWorldApi;

  readonly notifications: RealmNotificationApi;

  readonly media: RealmMediaApi;

  readonly search: RealmSearchApi;

  readonly transits: RealmTransitsApi;

  readonly services: RealmServiceRegistry;

  readonly events: RealmEventsModule;

  readonly raw: RealmRawModule;

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
    const accessToken = options.auth?.accessToken;
    if (!accessToken) {
      throw createNimiError({
        message: 'realm token is required (use Realm.NO_AUTH for unauthenticated access)',
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

    this.auth = this.services.AuthService;
    this.users = mergeHandles(this.services.UserService, this.services.MeService);
    this.posts = this.services.PostService;
    this.worlds = mergeHandles(
      this.services.WorldsService,
      this.services.WorldControlService,
      this.services.WorldRulesService,
    );
    this.notifications = this.services.NotificationService;
    this.media = this.services.MediaService;
    this.search = this.services.SearchService;
    this.transits = this.services.TransitsService;

    this.events = {
      on: (name, handler) => this.#eventBus.on(name, handler),
      once: (name, handler) => this.#eventBus.once(name, handler),
    };

    this.raw = {
      request: async <T = unknown>(input: RealmRawRequestInput): Promise<T> => {
        const value = await this.#requestUnknown(input);
        return value as T;
      },
    };
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
    }).catch((error: unknown) => {
      // Fail-open per SDKREALM-019: #requestUnknown already emitted the error
      // event, so we only add telemetry and swallow the exception.
      const mapped = mapRealmError(error);
      this.#emitTelemetry('realm.ready_probe_failed', {
        reasonCode: mapped.reasonCode,
      });
    });

    this.#state = {
      ...this.#state,
      status: 'ready',
      lastReadyAt: nowIso(),
    };
  }

  async close(input?: { force?: boolean }): Promise<void> {
    void input;

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

  async #requestUnknown(input: RealmRawRequestInput): Promise<unknown> {
    if (this.#state.status === 'idle') {
      await this.connect();
    }

    const path = normalizeText(input.path);
    if (!path) {
      throw createNimiError({
        message: 'realm path is required',
        reasonCode: ReasonCode.ACTION_INPUT_INVALID,
        actionHint: 'set_realm_request_path',
        source: 'sdk',
      });
    }

    const timeoutMs = Number(input.timeoutMs || this.#options.timeoutMs || DEFAULT_REALM_TIMEOUT_MS)
      || DEFAULT_REALM_TIMEOUT_MS;

    const headers = await this.#resolveHeaders(input.headers);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutController = timeoutMs > 0 ? new AbortController() : undefined;
    const requestAbortController = new AbortController();
    let timeoutTriggered = false;
    let externalAbortTriggered = false;

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
          if (response.status === 401 && this.#options.auth?.refreshToken) {
            try {
              const refreshResult = await this.#attemptRefresh();
              try {
                this.#options.auth.onTokenRefreshed?.(refreshResult);
              } catch { /* observer callback must not break retry */ }
              this.#emitTelemetry('realm.token_refreshed');

              const retryHeaders = await this.#resolveHeaders(input.headers);
              retryHeaders.Authorization = `Bearer ${refreshResult.accessToken}`;

              const retryResponse = await (method as (url: string, options?: Record<string, unknown>) => Promise<unknown>)(
                path,
                {
                  params: input.query ? { query: input.query } : undefined,
                  body: input.body,
                  headers: retryHeaders,
                  signal: requestAbortController.signal,
                },
              );

              const retryRecord = asRecord(retryResponse);
              const retryResp = retryRecord.response;
              const retryError = retryRecord.error;
              const retryData = retryRecord.data;

              if (isResponse(retryResp)) {
                if (!retryResp.ok) {
                  const retryBody = await readErrorBody(retryError);
                  const retryMapped = extractResponseReasonCode(retryBody, retryResp);
                  throw createNimiError({
                    message: retryMapped.message,
                    code: retryMapped.code,
                    reasonCode: retryMapped.reasonCode,
                    actionHint: retryMapped.actionHint,
                    traceId: retryMapped.traceId || undefined,
                    retryable: retryMapped.retryable,
                    source: 'realm',
                    details: retryMapped.details,
                  });
                }
                if (hasValue(retryData)) {
                  return retryData;
                }
                if (retryResp.status === 204) {
                  return undefined;
                }
                const retryContentType = normalizeText(retryResp.headers.get('content-type')).toLowerCase();
                if (retryContentType.includes('application/json')) {
                  return await retryResp.json();
                }
                return await retryResp.text();
              }
              if (hasValue(retryError)) {
                throw retryError;
              }
              if (hasValue(retryData)) {
                return retryData;
              }
              return retryResponse;
            } catch (refreshError) {
              try {
                this.#options.auth.onRefreshFailed?.(refreshError);
              } catch { /* observer callback must not break error flow */ }
              // Fall through to throw the original 401 error
            }
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
    const accessToken = this.#options.auth?.accessToken;
    let resolved: string;
    if (typeof accessToken === 'function') {
      resolved = normalizeText(await accessToken());
    } else {
      resolved = normalizeText(accessToken);
    }
    if (resolved === Realm.NO_AUTH) {
      return '';
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

  static decodeTokenExpiry(jwt: string): { expiresAt: number; expiresInMs: number } | null {
    try {
      const parts = jwt.split('.');
      if (parts.length !== 3) {
        return null;
      }
      const payload = parts[1]!;
      const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
      const decoded = atob(padded);
      const parsed = JSON.parse(decoded) as Record<string, unknown>;
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

  #emitTelemetry(name: string, data?: Record<string, unknown>): void {
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
