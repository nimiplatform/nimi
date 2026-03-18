// ---------------------------------------------------------------------------
// Social OAuth — extracted from Desktop, parameterized on TauriOAuthBridge
// ---------------------------------------------------------------------------

import type { TauriOAuthBridge } from './oauth-types.js';
import {
  createDesktopCallbackRedirectUri,
  createDesktopCallbackState,
  readEnv,
  toDesktopBrowserAuthErrorMessage,
} from './oauth-helpers.js';

const DEFAULT_AUTHORIZE_URL: Record<SocialOauthProvider, string> = {
  TWITTER: 'https://twitter.com/i/oauth2/authorize',
  TIKTOK: 'https://www.tiktok.com/v2/auth/authorize/',
};

const DEFAULT_TOKEN_URL: Record<SocialOauthProvider, string> = {
  TWITTER: 'https://api.twitter.com/2/oauth2/token',
  TIKTOK: 'https://open.tiktokapis.com/v2/oauth/token/',
};

const DEFAULT_SCOPE: Record<SocialOauthProvider, string> = {
  TWITTER: 'tweet.read users.read offline.access',
  TIKTOK: 'user.info.basic',
};

export type SocialOauthProvider = 'TWITTER' | 'TIKTOK';

export type SocialOauthConfig = {
  provider: SocialOauthProvider;
  label: string;
  enabled: boolean;
  disabledReason: string;
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientSecret: string;
  authorizeExtra: Record<string, string>;
  tokenExtra: Record<string, string>;
};

type SocialOauthResult = {
  provider: SocialOauthProvider;
  accessToken: string;
  refreshToken?: string;
};

function readProviderEnv(provider: SocialOauthProvider, suffix: string): string {
  return readEnv(`VITE_NIMI_${provider}_${suffix}`)
    || readEnv(`VITE_${provider}_${suffix}`);
}

function parseExtra(value: string): Record<string, string> {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return {};
  }
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const output: Record<string, string> = {};
    for (const [key, raw] of Object.entries(parsed)) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) continue;
      output[normalizedKey] = String(raw ?? '');
    }
    return output;
  } catch {
    return {};
  }
}

function resolveProviderLabel(provider: SocialOauthProvider): string {
  return provider === 'TWITTER' ? 'Twitter' : 'TikTok';
}

function normalizeProviderUrl(value: string, fallback: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallback;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

export function resolveSocialOauthConfig(
  provider: SocialOauthProvider,
  bridge: TauriOAuthBridge,
): SocialOauthConfig {
  const label = resolveProviderLabel(provider);
  const clientId = readProviderEnv(provider, 'CLIENT_ID').trim();
  const clientSecret = readProviderEnv(provider, 'CLIENT_SECRET').trim();
  const authorizeUrl = normalizeProviderUrl(
    readProviderEnv(provider, 'AUTHORIZE_URL'),
    DEFAULT_AUTHORIZE_URL[provider],
  );
  const tokenUrl = normalizeProviderUrl(
    readProviderEnv(provider, 'TOKEN_URL'),
    DEFAULT_TOKEN_URL[provider],
  );
  const scope = (readProviderEnv(provider, 'SCOPE').trim() || DEFAULT_SCOPE[provider]).trim();
  const authorizeExtra = parseExtra(readProviderEnv(provider, 'AUTHORIZE_EXTRA'));
  const tokenExtra = parseExtra(readProviderEnv(provider, 'TOKEN_EXTRA'));

  let disabledReason = '';
  if (!bridge.hasTauriInvoke()) {
    disabledReason = `${label} OAuth requires desktop runtime`;
  } else if (!clientId) {
    disabledReason = `Missing ${provider} OAuth client ID`;
  } else if (!scope) {
    disabledReason = `Missing ${provider} OAuth scope`;
  }

  return {
    provider,
    label,
    enabled: !disabledReason,
    disabledReason,
    clientId,
    authorizeUrl,
    tokenUrl,
    scope,
    clientSecret,
    authorizeExtra,
    tokenExtra,
  };
}

function base64UrlEncode(data: Uint8Array): string {
  let binary = '';
  for (const value of data) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function createCodeVerifier(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 18)}`;
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const encoder = new TextEncoder();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier));
    return base64UrlEncode(new Uint8Array(digest));
  }
  return codeVerifier;
}

function buildAuthorizeUrl(input: {
  config: SocialOauthConfig;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(input.config.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.config.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.config.scope);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (input.config.provider === 'TIKTOK' && !url.searchParams.has('client_key')) {
    url.searchParams.set('client_key', input.config.clientId);
  }
  for (const [key, value] of Object.entries(input.config.authorizeExtra)) {
    if (!String(key || '').trim()) continue;
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function startSocialOauth(
  provider: SocialOauthProvider,
  bridge: TauriOAuthBridge,
): Promise<SocialOauthResult> {
  const config = resolveSocialOauthConfig(provider, bridge);
  if (!config.enabled) {
    throw new Error(config.disabledReason || `${config.label} OAuth is unavailable`);
  }

  const callbackUrl = createDesktopCallbackRedirectUri();
  const callbackState = createDesktopCallbackState();
  const codeVerifier = createCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const authorizeUrl = buildAuthorizeUrl({
    config,
    redirectUri: callbackUrl,
    state: callbackState,
    codeChallenge,
  });

  const listenTask = bridge.oauthListenForCode({
    redirectUri: callbackUrl,
  });

  try {
    const launchResult = await bridge.openExternalUrl(authorizeUrl);
    if (!launchResult.opened) {
      throw new Error('Unable to open system browser for OAuth login');
    }

    const callback = await listenTask;
    void bridge.focusMainWindow().catch(() => undefined);
    if (callback.error) {
      throw new Error(`${config.label} OAuth callback error: ${callback.error}`);
    }

    const callbackStateFromWeb = String(callback.state || '').trim();
    if (!callbackStateFromWeb || callbackStateFromWeb !== callbackState) {
      throw new Error(`${config.label} OAuth state mismatch`);
    }

    const code = String(callback.code || '').trim();
    if (!code) {
      throw new Error(`${config.label} OAuth callback missing code`);
    }

    const tokenExtra = {
      ...config.tokenExtra,
    };
    if (provider === 'TIKTOK' && !tokenExtra.client_key) {
      tokenExtra.client_key = config.clientId;
    }

    const exchange = await bridge.oauthTokenExchange({
      tokenUrl: config.tokenUrl,
      clientId: config.clientId,
      code,
      codeVerifier,
      redirectUri: callbackUrl,
      clientSecret: config.clientSecret || undefined,
      extra: Object.keys(tokenExtra).length > 0 ? tokenExtra : undefined,
    });

    return {
      provider,
      accessToken: exchange.accessToken,
      refreshToken: exchange.refreshToken,
    };
  } catch (error) {
    throw new Error(toDesktopBrowserAuthErrorMessage(error), { cause: error });
  } finally {
    void listenTask.catch(() => undefined);
  }
}

export function toOauthProvider(provider: SocialOauthProvider): string {
  return provider === 'TWITTER' ? 'TWITTER' : 'TIKTOK';
}
