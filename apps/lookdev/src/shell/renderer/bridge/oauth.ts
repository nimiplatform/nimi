import { hasTauriInvoke } from './env.js';
import { invoke, invokeChecked } from './invoke.js';
import {
  parseOauthTokenExchangeResult,
  parseOauthListenForCodeResult,
  parseOpenExternalUrlResult,
  type TauriOAuthBridge,
  type OauthTokenExchangePayload,
  type OauthTokenExchangeResult,
  type OauthListenForCodePayload,
  type OauthListenForCodeResult,
  type OpenExternalUrlResult,
} from '@nimiplatform/nimi-kit/core/oauth';

export async function oauthTokenExchange(
  payload: OauthTokenExchangePayload,
): Promise<OauthTokenExchangeResult> {
  return invokeChecked('oauth_token_exchange', {
    payload: {
      tokenUrl: payload.tokenUrl,
      clientId: payload.clientId,
      code: payload.code,
      codeVerifier: payload.codeVerifier,
      redirectUri: payload.redirectUri,
      clientSecret: payload.clientSecret,
      extra: payload.extra,
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

export async function openExternalUrl(
  url: string,
): Promise<OpenExternalUrlResult> {
  return invokeChecked('open_external_url', {
    payload: { url },
  }, parseOpenExternalUrlResult);
}

export async function focusMainWindow(): Promise<void> {
  try {
    await invoke('focus_main_window', {});
  } catch {
    // Focus is best-effort; Forge may not have this command
  }
}

export const lookdevTauriOAuthBridge: TauriOAuthBridge = {
  hasTauriInvoke,
  oauthListenForCode,
  oauthTokenExchange,
  openExternalUrl: async (url: string) => openExternalUrl(url),
  focusMainWindow,
};
