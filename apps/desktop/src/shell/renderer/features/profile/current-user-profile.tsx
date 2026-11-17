import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore, useAppStoreApi } from '../../app-shell/providers/app-store.js';
import { useRealmSocialData } from '../social/data/realm-social-data-context.js';

export function currentUserProfileQueryKey(baseUrl: string, environmentId: string, accountId: string, authorizationRevision: string) {
  return ['current-user-profile', baseUrl, environmentId, accountId, authorizationRevision] as const;
}

// Profile and expiring media are a view over getMe. Runtime alone owns authentication.
export function useCurrentUserProfileProjection() {
  const data = useRealmSocialData();
  const store = useAppStoreApi();
  const auth = useAppStore(state => state.auth);
  const ready = useAppStore(state => state.bootstrapReady);
  const base = useAppStore(state => String(state.runtimeDefaults?.realm.realmBaseUrl || '').replace(/\/$/, ''));
  const apply = useAppStore(state => state.applyCurrentUserProfile);
  const id = String(auth.user?.id || '');
  const environment = String(auth.user?.realmEnvironmentId || '');
  const queryKey = currentUserProfileQueryKey(base, environment, id, auth.authorizationRevision);
  const query = useQuery({ queryKey, queryFn: () => data.loadCurrentUser(),
    enabled: ready && auth.status === 'authenticated' && Boolean(base && environment && id && auth.authorizationRevision),
    staleTime: 240_000, retry: false,
    refetchInterval: (current) => current.state.data?.avatarMedia?.expiresAt ? 240_000 : false,
  });
  useEffect(() => {
    if (auth.status === 'authenticated' && query.data?.id === id
      && store.getState().auth.authorizationRevision === auth.authorizationRevision) {
      apply({ ...query.data }, environment);
    }
  }, [apply, auth.status, auth.sequence, auth.authorizationRevision, environment, id, query.data, store]);
  return { query, queryKey };
}

export function CurrentUserProfileObserver() { useCurrentUserProfileProjection(); return null; }
