import type { StoreApi } from 'zustand/vanilla';
import type { AppStoreState } from './store-types.js';

export type AccountActionStore = Pick<StoreApi<AppStoreState>, 'getState' | 'subscribe'>;

function realmOf(state: AppStoreState): string {
  return String(state.runtimeDefaults?.realm.realmBaseUrl ?? '').replace(/\/$/, '');
}

/** Track the account lifecycle, not the reference of a refreshable projection. */
export function captureAccountActionScope(store: AccountActionStore, options: { allowRefreshing?: boolean } = {}) {
  const initial = store.getState();
  const accountId = typeof initial.auth.user?.id === 'string' ? initial.auth.user.id : '';
  if ((initial.auth.status !== 'authenticated' && !(options.allowRefreshing && initial.auth.status === 'refresh-pending')) || !accountId) return null;
  const realmBaseUrl = realmOf(initial);
  const realmEnvironmentId = initial.auth.user?.realmEnvironmentId;
  const authorizationRevision = initial.auth.authorizationRevision;
  const matches = (state: AppStoreState) =>
    (state.auth.status === 'authenticated' || state.auth.status === 'refresh-pending')
    && state.auth.authorizationRevision === authorizationRevision
    && state.auth.user?.id === accountId && realmOf(state) === realmBaseUrl
    && state.auth.user?.realmEnvironmentId === realmEnvironmentId;
  const abort = new AbortController();
  // Latch invalidation: logging out and returning to the same account must not
  // revive an old operation, even if both transitions precede its completion.
  const unsubscribe = store.subscribe((state) => { if (!matches(state)) abort.abort(); });
  return {
    accountId,
    realmBaseUrl,
    realmEnvironmentId: typeof realmEnvironmentId === 'string' ? realmEnvironmentId : '',
    signal: abort.signal,
    isCurrent: () => !abort.signal.aborted && matches(store.getState()),
    dispose() { abort.abort(); unsubscribe(); },
  };
}
