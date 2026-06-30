import { hasShellHostInvoke } from './env.js';
import { invokeChecked } from './invoke.js';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  parseOauthTokenExchangeResult,
  parseOauthListenForCodeResult,
  type ShellOAuthBridge,
  type ShellOAuthCodeBridge,
  type OauthTokenExchangePayload,
  type OauthTokenExchangeResult,
  type OauthListenForCodePayload,
  type OauthListenForCodeResult,
} from '@nimiplatform/kit/core/oauth';
import { focusMainWindow, openExternalUrl } from './ui.js';

export async function oauthTokenExchange(
  payload: OauthTokenExchangePayload,
): Promise<OauthTokenExchangeResult> {
  return invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange'], {
    payload: {
      provider: payload.provider,
      clientId: payload.clientId,
      code: payload.code,
      codeVerifier: payload.codeVerifier,
      redirectUri: payload.redirectUri,
    },
  }, parseOauthTokenExchangeResult);
}

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

export function createStandardShellOAuthBridge(): ShellOAuthBridge {
  return {
    ...createStandardShellOAuthCodeBridge(),
    oauthTokenExchange,
  };
}
