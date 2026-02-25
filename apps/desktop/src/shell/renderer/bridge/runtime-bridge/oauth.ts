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

export async function oauthTokenExchange(
  payload: OauthTokenExchangePayload,
): Promise<OauthTokenExchangeResult> {
  const tokenUrl = String(payload.tokenUrl || '').trim();
  const clientId = String(payload.clientId || '').trim();
  const code = String(payload.code || '').trim();
  if (!tokenUrl || !clientId || !code) {
    throw new Error('tokenUrl/clientId/code 不能为空');
  }

  if (!hasTauriInvoke()) {
    if (!nativeFetch) {
      throw new Error('当前环境不支持 OAuth token exchange');
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
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const accessToken = String(parsed.access_token || '').trim();
    if (!accessToken) {
      throw new Error('OAuth token 响应缺少 access_token');
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
    throw new Error('redirectUri 不能为空');
  }

  if (!hasTauriInvoke()) {
    throw new Error('oauth_listen_for_code 仅支持 Tauri 运行时');
  }

  return invokeChecked('oauth_listen_for_code', {
    payload: {
      redirectUri,
      timeoutMs: payload.timeoutMs,
    },
  }, parseOauthListenForCodeResult);
}
