import { readBundledEnv } from '../env.js';

// ---------------------------------------------------------------------------
// OAuth helpers — extracted from Desktop auth-helpers.ts (common parts)
// ---------------------------------------------------------------------------

export const DESKTOP_CALLBACK_TIMEOUT_MS = 300_000;
export const DESKTOP_CALLBACK_PATH = '/oauth/callback';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

export function readEnv(name: string): string {
  return readBundledEnv(name);
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

// ---------------------------------------------------------------------------
// Desktop callback helpers
// ---------------------------------------------------------------------------

export function createDesktopCallbackState(): string {
  const entropy = Math.random().toString(36).slice(2, 10);
  return `desktop-${Date.now().toString(36)}-${entropy}`;
}

export function createDesktopCallbackRedirectUri(): string {
  const port = 43_000 + Math.floor(Math.random() * 10_000);
  return `http://127.0.0.1:${port}${DESKTOP_CALLBACK_PATH}`;
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

  if (lowered.includes('invalid credentials') || lowered.includes('unauthorized')) {
    return 'Invalid email or password. Please check and try again.';
  }
  if (lowered.includes('blocked') || lowered.includes('disabled') || lowered.includes('banned')) {
    return 'Account has been disabled. Please contact support.';
  }
  if (lowered.includes('not found') || lowered.includes('does not exist') || lowered.includes('no user')) {
    return 'This email is not registered. Please sign up first.';
  }
  if (lowered.includes('invalid email') || lowered.includes('email format')) {
    return 'Invalid email format.';
  }
  if (lowered.includes('password too weak') || lowered.includes('password strength')) {
    return 'Password is too weak. Please use a stronger password.';
  }
  if (lowered.includes('invalid code') || lowered.includes('wrong code') || lowered.includes('code expired')) {
    return 'Invalid or expired code. Please request a new one.';
  }
  if (lowered.includes('rate limit') || lowered.includes('too many requests')) {
    return 'Too many requests. Please try again later.';
  }
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
