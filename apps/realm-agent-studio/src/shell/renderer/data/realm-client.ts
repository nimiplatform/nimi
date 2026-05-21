import { createRealmClient } from '@nimiplatform/sdk/realm';

const DEFAULT_REALM_BASE_URL = 'http://127.0.0.1:3000';

export function createStudioRealmClient() {
  const baseUrl = import.meta.env.VITE_REALM_BASE_URL || DEFAULT_REALM_BASE_URL;
  const accessToken = import.meta.env.VITE_REALM_ACCESS_TOKEN;

  return createRealmClient({
    baseUrl,
    auth: accessToken
      ? {
          mode: 'external_principal',
          accessToken,
        }
      : null,
  });
}
