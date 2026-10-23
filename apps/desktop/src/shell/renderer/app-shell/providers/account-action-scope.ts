import type { StoreApi } from 'zustand/vanilla';
import type { AppStoreState } from './store-types.js';

type AccountActionStore = Pick<StoreApi<AppStoreState>, 'getState' | 'subscribe'>;

function realmOf(state: AppStoreState): string {
  return String(state.runtimeDefaults?.realm.realmBaseUrl ?? '').replace(/\/$/, '');
}

/** Track the account lifecycle, not the reference of a refreshable projection. */
export function captureAccountActionScope(store: AccountActionStore) {
  const initial = store.getState();
  const accountId = typeof initial.auth.user?.id === 'string' ? initial.auth.user.id : '';
  if (initial.auth.status !== 'authenticated' || !accountId) return null;
  const realmBaseUrl = realmOf(initial);
  const matches = (state: AppStoreState) =>
    (state.auth.status === 'authenticated' || state.auth.status === 'refresh-pending')
    && state.auth.user?.id === accountId && realmOf(state) === realmBaseUrl;
  let current = true;
  // Latch invalidation: logging out and returning to the same account must not
  // revive an old operation, even if both transitions precede its completion.
  const unsubscribe = store.subscribe((state) => { if (!matches(state)) current = false; });
  return {
    accountId,
    realmBaseUrl,
    isCurrent: () => current && matches(store.getState()),
    dispose() { current = false; unsubscribe(); },
  };
}
