import type { NimiClient } from '@nimiplatform/sdk';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/wire-types';
import {
  createRuntimeAccountDesktopBrowserAuth,
  type RuntimeAccountDesktopBrowserAuthClient,
} from '@nimiplatform/kit/auth';
import type {
  AuthPlatformAdapter,
  ShellAuthDesktopBrowserAuth,
} from '@nimiplatform/kit/auth/shell';
import { createStandardShellOAuthBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  getRuntimeAccountCaller,
  runtimeAccountLoginEnabled,
} from './runtime-platform';

export { getRuntimeAccountCaller };

export const zhiyuShellOAuthBridge = createStandardShellOAuthBridge();

type RuntimeAccountClient = RuntimeAccountDesktopBrowserAuthClient & Pick<NimiClient, 'runtime'>;

function createZhiyuRuntimeAccountAuth(client: RuntimeAccountClient | NimiClient) {
  return createRuntimeAccountDesktopBrowserAuth({
    caller: getRuntimeAccountCaller(),
    getClient: () => client as RuntimeAccountClient,
    isAuthenticatedState: (state) => state === AccountSessionState.AUTHENTICATED,
    loginEnabled: runtimeAccountLoginEnabled,
    disabledMessage: 'Zhiyu uses the single Runtime account login model; standalone renderer credentials are forbidden.',
    logoutReason: 'zhiyu_logout',
    userDisplayFallback: 'Runtime account',
  });
}

export async function loadRuntimeAccountUser(client: RuntimeAccountClient | NimiClient) {
  return createZhiyuRuntimeAccountAuth(client).loadCurrentUser();
}

export async function logoutRuntimeAccount(client: RuntimeAccountClient | NimiClient): Promise<void> {
  await createZhiyuRuntimeAccountAuth(client).logout();
}

export function createZhiyuRuntimeAccountBroker(
  client: RuntimeAccountClient | NimiClient,
): ShellAuthDesktopBrowserAuth['runtimeAccountBroker'] {
  return createZhiyuRuntimeAccountAuth(client).createRuntimeAccountBroker();
}

export function createZhiyuDesktopBrowserAuthAdapter(
  onLoginComplete: () => void | Promise<void>,
  client: RuntimeAccountClient | NimiClient,
): AuthPlatformAdapter {
  const adapter = createZhiyuRuntimeAccountAuth(client).createDesktopBrowserAuthAdapter(onLoginComplete);
  return {
    ...adapter,
    oauthBridge: zhiyuShellOAuthBridge,
  };
}
