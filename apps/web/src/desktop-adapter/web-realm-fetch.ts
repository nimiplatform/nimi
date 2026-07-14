export function createWebRealmFetch(): typeof fetch {
  const browserFetch = globalThis.fetch?.bind(globalThis);
  if (!browserFetch) {
    throw new Error('Web Realm fetch is unavailable in this browser context.');
  }
  return async (input: RequestInfo | URL, init: RequestInit = {}) => browserFetch(input, init);
}
