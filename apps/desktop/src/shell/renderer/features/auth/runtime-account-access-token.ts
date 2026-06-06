import {
  getDesktopAccountRuntime,
  getDesktopRuntimeAccountCaller,
} from '@renderer/infra/sdk/desktop-nimi-client-session';

export async function getDesktopRuntimeAccessToken(requestedScopes: string[] = []): Promise<string> {
  const result = await getDesktopAccountRuntime().account.getAccessToken({
    caller: getDesktopRuntimeAccountCaller(),
    requestedScopes,
  });
  const token = String(result.accessToken || '').trim();
  if (!result.accepted || !token) {
    const reason = String(result.reasonCode || result.accountReasonCode || 'runtime_access_token_unavailable');
    throw new Error(reason);
  }
  return token;
}
