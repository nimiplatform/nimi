import type { Realm } from '@nimiplatform/sdk/realm';
import { emitAuthLog, traceIdOf, type PasswordAuthDebug } from '../auth';

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;

export async function loginWithPassword(
  callApi: DataSyncApiCaller,
  setToken: (token: string | null | undefined) => void,
  identifier: string,
  password: string,
  debug?: PasswordAuthDebug,
  setRefreshToken?: (token: string | null | undefined) => void,
  setAuth?: (user: Record<string, unknown> | null | undefined, token: string, refreshToken?: string) => void,
) {
  const traceId = traceIdOf(debug)
    || `datasync-login-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const flowId = debug?.flowId
    || `datasync-login-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = debug?.startedAt ?? performance.now();
  emitAuthLog({
    level: 'info',
    message: 'action:login:start',
    traceId,
    source: debug?.source,
    details: {
      flowId,
      identifierLength: identifier.trim().length,
    },
  });
  try {
    const result = await callApi(
      (realm) => realm.services.AuthService.passwordLogin({ identifier, password }),
      '登录失败',
    );
    emitAuthLog({
      level: 'info',
      message: 'action:login:done',
      traceId,
      source: debug?.source,
      costMs: Number((performance.now() - startedAt).toFixed(2)),
      details: {
        hasAccessToken: Boolean(result?.tokens?.accessToken),
      },
    });

    if (result.tokens?.accessToken) {
      setAuth?.(result.tokens.user, result.tokens.accessToken, result.tokens.refreshToken ?? undefined);
      setToken(result.tokens.accessToken);
      if (result.tokens.refreshToken) {
        setRefreshToken?.(result.tokens.refreshToken);
      }
    }
    return result;
  } catch (error) {
    emitAuthLog({
      level: 'error',
      message: 'action:login:failed',
      traceId,
      source: debug?.source,
      costMs: Number((performance.now() - startedAt).toFixed(2)),
      details: {
        error: error instanceof Error ? error.message : String(error || ''),
      },
    });
    throw error;
  }
}

export async function registerWithPassword(
  callApi: DataSyncApiCaller,
  setToken: (token: string | null | undefined) => void,
  email: string,
  password: string,
  debug?: PasswordAuthDebug,
  setRefreshToken?: (token: string | null | undefined) => void,
  setAuth?: (user: Record<string, unknown> | null | undefined, token: string, refreshToken?: string) => void,
) {
  const traceId = traceIdOf(debug)
    || `datasync-register-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const flowId = debug?.flowId
    || `datasync-register-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = debug?.startedAt ?? performance.now();
  emitAuthLog({
    level: 'info',
    message: 'action:register:start',
    traceId,
    source: debug?.source,
    details: {
      flowId,
      identifierLength: email.trim().length,
    },
  });
  try {
    const result = await callApi(
      (realm) => realm.services.AuthService.passwordRegister({ email, password }),
      '注册失败',
    );
    emitAuthLog({
      level: 'info',
      message: 'action:register:done',
      traceId,
      source: debug?.source,
      costMs: Number((performance.now() - startedAt).toFixed(2)),
      details: {
        hasAccessToken: Boolean(result?.tokens?.accessToken),
      },
    });

    if (result.tokens?.accessToken) {
      setAuth?.(result.tokens.user, result.tokens.accessToken, result.tokens.refreshToken ?? undefined);
      setToken(result.tokens.accessToken);
      if (result.tokens.refreshToken) {
        setRefreshToken?.(result.tokens.refreshToken);
      }
    }
    return result;
  } catch (error) {
    emitAuthLog({
      level: 'error',
      message: 'action:register:failed',
      traceId,
      source: debug?.source,
      costMs: Number((performance.now() - startedAt).toFixed(2)),
      details: {
        error: error instanceof Error ? error.message : String(error || ''),
      },
    });
    throw error;
  }
}

export async function logoutWithCleanup(input: {
  callApi: DataSyncApiCaller;
  clearAuth: () => void;
  stopAllPolling: () => void;
}) {
  try {
    await input.callApi((realm) => realm.services.AuthService.logout({}), '登出失败');
  } finally {
    input.clearAuth();
    input.stopAllPolling();
  }
}
