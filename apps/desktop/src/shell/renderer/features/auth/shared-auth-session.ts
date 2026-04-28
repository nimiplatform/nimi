import {
  clearPersistedAccessToken,
  type ResolvedDesktopBootstrapAuthSession,
} from '@nimiplatform/nimi-kit/auth';

export async function loadResolvedSharedDesktopBootstrapAuthSession(input: {
  realmBaseUrl: string;
  envAccessToken?: string | null;
}): Promise<ResolvedDesktopBootstrapAuthSession> {
  void input;
  throw new Error('Desktop shared auth bootstrap is disabled; RuntimeAccountService owns local account truth');
}

export async function persistSharedDesktopSession(input: {
  realmBaseUrl?: string;
  accessToken: string;
  refreshToken?: string | null;
  user?: Record<string, unknown> | null;
}): Promise<void> {
  void input;
  throw new Error('Desktop shared auth persistence is disabled; RuntimeAccountService owns token custody');
}

export async function clearSharedDesktopSession(): Promise<void> {
  clearPersistedAccessToken();
}
