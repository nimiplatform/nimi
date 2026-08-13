import { Realm, createRealmFetchTransport } from '@nimiplatform/sdk/realm';
import { isSecureBrowserSessionOrigin, readValidatedOauthNext } from './oauth-continuation.js';

const BROWSER_SESSION_HEADERS = Object.freeze({
  'x-nimi-auth-response': 'browser-session',
});

function realmOrigin(search: string): string {
  const continuation = readValidatedOauthNext(search);
  if (continuation) return new URL(continuation).origin;
  const configured = String(import.meta.env.VITE_NIMI_REALM_BASE_URL || '').trim();
  if (configured) {
    const parsed = new URL(configured);
    if (!isSecureBrowserSessionOrigin(parsed)) throw new Error('Realm origin is not admitted.');
    return parsed.origin;
  }
  const current = new URL(window.location.origin);
  if (!isSecureBrowserSessionOrigin(current)) throw new Error('Realm origin is not admitted.');
  return current.origin;
}

// @nimi-authority: rule.nimi.sdks.realm-consumer.r046
export function createWebBrowserRealm(search = window.location.search): Realm {
  return new Realm({
    transport: createRealmFetchTransport({
      baseUrl: realmOrigin(search),
      credentials: 'include',
      headers: BROWSER_SESSION_HEADERS,
    }),
  });
}
