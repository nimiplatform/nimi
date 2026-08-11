import type {
  AuthPlatformAdapter,
  ShellAuthDesktopBrowserAuthRuntimeBroker,
} from '@nimiplatform/kit/auth/shell';
import type { ShellOAuthCodeBridge } from '@nimiplatform/kit/core/oauth';

export interface DesktopRendererAuthPort {
  readonly adapter: AuthPlatformAdapter;
  readonly oauthBridge: ShellOAuthCodeBridge;
  readonly runtimeAccountBroker: ShellAuthDesktopBrowserAuthRuntimeBroker;
}

function authUnadmitted(): never {
  throw new Error('DESKTOP_SIMULATOR_AUTH_UNADMITTED');
}

export function createUnavailableDesktopRendererAuthPort(): DesktopRendererAuthPort {
  return Object.freeze({
    adapter: Object.freeze({
      supportsPasswordLogin: false,
      checkEmail: async () => authUnadmitted(),
      passwordLogin: async () => authUnadmitted(),
      requestEmailOtp: async () => authUnadmitted(),
      verifyEmailOtp: async () => authUnadmitted(),
      verifyTwoFactor: async () => authUnadmitted(),
      walletChallenge: async () => authUnadmitted(),
      walletLogin: async () => authUnadmitted(),
      oauthLogin: async () => authUnadmitted(),
      updatePassword: async () => authUnadmitted(),
      loadCurrentUser: async () => null,
      applyToken: async () => authUnadmitted(),
      restoreSession: async () => authUnadmitted(),
      persistSession: async () => authUnadmitted(),
      clearPersistedSession: async () => authUnadmitted(),
      oauthBridge: Object.freeze({
        hasShellHostInvoke: () => false,
        oauthListenForCode: async () => authUnadmitted(),
        openExternalUrl: async () => authUnadmitted(),
        focusMainWindow: async () => authUnadmitted(),
      }),
    }),
    oauthBridge: Object.freeze({
      hasShellHostInvoke: () => false,
      oauthListenForCode: async () => authUnadmitted(),
      openExternalUrl: async () => authUnadmitted(),
      focusMainWindow: async () => authUnadmitted(),
    }),
    runtimeAccountBroker: Object.freeze({
      begin: async () => authUnadmitted(),
      complete: async () => authUnadmitted(),
    }),
  });
}
