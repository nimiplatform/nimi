import { OAuthLoginState, OAuthProvider } from '@nimiplatform/sdk/realm';
import type { AuthTokensDto, OAuthLoginResultDto } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import {
  loadPersistedAuthSession,
  persistAuthSession,
  WEB_AUTH_SESSION_KEY,
} from './auth-session-storage.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WebAuthMenuMode = 'embedded' | 'desktop-browser';

export type AuthView =
  | 'main'
  | 'desktop_authorize'
  | 'email_login'
  | 'email_register'
  | 'email_otp'
  | 'email_otp_verify'
  | 'email_2fa';

export type WalletType = 'metamask' | 'okx' | 'binance';

export type WalletProvider = {
  isMetaMask?: boolean;
  isOkxWallet?: boolean;
  isOKXWallet?: boolean;
  isOkx?: boolean;
  isBinance?: boolean;
  isBinanceWallet?: boolean;
  isBinanceChain?: boolean;
  providers?: WalletProvider[];
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};

export type GoogleWindow = Window & {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient?: (config: {
          client_id: string;
          scope: string;
          callback: (response: { access_token?: string }) => void;
        }) => { requestAccessToken: () => void };
      };
    };
  };
  ethereum?: WalletProvider;
  okxwallet?: WalletProvider;
  BinanceChain?: WalletProvider;
  binanceWallet?: WalletProvider;
};

export type DesktopCallbackRequest = {
  callbackUrl: string;
  state: string;
};

export type RememberedLogin = {
  email: string;
  password: string;
  rememberMe: boolean;
};

export type AuthMenuProps = {
  onLogoHoverChange?: (hovered: boolean) => void;
  onLogoClick?: () => void;
  logoHintText?: string;
  logoErrorText?: string | null;
  logoDisabled?: boolean;
  enableAuthModal?: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LOGO_URL =
  'https://imagedelivery.net/evIMqF8VHO9ZoWtgAWZmSA/16d57f7d-2c76-46c7-eec0-198c46de1700/avatar';
export const DESKTOP_CALLBACK_TIMEOUT_MS = 300_000;
export const DESKTOP_CALLBACK_PATH = '/oauth/callback';
export const REMEMBER_LOGIN_KEY = 'nimi.rememberLogin';

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

export const buttonBase =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
export const buttonDefault = 'bg-mint-500 text-white hover:bg-mint-600 shadow-md';
export const buttonOutline = 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50';
export const buttonGhost = 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50';
export const inputBase =
  'file:text-foreground placeholder:text-[#999999] selection:bg-mint-500 selection:text-white dark:bg-input/30 border-input w-full min-w-0 rounded-md border bg-transparent text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-[#4ECCA3] focus-visible:ring-[#4ECCA3]/50 focus-visible:ring-[3px]';

// ---------------------------------------------------------------------------
// Remember-login storage
// ---------------------------------------------------------------------------

export function loadRememberedLogin(): RememberedLogin | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(REMEMBER_LOGIN_KEY);
    if (stored) {
      return JSON.parse(stored) as RememberedLogin;
    }
  } catch {
    // 忽略解析错误
  }
  return null;
}

export function saveRememberedLogin(login: RememberedLogin): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify(login));
  } catch {
    // 忽略存储错误
  }
}

export function clearRememberedLogin(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REMEMBER_LOGIN_KEY);
  } catch {
    // 忽略清除错误
  }
}

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

export function readEnv(name: string): string {
  const importMetaEnv = (import.meta as { env?: Record<string, string> }).env;
  const fromImportMeta = String(importMetaEnv?.[name] || '').trim();
  if (fromImportMeta) {
    return fromImportMeta;
  }

  const globalProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const fromProcess = String(globalProcess?.env?.[name] || '').trim();
  return fromProcess;
}

// ---------------------------------------------------------------------------
// URL / loopback helpers
// ---------------------------------------------------------------------------

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1';
}

export function normalizeLoopbackCallbackUrl(rawUrl: string): string | null {
  const normalized = String(rawUrl || '').trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' || !isLoopbackHost(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function readLocationQueryParams(): URLSearchParams {
  if (typeof window === 'undefined') {
    return new URLSearchParams();
  }

  const params = new URLSearchParams(window.location.search);
  const hash = String(window.location.hash || '');
  const queryStart = hash.indexOf('?');
  if (queryStart < 0) {
    return params;
  }

  const hashQuery = hash.slice(queryStart + 1);
  const hashParams = new URLSearchParams(hashQuery);
  hashParams.forEach((value, key) => {
    params.set(key, value);
  });
  return params;
}

// ---------------------------------------------------------------------------
// Desktop callback helpers
// ---------------------------------------------------------------------------

export function resolveDesktopCallbackRequestFromLocation(): DesktopCallbackRequest | null {
  const params = readLocationQueryParams();
  const callbackUrl = normalizeLoopbackCallbackUrl(String(params.get('desktop_callback') || ''));
  if (!callbackUrl) {
    return null;
  }

  return {
    callbackUrl,
    state: String(params.get('desktop_state') || '').trim(),
  };
}

export function buildDesktopCallbackReturnUrl(input: {
  request: DesktopCallbackRequest;
  accessToken: string;
}): string {
  const callbackUrl = new URL(input.request.callbackUrl);
  callbackUrl.searchParams.set('code', input.accessToken);
  if (input.request.state) {
    callbackUrl.searchParams.set('state', input.request.state);
  }
  return callbackUrl.toString();
}

export function createDesktopCallbackState(): string {
  const entropy = Math.random().toString(36).slice(2, 10);
  return `desktop-${Date.now().toString(36)}-${entropy}`;
}

export function createDesktopCallbackRedirectUri(): string {
  const port = 43_000 + Math.floor(Math.random() * 10_000);
  return `http://127.0.0.1:${port}${DESKTOP_CALLBACK_PATH}`;
}

export function normalizeWebAuthLaunchPath(input: URL): URL {
  const normalized = new URL(input.toString());
  if (!normalized.hash) {
    normalized.hash = '#/login';
  }
  return normalized;
}

export function resolveDesktopWebAuthLaunchBaseUrl(inputBaseUrl?: string): string {
  const baseUrl = String(inputBaseUrl || readEnv('NIMI_WEB_URL') || 'http://localhost').trim();

  try {
    const parsed = normalizeWebAuthLaunchPath(new URL(baseUrl));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('桌面网页登录地址仅支持 http/https 协议');
    }

    return parsed.toString();
  } catch (error) {
    throw new Error(
      `无效的 NIMI_WEB_URL：${toErrorMessage(error, '配置解析失败')}`,
    );
  }
}

export function buildDesktopWebAuthLaunchUrl(input: {
  callbackUrl: string;
  state: string;
  baseUrl?: string;
}): string {
  const url = new URL(resolveDesktopWebAuthLaunchBaseUrl(input.baseUrl));
  if (url.hash) {
    const hashRaw = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const [hashPathRaw = '', hashQueryRaw = ''] = hashRaw.split('?');
    const hashPath = hashPathRaw.trim() || '/login';
    const hashQuery = new URLSearchParams(hashQueryRaw);
    hashQuery.set('desktop_callback', input.callbackUrl);
    hashQuery.set('desktop_state', input.state);
    const encodedHashQuery = hashQuery.toString();
    url.hash = encodedHashQuery ? `#${hashPath}?${encodedHashQuery}` : `#${hashPath}`;
    return url.toString();
  }

  url.searchParams.set('desktop_callback', input.callbackUrl);
  url.searchParams.set('desktop_state', input.state);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

export function getGoogleClientId(): string {
  return (
    readEnv('VITE_NIMI_GOOGLE_CLIENT_ID')
    || readEnv('VITE_GOOGLE_CLIENT_ID')
    || readEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID')
  );
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

export function toErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const body = (error as { body?: unknown }).body;
    if (body && typeof body === 'object') {
      const bodyMessage = (body as { message?: unknown }).message;
      if (typeof bodyMessage === 'string' && bodyMessage.trim().length > 0) {
        return localizeAuthError(bodyMessage);
      }
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return localizeAuthError(error.message);
  }

  return fallback;
}

export function localizeAuthError(message: string): string {
  const lowered = message.toLowerCase();

  // Invalid credentials
  if (lowered.includes('invalid credentials') || lowered.includes('unauthorized')) {
    return 'Invalid email or password. Please check and try again.';
  }

  // Account blocked/disabled
  if (lowered.includes('blocked') || lowered.includes('disabled') || lowered.includes('banned')) {
    return 'Account has been disabled. Please contact support.';
  }

  // Account not found
  if (lowered.includes('not found') || lowered.includes('does not exist') || lowered.includes('no user')) {
    return 'This email is not registered. Please sign up first.';
  }

  // Invalid email format
  if (lowered.includes('invalid email') || lowered.includes('email format')) {
    return 'Invalid email format.';
  }

  // Weak password
  if (lowered.includes('password too weak') || lowered.includes('password strength')) {
    return 'Password is too weak. Please use a stronger password.';
  }

  // Invalid/expired code
  if (lowered.includes('invalid code') || lowered.includes('wrong code') || lowered.includes('code expired')) {
    return 'Invalid or expired code. Please request a new one.';
  }

  // Rate limit
  if (lowered.includes('rate limit') || lowered.includes('too many requests')) {
    return 'Too many requests. Please try again later.';
  }

  // Server error
  if (lowered.includes('internal server error') || lowered.includes('500')) {
    return 'Server error. Please try again later.';
  }

  return message;
}

export function toDesktopBrowserAuthErrorMessage(error: unknown): string {
  const message = toErrorMessage(error, '网页登录授权失败').trim();
  const lowered = message.toLowerCase();

  if (!message) {
    return '网页登录授权失败，请重试。';
  }

  if (message.includes('等待 OAuth 回调超时') || lowered.includes('timeout')) {
    return '等待网页登录回调超时。请在浏览器完成授权后重试。';
  }

  if (message.includes('state')) {
    return '网页登录回调校验失败（state 不匹配），请重试。';
  }

  if (message.includes('缺少 access token')) {
    return '网页授权未返回 access token，请重试。';
  }

  if (message.includes('无法打开系统浏览器')) {
    return '无法打开系统浏览器，请检查默认浏览器设置后重试。';
  }

  return message;
}

export function getUserDisplayLabel(user: Record<string, unknown> | null, fallback: string): string {
  if (!user) {
    return fallback;
  }

  const candidates = ['email', 'username', 'name', 'displayName', 'id'];
  for (const key of candidates) {
    const value = user[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return fallback;
}

// ---------------------------------------------------------------------------
// Wallet helpers
// ---------------------------------------------------------------------------

export function parseChainId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    if (value.startsWith('0x')) {
      const parsedHex = Number.parseInt(value, 16);
      return Number.isFinite(parsedHex) ? parsedHex : undefined;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

export function resolveWalletProvider(walletType: WalletType): WalletProvider | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const win = window as GoogleWindow;
  if (walletType === 'metamask') {
    const provider = win.ethereum;
    if (!provider) {
      return null;
    }

    if (provider.isMetaMask) {
      return provider;
    }

    const nested = provider.providers?.find((candidate) => candidate?.isMetaMask);
    return nested ?? null;
  }

  if (walletType === 'okx') {
    const provider = win.okxwallet || win.ethereum;
    if (!provider) {
      return null;
    }

    if (
      provider === win.okxwallet
      || provider.isOkxWallet
      || provider.isOKXWallet
      || provider.isOkx
    ) {
      return provider;
    }

    const nested = provider.providers?.find((candidate) =>
      candidate?.isOkxWallet || candidate?.isOKXWallet || candidate?.isOkx);
    return nested ?? null;
  }

  const provider = win.BinanceChain || win.binanceWallet || win.ethereum;
  if (!provider) {
    return null;
  }

  if (
    provider === win.BinanceChain
    || provider === win.binanceWallet
    || provider.isBinance
    || provider.isBinanceWallet
    || provider.isBinanceChain
  ) {
    return provider;
  }

  const nested = provider.providers?.find((candidate) =>
    candidate?.isBinance || candidate?.isBinanceWallet || candidate?.isBinanceChain);
  return nested ?? null;
}

// ---------------------------------------------------------------------------
// Google script loader
// ---------------------------------------------------------------------------

export function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('window is undefined'));
      return;
    }

    const win = window as GoogleWindow;
    if (win.google?.accounts?.oauth2?.initTokenClient) {
      resolve();
      return;
    }

    const existingScript = document.getElementById('google-identity-services');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () =>
        reject(new Error('Failed to load Google Identity Services script')));
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-identity-services';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services script'));
    document.head.appendChild(script);
  });
}

// ---------------------------------------------------------------------------
// Token application
// ---------------------------------------------------------------------------

export { OAuthLoginState, OAuthProvider };
export type { AuthTokensDto, OAuthLoginResultDto };
export { loadPersistedAuthSession, persistAuthSession, WEB_AUTH_SESSION_KEY };
export { dataSync };
export { queryClient };
