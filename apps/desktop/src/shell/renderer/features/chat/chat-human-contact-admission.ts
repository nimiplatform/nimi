import { useQuery } from '@tanstack/react-query';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

export type HumanContactAdmission = {
  state: 'loading' | 'error' | 'allowed' | 'denied';
  blockedByMe: boolean;
  deleted?: boolean;
  relationship?: RealmModel<'UserRelationshipDto'>;
  refresh(): void;
};

/** One selected person's owner projection. The server still decides every write. */
// @nimi-authority: rule.nimi.desktop.product-surfaces.r030
export function useHumanContactAdmission(peerAccountId: string | null, deleted = false): HumanContactAdmission {
  const sdk = useDesktopRendererSdk();
  const store = useAppStoreApi();
  const auth = useAppStore(state => state.auth);
  const environment = String(auth.user?.realmEnvironmentId ?? '');
  const accountId = String(auth.user?.id ?? '');
  const query = useQuery({
    queryKey: ['contacts', 'chat-admission', environment, accountId, peerAccountId],
    queryFn: async () => {
      const scope = captureAccountActionScope(store);
      if (!scope) throw new Error('CONTACT_ACCOUNT_UNAVAILABLE');
      try {
        const result = await sdk.realm().social.getMyRelationshipWithUser({ path: { id: peerAccountId! } });
        if (!scope.isCurrent()) throw new Error('CONTACT_ACCOUNT_CHANGED');
        return result;
      } finally { scope.dispose(); }
    },
    enabled: !deleted && auth.status === 'authenticated' && Boolean(environment && accountId && peerAccountId),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
  return {
    state: deleted ? 'denied' : query.isError || query.fetchStatus === 'paused' ? 'error' : !query.data ? 'loading' : query.data.canMessage ? 'allowed' : 'denied',
    blockedByMe: query.data?.blockedByMe === true,
    relationship: query.isError ? undefined : query.data,
    deleted,
    refresh: () => { if (peerAccountId && auth.status === 'authenticated') void query.refetch(); },
  };
}
