import { isWebShellMode } from '@nimiplatform/nimi-kit/core/shell-mode';
import { z } from 'zod';

export const WEB_AUTH_SESSION_KEY = 'nimi.web.auth.session.v1';
const WEB_AUTH_SESSION_FALLBACK_TTL_MS = 60 * 60 * 1000;

export type PersistedWebAuthSession = {
  accessToken?: string;
  refreshToken?: string;
  user?: Record<string, unknown> | null;
  updatedAt: string;
  expiresAt?: string;
};

const persistedWebAuthSessionSchema = z.object({
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  user: z.record(z.string(), z.unknown()).nullable().optional(),
  updatedAt: z.string().optional(),
  expiresAt: z.string().optional(),
});

function hasLocalStorage(): boolean {
  return typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined';
}

function canPersistWebAuthSession(): boolean {
  return isWebShellMode() && hasLocalStorage();
}

function normalizeUser(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
}

function clearStoredAuthSession(): void {
  if (!canPersistWebAuthSession()) {
    return;
  }
  try {
    globalThis.localStorage.removeItem(WEB_AUTH_SESSION_KEY);
  } catch {
    // ignore storage failures
  }
}

function decodeJwtExpiry(accessToken: string): number | null {
  const parts = String(accessToken || '').trim().split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const payload = parts[1]!
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1]!.length / 4) * 4, '=');
    const decoded = typeof atob === 'function'
      ? atob(payload)
      : Buffer.from(payload, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { exp?: unknown };
    const expSeconds = Number(parsed.exp);
    if (!Number.isFinite(expSeconds) || expSeconds <= 0) {
      return null;
    }
    return expSeconds * 1000;
  } catch {
    return null;
  }
}

function resolveSessionExpiry(accessToken: string, updatedAtIso: string): string {
  const updatedAtMs = Date.parse(updatedAtIso);
  const fallbackBaseMs = Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now();
  const jwtExpiryMs = decodeJwtExpiry(accessToken);
  const expiresAtMs = jwtExpiryMs && jwtExpiryMs > 0
    ? jwtExpiryMs
    : fallbackBaseMs + WEB_AUTH_SESSION_FALLBACK_TTL_MS;
  return new Date(expiresAtMs).toISOString();
}

function isExpired(expiresAt: string | undefined): boolean {
  if (!expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }
  return expiresAtMs <= Date.now();
}

export function loadPersistedAuthSession(): PersistedWebAuthSession | null {
  if (!canPersistWebAuthSession()) {
    return null;
  }

  try {
    const raw = globalThis.localStorage.getItem(WEB_AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = persistedWebAuthSessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      clearStoredAuthSession();
      return null;
    }

    const accessToken = String(parsed.data.accessToken || '').trim();
    const user = normalizeUser(parsed.data.user);
    const updatedAt = typeof parsed.data.updatedAt === 'string'
      ? parsed.data.updatedAt
      : new Date().toISOString();
    const expiresAt = typeof parsed.data.expiresAt === 'string' && parsed.data.expiresAt.trim()
      ? parsed.data.expiresAt
      : (accessToken ? resolveSessionExpiry(accessToken, updatedAt) : undefined);
    if (isExpired(expiresAt)) {
      clearStoredAuthSession();
      return null;
    }

    const refreshToken = String(parsed.data.refreshToken || '').trim();

    return {
      ...(accessToken ? { accessToken } : {}),
      ...(refreshToken ? { refreshToken } : {}),
      ...(user ? { user } : {}),
      updatedAt,
      ...(expiresAt ? { expiresAt } : {}),
    };
  } catch {
    clearStoredAuthSession();
    return null;
  }
}

function writeSessionKeys(session: PersistedWebAuthSession): void {
  const normalizedUserValue = normalizeUser(session.user);
  const accessToken = String(session.accessToken || '').trim();
  const refreshToken = String(session.refreshToken || '').trim();
  const payload: PersistedWebAuthSession = {
    ...(accessToken ? { accessToken } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    ...(normalizedUserValue ? { user: normalizedUserValue } : {}),
    updatedAt: session.updatedAt || new Date().toISOString(),
    ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
  };

  globalThis.localStorage.setItem(WEB_AUTH_SESSION_KEY, JSON.stringify(payload));
}

export function loadPersistedAccessToken(): string {
  const session = loadPersistedAuthSession();
  return String(session?.accessToken || '').trim();
}

export function persistAuthSession(input: {
  accessToken: string;
  refreshToken?: string | null;
  user?: Record<string, unknown> | null;
}): void {
  if (!canPersistWebAuthSession()) {
    return;
  }

  const previous = loadPersistedAuthSession();
  const normalizedToken = String(input.accessToken || '').trim();
  if (!normalizedToken) {
    clearPersistedAccessToken();
    return;
  }

  const normalizedUserValue = input.user === undefined
    ? (previous?.user ?? null)
    : input.user;

  const normalizedRefreshToken = String(input.refreshToken || '').trim();
  const payload: PersistedWebAuthSession = {
    accessToken: normalizedToken,
    ...(normalizedRefreshToken ? { refreshToken: normalizedRefreshToken } : {}),
    ...(normalizedUserValue ? { user: normalizedUserValue } : {}),
    updatedAt: new Date().toISOString(),
    expiresAt: resolveSessionExpiry(normalizedToken, new Date().toISOString()),
  };

  try {
    writeSessionKeys(payload);
  } catch {
    // ignore storage failures
  }
}

export function persistAccessToken(accessToken: string): void {
  persistAuthSession({ accessToken });
}

export function clearPersistedAccessToken(): void {
  clearStoredAuthSession();
}
