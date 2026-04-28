import { queryClient } from '@renderer/infra/query-client/query-client';
import type { AppStoreState } from '@renderer/app-shell/providers/store-types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { clearPersistedAccessToken } from '@nimiplatform/nimi-kit/auth';
import { getPlatformClient } from '@nimiplatform/sdk';
import { i18n } from '@renderer/i18n';
import { clearAllStreams } from '@renderer/features/turns/stream-controller';

type LogoutAndClearSessionInput = {
  clearAuthSession: AppStoreState['clearAuthSession'];
  setStatusBanner?: AppStoreState['setStatusBanner'];
  onFeedback?: (banner: { kind: 'info' | 'warning'; message: string }) => void;
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
  clearPersistedSession: () => Promise<void> | void;
  clearAllStreams: () => void;
  clearQueryClient: () => void;
  translate: LogoutTranslate;
};

const defaultLogoutDependencies: LogoutDependencies = {
  logout: async () => {
    await getPlatformClient().runtime.account.logout({
      caller: {
        appId: 'nimi.desktop',
        appInstanceId: 'nimi.desktop.local-first-party',
        deviceId: 'desktop-shell',
        mode: 2,
        scopes: [],
      },
      reason: 'desktop_logout',
    });
  },
  clearPersistedSession: async () => {
    clearPersistedAccessToken();
  },
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

  await deps.clearPersistedSession();
  deps.clearAllStreams();
  input.clearAuthSession();
  deps.clearQueryClient();

  const emitFeedback = (banner: { kind: 'info' | 'warning'; message: string }) => {
    if (input.onFeedback) {
      input.onFeedback(banner);
      return;
    }
    if (input.setStatusBanner) {
      input.setStatusBanner(banner);
      return;
    }
    useAppStore.getState().setStatusBanner(banner);
  };

  if (logoutError) {
    emitFeedback({
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

  emitFeedback({
    kind: 'info',
    message: deps.translate('Auth.logoutSuccess', { defaultValue: 'Signed out' }),
  });
}
