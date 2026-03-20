import type { RememberedLogin } from '../types/auth-types.js';

export const REMEMBER_LOGIN_KEY = 'nimi.rememberLogin';

function normalizeRememberedLogin(value: unknown): {
  login: RememberedLogin | null;
  migrated: boolean;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { login: null, migrated: false };
  }
  const record = value as {
    email?: unknown;
    rememberMe?: unknown;
    password?: unknown;
  };
  const email = typeof record.email === 'string' ? record.email.trim() : '';
  if (!email) {
    return { login: null, migrated: false };
  }
  return {
    login: {
      email,
      rememberMe: Boolean(record.rememberMe),
    },
    migrated: typeof record.password === 'string',
  };
}

export function loadRememberedLogin(): RememberedLogin | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(REMEMBER_LOGIN_KEY);
    if (stored) {
      const normalized = normalizeRememberedLogin(JSON.parse(stored));
      if (normalized.login && normalized.migrated) {
        window.localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify(normalized.login));
      }
      return normalized.login;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

export function saveRememberedLogin(login: RememberedLogin): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify({
      email: String(login.email || '').trim(),
      rememberMe: Boolean(login.rememberMe),
    }));
  } catch {
    // ignore storage errors
  }
}

export function clearRememberedLogin(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REMEMBER_LOGIN_KEY);
  } catch {
    // ignore clear errors
  }
}
