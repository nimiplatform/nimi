import { getPlatformClient } from '@nimiplatform/sdk';
import { createDesktopShellRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';

const desktopAccountCaller = createDesktopShellRuntimeAccountCaller({ appId: 'nimi.desktop' });

export async function getDesktopRuntimeAccessToken(requestedScopes: string[] = []): Promise<string> {
  const result = await getPlatformClient().runtime.account.getAccessToken({
    caller: desktopAccountCaller,
    requestedScopes,
  });
  const token = String(result.accessToken || '').trim();
  if (!result.accepted || !token) {
    const reason = String(result.reasonCode || result.accountReasonCode || 'runtime_access_token_unavailable');
    throw new Error(reason);
  }
  return token;
}
