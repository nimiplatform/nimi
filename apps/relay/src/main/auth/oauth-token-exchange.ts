// RL-BOOT-005 — OAuth Token Exchange (Node.js implementation)
// Equivalent to Tauri's oauth_token_exchange command

import type {
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
} from '@nimiplatform/nimi-kit/core/oauth';

/**
 * Exchange an OAuth authorization code for tokens.
 * Posts form-urlencoded data to the token URL, parses the JSON response.
 *
 * Security: token URL must be HTTPS or loopback HTTP.
 */
export async function performOauthTokenExchange(
  payload: OauthTokenExchangePayload,
): Promise<OauthTokenExchangeResult> {
  const tokenUrl = String(payload.tokenUrl || '').trim();
  const clientId = String(payload.clientId || '').trim();
  const code = String(payload.code || '').trim();

  if (!tokenUrl || !clientId || !code) {
    throw new Error('tokenUrl/clientId/code are required');
  }

  // Security: only allow HTTPS or loopback HTTP
  const parsed = new URL(tokenUrl);
  const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
    throw new Error(`Refusing token exchange to non-HTTPS URL: ${tokenUrl}`);
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

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed: HTTP ${response.status}`);
  }

  const data = JSON.parse(body) as Record<string, unknown>;
  const accessToken = String(data.access_token || '').trim();
  if (!accessToken) {
    throw new Error('OAuth token response missing access_token');
  }

  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    tokenType: typeof data.token_type === 'string' ? data.token_type : undefined,
    expiresIn: typeof data.expires_in === 'number' ? data.expires_in : undefined,
    scope: typeof data.scope === 'string' ? data.scope : undefined,
    raw: data,
  };
}
