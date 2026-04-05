import { dataSync } from '@runtime/data-sync';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { toAuthUserRecord } from '@renderer/features/auth/auth-session-utils';
import { persistSharedDesktopSession } from '@renderer/features/auth/shared-auth-session';
import { safeErrorMessage } from './runtime-bootstrap-utils';

function isExpectedUnauthorizedAutoLogin(error: unknown): boolean {
  const message = safeErrorMessage(error).toUpperCase();
  return message.includes('HTTP_401') || message.includes('UNAUTHORIZED');
}

export async function bootstrapAuthSession(input: {
  flowId: string;
  accessToken: string;
  refreshToken?: string;
  source: 'anonymous' | 'env' | 'persisted';
  resolution?: string;
  clearPersistedSession: () => Promise<void>;
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
    const user = await dataSync.loadCurrentUser();
    const normalizedUser = toAuthUserRecord(user);
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
    await Promise.allSettled([
      dataSync.loadChats(),
      dataSync.loadContacts(),
    ]);
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
  }
}
