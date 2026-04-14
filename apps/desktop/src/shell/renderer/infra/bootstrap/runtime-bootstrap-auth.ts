import { dataSync } from '@runtime/data-sync';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { toAuthUserRecord } from '@renderer/features/auth/auth-session-utils';
import { persistSharedDesktopSession } from '@renderer/features/auth/shared-auth-session';
import { pingDesktopMacosSmoke } from '@renderer/bridge/runtime-bridge/macos-smoke';
import { safeErrorMessage } from './runtime-bootstrap-utils';

const AUTO_LOGIN_USER_LOAD_TIMEOUT_MS = 8_000;
const AUTO_LOGIN_WARM_LOAD_TIMEOUT_MS = 4_000;

function isExpectedUnauthorizedAutoLogin(error: unknown): boolean {
  const message = safeErrorMessage(error).toUpperCase();
  return message.includes('HTTP_401') || message.includes('UNAUTHORIZED');
}

function readAuthUserId(user: Record<string, unknown> | null): string {
  return typeof user?.id === 'string' ? user.id : '';
}

function createBootstrapTimeoutError(step: string, timeoutMs: number): Error {
  return new Error(`${step} timed out after ${timeoutMs}ms`);
}

async function withBootstrapStepTimeout<T>(
  step: string,
  task: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(createBootstrapTimeoutError(step, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function bootstrapAuthSession(input: {
  flowId: string;
  accessToken: string;
  refreshToken?: string;
  source: 'anonymous' | 'env' | 'persisted';
  resolution?: string;
  clearPersistedSession: () => Promise<void>;
  skipWarmLoads?: boolean;
}): Promise<void> {
  const envToken = String(input.accessToken || '').trim();
  if (!envToken) {
    useAppStore.getState().clearAuthSession();
    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:auto-login:skipped',
      flowId: input.flowId,
      details: {
        reason: 'missing-token',
        source: input.source,
        resolution: input.resolution || 'unknown',
      },
    });
    return;
  }

  try {
    void pingDesktopMacosSmoke('bootstrap-auth-session-start', {
      source: input.source,
      skipWarmLoads: Boolean(input.skipWarmLoads),
    }).catch(() => {});
    const user = await withBootstrapStepTimeout(
      'bootstrap auth user load',
      dataSync.loadCurrentUser(),
      AUTO_LOGIN_USER_LOAD_TIMEOUT_MS,
    );
    const normalizedUser = toAuthUserRecord(user);
    void pingDesktopMacosSmoke('bootstrap-auth-session-user-loaded', {
      userId: readAuthUserId(normalizedUser),
    }).catch(() => {});
    useAppStore.getState().setAuthSession(
      normalizedUser,
      envToken,
      String(input.refreshToken || '').trim() || undefined,
    );
    if (input.source === 'persisted') {
      await persistSharedDesktopSession({
        accessToken: envToken,
        refreshToken: input.refreshToken,
        user: normalizedUser,
      });
    }
    if (input.skipWarmLoads) {
      void pingDesktopMacosSmoke('bootstrap-auth-session-warm-loads-skipped', {
        source: input.source,
      }).catch(() => {});
    } else {
      void pingDesktopMacosSmoke('bootstrap-auth-session-warm-loads-start', {
        source: input.source,
      }).catch(() => {});
      void withBootstrapStepTimeout(
        'bootstrap auth warm loads',
        Promise.allSettled([
          dataSync.loadChats(),
          dataSync.loadContacts(),
        ]),
        AUTO_LOGIN_WARM_LOAD_TIMEOUT_MS,
      )
        .then(() => {
          void pingDesktopMacosSmoke('bootstrap-auth-session-warm-loads-done', {
            source: input.source,
          }).catch(() => {});
        })
        .catch((warmLoadError) => {
          const errorMessage = safeErrorMessage(warmLoadError);
          logRendererEvent({
            level: 'warn',
            area: 'renderer-bootstrap',
            message: 'phase:auto-login:warm-loads-deferred',
            flowId: input.flowId,
            details: {
              error: errorMessage,
              source: input.source,
              resolution: input.resolution || 'unknown',
            },
          });
          void pingDesktopMacosSmoke('bootstrap-auth-session-warm-loads-failed', {
            source: input.source,
            error: errorMessage,
          }).catch(() => {});
        });
    }
    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:auto-login:done',
      flowId: input.flowId,
      details: {
        hasToken: true,
        source: input.source,
        resolution: input.resolution || 'unknown',
      },
    });
    void pingDesktopMacosSmoke('bootstrap-auth-session-done', {
      source: input.source,
      skipWarmLoads: Boolean(input.skipWarmLoads),
    }).catch(() => {});
  } catch (error) {
    const errorMessage = safeErrorMessage(error);
    const expectedUnauthorized = isExpectedUnauthorizedAutoLogin(error);
    useAppStore.getState().clearAuthSession();
    dataSync.setToken('');
    dataSync.setRefreshToken('');
    if (input.source === 'persisted') {
      await input.clearPersistedSession();
    }
    logRendererEvent({
      level: expectedUnauthorized ? 'info' : 'warn',
      area: 'renderer-bootstrap',
      message: expectedUnauthorized
        ? 'phase:auto-login:skipped'
        : 'phase:auto-login:failed',
      flowId: input.flowId,
      details: {
        error: errorMessage,
        reason: expectedUnauthorized ? 'unauthorized' : 'error',
        source: input.source,
        resolution: input.resolution || 'unknown',
      },
    });
    void pingDesktopMacosSmoke('bootstrap-auth-session-failed', {
      source: input.source,
      error: errorMessage,
      reason: expectedUnauthorized ? 'unauthorized' : 'error',
    }).catch(() => {});
  }
}
