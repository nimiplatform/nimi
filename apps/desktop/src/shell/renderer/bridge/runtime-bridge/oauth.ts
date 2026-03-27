import { createNimiError } from '@nimiplatform/sdk/runtime';
import { assertRecord } from './shared.js';
import { hasTauriInvoke, nativeFetch } from './env';
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
  const tokenUrl = String(payload.tokenUrl || '').trim();
  const clientId = String(payload.clientId || '').trim();
  const code = String(payload.code || '').trim();
  if (!tokenUrl || !clientId || !code) {
    throw createDesktopOauthError('DESKTOP_OAUTH_TOKEN_EXCHANGE_INPUT_INVALID', 'tokenUrl, clientId, and code are required');
  }

  if (!hasTauriInvoke()) {
    if (!nativeFetch) {
      throw createDesktopOauthError('DESKTOP_OAUTH_TOKEN_EXCHANGE_UNAVAILABLE', 'OAuth token exchange is unavailable in the current environment');
    }
    const form = new URLSearchParams();
    form.set('grant_type', 'authorization_code');
    form.set('client_id', clientId);
    form.set('code', code);
    if (payload.codeVerifier) {
      form.set('code_verifier', String(payload.codeVerifier));
    }
    if (payload.redirectUri) {
      form.set('redirect_uri', String(payload.redirectUri));
    }
    if (payload.clientSecret) {
      form.set('client_secret', String(payload.clientSecret));
    }
    if (payload.extra) {
      for (const [key, value] of Object.entries(payload.extra)) {
        if (String(key || '').trim()) {
          form.set(key, String(value || ''));
        }
      }
    }

    const response = await nativeFetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`OAuth token exchange failed: HTTP ${response.status} ${body.slice(0, 200)}`);
    }
    const parsed = assertRecord(JSON.parse(body), 'oauth_token_exchange returned invalid JSON payload');
    const accessToken = String(parsed.access_token || '').trim();
    if (!accessToken) {
      throw createDesktopOauthError('DESKTOP_OAUTH_TOKEN_EXCHANGE_RESPONSE_INVALID', 'OAuth token response is missing access_token');
    }
    return parseOauthTokenExchangeResult({
      accessToken,
      refreshToken: typeof parsed.refresh_token === 'string' ? parsed.refresh_token : undefined,
      tokenType: typeof parsed.token_type === 'string' ? parsed.token_type : undefined,
      expiresIn: typeof parsed.expires_in === 'number' ? parsed.expires_in : undefined,
      scope: typeof parsed.scope === 'string' ? parsed.scope : undefined,
      raw: parsed,
    });
  }

  return invokeChecked('oauth_token_exchange', {
    payload: {
      tokenUrl,
      clientId,
      code,
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
