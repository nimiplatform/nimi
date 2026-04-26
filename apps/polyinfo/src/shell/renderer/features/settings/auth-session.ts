import type { AuthUser } from '@renderer/data/types.js';

type RealmAuthPatch = {
  accessToken?: () => string;
  refreshToken?: () => string;
};

type RealmLike = {
  updateAuth: (patch: RealmAuthPatch) => void;
  services: {
    MeService: {
      getMe: () => Promise<Record<string, unknown> | null | undefined>;
    };
  };
};

type PersistedPolyinfoSession = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

export function normalizePolyinfoAuthUser(user: Record<string, unknown> | null | undefined): AuthUser {
  if (!user?.id) {
    throw new Error('登录返回不完整');
  }
  return {
    id: String(user.id),
    displayName: String(user.displayName || user.name || '').trim(),
    email: user.email ? String(user.email) : undefined,
    avatarUrl: user.avatarUrl ? String(user.avatarUrl) : undefined,
  };
}

export async function applyPolyinfoAccessTokenSession(input: {
  realm: RealmLike;
  accessToken: string;
  refreshToken?: string;
  setAuthSession: (user: AuthUser, token: string, refreshToken?: string) => void;
  persistSession: (session: PersistedPolyinfoSession) => Promise<void>;
}): Promise<AuthUser> {
  const accessToken = String(input.accessToken || '').trim();
  const refreshToken = String(input.refreshToken || '').trim();
  if (!accessToken) {
    throw new Error('登录返回不完整');
  }

  input.realm.updateAuth({
    accessToken: () => accessToken,
    refreshToken: () => refreshToken,
  });

  const user = normalizePolyinfoAuthUser(await input.realm.services.MeService.getMe());
  input.setAuthSession(user, accessToken, refreshToken);
  await input.persistSession({
    accessToken,
    refreshToken,
    user,
  });
  return user;
}
