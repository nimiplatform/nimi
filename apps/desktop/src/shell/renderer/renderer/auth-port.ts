import type {
  DesktopBrowserAuthRuntimeBroker,
} from '@nimiplatform/kit/auth/shell';
import type { ShellOAuthCodeBridge } from '@nimiplatform/kit/core/oauth';

export interface DesktopRendererAuthPort {
  readonly oauthBridge: ShellOAuthCodeBridge;
  readonly runtimeAccountBroker: DesktopBrowserAuthRuntimeBroker;
}

function authUnadmitted(): never {
  throw new Error('DESKTOP_SIMULATOR_AUTH_UNADMITTED');
}

export function createUnavailableDesktopRendererAuthPort(): DesktopRendererAuthPort {
  return Object.freeze({
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
