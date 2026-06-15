import { hasTauriInvoke } from './env.js';
import { invokeChecked } from './invoke.js';
import {
  parseOauthTokenExchangeResult,
  parseOauthListenForCodeResult,
  type TauriOAuthBridge,
  type TauriOAuthCodeBridge,
  type OauthTokenExchangePayload,
  type OauthTokenExchangeResult,
  type OauthListenForCodePayload,
  type OauthListenForCodeResult,
} from '@nimiplatform/kit/core/oauth';
import { focusMainWindow, openExternalUrl } from './ui.js';

export async function oauthTokenExchange(
  payload: OauthTokenExchangePayload,
): Promise<OauthTokenExchangeResult> {
  return invokeChecked('oauth_token_exchange', {
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
  return invokeChecked('oauth_listen_for_code', {
    payload: {
      redirectUri: payload.redirectUri,
      timeoutMs: payload.timeoutMs,
    },
  }, parseOauthListenForCodeResult);
}

export function createTauriOAuthCodeBridge(): TauriOAuthCodeBridge {
  return {
    hasTauriInvoke,
    oauthListenForCode,
    openExternalUrl: async (url: string) => openExternalUrl(url),
    focusMainWindow,
  };
}

export function createTauriOAuthBridge(): TauriOAuthBridge {
  return {
    ...createTauriOAuthCodeBridge(),
    oauthTokenExchange,
  };
}
