import { isWebShellMode } from '@nimiplatform/shell-core/shell-mode';
import { z } from 'zod';

export const WEB_AUTH_SESSION_KEY = 'nimi.web.auth.session.v1';

export type PersistedWebAuthSession = {
  accessToken?: string;
  user?: Record<string, unknown> | null;
  updatedAt: string;
};

const persistedWebAuthSessionSchema = z.object({
  accessToken: z.string().optional(),
  user: z.record(z.string(), z.unknown()).nullable().optional(),
  updatedAt: z.string().optional(),
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

export function loadPersistedAuthSession(): PersistedWebAuthSession | null {
  if (!canPersistWebAuthSession()) {
    return null;
  }

  try {
    const raw = globalThis.localStorage.getItem(WEB_AUTH_SESSION_KEY);
    if (!raw) return null;
    const parsed = persistedWebAuthSessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;

    const accessToken = String(parsed.data.accessToken || '').trim();
    const user = normalizeUser(parsed.data.user);

    return {
      ...(accessToken ? { accessToken } : {}),
      ...(user ? { user } : {}),
      updatedAt: typeof parsed.data.updatedAt === 'string'
        ? parsed.data.updatedAt
        : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeSessionKeys(session: PersistedWebAuthSession): void {
  const normalizedAccessToken = String(session.accessToken || '').trim();
  const normalizedUserValue = normalizeUser(session.user);
  const payload: PersistedWebAuthSession = {
    ...(normalizedAccessToken ? { accessToken: normalizedAccessToken } : {}),
    ...(normalizedUserValue ? { user: normalizedUserValue } : {}),
    updatedAt: session.updatedAt || new Date().toISOString(),
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

  const payload: PersistedWebAuthSession = {
    ...(normalizedToken ? { accessToken: normalizedToken } : {}),
    ...(normalizedUserValue ? { user: normalizedUserValue } : {}),
    updatedAt: new Date().toISOString(),
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
  if (!canPersistWebAuthSession()) {
    return;
  }

  try {
    globalThis.localStorage.removeItem(WEB_AUTH_SESSION_KEY);
  } catch {
    // ignore storage failures
  }
}
