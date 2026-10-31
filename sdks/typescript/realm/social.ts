import type {
  AddFriendBodyDto,
  BlockedUserDto,
  BlockedUserListDto,
  BlockUserBodyDto,
  CreateReportDto,
  FriendProfileDto,
  FriendProfileListDto,
  FriendshipActionDto,
  FriendshipActionResultDto,
  UserRelationshipDto,
  RealmTypedCallOptions,
  ReportResponseDto,
  SocialProfileDto,
  UpdateUserDto,
  UserPrivateDto,
  UserProfileDto,
  UserStatsDto,
  UserTierSummaryDto,
} from '../core-generated/realm-typed-client';
import {
  AccountStatusValues,
  GenderValues,
} from '../core-generated/realm-typed-client';
import { ReasonCode, type JsonObject } from '../types';
import type {
  NimiRealmPendingFriendRequestDto,
  NimiRealmPendingFriendRequestListDto,
  NimiRealmSocialApi,
  NimiRealmSocialContactRecord,
  NimiRealmSocialContactSnapshot,
  NimiRealmSocialDataErrorEmitter,
  NimiRealmSocialProfileView,
} from './social-types';
import {
  requireText,
  socialError,
  toRecord,
} from './social-validation';

export type {
  NimiRealmPendingFriendRequestDto,
  NimiRealmPendingFriendRequestListDto,
  NimiRealmSocialApi,
  NimiRealmSocialContactRecord,
  NimiRealmSocialContactSnapshot,
  NimiRealmSocialDataErrorEmitter,
  NimiRealmSocialProfileView,
} from './social-types';

type NimiRealmPendingFriendRequestApi = {
  readonly generated: Pick<NimiRealmSocialApi['generated'], 'getMyPendingFriendRequests'>;
};

function toPendingRequestItem(value: unknown): NimiRealmPendingFriendRequestDto {
  const record = toRecord(value);
  if (!record) {
    throw pendingFriendRequestDecodeError();
  }
  if (
    typeof record.userId !== 'string'
    || typeof record.requestedAt !== 'string'
  ) {
    throw pendingFriendRequestDecodeError();
  }
  if (
    record.requestMessage !== null
    && typeof record.requestMessage !== 'string'
  ) {
    throw pendingFriendRequestDecodeError();
  }
  if (typeof record.relationshipId !== 'string' || !record.relationshipId
    || typeof record.displayName !== 'string' || typeof record.isDeleted !== 'boolean'
    || (record.handle !== null && typeof record.handle !== 'string')
    || (record.avatarUrl !== null && typeof record.avatarUrl !== 'string')) throw pendingFriendRequestDecodeError();
  return record as unknown as NimiRealmPendingFriendRequestDto;
}

function normalizePendingRequestList(value: unknown): NimiRealmPendingFriendRequestListDto {
  const record = toRecord(value);
  if (!record || !Array.isArray(record.items)
    || (record.nextCursor !== null && typeof record.nextCursor !== 'string')
    || typeof record.total !== 'number' || !Number.isSafeInteger(record.total) || record.total < 0) {
    throw pendingFriendRequestDecodeError();
  }
  return { items: record.items.map(toPendingRequestItem), nextCursor: record.nextCursor, total: record.total };
}

function pendingFriendRequestDecodeError(): Error {
  return socialError({
    reasonCode: ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED,
    message: 'Realm pending friend request response is malformed.',
    actionHint: 'check_realm_pending_friend_request_response',
  });
}

function socialResponseDecodeError(message: string): Error {
  return socialError({
    reasonCode: ReasonCode.SDK_REALM_RESPONSE_DECODE_FAILED,
    message,
    actionHint: 'check_realm_social_response',
  });
}

function decodeUserProfile(value: unknown): UserProfileDto {
  const record = toRecord(value);
  if (!record || !hasValidUserProfileFields(record)) {
    throw socialResponseDecodeError('Realm user profile response is malformed.');
  }
  return record as unknown as UserProfileDto;
}

function decodeFriendProfile(value: unknown): FriendProfileDto {
  const record = toRecord(value);
  if (
    !record
    || !hasValidUserProfileFields(record)
    || typeof record.relationshipId !== 'string' || !record.relationshipId
    || typeof record.isDeleted !== 'boolean'
    || !isOptionalNullableString(record.friendsSince)
  ) {
    throw socialResponseDecodeError('Realm friend profile response is malformed.');
  }
  return record as unknown as FriendProfileDto;
}

function hasValidUserProfileFields(record: JsonObject): boolean {
  return (
    typeof record.createdAt === 'string'
    && typeof record.displayName === 'string'
    && typeof record.handle === 'string'
    && typeof record.id === 'string'
    && isOptionalNullableString(record.avatarUrl)
    && isOptionalNullableString(record.bio)
    && isOptionalNullableFiniteNumber(record.birthYear)
    && isOptionalNullableString(record.city)
    && isOptionalNullableString(record.countryCode)
    && isOptionalFiniteNumber(record.friendCount)
    && (
      record.gender === undefined
      || record.gender === null
      || (
        typeof record.gender === 'string'
        && GenderValues.includes(record.gender as (typeof GenderValues)[number])
      )
    )
    && (record.isOnline === undefined || typeof record.isOnline === 'boolean')
    && (record.languages === undefined || isStringArray(record.languages))
    && isOptionalNullableString(record.presenceEmoji)
    && isOptionalNullableString(record.presenceStatus)
    && isOptionalNullableString(record.presenceText)
    && isOptionalNullableString(record.profileCoverUrl)
    && (record.socialProfiles === undefined || isSocialProfiles(record.socialProfiles))
    && (
      record.status === undefined
      || (
        typeof record.status === 'string'
        && AccountStatusValues.includes(record.status as (typeof AccountStatusValues)[number])
      )
    )
    && (record.stats === undefined || isUserStats(record.stats))
    && (record.tags === undefined || isStringArray(record.tags))
    && (record.tiers === undefined || isUserTiers(record.tiers))
  );
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (
    typeof value === 'number' && Number.isFinite(value)
  );
}

function isOptionalNullableFiniteNumber(value: unknown): boolean {
  return value === null || isOptionalFiniteNumber(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSocialProfiles(value: unknown): value is readonly SocialProfileDto[] {
  return Array.isArray(value) && value.every((item) => {
    const record = toRecord(item);
    return Boolean(
      record
      && typeof record.handle === 'string'
      && typeof record.platform === 'string'
      && isOptionalFiniteNumber(record.followers)
      && (record.isVerified === undefined || typeof record.isVerified === 'boolean')
      && isOptionalNullableString(record.url)
      && isOptionalNullableString(record.verifiedAt),
    );
  });
}

function isUserStats(value: unknown): value is UserStatsDto {
  const record = toRecord(value);
  return Boolean(
    record
    && isOptionalFiniteNumber(record.friendsCount)
    && isOptionalFiniteNumber(record.postsCount),
  );
}

function isUserTiers(value: unknown): value is UserTierSummaryDto {
  const record = toRecord(value);
  return Boolean(
    record
    && isOptionalFiniteNumber(record.assetTier)
    && isOptionalFiniteNumber(record.influenceTier)
    && isOptionalFiniteNumber(record.interactionTier)
    && isOptionalFiniteNumber(record.vitalityScore),
  );
}

function decodeFriendProfileList(value: unknown): FriendProfileListDto {
  const record = toRecord(value);
  if (
    !record
    || !Array.isArray(record.items)
    || (record.nextCursor !== null && typeof record.nextCursor !== 'string')
    || typeof record.total !== 'number'
    || !Number.isFinite(record.total)
  ) {
    throw socialResponseDecodeError('Realm friend profile list response is malformed.');
  }
  return { items: record.items.map(decodeFriendProfile), nextCursor: record.nextCursor, total: record.total };
}

function decodeBlockedUser(value: unknown): BlockedUserDto {
  const record = toRecord(value);
  if (
    !record
    || (record.avatarUrl !== null && typeof record.avatarUrl !== 'string')
    || (record.bio !== null && typeof record.bio !== 'string')
    || typeof record.blockedAt !== 'string'
    || (record.displayName !== null && typeof record.displayName !== 'string')
    || (record.handle !== null && typeof record.handle !== 'string')
    || typeof record.id !== 'string'
    || typeof record.isDeleted !== 'boolean'
    || (record.reason !== null && typeof record.reason !== 'string')
  ) {
    throw socialResponseDecodeError('Realm blocked user response is malformed.');
  }
  return record as unknown as BlockedUserDto;
}

function decodeBlockedUserList(value: unknown): BlockedUserListDto {
  const record = toRecord(value);
  if (
    !record
    || !Array.isArray(record.items)
    || (record.nextCursor !== null && typeof record.nextCursor !== 'string')
    || typeof record.total !== 'number'
    || !Number.isFinite(record.total)
  ) {
    throw socialResponseDecodeError('Realm blocked user list response is malformed.');
  }
  return {
    items: record.items.map(decodeBlockedUser),
    nextCursor: record.nextCursor,
    total: record.total,
  };
}

export type NimiRealmRelationshipPageInput = { readonly cursor?: string; readonly limit?: number };

export async function fetchNimiRealmPendingFriendRequests(
  realm: NimiRealmPendingFriendRequestApi,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  input: NimiRealmRelationshipPageInput & { readonly direction: 'received' | 'sent' },
  options?: RealmTypedCallOptions,
): Promise<NimiRealmPendingFriendRequestListDto> {
  try {
    return normalizePendingRequestList(await realm.generated.getMyPendingFriendRequests({ path: {}, query: input }, options));
  } catch (error) {
    emitRealmDataError('load-friend-requests', error);
    throw error;
  }
}

export async function loadNimiRealmFriendListPage(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  input: NimiRealmRelationshipPageInput & { readonly query?: string } = {},
  options?: RealmTypedCallOptions,
): Promise<FriendProfileListDto> {
  return decodeFriendProfileList(await realm.generated.listMyFriendsWithDetails({ path: {}, query: input }, options));
}

export async function loadNimiRealmBlockedUserPage(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  input: NimiRealmRelationshipPageInput = {},
  options?: RealmTypedCallOptions,
): Promise<BlockedUserListDto> {
  return decodeBlockedUserList(await realm.generated.getMyBlockedUsers({ path: {}, query: input }, options));
}

async function readAllSocialPages<T>(load: (cursor?: string) => Promise<{ items: readonly T[]; nextCursor: string | null }>): Promise<T[]> {
  const result: T[] = [];
  const visited = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    result.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor && visited.has(cursor)) throw socialResponseDecodeError('Realm relationship pagination repeated a cursor.');
    if (cursor) visited.add(cursor);
  } while (cursor);
  return result;
}

/** Complete snapshot for callers that require all four lists. Independent screens
 * use the page functions so a blocked-list error cannot hide available friends. */
export async function loadNimiRealmSocialSnapshot(
  realm: Pick<NimiRealmSocialApi, 'generated'>,
  emitRealmDataError: NimiRealmSocialDataErrorEmitter,
  options?: RealmTypedCallOptions,
): Promise<NimiRealmSocialContactSnapshot> {
  const read = async <T>(action: string, load: () => Promise<T>): Promise<T> => {
    try { return await load(); } catch (error) { emitRealmDataError(action, error); throw error; }
  };
  const [friends, received, sent, blocked] = await Promise.all([
    read('load-friends', () => readAllSocialPages(cursor => loadNimiRealmFriendListPage(realm, { cursor, limit: 100 }, options))),
    readAllSocialPages(cursor => fetchNimiRealmPendingFriendRequests(realm, emitRealmDataError, { direction: 'received', cursor, limit: 100 }, options)),
    readAllSocialPages(cursor => fetchNimiRealmPendingFriendRequests(realm, emitRealmDataError, { direction: 'sent', cursor, limit: 100 }, options)),
    read('load-blocked-users', () => readAllSocialPages(cursor => loadNimiRealmBlockedUserPage(realm, { cursor, limit: 100 }, options))),
  ]);
  return {
    friends: friends.map(item => ({ ...item }) as unknown as NimiRealmSocialContactRecord),
    pendingReceived: received.map(item => ({ ...item, id: item.userId, direction: 'received' })),
    pendingSent: sent.map(item => ({ ...item, id: item.userId, direction: 'sent' })),
    blocked: blocked.map(item => ({ ...item }) as unknown as NimiRealmSocialContactRecord),
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
    return decodeUserProfile(await realm.generated.getUser({ path: { id: normalizedId } }, options));
  } catch (error) {
    emitRealmDataError('load-user-profile', error, { id: normalizedId });
    throw error;
  }
}

export async function addNimiRealmFriendById(
  realm: Pick<NimiRealmSocialApi, 'social'>,
  userId: unknown,
  message?: string,
  options?: RealmTypedCallOptions,
): Promise<{ readonly id: string; readonly outcome: 'requested' | 'accepted' | 'unchanged' }> {
  const normalizedUserId = requireText(userId, {
    reasonCode: 'SDK_REALM_USER_ID_REQUIRED',
    message: 'Realm user id is required.',
    actionHint: 'provide_realm_user_id',
  });
  const body: AddFriendBodyDto = message ? { requestMessage: message } : {};
  const result = await realm.social.addFriend({
    path: { id: normalizedUserId },
    body,
  }, options);
  return { id: normalizedUserId, outcome: result.outcome };
}

export async function applyNimiRealmFriendshipAction(
  realm: Pick<NimiRealmSocialApi, 'social'>,
  userId: unknown,
  input: FriendshipActionDto,
  options?: RealmTypedCallOptions,
): Promise<FriendshipActionResultDto> {
  const id = requireText(userId, { reasonCode: 'SDK_REALM_USER_ID_REQUIRED', message: 'Realm user id is required.', actionHint: 'provide_realm_user_id' });
  return realm.social.applyFriendshipAction({ path: { id }, body: input }, options);
}

export async function loadNimiRealmRelationship(
  realm: Pick<NimiRealmSocialApi, 'social'>,
  userId: unknown,
  options?: RealmTypedCallOptions,
): Promise<UserRelationshipDto> {
  const id = requireText(userId, { reasonCode: 'SDK_REALM_USER_ID_REQUIRED', message: 'Realm user id is required.', actionHint: 'provide_realm_user_id' });
  return realm.social.getMyRelationshipWithUser({ path: { id } }, options);
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
