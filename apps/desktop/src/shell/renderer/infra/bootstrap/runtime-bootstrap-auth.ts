import { dataSync } from '@runtime/data-sync';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { toAuthUserRecord } from '@renderer/features/auth/auth-session-utils';
import { safeErrorMessage } from './runtime-bootstrap-utils';

function isExpectedUnauthorizedAutoLogin(error: unknown): boolean {
  const message = safeErrorMessage(error).toUpperCase();
  return message.includes('HTTP_401') || message.includes('UNAUTHORIZED');
}

export async function bootstrapAuthSession(input: {
  flowId: string;
  accessToken: string;
}): Promise<void> {
  const envToken = String(input.accessToken || '').trim();
  if (!envToken) {
    useAppStore.getState().clearAuthSession();
    return;
  }

  try {
    const user = await dataSync.loadCurrentUser();
    useAppStore.getState().setAuthSession(
      toAuthUserRecord(user),
      envToken,
    );
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
      },
    });
  } catch (error) {
    const errorMessage = safeErrorMessage(error);
    const expectedUnauthorized = isExpectedUnauthorizedAutoLogin(error);
    useAppStore.getState().clearAuthSession();
    dataSync.setToken('');
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
      },
    });
  }
}
