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
  logout: () => Promise<void | {
    accepted: boolean;
    reasonCode?: unknown;
    accountReasonCode?: unknown;
  }>;
  clearPersistedSession: () => Promise<void> | void;
  clearAllStreams: () => void;
  clearQueryClient: () => void;
  translate: LogoutTranslate;
};

type SwitchAccountDependencies = Omit<LogoutDependencies, 'logout'> & {
  switchAccount: () => Promise<void>;
};

const defaultLogoutDependencies: LogoutDependencies = {
  logout: async () => {
    return getDesktopAccountRuntime().account.logout({
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

const defaultSwitchAccountDependencies: SwitchAccountDependencies = {
  switchAccount: async () => {
    const response = await getDesktopAccountRuntime().account.switchAccount({
      caller: getDesktopRuntimeAccountCaller(),
      reason: 'desktop_switch_account',
    });
    if (!response.accepted) {
      throw new Error(String(response.accountReasonCode || response.reasonCode || 'runtime_switch_account_rejected'));
    }
  },
  clearPersistedSession: defaultLogoutDependencies.clearPersistedSession,
  clearAllStreams: defaultLogoutDependencies.clearAllStreams,
  clearQueryClient: defaultLogoutDependencies.clearQueryClient,
  translate: defaultLogoutDependencies.translate,
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
    const response = await deps.logout();
    if (response && !response.accepted) {
      throw new Error(String(
        response.accountReasonCode
        || response.reasonCode
        || 'runtime_logout_rejected'
      ));
    }
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

export async function switchAccountAndClearSession(
  input: LogoutAndClearSessionInput,
  deps: SwitchAccountDependencies = defaultSwitchAccountDependencies,
): Promise<boolean> {
  try {
    await deps.switchAccount();
  } catch (error) {
    await emitLogoutFeedback(input, {
      kind: 'warning',
      message: deps.translate('Auth.switchAccountRuntimeFailure', {
        error: toErrorMessage(error),
        defaultValue: 'Account switch could not start because Runtime did not confirm the switch: {{error}}',
      }),
    });
    return false;
  }

  await deps.clearPersistedSession();
  deps.clearAllStreams();
  input.clearAuthSession();
  deps.clearQueryClient();
  await emitLogoutFeedback(input, {
    kind: 'info',
    message: deps.translate('Auth.switchAccountReady', { defaultValue: 'Choose another account to continue' }),
  });
  return true;
}
