import { queryClient } from '@renderer/infra/query-client/query-client';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { AppStoreState } from '@renderer/app-shell/providers/store-types';
import { clearPersistedAccessToken } from '@nimiplatform/kit/auth';
import { i18n } from '@renderer/i18n';
import { clearAllStreams } from '@renderer/features/turns/stream-controller';
import {
  getDesktopAccountRuntime,
  getDesktopRuntimeAccountCaller,
} from '@renderer/infra/sdk/desktop-nimi-client-session';

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
    await getDesktopAccountRuntime().account.logout({
      caller: getDesktopRuntimeAccountCaller(),
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

async function emitLogoutFeedback(
  input: LogoutAndClearSessionInput,
  banner: { kind: 'info' | 'warning'; message: string },
): Promise<void> {
  if (input.onFeedback) {
    input.onFeedback(banner);
    return;
  }
  if (input.setStatusBanner) {
    input.setStatusBanner(banner);
    return;
  }
  useAppStore.getState().setStatusBanner(banner);
}

export async function logoutAndClearSession(
  input: LogoutAndClearSessionInput,
  deps: LogoutDependencies = defaultLogoutDependencies,
): Promise<void> {
  try {
    await deps.logout();
  } catch (error) {
    await emitLogoutFeedback(input, {
      kind: 'warning',
      message: isTransientLogoutError(error)
        ? deps.translate('Auth.logoutRuntimeTransientFailure', {
          error: toErrorMessage(error),
          defaultValue: 'Sign out could not be completed because Runtime logout could not be confirmed. The account session may still be active: {{error}}',
        })
        : deps.translate('Auth.logoutRuntimeFailure', {
          error: toErrorMessage(error),
          defaultValue: 'Sign out could not be completed because Runtime logout failed. The account session may still be active: {{error}}',
        }),
    });
    return;
  }

  await deps.clearPersistedSession();
  deps.clearAllStreams();
  input.clearAuthSession();
  deps.clearQueryClient();

  await emitLogoutFeedback(input, {
    kind: 'info',
    message: deps.translate('Auth.logoutSuccess', { defaultValue: 'Signed out' }),
  });
}
