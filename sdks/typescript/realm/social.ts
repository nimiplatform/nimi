import type {
  AddFriendBodyDto,
  BlockUserBodyDto,
  CreatePostDto,
  CreateReportDto,
  CreateSourceMaterializationPacketDto,
  FeedPageMetaDto,
  FeedResponseDto,
  FriendProfileDto,
  PostDto,
  RealmTypedCallOptions,
  ReportResponseDto,
  UpdatePostDto,
  UpdateUserDto,
  UserPrivateDto,
} from '../core-generated/realm-typed-client';
import type { JsonObject } from '../types';
import type {
  NimiRealmPendingFriendRequestDto,
  NimiRealmPendingFriendRequestListDto,
  NimiRealmPostFeedInput,
  NimiRealmSocialApi,
  NimiRealmSocialContactRecord,
  NimiRealmSocialContactSnapshot,
  NimiRealmSocialDataErrorEmitter,
  NimiRealmSocialMutationExecutionInput,
  NimiRealmSocialProfileView,
  NimiRealmSourceMaterializationPacket,
} from './social-types';
import {
  normalizeText,
  requireSourceMaterializationRequest,
  requireText,
  socialError,
  toNullableString,
  toRecord,
  toRecordArray,
} from './social-validation';

export type {
  NimiRealmPendingFriendRequestDto,
  NimiRealmPendingFriendRequestListDto,
  NimiRealmPostFeedInput,
  NimiRealmSocialApi,
  NimiRealmSocialContactRecord,
  NimiRealmSocialContactSnapshot,
  NimiRealmSocialDataErrorEmitter,
  NimiRealmCoreSourceRef,
  NimiRealmSocialMutationExecutionInput,
  NimiRealmSocialMutationKind,
  NimiRealmSocialProfileView,
  NimiRealmSourceMaterializationRequest,
  NimiRealmSourceMaterializationPacket,
} from './social-types';

type PendingRequestMapValue = {
  readonly requestedAt: string | null;
  readonly requestMessage: string | null;
};

function normalizePostFeedInput(input: NimiRealmPostFeedInput): NimiRealmPostFeedInput {
  return {
    visibility: input.visibility,
    worldId: typeof input.worldId === 'string' ? input.worldId : undefined,
    authorId: typeof input.authorId === 'string' ? input.authorId : undefined,
    limit: typeof input.limit === 'number' ? input.limit : undefined,
    cursor: typeof input.cursor === 'string' ? input.cursor : undefined,
    scope: input.scope,
  };
}

function toPendingRequestItem(value: unknown): NimiRealmPendingFriendRequestDto | null {
  const record = toRecord(value);
  if (!record) {
    return null;
  }
  const userId = normalizeText(record.userId);
  if (!userId) {
    return null;
  }
  return {
    userId,
    ...(normalizeText(record.requestedAt) ? { requestedAt: normalizeText(record.requestedAt) } : {}),
    ...(normalizeText(record.requestMessage) ? { requestMessage: normalizeText(record.requestMessage) } : {}),
  };
}

function normalizePendingRequestList(value: unknown): NimiRealmPendingFriendRequestListDto {
  const record = toRecord(value);
  if (!record) {
    return { received: [], sent: [] };
  }
  const received = Array.isArray(record.received)
    ? record.received.map(toPendingRequestItem).filter((item): item is NimiRealmPendingFriendRequestDto => item !== null)
    : [];
  const sent = Array.isArray(record.sent)
    ? record.sent.map(toPendingRequestItem).filter((item): item is NimiRealmPendingFriendRequestDto => item !== null)
    : [];
  return { received, sent };
}

function toPendingRequestMap(items: readonly NimiRealmPendingFriendRequestDto[] | undefined): Map<string, PendingRequestMapValue> {
  const normalized = new Map<string, PendingRequestMapValue>();
  for (const item of items || []) {
    const userId = normalizeText(item.userId);
    if (!userId || normalized.has(userId)) {
      continue;
    }
    normalized.set(userId, {
      requestedAt: toNullableString(item.requestedAt),
      requestMessage: toNullableString(item.requestMessage),
    });
  }
  return normalized;
}

async function resolvePendingRequestProfiles(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  userMap: Map<string, PendingRequestMapValue>,
  direction: 'received' | 'sent',
  options?: RealmTypedCallOptions,
): Promise<NimiRealmSocialContactRecord[]> {
  const tasks = Array.from(userMap.entries()).map(async ([userId, { requestedAt, requestMessage }]) => {
    try {
      const profile = await realm.generated.getUser({ path: { id: userId } }, options);
      const profileRecord = toRecord(profile) || {};
      const handle = normalizeText(profileRecord.handle);
      return {
        id: userId,
        userId,
        direction,
        requestedAt,
        requestMessage,
        displayName: normalizeText(profileRecord.displayName) || handle || userId,
        handle,
        avatarUrl: toNullableString(profileRecord.avatarUrl),
        bio: toNullableString(profileRecord.bio),
      };
    } catch (error) {
      emitRealmDataError('load-pending-friend-request-profile', error, { userId, direction });
      throw error;
    }
  });

  const rows = await Promise.all(tasks);
  rows.sort((a, b) => {
    const timeA = toNullableString(a.requestedAt);
    const timeB = toNullableString(b.requestedAt);
    if (!timeA && !timeB) {
      return 0;
    }
    if (!timeA) {
      return 1;
    }
    if (!timeB) {
      return -1;
    }
    return new Date(timeB).getTime() - new Date(timeA).getTime();
  });
  return rows;
}

export async function fetchNimiRealmPendingFriendRequests(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmPendingFriendRequestListDto> {
  try {
    return normalizePendingRequestList(await realm.generated.getMyPendingFriendRequests({ path: {} }, options));
  } catch (error) {
    emitRealmDataError('load-friend-requests', error);
    throw error;
  }
}

async function fetchNimiRealmBlockedUsers(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmSocialContactRecord[]> {
  try {
    const response = await realm.generated.getMyBlockedUsers({
      path: {},
      query: { limit: 100 },
    }, options);
    return toRecordArray(toRecord(response)?.items).map((item) => {
      const id = normalizeText(item.id);
      const handle = normalizeText(item.handle);
      return {
        id,
        displayName: normalizeText(item.displayName) || handle || id,
        handle,
        avatarUrl: toNullableString(item.avatarUrl),
        bio: toNullableString(item.bio),
        blockedAt: toNullableString(item.blockedAt),
        reason: toNullableString(item.reason),
      };
    }).filter((item) => Boolean(item.id));
  } catch (error) {
    emitRealmDataError('load-blocked-users', error);
    throw error;
  }
}

export async function loadNimiRealmSocialSnapshot(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmSocialContactSnapshot> {
  const [friendsResult, pendingResult, blockedUsers] = await Promise.all([
    realm.generated.listMyFriendsWithDetails({
      path: {},
      query: { limit: 100 },
    }, options),
    fetchNimiRealmPendingFriendRequests(realm, emitRealmDataError, options),
    fetchNimiRealmBlockedUsers(realm, emitRealmDataError, options),
  ]);

  const pendingReceived = await resolvePendingRequestProfiles(
    realm,
    emitRealmDataError,
    toPendingRequestMap(pendingResult.received),
    'received',
    options,
  );
  const pendingSent = await resolvePendingRequestProfiles(
    realm,
    emitRealmDataError,
    toPendingRequestMap(pendingResult.sent),
    'sent',
    options,
  );

  const friends = Array.isArray(friendsResult.items)
    ? friendsResult.items.map((item: FriendProfileDto) => item as unknown as NimiRealmSocialContactRecord)
    : [];

  return {
    friends,
    pendingReceived,
    pendingSent,
    blocked: blockedUsers,
  };
}

export function buildEmptyNimiRealmPostFeedResponse(input: {
  readonly cursor?: string;
  readonly limit?: number;
}): FeedResponseDto {
  const page: FeedPageMetaDto = {
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  };
  return {
    items: [],
    page,
  };
}

export async function loadNimiRealmCurrentUserProfile(
  realm: Pick<NimiRealmSocialApi, 'account'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  options?: RealmTypedCallOptions,
): Promise<UserPrivateDto> {
  try {
    return await realm.account.getMe({ path: {} }, options);
  } catch (error) {
    emitRealmDataError('load-current-user', error);
    throw error;
  }
}

export async function updateNimiRealmCurrentUserProfile(
  realm: Pick<NimiRealmSocialApi, 'account'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  data: JsonObject,
  options?: RealmTypedCallOptions,
): Promise<UserPrivateDto> {
  try {
    return await realm.account.updateMe({ path: {}, body: data as UpdateUserDto }, options);
  } catch (error) {
    emitRealmDataError('update-user-profile', error);
    throw error;
  }
}

export async function loadNimiRealmUserProfileById(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  id: unknown,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmSocialProfileView> {
  const normalizedId = requireText(id, {
    reasonCode: 'SDK_REALM_USER_ID_REQUIRED',
    message: 'Realm user id is required.',
    actionHint: 'provide_realm_user_id',
  });
  try {
    return await realm.generated.getUser({ path: { id: normalizedId } }, options) as unknown as NimiRealmSocialProfileView;
  } catch (error) {
    emitRealmDataError('load-user-profile', error, { id: normalizedId });
    throw error;
  }
}

export async function createNimiRealmSourceMaterializationPacket(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  requestInput: unknown,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmSourceMaterializationPacket> {
  const body: CreateSourceMaterializationPacketDto = requireSourceMaterializationRequest(requestInput);
  const { sourceRef } = body;
  const sourceRefDetails: JsonObject = {
    kind: sourceRef.kind,
    worldId: sourceRef.worldId,
    sourceId: sourceRef.sourceId,
    sourceContentHash: sourceRef.sourceContentHash,
  };
  try {
    return await realm.generated.worldCoreControllerCreateSourceMaterializationPacket({ path: {}, body }, options);
  } catch (error) {
    emitRealmDataError('create-source-materialization-packet', error, {
      sourceRef: sourceRefDetails,
      challengeId: body.challengeId,
      challengeDigest: body.challengeDigest,
      intendedRuntimeAudience: body.intendedRuntimeAudience,
    });
    throw error;
  }
}

export async function addNimiRealmFriendById(
  realm: Pick<NimiRealmSocialApi, 'social'>,
  userId: unknown,
  message?: string,
  options?: RealmTypedCallOptions,
): Promise<{ readonly id: string }> {
  const normalizedUserId = requireText(userId, {
    reasonCode: 'SDK_REALM_USER_ID_REQUIRED',
    message: 'Realm user id is required.',
    actionHint: 'provide_realm_user_id',
  });
  const body: AddFriendBodyDto = message ? { requestMessage: message } : {};
  await realm.social.addFriend({
    path: { id: normalizedUserId },
    body,
  }, options);
  return { id: normalizedUserId };
}

export async function removeNimiRealmFriendById(
  realm: Pick<NimiRealmSocialApi, 'social'>,
  userId: unknown,
  options?: RealmTypedCallOptions,
): Promise<void> {
  const normalizedUserId = requireText(userId, {
    reasonCode: 'SDK_REALM_USER_ID_REQUIRED',
    message: 'Realm user id is required.',
    actionHint: 'provide_realm_user_id',
  });
  await realm.social.removeFriend({ path: { id: normalizedUserId } }, options);
}

export async function blockNimiRealmUser(
  realm: Pick<NimiRealmSocialApi, 'social'>,
  contactId: unknown,
  reason?: string,
  options?: RealmTypedCallOptions,
): Promise<{ readonly id: string }> {
  const normalizedContactId = requireText(contactId, {
    reasonCode: 'SDK_REALM_USER_ID_REQUIRED',
    message: 'Realm user id is required.',
    actionHint: 'provide_realm_user_id',
  });
  const body: BlockUserBodyDto = reason ? { reason } : {};
  await realm.social.blockUser({
    path: { id: normalizedContactId },
    body,
  }, options);
  return { id: normalizedContactId };
}

export async function unblockNimiRealmUser(
  realm: Pick<NimiRealmSocialApi, 'social'>,
  contactId: unknown,
  options?: RealmTypedCallOptions,
): Promise<{ readonly id: string }> {
  const normalizedContactId = requireText(contactId, {
    reasonCode: 'SDK_REALM_USER_ID_REQUIRED',
    message: 'Realm user id is required.',
    actionHint: 'provide_realm_user_id',
  });
  await realm.social.unblockUser({ path: { id: normalizedContactId } }, options);
  return { id: normalizedContactId };
}

export async function loadNimiRealmPostFeed(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  input: NimiRealmPostFeedInput,
  options?: RealmTypedCallOptions,
): Promise<FeedResponseDto> {
  const normalized = normalizePostFeedInput(input);
  try {
    return await realm.generated.getHomeFeed({
      path: {},
      query: normalized,
    }, options);
  } catch (error) {
    emitRealmDataError('load-post-feed', error, normalized);
    throw error;
  }
}

export async function loadNimiRealmLikedPosts(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  profileId: unknown,
  limit = 20,
  cursor?: string,
  options?: RealmTypedCallOptions,
): Promise<FeedResponseDto> {
  const normalizedProfileId = requireText(profileId, {
    reasonCode: 'SDK_REALM_USER_ID_REQUIRED',
    message: 'Realm user id is required.',
    actionHint: 'provide_realm_user_id',
  });
  try {
    return await realm.generated.listLikedPosts({
      path: {},
      query: { limit, cursor, userId: normalizedProfileId },
    }, options);
  } catch (error) {
    emitRealmDataError('load-liked-posts', error, { profileId: normalizedProfileId, limit, cursor });
    throw error;
  }
}

export async function loadNimiRealmPostById(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  postId: unknown,
  options?: RealmTypedCallOptions,
): Promise<PostDto> {
  const normalizedPostId = requireText(postId, {
    reasonCode: 'SDK_REALM_POST_ID_REQUIRED',
    message: 'Realm post id is required.',
    actionHint: 'provide_realm_post_id',
  });
  try {
    return await realm.generated.getPost({ path: { id: normalizedPostId } }, options);
  } catch (error) {
    emitRealmDataError('load-post-by-id', error, { postId: normalizedPostId });
    throw error;
  }
}

export async function createNimiRealmPost(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  payload: CreatePostDto,
  options?: RealmTypedCallOptions,
): Promise<PostDto> {
  try {
    return await realm.generated.createPost({ path: {}, body: payload }, options);
  } catch (error) {
    emitRealmDataError('create-post', error, {
      attachmentCount: Array.isArray(payload.attachments) ? payload.attachments.length : 0,
      tagsCount: Array.isArray(payload.tags) ? payload.tags.length : 0,
    });
    throw error;
  }
}

export async function deleteNimiRealmPost(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  postId: unknown,
  options?: RealmTypedCallOptions,
): Promise<void> {
  const normalizedPostId = requireText(postId, {
    reasonCode: 'SDK_REALM_POST_ID_REQUIRED',
    message: 'Realm post id is required.',
    actionHint: 'provide_realm_post_id',
  });
  try {
    await realm.generated.deletePost({ path: { id: normalizedPostId } }, options);
  } catch (error) {
    emitRealmDataError('delete-post', error, { postId: normalizedPostId });
    throw error;
  }
}

export async function updateNimiRealmPostVisibility(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  postId: unknown,
  visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE',
  options?: RealmTypedCallOptions,
): Promise<PostDto> {
  const normalizedPostId = requireText(postId, {
    reasonCode: 'SDK_REALM_POST_ID_REQUIRED',
    message: 'Realm post id is required.',
    actionHint: 'provide_realm_post_id',
  });
  const body: UpdatePostDto = { visibility };
  try {
    return await realm.generated.updatePost({ path: { id: normalizedPostId }, body }, options);
  } catch (error) {
    emitRealmDataError('update-post-visibility', error, { postId: normalizedPostId, visibility });
    throw error;
  }
}

export async function likeNimiRealmPost(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  postId: unknown,
  options?: RealmTypedCallOptions,
): Promise<void> {
  const normalizedPostId = requireText(postId, {
    reasonCode: 'SDK_REALM_POST_ID_REQUIRED',
    message: 'Realm post id is required.',
    actionHint: 'provide_realm_post_id',
  });
  try {
    await realm.generated.likePost({ path: { postId: normalizedPostId } }, options);
  } catch (error) {
    emitRealmDataError('like-post', error, { postId: normalizedPostId });
    throw error;
  }
}

export async function unlikeNimiRealmPost(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  postId: unknown,
  options?: RealmTypedCallOptions,
): Promise<void> {
  const normalizedPostId = requireText(postId, {
    reasonCode: 'SDK_REALM_POST_ID_REQUIRED',
    message: 'Realm post id is required.',
    actionHint: 'provide_realm_post_id',
  });
  try {
    await realm.generated.unlikePost({ path: { postId: normalizedPostId } }, options);
  } catch (error) {
    emitRealmDataError('unlike-post', error, { postId: normalizedPostId });
    throw error;
  }
}

export async function createNimiRealmReport(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  payload: CreateReportDto,
  options?: RealmTypedCallOptions,
): Promise<ReportResponseDto> {
  try {
    return await realm.generated.reportControllerCreateReport({ path: {}, body: payload }, options);
  } catch (error) {
    emitRealmDataError('create-report', error, {
      targetType: payload.targetType,
      targetId: payload.targetId,
      reason: payload.reason,
    });
    throw error;
  }
}

export async function executeNimiRealmSocialMutation(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  entry: NimiRealmSocialMutationExecutionInput,
  options?: RealmTypedCallOptions,
): Promise<void> {
  if (entry.kind === 'post-like') {
    const postId = requireText(entry.payload.postId, {
      reasonCode: 'SDK_REALM_POST_ID_REQUIRED',
      message: 'Realm post id is required.',
      actionHint: 'provide_realm_post_id',
    });
    await realm.generated.likePost({ path: { postId } }, options);
    return;
  }
  if (entry.kind === 'post-unlike') {
    const postId = requireText(entry.payload.postId, {
      reasonCode: 'SDK_REALM_POST_ID_REQUIRED',
      message: 'Realm post id is required.',
      actionHint: 'provide_realm_post_id',
    });
    await realm.generated.unlikePost({ path: { postId } }, options);
    return;
  }
  throw socialError({
    reasonCode: 'SDK_REALM_SOCIAL_MUTATION_UNSUPPORTED',
    message: 'Realm social mutation kind is not supported.',
    actionHint: 'use_supported_realm_social_mutation_kind',
    details: { kind: entry.kind },
  });
}

export async function loadNimiRealmExploreFeedItems(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  tag: string | null,
  limit: number,
  cursor?: string,
  options?: RealmTypedCallOptions,
): Promise<FeedResponseDto> {
  try {
    return await realm.generated.getExploreFeed({
      path: {},
      query: {
        tag: tag || undefined,
        limit,
        cursor,
      },
    }, options);
  } catch (error) {
    emitRealmDataError(cursor ? 'load-more-explore-feed' : 'load-explore-feed', error, { tag, limit });
    throw error;
  }
}
