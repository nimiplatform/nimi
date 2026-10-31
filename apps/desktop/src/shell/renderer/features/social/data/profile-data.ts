import {
  addNimiRealmFriendById,
  blockNimiRealmUser,
  loadNimiRealmCurrentUserProfile,
  loadNimiRealmUserProfileById,
  type NimiRealmSocialProfileView,
  applyNimiRealmFriendshipAction,
  loadNimiRealmRelationship,
  unblockNimiRealmUser,
  updateNimiRealmCurrentUserProfile,
} from '@nimiplatform/sdk/realm';
import {
  isRealmOfflineErrorLike as isRealmOfflineError,
  ReasonCode,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import {
  fetchPendingFriendRequests,
  type SocialSnapshotStore,
  type RealmApiCaller,
  type RealmDataErrorEmitter,
  type SocialContactSnapshot,
} from './social-snapshot';
import type { RealmSocialOfflinePort } from './social-offline-port.js';

type UserProfileProjection = NimiRealmSocialProfileView & { relationship: Awaited<ReturnType<typeof loadNimiRealmRelationship>>; relationshipId: string | null; isFriend: boolean; isPendingFriendRequest: boolean };

export type { SocialContactSnapshot } from './social-snapshot';

export async function loadCurrentUserProfile(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
) {
  return callApi(
    (realm) => loadNimiRealmCurrentUserProfile(realm, emitRealmDataError),
    'Failed to load Realm current user',
  );
}

export async function updateCurrentUserProfile(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  data: JsonObject,
) {
  return callApi(
    (realm) => updateNimiRealmCurrentUserProfile(realm, emitRealmDataError, data),
    'Failed to update Realm current user',
  );
}

export async function loadContactList(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  snapshotStore: SocialSnapshotStore,
): Promise<SocialContactSnapshot> {
  try {
    return await snapshotStore.load(callApi, emitRealmDataError);
  } catch (error) {
    emitRealmDataError('load-contacts', error);
    throw error;
  }
}

export async function loadSocialSnapshot(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  snapshotStore: SocialSnapshotStore,
): Promise<SocialContactSnapshot> {
  try {
    return await snapshotStore.load(callApi, emitRealmDataError);
  } catch (error) {
    emitRealmDataError('load-social-snapshot', error);
    throw error;
  }
}

export async function loadPendingFriendRequests(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
) {
  return fetchPendingFriendRequests(callApi, emitRealmDataError);
}

export async function loadUserProfileById(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  offline: RealmSocialOfflinePort,
  id: string,
): Promise<UserProfileProjection> {
  const normalizedId = String(id || '').trim();
  const cache = offline.capture();
  try {
    const enriched = await callApi(
      async realm => {
        const [profile, relationship] = await Promise.all([
          loadNimiRealmUserProfileById(realm, emitRealmDataError, normalizedId),
          loadNimiRealmRelationship(realm, normalizedId),
        ]);
        return { ...profile, relationship, relationshipId: relationship.relationshipId,
          isFriend: relationship.state === 'active', isPendingFriendRequest: relationship.state === 'pending_outgoing' };
      },
      'Failed to load Realm user profile',
    );
    await cache.syncProfileMetadata(`user:${normalizedId}`, enriched);
    return enriched;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await cache.loadProfileMetadata<UserProfileProjection>(`user:${normalizedId}`);
      if (cached) {
        cache.markCacheFallbackUsed();
        return cached;
      }
    } else if (error && typeof error === 'object') {
      const failure = error as { status?: unknown; statusCode?: unknown; reasonCode?: unknown; details?: { httpStatus?: unknown } };
      const status = Number(failure.details?.httpStatus ?? failure.status ?? failure.statusCode);
      if (status === 403 || status === 404 || failure.reasonCode === ReasonCode.PRINCIPAL_UNAUTHORIZED) {
        await cache.removeProfileMetadata(`user:${normalizedId}`);
      }
    }
    throw error;
  }
}

export async function addFriendById(
  callApi: RealmApiCaller,
  userId: string,
  message?: string,
) {
  if (!userId) {
    throw new Error('用户ID不能为空');
  }
  return callApi(
    (realm) => addNimiRealmFriendById(realm, userId, message),
    'Failed to add Realm friend',
  );
}

export async function applySocialRelationshipAction(
  callApi: RealmApiCaller,
  userId: string,
  relationshipId: string,
  action: 'accept' | 'reject' | 'cancel' | 'remove',
) {
  if (!userId) {
    throw new Error('用户ID不能为空');
  }
  await callApi(
    (realm) => applyNimiRealmFriendshipAction(realm, userId, { action, relationshipId }),
    'Failed to remove Realm friend',
  );
}

export async function addFriendByIdentifier(input: {
  callApi: RealmApiCaller;
  userId: string;
  reloadContacts: () => Promise<void>;
}) {
  await addFriendById(input.callApi, input.userId);
  await input.reloadContacts();
  return { id: String(input.userId || '') };
}

export async function requestOrAcceptFriend(input: {
  callApi: RealmApiCaller;
  offline: RealmSocialOfflinePort;
  userId: string;
  message?: string;
  reloadContacts: () => Promise<void>;
}) {
  try {
    await addFriendById(input.callApi, input.userId, input.message);
    await input.reloadContacts();
  } catch (error) {
    if (isRealmOfflineError(error)) {
      input.offline.markRealmUnreachable();
    }
    throw error;
  }
  return { id: String(input.userId || '') };
}

export async function removeFriend(input: {
  callApi: RealmApiCaller;
  offline: RealmSocialOfflinePort;
  userId: string;
  relationshipId: string;
  reloadContacts: () => Promise<void>;
}) {
  try {
    await applySocialRelationshipAction(input.callApi, input.userId, input.relationshipId, 'remove');
    await input.reloadContacts();
  } catch (error) {
    if (isRealmOfflineError(error)) {
      input.offline.markRealmUnreachable();
    }
    throw error;
  }
}

export async function actOnFriendRequest(input: {
  callApi: RealmApiCaller;
  offline: RealmSocialOfflinePort;
  userId: string;
  relationshipId: string;
  action: 'accept' | 'reject' | 'cancel';
  reloadContacts: () => Promise<void>;
}) {
  try {
    await applySocialRelationshipAction(input.callApi, input.userId, input.relationshipId, input.action);
    await input.reloadContacts();
  } catch (error) {
    if (isRealmOfflineError(error)) {
      input.offline.markRealmUnreachable();
    }
    throw error;
  }
  return { id: String(input.userId || '') };
}

export async function blockUser(
  callApi: RealmApiCaller,
  contact: JsonObject,
  reloadContacts: () => Promise<void>,
) {
  const contactId = String(contact.id || '');
  if (!contactId) {
    throw new Error('用户ID不能为空');
  }

  const result = await callApi(
    (realm) => blockNimiRealmUser(realm, contactId),
    'Failed to block Realm user',
  );

  await reloadContacts();
  return result;
}

export async function unblockUser(
  callApi: RealmApiCaller,
  contact: JsonObject,
  reloadContacts: () => Promise<void>,
) {
  const contactId = String(contact.id || '');
  if (!contactId) {
    throw new Error('用户ID不能为空');
  }

  const result = await callApi(
    (realm) => unblockNimiRealmUser(realm, contactId),
    'Failed to unblock Realm user',
  );

  await reloadContacts();
  return result;
}
