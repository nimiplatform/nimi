import createClient from 'openapi-fetch';
import { createEventBus } from '../internal/event-bus.js';
import { ReasonCode } from '../types/index.js';
import { asNimiError, createNimiError } from '../runtime/errors.js';
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

type RealmEventPayloadMap = {
  error: { error: NimiError; at: string };
};

type OpenApiClient = ReturnType<typeof createClient<paths>>;

const DEFAULT_REALM_TIMEOUT_MS = 10000;

type MergeHandleSource = Record<string, unknown>;

type UnionToIntersection<Union> = (
  Union extends unknown ? (value: Union) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

type MergedHandle<Handles extends Array<MergeHandleSource | undefined>> = UnionToIntersection<
  Exclude<Handles[number], undefined>
>;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function resolveBaseUrl(value: unknown): string {
  const baseUrl = normalizeText(value);
  if (!baseUrl) {
    throw createNimiError({
      message: 'realm endpoint (baseUrl) is required',
      reasonCode: ReasonCode.SDK_REALM_ENDPOINT_REQUIRED,
      actionHint: 'set_realm_base_url',
      source: 'sdk',
    });
  }
  return baseUrl.replace(/\/+$/, '');
}

function isAbortLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  const record = asRecord(error);
  const name = normalizeText(record.name);
  const code = normalizeText(record.code);
  if (name === 'AbortError' || code === 'ABORT_ERR') {
    return true;
  }
  const message = normalizeText(record.message).toLowerCase();
  return message.includes('aborted');
}

function mapRealmStatusReasonCode(status: number): string {
  if (status === 401 || status === 403) {
    return ReasonCode.AUTH_DENIED;
  }
  if (status === 404) {
    return ReasonCode.REALM_NOT_FOUND;
  }
  if (status === 409) {
    return ReasonCode.REALM_CONFLICT;
  }
  if (status === 429) {
    return ReasonCode.REALM_RATE_LIMITED;
  }
  if (status === 400 || status === 422) {
    return ReasonCode.CONFIG_INVALID;
  }
  if (status >= 500) {
    return ReasonCode.REALM_UNAVAILABLE;
  }
  return ReasonCode.ACTION_INPUT_INVALID;
}

function mapRealmStatusActionHint(status: number): string {
  if (status === 401 || status === 403) {
    return 'refresh_realm_token_or_reauthenticate';
  }
  if (status === 404) {
    return 'check_realm_path_or_resource_id';
  }
  if (status === 409) {
    return 'resolve_realm_conflict_then_retry';
  }
  if (status === 429) {
    return 'retry_after_backoff';
  }
  if (status === 400 || status === 422) {
    return 'fix_realm_config_or_request_payload';
  }
  if (status >= 500) {
    return 'retry_or_check_realm_status';
  }
  return 'check_realm_request_payload';
}

function mergeHandles<Handles extends Array<MergeHandleSource | undefined>>(
  ...handles: Handles
): MergedHandle<Handles> {
  const merged: Record<string, unknown> = {};
  for (const handle of handles) {
    if (!handle) {
      continue;
    }
    for (const [methodName, method] of Object.entries(handle)) {
      merged[methodName] = method;
    }
  }
  return merged as MergedHandle<Handles>;
}

function isResponse(value: unknown): value is Response {
  return typeof Response !== 'undefined' && value instanceof Response;
}

async function readErrorBody(value: unknown): Promise<Record<string, unknown>> {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return asRecord(parsed);
    } catch {
      return { message: value };
    }
  }
  if (typeof value === 'object') {
    return asRecord(value);
  }
  return {};
}

function extractResponseReasonCode(
  body: Record<string, unknown>,
  response: Response,
): {
  rawReasonCode: string;
  reasonCode: string;
  code: string;
  actionHint: string;
  traceId: string;
  message: string;
  retryable: boolean;
  details: Record<string, unknown>;
} {
  const nestedError = asRecord(body.error);
  const rawReasonCode = pickString(body, ['reasonCode', 'reason_code'])
    || pickString(nestedError, ['reasonCode', 'reason_code'])
    || normalizeText(response.headers.get('x-reason-code'));

  const reasonCode = rawReasonCode || mapRealmStatusReasonCode(response.status);
  const code = mapRealmStatusReasonCode(response.status);

  const actionHint = pickString(body, ['actionHint', 'action_hint'])
    || pickString(nestedError, ['actionHint', 'action_hint'])
    || normalizeText(response.headers.get('x-action-hint'))
    || mapRealmStatusActionHint(response.status);

  const traceId = pickString(body, ['traceId', 'trace_id'])
    || pickString(nestedError, ['traceId', 'trace_id'])
    || normalizeText(response.headers.get('x-trace-id'));

  const message = pickString(body, ['message'])
    || pickString(nestedError, ['message'])
    || `${response.status} ${response.statusText}`;

  const retryable = response.status === 429 || response.status >= 500;
  const details: Record<string, unknown> = {
    httpStatus: response.status,
  };
  if (rawReasonCode) {
    details.rawReasonCode = rawReasonCode;
  }

  return {
    rawReasonCode,
    reasonCode,
    code,
    actionHint,
    traceId,
    message,
    retryable,
    details,
  };
}

function mapRealmError(error: unknown): NimiError {
  if (isAbortLikeError(error)) {
    return createNimiError({
      message: normalizeText(asRecord(error).message) || 'realm request aborted',
      code: ReasonCode.OPERATION_ABORTED,
      reasonCode: ReasonCode.OPERATION_ABORTED,
      actionHint: 'retry_if_needed',
      source: 'realm',
    });
  }

  const normalized = asNimiError(error, {
    code: ReasonCode.REALM_UNAVAILABLE,
    reasonCode: ReasonCode.REALM_UNAVAILABLE,
    actionHint: 'retry_or_check_realm_network',
    source: 'realm',
  });

  const message = normalizeText(normalized.message).toLowerCase();
  if (message.includes('aborted')) {
    return createNimiError({
      message: normalized.message,
      code: ReasonCode.OPERATION_ABORTED,
      reasonCode: ReasonCode.OPERATION_ABORTED,
      actionHint: 'retry_if_needed',
      traceId: normalized.traceId || undefined,
      source: 'realm',
      retryable: false,
    });
  }

  return normalized;
}

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

    if (this.services.Me2FaService) {
      this.services.MeTwoFactorService = this.services.Me2FaService;
    }
    if (this.services.SocialV1DefaultVisibilityService) {
      this.services.SocialDefaultVisibilityService = this.services.SocialV1DefaultVisibilityService;
    }
    if (this.services.SocialFourDimensionalAttributesService) {
      this.services.SocialAttributesService = this.services.SocialFourDimensionalAttributesService;
    }

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
    }).catch(() => {
      // Some realm deployments do not expose root endpoint. Client state is still ready.
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
    if (typeof accessToken === 'function') {
      return normalizeText(await accessToken());
    }
    return normalizeText(accessToken);
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
