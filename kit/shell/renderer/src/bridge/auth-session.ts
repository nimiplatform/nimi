import {
  parseSharedDesktopAuthSession,
  type SharedDesktopAuthSession,
} from '@nimiplatform/nimi-kit/auth';
import { hasTauriInvoke } from './env.js';
import { invokeChecked } from './invoke.js';

export type SharedDesktopAuthSessionWatchOptions = {
  initialSession?: SharedDesktopAuthSession | null;
  intervalMs?: number;
  onChange: (session: SharedDesktopAuthSession | null) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
};

function parseOptionalSharedDesktopAuthSession(value: unknown): SharedDesktopAuthSession | null {
  if (value == null) {
    return null;
  }
  return parseSharedDesktopAuthSession(value);
}

function sessionFingerprint(session: SharedDesktopAuthSession | null | undefined): string {
  if (!session) {
    return 'null';
  }
  return JSON.stringify([
    session.realmBaseUrl,
    session.user?.id ?? '',
    session.user?.displayName ?? '',
    session.user?.email ?? '',
    session.user?.avatarUrl ?? '',
    session.accessToken,
    session.refreshToken ?? '',
    session.updatedAt,
    session.expiresAt ?? '',
  ]);
}

function normalizeWatchError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(`desktop auth session watch failed: ${String(error)}`);
}

export async function loadAuthSession(): Promise<SharedDesktopAuthSession | null> {
  if (!hasTauriInvoke()) {
    return null;
  }
  return invokeChecked('auth_session_load', {}, parseOptionalSharedDesktopAuthSession);
}

export async function saveAuthSession(session: SharedDesktopAuthSession): Promise<void> {
  if (!hasTauriInvoke()) {
    return;
  }
  await invokeChecked('auth_session_save', { payload: session }, () => undefined);
}

export async function clearAuthSession(): Promise<void> {
  if (!hasTauriInvoke()) {
    return;
  }
  await invokeChecked('auth_session_clear', {}, () => undefined);
}

export function watchAuthSessionChanges(
  options: SharedDesktopAuthSessionWatchOptions,
): () => void {
  if (!hasTauriInvoke()) {
    return () => {};
  }

  let active = true;
  let polling = false;
  let lastFingerprint = sessionFingerprint(options.initialSession ?? null);
  const intervalMs = Math.max(250, Math.trunc(options.intervalMs ?? 1_000));

  const poll = async () => {
    if (!active || polling) {
      return;
    }
    polling = true;
    try {
      const session = await loadAuthSession();
      const nextFingerprint = sessionFingerprint(session);
      if (nextFingerprint !== lastFingerprint) {
        lastFingerprint = nextFingerprint;
        await options.onChange(session);
      }
    } catch (error) {
      await options.onError?.(normalizeWatchError(error));
    } finally {
      polling = false;
    }
  };

  const timer = globalThis.setInterval(() => {
    void poll();
  }, intervalMs);
  void poll();

  return () => {
    active = false;
    globalThis.clearInterval(timer);
  };
}
