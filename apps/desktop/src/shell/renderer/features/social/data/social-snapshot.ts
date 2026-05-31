import type { RealmSocialContactSnapshot } from '@nimiplatform/sdk/realm';
import {
  enrichRealmProfileWithWorldBanner,
  fetchRealmAgentFriendLimit,
  fetchRealmPendingFriendRequests,
  loadRealmSocialSnapshot,
  type RealmSocialApiCaller,
  type RealmSocialErrorEmitter,
} from '@nimiplatform/sdk/realm';

export type RealmApiCaller = RealmSocialApiCaller;
export type RealmDataErrorEmitter = RealmSocialErrorEmitter;
export type SocialContactSnapshot = RealmSocialContactSnapshot;

let cachedContacts: SocialContactSnapshot = {
  friends: [],
  agents: [],
  groups: [],
  pendingReceived: [],
  pendingSent: [],
  blocked: [],
};

const inflightSnapshots = new Map<string, Promise<SocialContactSnapshot>>();

function mergeWithLocalContacts(snapshot: SocialContactSnapshot): SocialContactSnapshot {
  return snapshot;
}

export const enrichProfileWithWorldBanner = enrichRealmProfileWithWorldBanner;
export const fetchPendingFriendRequests = fetchRealmPendingFriendRequests;
export const fetchAgentFriendLimit = fetchRealmAgentFriendLimit;

export async function loadMergedSocialSnapshot(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
): Promise<SocialContactSnapshot> {
  const key = 'social';
  const existing = inflightSnapshots.get(key);
  if (existing) return existing;

  const task = loadRealmSocialSnapshot(callApi, emitRealmDataError)
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
  contacts: { friends?: Array<Record<string, unknown>> } | undefined,
  userId: string,
): boolean {
  if (!contacts?.friends?.length) return false;
  return contacts.friends.some((friend: Record<string, unknown>) => friend.id === userId);
}
