import { isWebShellMode } from '@nimiplatform/shell-core/shell-mode';

export const WEB_AUTH_SESSION_KEY = 'nimi.web.auth.session.v1';

export type PersistedWebAuthSession = {
  accessToken: string;
  refreshToken?: string;
  user?: Record<string, unknown> | null;
  updatedAt: string;
};

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
    const parsed = JSON.parse(raw) as PersistedWebAuthSession;
    if (!parsed || typeof parsed !== 'object') return null;

    const accessToken = typeof parsed.accessToken === 'string'
      ? parsed.accessToken.trim()
      : '';
    if (!accessToken) {
      return null;
    }

    const refreshToken = typeof parsed.refreshToken === 'string'
      ? parsed.refreshToken.trim()
      : '';
    const user = normalizeUser(parsed.user);

    return {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(user ? { user } : {}),
      updatedAt: typeof parsed.updatedAt === 'string'
        ? parsed.updatedAt
        : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeSessionKeys(session: PersistedWebAuthSession): void {
  const normalizedToken = String(session.accessToken || '').trim();
  if (!normalizedToken) {
    return;
  }

  const normalizedRefreshToken = String(session.refreshToken || '').trim();
  const normalizedUserValue = normalizeUser(session.user);
  const payload: PersistedWebAuthSession = {
    accessToken: normalizedToken,
    ...(normalizedRefreshToken ? { refreshToken: normalizedRefreshToken } : {}),
    ...(normalizedUserValue ? { user: normalizedUserValue } : {}),
    updatedAt: session.updatedAt || new Date().toISOString(),
  };

  globalThis.localStorage.setItem(WEB_AUTH_SESSION_KEY, JSON.stringify(payload));
}

export function loadPersistedAccessToken(): string {
  const session = loadPersistedAuthSession();
  return session?.accessToken || '';
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

  const isSameToken = previous?.accessToken === normalizedToken;
  const normalizedRefreshToken = input.refreshToken === undefined
    ? (isSameToken ? previous?.refreshToken : undefined)
    : String(input.refreshToken || '').trim();
  const normalizedUserValue = input.user === undefined
    ? (isSameToken ? (previous?.user ?? null) : null)
    : input.user;

  const payload: PersistedWebAuthSession = {
    accessToken: normalizedToken,
    ...(normalizedRefreshToken ? { refreshToken: normalizedRefreshToken } : {}),
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
