import { createNimiError } from '../core/errors.js';
import { ReasonCode, type ReasonCodeValue } from '../types/index.js';
import type {
  RealmAuthOptions,
  RealmOptions,
  RealmTokenRefreshResult,
} from './client-types.js';
import {
  asRecord,
  extractResponseReasonCode,
  normalizeText,
} from './client-helpers.js';
import { hasOwn, readErrorResponseBodyWithDiagnostics } from './client-request-utils.js';
import {
  executeGeneratedRealmRefreshToken,
  parseRealmRefreshResult,
} from './client-refresh.js';
import { assertExternalPrincipalRefreshMode, assertRealmAuthCustodyMode } from './auth-custody.js';

export type RealmAuthState = {
  updateAuth(patch: Partial<RealmAuthOptions>): void;
  clearAuth(): void;
  resolveAccessToken(): Promise<string>;
  resolveHeaders(overrides?: Record<string, string>, resolvedAccessToken?: string): Promise<Record<string, string>>;
  refreshAccessTokenForRetry(): Promise<RealmTokenRefreshResult>;
};

export function createRealmAuthState(input: {
  options: RealmOptions;
  baseUrl: string;
}): RealmAuthState {
  const authProvided = hasOwn(input.options, 'auth');
  if (!authProvided) {
    throw createNimiError({
      message: 'realm token is required (set auth explicitly to null or undefined for unauthenticated access)',
      reasonCode: ReasonCode.SDK_REALM_TOKEN_REQUIRED,
      actionHint: 'set_realm_auth_access_token',
      source: 'sdk',
    });
  }
  if (input.options.auth != null) {
    assertRealmAuthCustodyMode(input.options.auth);
  }
  return new RealmAuthController(input.options, input.baseUrl);
}

export async function refreshRealmAccessToken(input: {
  authMode: 'external_principal';
  realmBaseUrl: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<RealmTokenRefreshResult> {
  assertExternalPrincipalRefreshMode(input.authMode);
  const baseUrl = normalizeRealmRefreshBaseUrl(input.realmBaseUrl);
  const refreshToken = normalizeText(input.refreshToken);
  if (!refreshToken) {
    throw createNimiError({
      message: 'realm refresh token is required',
      reasonCode: ReasonCode.SDK_REALM_TOKEN_REQUIRED,
      actionHint: 'set_realm_refresh_token',
      source: 'sdk',
    });
  }

  const payload = await executeGeneratedRealmRefreshToken({
    baseUrl,
    refreshToken,
    fetchImpl: input.fetchImpl,
    mapError: (response) => createNimiError({
      message: `realm refresh failed: ${response.status}`,
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      actionHint: 'check_realm_refresh_token',
      source: 'realm',
      details: {
        httpStatus: response.status,
      },
    }),
  });
  return parseRealmRefreshResult(payload, {
    message: 'realm refresh response missing accessToken',
    reasonCode: ReasonCode.REALM_UNAVAILABLE,
    actionHint: 'check_realm_refresh_response',
  });
}

/**
 * Decodes the unverified JWT payload for UX hints only.
 * Do not use this helper for trust, authorization, or expiry enforcement.
 */
export function decodeRealmTokenExpiryUnsafe(jwt: string): { expiresAt: number; expiresInMs: number } | null {
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

function normalizeRealmRefreshBaseUrl(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: 'realm baseUrl is required',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'set_realm_base_url',
      source: 'sdk',
    });
  }
  return normalized.replace(/\/+$/, '');
}

class RealmAuthController implements RealmAuthState {
  readonly #options: RealmOptions;

  readonly #baseUrl: string;

  #refreshPromise: Promise<RealmTokenRefreshResult> | null = null;

  constructor(
    options: RealmOptions,
    baseUrl: string,
  ) {
    this.#options = options;
    this.#baseUrl = baseUrl;
  }

  updateAuth(patch: Partial<RealmAuthOptions>): void {
    const nextAuth = this.#options.auth
      ? { ...this.#options.auth, ...patch }
      : { ...patch } as RealmAuthOptions;
    assertRealmAuthCustodyMode(nextAuth);
    this.#options.auth = nextAuth;
  }

  clearAuth(): void {
    this.#options.auth = undefined;
  }

  async resolveAccessToken(): Promise<string> {
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

  async resolveHeaders(overrides?: Record<string, string>, resolvedAccessToken?: string): Promise<Record<string, string>> {
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

    const accessToken = resolvedAccessToken ?? await this.resolveAccessToken();
    if (accessToken && !Object.keys(merged).some((name) => name.toLowerCase() === 'authorization')) {
      merged.Authorization = `Bearer ${accessToken}`;
    }

    return merged;
  }

  async refreshAccessTokenForRetry(): Promise<RealmTokenRefreshResult> {
    try {
      const refreshResult = await this.#attemptRefresh();
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
      return refreshResult;
    } catch (refreshError) {
      try {
        this.#options.auth?.onRefreshFailed?.(refreshError);
      } catch { /* observer callback must not break error flow */ }
      throw refreshError;
    }
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

    const data = await executeGeneratedRealmRefreshToken({
      baseUrl: this.#baseUrl,
      refreshToken,
      fetchImpl: this.#options.fetchImpl,
      mapError: async (response) => {
        const { body, details: readDetails } = await readErrorResponseBodyWithDiagnostics(response);
        const mapped = extractResponseReasonCode(body, response);
        return createNimiError({
          message: mapped.message || 'token refresh failed',
          code: mapped.code,
          reasonCode: mapped.reasonCode,
          actionHint: mapped.actionHint,
          traceId: mapped.traceId || undefined,
          source: 'realm',
          details: {
            ...mapped.details,
            ...readDetails,
          },
        });
      },
    });
    return parseRealmRefreshResult(data, {
      message: 'refresh response missing accessToken',
      reasonCode: ReasonCode.AUTH_DENIED,
      actionHint: 'reauthenticate',
    });
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
}
