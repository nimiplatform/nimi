import type { RealmServiceResult } from '@nimiplatform/sdk/realm';
import type { Realm } from '@nimiplatform/sdk/realm';
import { persistSharedDesktopAuthSession } from '@nimiplatform/nimi-kit/auth';
import { clearAuthSession as clearPersistedAuthSession, saveAuthSession } from '@renderer/bridge';
import { useAvatarStore, type AvatarAuthUser } from './app-store.js';

type CurrentUserDto = RealmServiceResult<'MeService', 'getMe'>;

export type BootstrapAuthInput = {
  realm: Realm;
  accessToken: string;
  refreshToken?: string;
  source: 'anonymous' | 'env' | 'persisted';
  realmBaseUrl: string;
  clearPersistedSession: () => Promise<void>;
};

function normalizeAuthUser(user: CurrentUserDto): AvatarAuthUser {
  if (!user || !user.id) {
    throw new Error('avatar bootstrap auth session is missing user.id');
  }
  return {
    id: String(user.id),
    displayName: typeof user.displayName === 'string' ? user.displayName : '',
    ...(user.email ? { email: String(user.email) } : {}),
    ...(user.avatarUrl ? { avatarUrl: String(user.avatarUrl) } : {}),
  };
}

export async function bootstrapAuthSession(input: BootstrapAuthInput): Promise<AvatarAuthUser> {
  const accessToken = String(input.accessToken || '').trim();
  if (!accessToken) {
    useAvatarStore.getState().clearAuthSession();
    throw new Error('avatar bootstrap requires an authenticated desktop session');
  }

  try {
    const user = normalizeAuthUser(await input.realm.services.MeService.getMe());
    useAvatarStore.getState().setAuthSession(
      user,
      accessToken,
      String(input.refreshToken || '').trim(),
    );
    if (input.source === 'persisted') {
      await persistSharedDesktopAuthSession({
        realmBaseUrl: input.realmBaseUrl,
        accessToken,
        refreshToken: input.refreshToken,
        user,
        saveSession: (session) => saveAuthSession(session),
        clearSession: () => clearPersistedAuthSession(),
      });
    }
    return user;
  } catch (error) {
    if (input.source === 'persisted') {
      await input.clearPersistedSession();
    }
    useAvatarStore.getState().clearAuthSession();
    throw error instanceof Error
      ? error
      : new Error(`avatar auth bootstrap failed: ${String(error)}`);
  }
}
