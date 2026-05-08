import { createNimiError } from '@nimiplatform/sdk/runtime';
import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';
import {
  parseOauthListenForCodeResult,
  parseOauthTokenExchangeResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
} from './types';

function createDesktopOauthError(reasonCode: string, message: string) {
  return createNimiError({
    message,
    reasonCode,
    actionHint: 'check_desktop_bridge_config',
    source: 'runtime',
  });
}

export async function oauthTokenExchange(
  payload: OauthTokenExchangePayload,
): Promise<OauthTokenExchangeResult> {
  const provider = String(payload.provider || '').trim();
  const clientId = String(payload.clientId || '').trim();
  const code = String(payload.code || '').trim();
  if (!provider || !clientId || !code) {
    throw createDesktopOauthError('DESKTOP_OAUTH_TOKEN_EXCHANGE_INPUT_INVALID', 'provider, clientId, and code are required');
  }

  if (!hasTauriInvoke()) {
    throw createDesktopOauthError('DESKTOP_OAUTH_TOKEN_EXCHANGE_UNAVAILABLE', 'OAuth token exchange requires the Tauri runtime');
  }

  return invokeChecked('oauth_token_exchange', {
    payload: {
      provider,
      clientId,
      code,
      codeVerifier: payload.codeVerifier,
      redirectUri: payload.redirectUri,
    },
  }, parseOauthTokenExchangeResult);
}

export async function oauthListenForCode(
  payload: OauthListenForCodePayload,
): Promise<OauthListenForCodeResult> {
  const redirectUri = String(payload.redirectUri || '').trim();
  if (!redirectUri) {
    throw createDesktopOauthError('DESKTOP_OAUTH_REDIRECT_URI_REQUIRED', 'redirectUri is required');
  }

  if (!hasTauriInvoke()) {
    throw createDesktopOauthError('DESKTOP_OAUTH_LISTEN_UNAVAILABLE', 'oauth_listen_for_code requires the Tauri runtime');
  }

  return invokeChecked('oauth_listen_for_code', {
    payload: {
      redirectUri,
      timeoutMs: payload.timeoutMs,
    },
  }, parseOauthListenForCodeResult);
}
