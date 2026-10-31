import { Realm, createRealmFetchTransport } from '@nimiplatform/sdk/realm';
import { isSecureBrowserSessionOrigin, readValidatedOauthNext } from './oauth-continuation.js';
import { createBrowserSessionReader } from './browser-session-reader.js';

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

export function webRealmOrigin(): string {
  return realmOrigin(window.location.search);
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

type BrowserAccount = Awaited<ReturnType<Realm['me']>>;
const accountReaders = new Map<string, () => Promise<BrowserAccount>>();

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005c
export function readWebBrowserAccount() {
  const origin = webRealmOrigin();
  let read = accountReaders.get(origin);
  if (!read) {
    const realm = createWebBrowserRealm();
    read = createBrowserSessionReader({
      read: () => realm.me(),
      renew: async () => {
        await realm.generated.refreshBrowserSession({
          path: {},
          headers: { 'x-nimi-auth-response': 'browser-session' },
        });
      },
      exclusive: (work, originalError) => {
        // Without an origin-wide lock, require ordinary sign-in instead of racing
        // rotation against another tab. No credentials are read into JavaScript.
        if (!navigator.locks) return Promise.reject(originalError);
        return navigator.locks.request(`nimi:browser-session:${origin}`, work);
      },
    });
    accountReaders.set(origin, read);
  }
  return read();
}
