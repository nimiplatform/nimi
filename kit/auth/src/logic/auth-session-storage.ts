import { isWebShellMode } from '@nimiplatform/nimi-kit/core/shell-mode';
import { resolveSessionExpiry } from './shared-desktop-auth-session.js';

export const WEB_AUTH_SESSION_KEY = 'nimi.web.auth.session.v1';

export type PersistedWebAuthSession = {
  user?: Record<string, unknown> | null;
  updatedAt: string;
  expiresAt?: string;
};

// Inline validator replacing:
//   z.object({ user: z.record(z.string(), z.unknown()).nullable().optional(), updatedAt: z.string().optional(), expiresAt: z.string().optional() })
function safeParsePersistedWebAuthSession(
  value: unknown,
): { success: true; data: { user?: Record<string, unknown> | null; updatedAt?: string; expiresAt?: string } } | { success: false } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { success: false };
  }
  const record = value as Record<string, unknown>;
  if (record.updatedAt !== undefined && typeof record.updatedAt !== 'string') return { success: false };
  if (record.expiresAt !== undefined && typeof record.expiresAt !== 'string') return { success: false };

  let user: Record<string, unknown> | null | undefined;
  if (record.user === null) {
    user = null;
  } else if (record.user === undefined) {
    user = undefined;
  } else if (typeof record.user === 'object' && !Array.isArray(record.user)) {
    user = record.user as Record<string, unknown>;
  } else {
    return { success: false };
  }

  return {
    success: true,
    data: {
      ...(user !== undefined ? { user } : {}),
      ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {}),
      ...(typeof record.expiresAt === 'string' ? { expiresAt: record.expiresAt } : {}),
    },
  };
}

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
    const rawPayload = JSON.parse(raw) as Record<string, unknown>;
    const parsed = safeParsePersistedWebAuthSession(rawPayload);
    if (!parsed.success) {
      clearStoredAuthSession();
      return null;
    }

    const user = normalizeUser(parsed.data.user);
    const updatedAt = typeof parsed.data.updatedAt === 'string'
      ? parsed.data.updatedAt
      : new Date().toISOString();
    const expiresAt = typeof parsed.data.expiresAt === 'string' && parsed.data.expiresAt.trim()
      ? parsed.data.expiresAt
      : undefined;
    if (isExpired(expiresAt)) {
      clearStoredAuthSession();
      return null;
    }

    if ('accessToken' in rawPayload || 'refreshToken' in rawPayload) {
      writeSessionKeys({
        ...(user ? { user } : {}),
        updatedAt,
        ...(expiresAt ? { expiresAt } : {}),
      });
    }

    return {
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
  const payload: PersistedWebAuthSession = {
    ...(normalizedUserValue ? { user: normalizedUserValue } : {}),
    updatedAt: session.updatedAt || new Date().toISOString(),
    ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
  };

  globalThis.localStorage.setItem(WEB_AUTH_SESSION_KEY, JSON.stringify(payload));
}

export function loadPersistedAccessToken(): string {
  return '';
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

  const payload: PersistedWebAuthSession = {
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

export function persistAuthSessionMetadata(input: {
  user?: Record<string, unknown> | null;
  expiresAt?: string | null;
  updatedAt?: string | null;
}): void {
  if (!canPersistWebAuthSession()) {
    return;
  }

  const previous = loadPersistedAuthSession();
  const normalizedUserValue = input.user === undefined
    ? (previous?.user ?? null)
    : input.user;
  const updatedAt = String(input.updatedAt || '').trim() || new Date().toISOString();
  const expiresAt = String(input.expiresAt || '').trim();

  const payload: PersistedWebAuthSession = {
    ...(normalizedUserValue ? { user: normalizedUserValue } : {}),
    updatedAt,
    ...(expiresAt ? { expiresAt } : {}),
  };

  try {
    writeSessionKeys(payload);
  } catch {
    // ignore storage failures
  }
}

export function clearPersistedAccessToken(): void {
  clearStoredAuthSession();
}
