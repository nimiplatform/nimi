import type { RememberedLogin } from '../types/auth-types.js';

export const REMEMBER_LOGIN_KEY = 'nimi.rememberLogin';
const REMEMBER_LOGIN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type PersistedRememberedLogin = {
  email: string;
  rememberMe: boolean;
  updatedAt?: string;
  expiresAt?: string;
};

function normalizeRememberedLogin(value: unknown): {
  login: PersistedRememberedLogin | null;
  migrated: boolean;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { login: null, migrated: false };
  }
  const record = Object.fromEntries(Object.entries(value));
  const email = typeof record.email === 'string' ? record.email.trim() : '';
  if (!email) {
    return { login: null, migrated: false };
  }
  return {
    login: {
      email,
      rememberMe: Boolean(record.rememberMe),
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
      expiresAt: typeof record.expiresAt === 'string' ? record.expiresAt : undefined,
    },
    migrated: typeof record.password === 'string',
  };
}

function clearStoredRememberedLogin(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REMEMBER_LOGIN_KEY);
  } catch {
    // ignore clear errors
  }
}

function resolveRememberedLoginExpiry(updatedAtIso?: string): string {
  const updatedAtMs = Date.parse(String(updatedAtIso || ''));
  const baseMs = Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now();
  return new Date(baseMs + REMEMBER_LOGIN_TTL_MS).toISOString();
}

export function loadRememberedLogin(): RememberedLogin | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(REMEMBER_LOGIN_KEY);
    if (stored) {
      const normalized = normalizeRememberedLogin(JSON.parse(stored));
      if (!normalized.login) {
        clearStoredRememberedLogin();
        return null;
      }
      const expiresAt = normalized.login.expiresAt || resolveRememberedLoginExpiry(normalized.login.updatedAt);
      const expiresAtMs = Date.parse(expiresAt);
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        clearStoredRememberedLogin();
        return null;
      }
      if (normalized.migrated || !normalized.login.expiresAt || !normalized.login.updatedAt) {
        window.localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify({
          email: normalized.login.email,
          rememberMe: normalized.login.rememberMe,
          updatedAt: normalized.login.updatedAt || new Date().toISOString(),
          expiresAt,
        }));
      }
      return {
        email: normalized.login.email,
        rememberMe: normalized.login.rememberMe,
      };
    }
  } catch {
    clearStoredRememberedLogin();
  }
  return null;
}

export function saveRememberedLogin(login: RememberedLogin): void {
  if (typeof window === 'undefined') return;
  try {
    const updatedAt = new Date().toISOString();
    window.localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify({
      email: String(login.email || '').trim(),
      rememberMe: Boolean(login.rememberMe),
      updatedAt,
      expiresAt: resolveRememberedLoginExpiry(updatedAt),
    }));
  } catch {
    // ignore storage errors
  }
}

export function clearRememberedLogin(): void {
  clearStoredRememberedLogin();
}
