import { hasTauriInvoke } from './runtime-bridge/env.js';
import { invoke } from './runtime-bridge/invoke.js';
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
} from '@nimiplatform/shell-core/oauth';

export async function oauthTokenExchange(
  payload: OauthTokenExchangePayload,
): Promise<OauthTokenExchangeResult> {
  const raw = await invoke('oauth_token_exchange', {
    payload: {
      tokenUrl: payload.tokenUrl,
      clientId: payload.clientId,
      code: payload.code,
      codeVerifier: payload.codeVerifier,
      redirectUri: payload.redirectUri,
      clientSecret: payload.clientSecret,
      extra: payload.extra,
    },
  });
  return parseOauthTokenExchangeResult(raw);
}

export async function oauthListenForCode(
  payload: OauthListenForCodePayload,
): Promise<OauthListenForCodeResult> {
  const raw = await invoke('oauth_listen_for_code', {
    payload: {
      redirectUri: payload.redirectUri,
      timeoutMs: payload.timeoutMs,
    },
  });
  return parseOauthListenForCodeResult(raw);
}

export async function openExternalUrl(
  url: string,
): Promise<OpenExternalUrlResult> {
  const raw = await invoke('open_external_url', {
    payload: { url },
  });
  return parseOpenExternalUrlResult(raw);
}

export async function focusMainWindow(): Promise<void> {
  try {
    await invoke('focus_main_window', {});
  } catch {
    // Focus is best-effort; Overtone may not have this command
  }
}

export const overtoneTauriOAuthBridge: TauriOAuthBridge = {
  hasTauriInvoke,
  oauthListenForCode,
  oauthTokenExchange,
  openExternalUrl: async (url: string) => openExternalUrl(url),
  focusMainWindow,
};
