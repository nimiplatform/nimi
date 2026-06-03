import createClient from 'openapi-fetch';
import { createEventBus } from '../internal/event-bus.js';
import type { JsonObject } from '../internal/utils.js';
import type { paths } from './generated/schema.js';
import {
  createRealmServiceRegistry,
  type RealmRawRequestInput,
} from './generated/service-registry.js';
import type {
  RealmAuthOptions,
  RealmConnectionState,
  RealmEventPayloadMap,
  RealmEventsModule,
  RealmOptions,
  RealmResponseParser,
  RealmServiceRegistry,
  RealmTokenRefreshResult,
  RealmUnsafeRawModule,
} from './client-types.js';
import {
  DEFAULT_REALM_TIMEOUT_MS,
  nowIso,
  resolveBaseUrl,
} from './client-helpers.js';
import {
  resolvePositiveTimeoutMs,
} from './client-request-utils.js';
import {
  createRealmAuthState,
  decodeRealmTokenExpiryUnsafe,
  refreshRealmAccessToken,
  type RealmAuthState,
} from './client-auth.js';
import { requestRealmUnknown } from './client-request.js';

type OpenApiClient = ReturnType<typeof createClient<paths>>;

export class Realm {
  readonly services: RealmServiceRegistry;

  readonly events: RealmEventsModule;

  readonly unsafeRaw: RealmUnsafeRawModule;

  readonly baseUrl: string;

  #state: RealmConnectionState = {
    status: 'idle',
  };

  readonly #options: RealmOptions;

  readonly #authState: RealmAuthState;

  readonly #eventBus = createEventBus<RealmEventPayloadMap>();

  readonly #openapiClient: OpenApiClient;

  constructor(options: RealmOptions) {
    this.baseUrl = resolveBaseUrl(options.baseUrl);
    this.#authState = createRealmAuthState({ options, baseUrl: this.baseUrl });
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

    this.#state = { ...this.#state, status: 'connecting' };

    this.#state = { ...this.#state, status: 'ready', connectedAt: nowIso() };
    this.#emitTelemetry('realm.connected', { baseUrl: this.baseUrl });
  }

  async ready(input?: { timeoutMs?: number }): Promise<void> {
    await this.connect();

    const timeoutMs = resolvePositiveTimeoutMs(
      input?.timeoutMs ?? this.#options.timeoutMs,
      DEFAULT_REALM_TIMEOUT_MS,
    );

    try {
      await this.#requestUnknown({ method: 'GET', path: '/', timeoutMs });
    } catch (error) {
      this.#state = { ...this.#state, status: 'closed' };
      this.#emitTelemetry('realm.disconnected', { baseUrl: this.baseUrl, reason: 'probe_error_propagated' });
      throw error;
    }

    this.#state = { ...this.#state, status: 'ready', lastReadyAt: nowIso() };
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
    this.#authState.updateAuth(patch);
  }

  clearAuth(): void {
    this.#authState.clearAuth();
  }

  static async refreshAccessToken(input: {
    authMode: 'external_principal';
    realmBaseUrl: string;
    refreshToken: string;
    fetchImpl?: typeof fetch;
  }): Promise<RealmTokenRefreshResult> {
    return refreshRealmAccessToken(input);
  }

  async #requestUnknown(input: RealmRawRequestInput): Promise<unknown> {
    return requestRealmUnknown(input, {
      openapiClient: this.#openapiClient as unknown as Record<string, unknown>,
      options: this.#options,
      authState: this.#authState,
      getStateStatus: () => this.#state.status,
      connect: () => this.connect(),
      emitError: (error) => {
        this.#eventBus.emit('error', {
          error,
          at: nowIso(),
        });
      },
      emitTelemetry: (name, data) => this.#emitTelemetry(name, data),
      emitRequestSuccess: (method, path, httpStatus) => this.#emitRequestSuccess(method, path, httpStatus),
    });
  }

  static decodeTokenExpiryUnsafe(jwt: string): { expiresAt: number; expiresInMs: number } | null {
    return decodeRealmTokenExpiryUnsafe(jwt);
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

  #emitRequestSuccess(method: string, path: string, httpStatus?: number): void {
    const at = nowIso();
    if (this.#state.status !== 'closed' && this.#state.status !== 'closing') {
      this.#state = { ...this.#state, status: 'ready', lastReadyAt: at };
    }
    this.#eventBus.emit('request.success', {
      method,
      path,
      at,
      httpStatus,
    });
    this.#emitTelemetry('realm.request.success', {
      method,
      path,
      httpStatus,
    });
  }
}
