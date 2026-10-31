import {
  fetchNimiRealmPendingFriendRequests,
  loadNimiRealmSocialSnapshot,
  type NimiRealmSocialContactSnapshot,
  type NimiRealmSocialDataErrorEmitter,
  type Realm,
} from '@nimiplatform/sdk/realm';
import { captureAccountActionScope, type AccountActionStore } from '../../../app-shell/providers/account-action-scope.js';

export type RealmApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
export type RealmDataErrorEmitter = NimiRealmSocialDataErrorEmitter;
export type SocialContactSnapshot = NimiRealmSocialContactSnapshot;

function emptySocialContactSnapshot(): SocialContactSnapshot {
  return {
    friends: [],
    pendingReceived: [],
    pendingSent: [],
    blocked: [],
  };
}

export function fetchPendingFriendRequests(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
) {
  return callApi(
    (realm) => fetchNimiRealmPendingFriendRequests(realm, emitRealmDataError, { direction: 'received' }),
    'Failed to load Realm friend requests',
  );
}

export type SocialSnapshotStore = {
  load(
    callApi: RealmApiCaller,
    emitRealmDataError: RealmDataErrorEmitter,
  ): Promise<SocialContactSnapshot>;
  get(): SocialContactSnapshot;
  update(snapshot: SocialContactSnapshot): void;
  reset(): void;
};

export function createSocialSnapshotStore(store: AccountActionStore): SocialSnapshotStore {
  let owner: ReturnType<typeof captureAccountActionScope> = null;
  let cachedContacts = emptySocialContactSnapshot();
  let inflightSnapshot: Promise<SocialContactSnapshot> | null = null;

  function reset() {
    owner?.dispose();
    owner = null;
    cachedContacts = emptySocialContactSnapshot();
    inflightSnapshot = null;
  }

  function requireOwner() {
    if (!owner?.isCurrent()) {
      reset();
      owner = captureAccountActionScope(store, { allowRefreshing: true });
    }
    if (!owner?.realmEnvironmentId) throw new Error('CONTACT_ACCOUNT_UNAVAILABLE');
    return owner;
  }

  return Object.freeze({
    load(callApi, emitRealmDataError) {
      const scope = requireOwner();
      if (inflightSnapshot) return inflightSnapshot;
      inflightSnapshot = callApi(
        (realm) => loadNimiRealmSocialSnapshot(realm, emitRealmDataError, { signal: scope.signal }),
        'Failed to load Realm social snapshot',
      )
        .then((snapshot) => {
          scope.signal.throwIfAborted();
          cachedContacts = snapshot;
          return snapshot;
        })
        .finally(() => {
          if (owner === scope) inflightSnapshot = null;
        });
      return inflightSnapshot;
    },
    get() {
      return owner?.isCurrent() ? cachedContacts : emptySocialContactSnapshot();
    },
    update(snapshot) {
      requireOwner();
      cachedContacts = { ...snapshot };
    },
    reset,
  });
}

export function isPendingSentRequestInContacts(
  contacts: Pick<SocialContactSnapshot, 'pendingSent'> | undefined,
  userId: string,
): boolean {
  if (!contacts?.pendingSent?.length) return false;
  return contacts.pendingSent.some((req) => req.userId === userId);
}

export function isFriendInContacts(
  contacts: { friends?: readonly Record<string, unknown>[] } | undefined,
  userId: string,
): boolean {
  if (!contacts?.friends?.length) return false;
  return contacts.friends.some((friend: Record<string, unknown>) => friend.id === userId);
}
