import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AppStoreState } from '../../app-shell/providers/store-types';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useStreamController } from '../turns/stream-controller-context.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

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
  clearAllStreams: () => void;
  clearQueryClient: () => void;
  translate: LogoutTranslate;
};

type SwitchAccountDependencies = Omit<LogoutDependencies, 'logout'> & {
  switchAccount: () => Promise<void>;
};

export function useLogoutSessionDependencies(): {
  readonly logout: LogoutDependencies;
  readonly switchAccount: SwitchAccountDependencies;
  readonly feedback: NonNullable<LogoutAndClearSessionInput['onFeedback']>;
} {
  const queryClient = useQueryClient();
  const i18n = useDesktopI18nResource().instance;
  const streamController = useStreamController();
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const sdk = useDesktopRendererSdk();
  return useMemo(() => {
    const shared = {
      clearAllStreams: streamController.clearAllStreams,
      clearQueryClient: () => queryClient.clear(),
      translate: i18n.t.bind(i18n),
    };
    return {
      logout: {
        ...shared,
        logout: () => sdk.accountRuntime().account.logout({
          caller: sdk.accountCaller(),
          reason: 'desktop_logout',
        }),
      },
      switchAccount: {
        ...shared,
        async switchAccount() {
          const response = await sdk.accountRuntime().account.switchAccount({
            caller: sdk.accountCaller(),
            reason: 'desktop_switch_account',
          });
          if (!response.accepted) {
            throw new Error(String(response.accountReasonCode || response.reasonCode || 'runtime_switch_account_rejected'));
          }
        },
      },
      feedback: setStatusBanner,
    };
  }, [i18n, queryClient, sdk, setStatusBanner, streamController]);
}

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
  throw new Error('LOGOUT_FEEDBACK_SINK_REQUIRED');
}

export async function logoutAndClearSession(
  input: LogoutAndClearSessionInput,
  deps: LogoutDependencies,
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
  deps: SwitchAccountDependencies,
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

  deps.clearAllStreams();
  input.clearAuthSession();
  deps.clearQueryClient();
  await emitLogoutFeedback(input, {
    kind: 'info',
    message: deps.translate('Auth.switchAccountReady', { defaultValue: 'Choose another account to continue' }),
  });
  return true;
}
