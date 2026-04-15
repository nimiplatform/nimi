const DESKTOP_AUTH_SESSION_FALLBACK_TTL_MS = 60 * 60 * 1000;

export type SharedDesktopAuthUser = {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
};

export type SharedDesktopAuthSession = {
  realmBaseUrl: string;
  user: SharedDesktopAuthUser | null;
  accessToken: string;
  refreshToken?: string;
  updatedAt: string;
  expiresAt?: string;
};

export type DesktopBootstrapAuthResolution =
  | 'env-override'
  | 'persisted-session'
  | 'no-session'
  | 'realm-mismatch';

export type ResolvedDesktopBootstrapAuthSession = {
  source: 'anonymous' | 'env' | 'persisted';
  resolution: DesktopBootstrapAuthResolution;
  session: SharedDesktopAuthSession | null;
  shouldClearPersistedSession: boolean;
};

export type PersistSharedDesktopAuthSessionInput = {
  realmBaseUrl: string;
  accessToken: string;
  refreshToken?: string | null;
  user?: Record<string, unknown> | SharedDesktopAuthUser | null;
  updatedAt?: string;
  expiresAt?: string;
  saveSession: (session: SharedDesktopAuthSession) => Promise<void>;
  clearSession: () => Promise<void>;
};

// Inline validators replacing zod schemas to keep vendor-data (371 KB)
// out of the startup static dependency graph.  The original schemas were:
//   z.object({ id: z.string(), displayName: z.string(), email: z.string().optional(), avatarUrl: z.string().optional() })
//   z.object({ realmBaseUrl: z.string(), user: <above>.nullable().optional(), accessToken: z.string(), refreshToken: z.string().optional(), updatedAt: z.string(), expiresAt: z.string().optional() })

type SafeParseResult<T> = { success: true; data: T } | { success: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeParseAuthUser(value: unknown): SafeParseResult<SharedDesktopAuthUser> {
  if (!isRecord(value)) return { success: false };
  if (typeof value.id !== 'string' || typeof value.displayName !== 'string') return { success: false };
  if (value.email !== undefined && typeof value.email !== 'string') return { success: false };
  if (value.avatarUrl !== undefined && typeof value.avatarUrl !== 'string') return { success: false };
  const result: SharedDesktopAuthUser = { id: value.id, displayName: value.displayName };
  if (typeof value.email === 'string') result.email = value.email;
  if (typeof value.avatarUrl === 'string') result.avatarUrl = value.avatarUrl;
  return { success: true, data: result };
}

function safeParseAuthSession(value: unknown): SafeParseResult<{
  realmBaseUrl: string;
  user?: SharedDesktopAuthUser | null;
  accessToken: string;
  refreshToken?: string;
  updatedAt: string;
  expiresAt?: string;
}> {
  if (!isRecord(value)) return { success: false };
  if (typeof value.realmBaseUrl !== 'string') return { success: false };
  if (typeof value.accessToken !== 'string') return { success: false };
  if (typeof value.updatedAt !== 'string') return { success: false };
  if (value.refreshToken !== undefined && typeof value.refreshToken !== 'string') return { success: false };
  if (value.expiresAt !== undefined && typeof value.expiresAt !== 'string') return { success: false };

  let user: SharedDesktopAuthUser | null | undefined;
  if (value.user === null || value.user === undefined) {
    user = value.user ?? undefined;
  } else {
    const userResult = safeParseAuthUser(value.user);
    if (!userResult.success) return { success: false };
    user = userResult.data;
  }

  return {
    success: true,
    data: {
      realmBaseUrl: value.realmBaseUrl,
      accessToken: value.accessToken,
      updatedAt: value.updatedAt,
      ...(user !== undefined ? { user } : {}),
      ...(typeof value.refreshToken === 'string' ? { refreshToken: value.refreshToken } : {}),
      ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}),
    },
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toTrimmedString(value: unknown): string {
  return String(value ?? '').trim();
}

export function decodeJwtExpiry(accessToken: string): number | null {
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

export function resolveSessionExpiry(accessToken: string, updatedAtIso: string): string {
  const updatedAtMs = Date.parse(updatedAtIso);
  const fallbackBaseMs = Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now();
  const jwtExpiryMs = decodeJwtExpiry(accessToken);
  const expiresAtMs = jwtExpiryMs && jwtExpiryMs > 0
    ? jwtExpiryMs
    : fallbackBaseMs + DESKTOP_AUTH_SESSION_FALLBACK_TTL_MS;
  return new Date(expiresAtMs).toISOString();
}

export function normalizeSharedDesktopAuthUser(value: unknown): SharedDesktopAuthUser | null {
  const record = normalizeRecord(value);
  if (!record) {
    return null;
  }

  const id = toTrimmedString(record.id || record.userId || record.accountId);
  if (!id) {
    return null;
  }

  const displayName = toTrimmedString(record.displayName || record.name);
  const email = toTrimmedString(record.email);
  const avatarUrl = toTrimmedString(record.avatarUrl);

  return {
    id,
    displayName,
    ...(email ? { email } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export function createSharedDesktopAuthSession(input: {
  realmBaseUrl: string;
  accessToken: string;
  refreshToken?: string | null;
  user?: Record<string, unknown> | SharedDesktopAuthUser | null;
  updatedAt?: string;
  expiresAt?: string;
}): SharedDesktopAuthSession | null {
  const realmBaseUrl = toTrimmedString(input.realmBaseUrl);
  const accessToken = toTrimmedString(input.accessToken);
  if (!realmBaseUrl || !accessToken) {
    return null;
  }

  const updatedAt = toTrimmedString(input.updatedAt) || new Date().toISOString();
  const refreshToken = toTrimmedString(input.refreshToken);
  const user = normalizeSharedDesktopAuthUser(input.user);
  const expiresAt = toTrimmedString(input.expiresAt) || resolveSessionExpiry(accessToken, updatedAt);

  return {
    realmBaseUrl,
    user,
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    updatedAt,
    ...(expiresAt ? { expiresAt } : {}),
  };
}

export function parseSharedDesktopAuthSession(value: unknown): SharedDesktopAuthSession {
  const parsed = safeParseAuthSession(value);
  if (!parsed.success) {
    throw new Error('desktop auth session payload is invalid');
  }
  const session = createSharedDesktopAuthSession({
    realmBaseUrl: parsed.data.realmBaseUrl,
    accessToken: parsed.data.accessToken,
    refreshToken: parsed.data.refreshToken,
    user: parsed.data.user ?? null,
    updatedAt: parsed.data.updatedAt,
    expiresAt: parsed.data.expiresAt,
  });
  if (!session) {
    throw new Error('desktop auth session payload is invalid');
  }
  return session;
}

export async function persistSharedDesktopAuthSession(
  input: PersistSharedDesktopAuthSessionInput,
): Promise<SharedDesktopAuthSession | null> {
  const session = createSharedDesktopAuthSession(input);
  if (!session) {
    await input.clearSession();
    return null;
  }
  await input.saveSession(session);
  return session;
}

export async function resolveDesktopBootstrapAuthSession(input: {
  realmBaseUrl: string;
  envAccessToken?: string | null;
  loadPersistedSession: () => Promise<SharedDesktopAuthSession | null>;
}): Promise<ResolvedDesktopBootstrapAuthSession> {
  const realmBaseUrl = toTrimmedString(input.realmBaseUrl);
  const envAccessToken = toTrimmedString(input.envAccessToken);
  if (envAccessToken) {
    return {
      source: 'env',
      resolution: 'env-override',
      session: createSharedDesktopAuthSession({
        realmBaseUrl,
        accessToken: envAccessToken,
      }),
      shouldClearPersistedSession: false,
    };
  }

  const persistedSession = await input.loadPersistedSession();
  if (!persistedSession) {
    return {
      source: 'anonymous',
      resolution: 'no-session',
      session: null,
      shouldClearPersistedSession: false,
    };
  }

  if (toTrimmedString(persistedSession.realmBaseUrl) !== realmBaseUrl) {
    return {
      source: 'anonymous',
      resolution: 'realm-mismatch',
      session: null,
      shouldClearPersistedSession: true,
    };
  }

  return {
    source: 'persisted',
    resolution: 'persisted-session',
    session: persistedSession,
    shouldClearPersistedSession: false,
  };
}
