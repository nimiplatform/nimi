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

type LogoutTranslate = (
  key: string,
  options?: {
    defaultValue?: string;
    error?: string;
  },
) => string;

type LogoutDependencies = {
  logout: () => Promise<void>;
  clearPersistedAccessToken: () => void;
  clearAllStreams: () => void;
  clearQueryClient: () => void;
  translate: LogoutTranslate;
};

const defaultLogoutDependencies: LogoutDependencies = {
  logout: () => dataSync.logout(),
  clearPersistedAccessToken,
  clearAllStreams,
  clearQueryClient: () => queryClient.clear(),
  translate: i18n.t.bind(i18n),
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

export async function logoutAndClearSession(
  input: LogoutAndClearSessionInput,
  deps: LogoutDependencies = defaultLogoutDependencies,
): Promise<void> {
  let logoutError: unknown = null;

  try {
    await deps.logout();
  } catch (error) {
    logoutError = error;
  }

  deps.clearPersistedAccessToken();
  deps.clearAllStreams();
  input.clearAuthSession();
  deps.clearQueryClient();

  if (logoutError) {
    input.setStatusBanner({
      kind: 'warning',
      message: isTransientLogoutError(logoutError)
        ? deps.translate('Auth.logoutServerTransientFailure', {
          error: toErrorMessage(logoutError),
          defaultValue: 'Signed out locally, but the server logout request could not be confirmed because of a network error. The server session may still be active: {{error}}',
        })
        : deps.translate('Auth.logoutServerFailure', {
          error: toErrorMessage(logoutError),
          defaultValue: 'Signed out locally, but server logout failed. The server session may still be active until it is revoked elsewhere: {{error}}',
        }),
    });
    return;
  }

  input.setStatusBanner({
    kind: 'info',
    message: deps.translate('Auth.logoutSuccess', { defaultValue: 'Signed out' }),
  });
}
