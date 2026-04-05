import type { Realm, RealmServiceResult } from '@nimiplatform/sdk/realm';
import { persistSharedDesktopAuthSession } from '@nimiplatform/nimi-kit/auth';
import { clearAuthSession as clearPersistedAuthSession, saveAuthSession } from '@renderer/bridge';
import { useAppStore } from './app-store.js';

type CurrentUserDto = RealmServiceResult<'MeService', 'getMe'>;

export type BootstrapAuthInput = {
  realm: Realm;
  accessToken: string;
  refreshToken?: string;
  source: 'anonymous' | 'env' | 'persisted';
  realmBaseUrl: string;
  clearPersistedSession: () => Promise<void>;
};

export async function bootstrapAuthSession(input: BootstrapAuthInput): Promise<void> {
  const { realm, accessToken } = input;
  const store = useAppStore.getState();

  if (!accessToken) {
    store.clearAuthSession();
    return;
  }

  try {
    const user: CurrentUserDto = await realm.services.MeService.getMe();
    if (!user || !user.id) {
      store.clearAuthSession();
      return;
    }

    store.setAuthSession(
      {
        id: String(user.id),
        displayName: typeof user.displayName === 'string' ? user.displayName : '',
        email: user.email ? String(user.email) : undefined,
        avatarUrl: user.avatarUrl ? String(user.avatarUrl) : undefined,
      },
      accessToken,
      String((input.refreshToken ?? store.auth.refreshToken) || '').trim(),
    );
    if (input.source === 'persisted') {
      await persistSharedDesktopAuthSession({
        realmBaseUrl: input.realmBaseUrl,
        accessToken,
        refreshToken: input.refreshToken,
        user: useAppStore.getState().auth.user,
        saveSession: (session) => saveAuthSession(session),
        clearSession: () => clearPersistedAuthSession(),
      });
    }
  } catch {
    if (input.source === 'persisted') {
      await input.clearPersistedSession();
    }
    store.clearAuthSession();
  }
}
