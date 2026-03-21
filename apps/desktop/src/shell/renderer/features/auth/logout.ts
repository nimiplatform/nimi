import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import type { AppStoreState } from '@renderer/app-shell/providers/store-types';
import { clearPersistedAccessToken } from '@nimiplatform/shell-auth';
import { i18n } from '@renderer/i18n';
import { clearAllStreams } from '@renderer/features/turns/stream-controller';

type LogoutAndClearSessionInput = {
  clearAuthSession: AppStoreState['clearAuthSession'];
  setStatusBanner: AppStoreState['setStatusBanner'];
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

function isTransientLogoutError(error: unknown): boolean {
  const message = toErrorMessage(error).toUpperCase();
  return (
    error instanceof TypeError
    || message.includes('NETWORK')
    || message.includes('FETCH')
    || message.includes('TIMEOUT')
    || message.includes('ECONN')
    || message.includes('ETIMEDOUT')
    || message.includes('502')
    || message.includes('503')
    || message.includes('504')
  );
}

export async function logoutAndClearSession(input: LogoutAndClearSessionInput): Promise<void> {
  let logoutError: unknown = null;

  try {
    await dataSync.logout();
  } catch (error) {
    logoutError = error;
  }

  clearPersistedAccessToken();
  clearAllStreams();
  input.clearAuthSession();
  queryClient.clear();

  if (logoutError) {
    input.setStatusBanner({
      kind: 'warning',
      message: isTransientLogoutError(logoutError)
        ? i18n.t('Auth.logoutServerTransientFailure', {
          error: toErrorMessage(logoutError),
          defaultValue: 'Signed out locally, but the server logout request could not be confirmed because of a network error. The server session may still be active: {{error}}',
        })
        : i18n.t('Auth.logoutServerFailure', {
          error: toErrorMessage(logoutError),
          defaultValue: 'Signed out locally, but server logout failed. The server session may still be active until it is revoked elsewhere: {{error}}',
        }),
    });
    return;
  }

  input.setStatusBanner({
    kind: 'info',
    message: i18n.t('Auth.logoutSuccess', { defaultValue: 'Signed out' }),
  });
}
