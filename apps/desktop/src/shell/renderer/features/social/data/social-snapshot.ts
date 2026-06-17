import {
  fetchNimiRealmPendingFriendRequests,
  loadNimiRealmSocialSnapshot,
  type NimiRealmSocialContactSnapshot,
  type NimiRealmSocialDataErrorEmitter,
  type NimiRealmSocialProfileView,
  type Realm,
} from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@nimiplatform/sdk/types';

export type RealmApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
export type RealmDataErrorEmitter = NimiRealmSocialDataErrorEmitter;
export type SocialContactSnapshot = NimiRealmSocialContactSnapshot;

let cachedContacts: SocialContactSnapshot = {
  friends: [],
  pendingReceived: [],
  pendingSent: [],
  blocked: [],
};

const inflightSnapshots = new Map<string, Promise<SocialContactSnapshot>>();

function mergeWithLocalContacts(snapshot: SocialContactSnapshot): SocialContactSnapshot {
  return snapshot;
}

export function enrichProfileWithWorldBanner(
  _callApi: RealmApiCaller,
  profile: JsonObject,
): Promise<NimiRealmSocialProfileView> {
  return Promise.resolve(profile as NimiRealmSocialProfileView);
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

export async function loadMergedSocialSnapshot(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
): Promise<SocialContactSnapshot> {
  const key = 'social';
  const existing = inflightSnapshots.get(key);
  if (existing) return existing;

  const task = callApi(
    (realm) => loadNimiRealmSocialSnapshot(realm, emitRealmDataError),
    'Failed to load Realm social snapshot',
  )
    .then((snapshot) => {
      const merged = mergeWithLocalContacts(snapshot);
      cachedContacts = { ...merged };
      return merged;
    })
    .finally(() => {
      inflightSnapshots.delete(key);
    });

  inflightSnapshots.set(key, task);
  return task;
}

export function getCachedContacts(): SocialContactSnapshot {
  return cachedContacts;
}

export function isPendingSentRequestInContacts(
  contacts: Pick<SocialContactSnapshot, 'pendingSent'> | undefined,
  userId: string,
): boolean {
  if (!contacts?.pendingSent?.length) return false;
  return contacts.pendingSent.some((req) => req.userId === userId);
}

export function updateCachedContacts(snapshot: SocialContactSnapshot) {
  cachedContacts = { ...snapshot };
}

export function isFriendInContacts(
  contacts: { friends?: readonly Record<string, unknown>[] } | undefined,
  userId: string,
): boolean {
  if (!contacts?.friends?.length) return false;
  return contacts.friends.some((friend: Record<string, unknown>) => friend.id === userId);
}
