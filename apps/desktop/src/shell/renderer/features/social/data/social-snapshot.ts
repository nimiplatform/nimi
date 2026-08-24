import {
  fetchNimiRealmPendingFriendRequests,
  loadNimiRealmSocialSnapshot,
  type NimiRealmSocialContactSnapshot,
  type NimiRealmSocialDataErrorEmitter,
  type Realm,
} from '@nimiplatform/sdk/realm';

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

function mergeWithLocalContacts(snapshot: SocialContactSnapshot): SocialContactSnapshot {
  return snapshot;
}

export function fetchPendingFriendRequests(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
) {
  return callApi(
    (realm) => fetchNimiRealmPendingFriendRequests(realm, emitRealmDataError),
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

export function createSocialSnapshotStore(): SocialSnapshotStore {
  let cachedContacts = emptySocialContactSnapshot();
  let inflightSnapshot: Promise<SocialContactSnapshot> | null = null;

  return Object.freeze({
    load(callApi, emitRealmDataError) {
      if (inflightSnapshot) return inflightSnapshot;
      inflightSnapshot = callApi(
        (realm) => loadNimiRealmSocialSnapshot(realm, emitRealmDataError),
        'Failed to load Realm social snapshot',
      )
        .then((snapshot) => {
          const merged = mergeWithLocalContacts(snapshot);
          cachedContacts = { ...merged };
          return merged;
        })
        .finally(() => {
          inflightSnapshot = null;
        });
      return inflightSnapshot;
    },
    get() {
      return cachedContacts;
    },
    update(snapshot) {
      cachedContacts = { ...snapshot };
    },
    reset() {
      cachedContacts = emptySocialContactSnapshot();
      inflightSnapshot = null;
    },
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
