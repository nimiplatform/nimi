import type { Realm } from '@nimiplatform/sdk/realm';
import { useAppStore } from '@renderer/app-shell/app-store.js';

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
    const data = await realm.raw.request<Record<string, unknown>>({
      method: 'GET',
      path: '/api/auth/me',
    });
    const user = data.user as Record<string, unknown> | undefined;

    if (!user || !user.id) {
      store.clearAuthSession();
      return;
    }

    store.setAuthSession(
      {
        id: String(user.id),
        displayName: String(user.displayName || user.name || ''),
        email: user.email ? String(user.email) : undefined,
        avatarUrl: user.avatarUrl ? String(user.avatarUrl) : undefined,
      },
      accessToken,
      String(data.refreshToken || ''),
    );
  } catch {
    store.clearAuthSession();
  }
}
