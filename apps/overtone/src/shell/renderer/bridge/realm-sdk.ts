import { Realm } from '@nimiplatform/sdk/realm';

let instance: Realm | null = null;

/**
 * Get or create the Realm SDK client.
 *
 * Realm uses HTTP transport directly (not routed through Tauri IPC).
 * The access token must be provided before calling this.
 */
export function getRealmInstance(): Realm | null {
  return instance;
}

export function initRealmInstance(baseUrl: string, accessToken: string): Realm {
  instance = new Realm({
    baseUrl,
    auth: { accessToken },
  });
  return instance;
}

export function clearRealmInstance(): void {
  instance = null;
}
