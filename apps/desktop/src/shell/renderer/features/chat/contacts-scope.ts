import { useAppStore } from '../../app-shell/providers/app-store.js';

export const contactsScopeKey = (realm: string, accountId: string, revision: string | undefined) => JSON.stringify([realm, accountId, revision]);

export function useContactsScope() {
  const auth = useAppStore(state => state.auth);
  const accountId = String(auth.user?.id ?? '');
  const realm = useAppStore(state => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  return { auth, accountId, realm, scope: contactsScopeKey(realm, accountId, auth.authorizationRevision) };
}
