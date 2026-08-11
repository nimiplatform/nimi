import { hasShellHostInvoke } from './env.js';
import { invokeChecked } from './invoke.js';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  parseOauthListenForCodeResult,
  type ShellOAuthCodeBridge,
  type OauthListenForCodePayload,
  type OauthListenForCodeResult,
} from '@nimiplatform/kit/core/oauth';
import { focusMainWindow, openExternalUrl } from './ui.js';

export async function oauthListenForCode(
  payload: OauthListenForCodePayload,
): Promise<OauthListenForCodeResult> {
  return invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['oauth.listenForCode'], {
    payload: {
      redirectUri: payload.redirectUri,
      timeoutMs: payload.timeoutMs,
    },
  }, parseOauthListenForCodeResult);
}

export function createStandardShellOAuthCodeBridge(): ShellOAuthCodeBridge {
  return {
    hasShellHostInvoke,
    oauthListenForCode,
    openExternalUrl: async (url: string) => openExternalUrl(url),
    focusMainWindow,
  };
}
