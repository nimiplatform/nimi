import { AppMode, WorldRelation } from './generated/runtime/v1/auth.js';
import { ExternalPrincipalType, type ResourceSelectors as RuntimeResourceSelectors } from './generated/runtime/v1/common.js';
import { AuthorizationPreset, PolicyMode } from './generated/runtime/v1/grant.js';
import { createRuntimeClient } from './core/client.js';
import { asNimiError, createNimiError } from './errors.js';
import type {
  RuntimeCallOptions,
  RuntimeAuthClient,
  RuntimeAppAuthClient,
  RuntimeProtectedAccessToken,
  RuntimeTransportConfig,
} from './types.js';
import { ReasonCode } from '../types/index.js';

const defaultTTLSeconds = 3600;
const refreshSkewMs = 30_000;
const runtimeProtectedScopeCatalogVersion = 'sdk-v2';

type ProtectedRuntime = {
  appId: string;
  transport?: RuntimeTransportConfig;
  auth: Pick<RuntimeAuthClient, 'registerApp'>;
  appAuth: Pick<RuntimeAppAuthClient, 'authorizeExternalPrincipal'>;
};

type CreateRuntimeProtectedScopeHelperInput = {
  runtime: ProtectedRuntime;
  getSubjectUserId: () => string | Promise<string>;
  now?: () => Date;
};

type RuntimeProtectedAuthClient = {
  auth: Pick<RuntimeAuthClient, 'registerApp'>;
  appAuth: Pick<RuntimeAppAuthClient, 'authorizeExternalPrincipal'>;
};

type CachedToken = {
  token: RuntimeProtectedAccessToken;
  expiresAtMs: number;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampFromDate(date: Date): { seconds: string; nanos: number } {
  const millis = date.getTime();
  return {
    seconds: String(Math.floor(millis / 1000)),
    nanos: (millis % 1000) * 1_000_000,
  };
}

function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => normalizeText(scope)).filter(Boolean))].sort();
}

function scopeKey(scopes: readonly string[]): string {
  return normalizeScopes(scopes).join('\n');
}

function isRetryableProtectedAccessError(error: unknown): boolean {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: 'refresh_runtime_protected_access',
    source: 'runtime',
  });
  return normalized.reasonCode === ReasonCode.PRINCIPAL_UNAUTHORIZED
    || normalized.reasonCode === ReasonCode.APP_SCOPE_FORBIDDEN
    || normalized.reasonCode === ReasonCode.APP_TOKEN_EXPIRED
    || normalized.reasonCode === ReasonCode.APP_TOKEN_REVOKED
    || normalized.reasonCode === ReasonCode.APP_GRANT_INVALID;
}

export function createRuntimeProtectedScopeHelper(input: CreateRuntimeProtectedScopeHelperInput) {
  const now = input.now ?? (() => new Date());
  const cache = new Map<string, CachedToken>();
  const inflight = new Map<string, Promise<CachedToken>>();
  let registerPromise: Promise<void> | null = null;
  let rawRuntimeClient: RuntimeProtectedAuthClient | null = null;

  const resolveRuntimeAuthClient = (): RuntimeProtectedAuthClient => {
    if (!input.runtime.transport) {
      return {
        auth: input.runtime.auth,
        appAuth: input.runtime.appAuth,
      };
    }
    if (!rawRuntimeClient) {
      rawRuntimeClient = createRuntimeClient({
        appId: input.runtime.appId,
        transport: input.runtime.transport,
      });
    }
    return rawRuntimeClient;
  };

  const ensureSubjectUserID = async (): Promise<string> => {
    const subjectUserId = normalizeText(await input.getSubjectUserId());
    if (subjectUserId) {
      return subjectUserId;
    }
    throw createNimiError({
      message: 'runtime protected access requires subject user id',
      reasonCode: ReasonCode.SDK_RUNTIME_APP_AUTH_SUBJECT_USER_ID_REQUIRED,
      actionHint: 'provide_subject_user_id',
      source: 'sdk',
    });
  };

  const ensureRegistered = async (): Promise<void> => {
    if (registerPromise) {
      return registerPromise;
    }
    registerPromise = (async () => {
      const response = await resolveRuntimeAuthClient().auth.registerApp({
        appId: input.runtime.appId,
        appInstanceId: `${input.runtime.appId}.runtime-protected-access`,
        deviceId: 'runtime-protected-access',
        appVersion: '1',
        capabilities: [],
        modeManifest: {
          appMode: AppMode.FULL,
          runtimeRequired: true,
          realmRequired: true,
          worldRelation: WorldRelation.NONE,
        },
      });
      if (!response.accepted) {
        throw createNimiError({
          message: `runtime protected access registration rejected: ${String(response.reasonCode || 'unknown')}`,
          reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
          actionHint: 'register_runtime_app_first',
          source: 'runtime',
        });
      }
    })();
    try {
      await registerPromise;
    } catch (error) {
      registerPromise = null;
      throw error;
    }
  };

  const issueToken = async (scopes: readonly string[]): Promise<CachedToken> => {
    const normalizedScopes = normalizeScopes(scopes);
    const key = normalizedScopes.join('\n');
    const cached = cache.get(key);
    const nowMs = now().getTime();
    if (cached && cached.expiresAtMs-nowMs > refreshSkewMs) {
      return cached;
    }
    const active = inflight.get(key);
    if (active) {
      return active;
    }

    const next = (async () => {
      await ensureRegistered();
      const issuedAt = now();
      const resourceSelectors: RuntimeResourceSelectors = {
        conversationIds: [],
        messageIds: [],
        documentIds: [],
        labels: {},
      };
      const response = await resolveRuntimeAuthClient().appAuth.authorizeExternalPrincipal({
        domain: 'app-auth',
        appId: input.runtime.appId,
        externalPrincipalId: input.runtime.appId,
        externalPrincipalType: ExternalPrincipalType.APP,
        subjectUserId: await ensureSubjectUserID(),
        consentId: 'runtime-protected-access',
        consentVersion: 'v1',
        decisionAt: timestampFromDate(issuedAt),
        policyVersion: 'runtime-protected-access-v1',
        policyMode: PolicyMode.CUSTOM,
        preset: AuthorizationPreset.UNSPECIFIED,
        scopes: normalizedScopes,
        resourceSelectors,
        canDelegate: false,
        maxDelegationDepth: 0,
        ttlSeconds: defaultTTLSeconds,
        scopeCatalogVersion: runtimeProtectedScopeCatalogVersion,
        policyOverride: false,
      }, {
        metadata: {
          domain: 'app-auth',
        },
      });
      const tokenId = normalizeText(response.tokenId);
      const secret = normalizeText(response.secret);
      if (!tokenId || !secret) {
        throw createNimiError({
          message: 'runtime protected access token response missing token credentials',
          reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
          actionHint: 'check_runtime_app_auth_response',
          source: 'runtime',
        });
      }
      const expiresAtMs = response.expiresAt
        ? Number(response.expiresAt.seconds) * 1000 + Math.floor(Number(response.expiresAt.nanos || 0) / 1_000_000)
        : issuedAt.getTime() + defaultTTLSeconds * 1000;
      const issued = {
        token: { tokenId, secret },
        expiresAtMs,
      };
      cache.set(key, issued);
      return issued;
    })();

    inflight.set(key, next);
    try {
      return await next;
    } finally {
      inflight.delete(key);
    }
  };

  const getCallOptions = async (
    scopes: readonly string[],
    baseOptions?: RuntimeCallOptions,
  ): Promise<RuntimeCallOptions> => {
    const normalizedScopes = normalizeScopes(scopes);
    if (normalizedScopes.length === 0) {
      return { ...(baseOptions || {}) };
    }
    const issued = await issueToken(normalizedScopes);
    return {
      ...(baseOptions || {}),
      protectedAccessToken: issued.token,
    };
  };

  return {
    async getCallOptions(
      scopes: readonly string[],
      baseOptions?: RuntimeCallOptions,
    ): Promise<RuntimeCallOptions> {
      return getCallOptions(scopes, baseOptions);
    },

    invalidate(scopes: readonly string[]): void {
      const key = scopeKey(scopes);
      cache.delete(key);
      inflight.delete(key);
    },

    async withScopes<T>(
      scopes: readonly string[],
      operation: (options: RuntimeCallOptions) => Promise<T>,
      baseOptions?: RuntimeCallOptions,
    ): Promise<T> {
      const normalizedScopes = normalizeScopes(scopes);
      const key = normalizedScopes.join('\n');
      try {
        return await operation(await getCallOptions(normalizedScopes, baseOptions));
      } catch (error) {
        if (!isRetryableProtectedAccessError(error)) {
          throw error;
        }
        cache.delete(key);
        inflight.delete(key);
        return operation(await getCallOptions(normalizedScopes, baseOptions));
      }
    },
  };
}
