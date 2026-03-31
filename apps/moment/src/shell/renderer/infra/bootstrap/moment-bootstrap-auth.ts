import type { Realm, RealmServiceResult } from '@nimiplatform/sdk/realm';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

type CurrentUserDto = RealmServiceResult<'MeService', 'getMe'>;

export type BootstrapAuthInput = {
  realm: Realm;
  accessToken: string;
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
    const userRecord = user as Record<string, unknown>;

    if (!user || !user.id) {
      store.clearAuthSession();
      return;
    }

    store.setAuthSession(
      {
        id: String(user.id),
        displayName: String(user.displayName || userRecord.name || ''),
        email: user.email ? String(user.email) : undefined,
        avatarUrl: user.avatarUrl ? String(user.avatarUrl) : undefined,
      },
      accessToken,
      String(store.auth.refreshToken || ''),
    );
  } catch {
    store.clearAuthSession();
  }
}
