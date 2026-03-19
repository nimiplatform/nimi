import type { Realm } from '@nimiplatform/sdk/realm';
import type { AuthPlatformAdapter } from '@nimiplatform/shell-auth';
import { overtoneTauriOAuthBridge } from '@renderer/bridge/oauth.js';
import {
  clearRealmInstance,
  getRealmInstance,
  initRealmInstance,
} from '@renderer/bridge/realm-sdk.js';

const OVERTONE_EMBEDDED_AUTH_UNSUPPORTED =
  'Embedded auth flow is not supported in Overtone desktop-browser mode.';

type OvertoneUser = Record<string, unknown> & {
  id: string;
  displayName: string;
};

type OvertoneRealmRequestInput = Parameters<Realm['raw']['request']>[0];

let currentAccessToken = '';

function unsupported<T>(): Promise<T> {
  return Promise.reject(new Error(OVERTONE_EMBEDDED_AUTH_UNSUPPORTED));
}

function normalizeOvertoneUser(
  user: Record<string, unknown> | null | undefined,
): OvertoneUser | null {
  if (!user || !user.id) {
    return null;
  }

  return {
    ...user,
    id: String(user.id),
    displayName: String(user.displayName || user.name || ''),
  };
}

export function getOvertoneRealmBaseUrl(): string {
  const baseUrl = String(import.meta.env.VITE_NIMI_REALM_BASE_URL || '').trim();
  if (!baseUrl) {
    throw new Error('Missing VITE_NIMI_REALM_BASE_URL configuration');
  }
  return baseUrl;
}

export async function resolveOvertoneCurrentUser(
  accessToken: string,
): Promise<OvertoneUser | null> {
  const realm = initRealmInstance(getOvertoneRealmBaseUrl(), accessToken);
  const data = await realm.raw.request<Record<string, unknown>>({
    method: 'GET',
    path: '/api/auth/me',
  });
  return normalizeOvertoneUser((data.user as Record<string, unknown> | null | undefined) ?? null);
}

function getAuthenticatedRealm() {
  if (!currentAccessToken) {
    throw new Error('Overtone auth token is not initialized');
  }

  return getRealmInstance() ?? initRealmInstance(getOvertoneRealmBaseUrl(), currentAccessToken);
}

export function createOvertoneDesktopBrowserAuthAdapter(): AuthPlatformAdapter {
  return {
    checkEmail: unsupported,
    passwordLogin: unsupported,
    requestEmailOtp: unsupported,
    verifyEmailOtp: unsupported,
    verifyTwoFactor: unsupported,
    walletChallenge: unsupported,
    walletLogin: unsupported,
    oauthLogin: unsupported,
    updatePassword: unsupported,
    loadCurrentUser: async () => {
      if (!currentAccessToken) {
        return null;
      }
      return resolveOvertoneCurrentUser(currentAccessToken);
    },
    applyToken: async (accessToken: string) => {
      currentAccessToken = String(accessToken || '').trim();
      if (!currentAccessToken) {
        clearRealmInstance();
        return;
      }
      initRealmInstance(getOvertoneRealmBaseUrl(), currentAccessToken);
    },
    oauthBridge: overtoneTauriOAuthBridge,
    realmRequest: async (method: string, path: string, body?: unknown) => {
      const request: OvertoneRealmRequestInput = body === undefined
        ? { method: method as OvertoneRealmRequestInput['method'], path }
        : { method: method as OvertoneRealmRequestInput['method'], path, body };
      return getAuthenticatedRealm().raw.request<Record<string, unknown>>(request);
    },
    syncAfterLogin: async () => {},
  };
}
