import {
  NIMI_REALM_OAUTH_PROVIDER,
  linkNimiRealmOAuth,
  loginNimiRealmOAuth,
  toNimiRealmAuthUserRecord,
  type NimiRealmOAuthLoginResult,
} from '@nimiplatform/sdk/realm';
import { ReasonCode, createNimiError } from '@nimiplatform/sdk/types';
import { createWebBrowserRealm } from './browser-realm.js';
import { readValidatedOauthNext } from './oauth-continuation.js';

const TIKTOK_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_SCOPE = 'user.info.basic';
const PENDING_LINK_KEY = 'nimi.web.account-provider-oauth.v1';
const PENDING_LINK_MAX_AGE_MS = 10 * 60 * 1000;

type PendingProviderLink = {
  provider: 'TIKTOK';
  mode: 'login' | 'link';
  state: string;
  codeVerifier: string;
  redirectUri: string;
  issuedAt: number;
  oauthNext?: string;
};

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomValue(byteLength: number): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error('安全随机数不可用。');
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function codeChallenge(verifier: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('浏览器不支持安全的 PKCE S256。');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

async function beginTikTokAccountOAuth(mode: PendingProviderLink['mode'], search = ''): Promise<void> {
  const clientId = String(import.meta.env.VITE_NIMI_TIKTOK_CLIENT_ID || '').trim();
  if (!clientId) throw new Error('TikTok 登录当前未配置。');
  const pending: PendingProviderLink = {
    provider: 'TIKTOK',
    mode,
    state: randomValue(24),
    codeVerifier: randomValue(32),
    redirectUri: new URL('/account/oauth/callback', window.location.origin).toString(),
    issuedAt: Date.now(),
    ...(mode === 'login' && readValidatedOauthNext(search) ? { oauthNext: readValidatedOauthNext(search)! } : {}),
  };
  window.sessionStorage.setItem(PENDING_LINK_KEY, JSON.stringify(pending));
  const authorize = new URL(TIKTOK_AUTHORIZE_URL);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_key', clientId);
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', pending.redirectUri);
  authorize.searchParams.set('scope', TIKTOK_SCOPE);
  authorize.searchParams.set('state', pending.state);
  authorize.searchParams.set('code_challenge', await codeChallenge(pending.codeVerifier));
  authorize.searchParams.set('code_challenge_method', 'S256');
  window.location.assign(authorize.toString());
}

export function beginTikTokAccountLogin(search: string): Promise<void> {
  return beginTikTokAccountOAuth('login', search);
}

export function beginTikTokAccountLink(): Promise<void> {
  return beginTikTokAccountOAuth('link');
}

function consumePendingProviderLink(): PendingProviderLink {
  const raw = window.sessionStorage.getItem(PENDING_LINK_KEY);
  window.sessionStorage.removeItem(PENDING_LINK_KEY);
  if (!raw) throw new Error('OAuth 绑定事务不存在或已消费。');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('OAuth 绑定事务无效。'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('OAuth 绑定事务无效。');
  const record = parsed as Partial<PendingProviderLink>;
  if (
    record.provider !== 'TIKTOK'
    || (record.mode !== 'login' && record.mode !== 'link')
    || typeof record.state !== 'string'
    || typeof record.codeVerifier !== 'string'
    || record.redirectUri !== new URL('/account/oauth/callback', window.location.origin).toString()
    || typeof record.issuedAt !== 'number'
    || Date.now() - record.issuedAt < 0
    || Date.now() - record.issuedAt > PENDING_LINK_MAX_AGE_MS
  ) throw new Error('OAuth 绑定事务已失效。');
  if (record.oauthNext !== undefined) {
    const validated = typeof record.oauthNext === 'string'
      ? readValidatedOauthNext(`?oauth_next=${encodeURIComponent(record.oauthNext)}`)
      : null;
    if (!validated || validated !== record.oauthNext) throw new Error('OAuth continuation 已失效。');
  }
  return record as PendingProviderLink;
}

// This callback consumes only a third-party provider code for Realm account
// linking. Desktop authorization codes remain exclusive to RuntimeAccountService.
export type CompletedTikTokAccountOAuth = {
  mode: PendingProviderLink['mode'];
  oauthNext?: string;
  loginResult?: NimiRealmOAuthLoginResult;
};

function browserSessionContractError(message: string): Error {
  return createNimiError({
    message,
    reasonCode: ReasonCode.SDK_REALM_AUTH_RESPONSE_INVALID,
    actionHint: 'check_realm_auth_response',
    source: 'sdk',
  });
}

export async function confirmCurrentWebBrowserSession(): Promise<void> {
  const currentUser = toNimiRealmAuthUserRecord(await createWebBrowserRealm('').me());
  if (!currentUser) {
    throw browserSessionContractError('Realm did not confirm the current browser session.');
  }
}

export async function completeTikTokAccountOAuth(search: string): Promise<CompletedTikTokAccountOAuth> {
  const pending = consumePendingProviderLink();
  const query = new URLSearchParams(search);
  const error = String(query.get('error') || '').trim();
  if (error) throw new Error(`TikTok 授权失败：${error}`);
  if (String(query.get('state') || '').trim() !== pending.state) throw new Error('OAuth state 不匹配。');
  const code = String(query.get('code') || '').trim();
  if (!code) throw new Error('TikTok 未返回授权 code。');
  const input = {
    provider: NIMI_REALM_OAUTH_PROVIDER.TIKTOK,
    code,
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirectUri,
  } as const;
  if (pending.mode === 'link') {
    await linkNimiRealmOAuth(createWebBrowserRealm(''), input);
    return { mode: pending.mode };
  }
  const loginResult = await loginNimiRealmOAuth(createWebBrowserRealm(''), input);
  if (loginResult.tokens != null) {
    throw browserSessionContractError('Realm 向 Web browser session 返回了禁止的 bearer。');
  }
  if (loginResult.loginState === 'ok' || loginResult.loginState === 'needs_onboarding') {
    await confirmCurrentWebBrowserSession();
  }
  return { mode: pending.mode, oauthNext: pending.oauthNext, loginResult };
}
