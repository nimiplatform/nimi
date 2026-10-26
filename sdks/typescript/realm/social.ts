import type {
  AddFriendBodyDto,
  BlockedUserDto,
  BlockedUserListDto,
  BlockUserBodyDto,
  CreateReportDto,
  FriendProfileDto,
  FriendProfileListDto,
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
  normalizeText,
  requireText,
  socialError,
  toNullableString,
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

type PendingRequestMapValue = {
  readonly requestedAt: string | null;
  readonly requestMessage: string | null;
};

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
  return {
    userId: record.userId,
    requestedAt: record.requestedAt,
    requestMessage: record.requestMessage,
  };
}

function normalizePendingRequestList(value: unknown): NimiRealmPendingFriendRequestListDto {
  const record = toRecord(value);
  if (!record) {
    throw pendingFriendRequestDecodeError();
  }
  const received = normalizePendingRequestCollection(record.received);
  const sent = normalizePendingRequestCollection(record.sent);
  return { received, sent };
}

function normalizePendingRequestCollection(value: unknown): NimiRealmPendingFriendRequestDto[] {
  if (!Array.isArray(value)) {
    throw pendingFriendRequestDecodeError();
  }
  return value.map(toPendingRequestItem);
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

function decodeFriendProfileList(value: unknown): readonly FriendProfileDto[] {
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
  return record.items.map(decodeFriendProfile);
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

function toPendingRequestMap(items: readonly NimiRealmPendingFriendRequestDto[]): Map<string, PendingRequestMapValue> {
  const normalized = new Map<string, PendingRequestMapValue>();
  for (const item of items) {
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
      const profileRecord = decodeUserProfile(profile);
      return {
        id: userId,
        userId,
        direction,
        requestedAt,
        requestMessage,
        displayName: profileRecord.displayName,
        handle: profileRecord.handle,
        avatarUrl: profileRecord.avatarUrl,
        bio: profileRecord.bio,
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
  realm: NimiRealmPendingFriendRequestApi,
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
    const response = decodeBlockedUserList(await realm.generated.getMyBlockedUsers({
      path: {},
      query: { limit: 100 },
    }, options));
    return response.items.map((item) => ({ ...item }) as unknown as NimiRealmSocialContactRecord);
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

  let friends: readonly FriendProfileDto[];
  try {
    friends = decodeFriendProfileList(friendsResult as FriendProfileListDto);
  } catch (error) {
    emitRealmDataError('load-friends', error);
    throw error;
  }

  return {
    friends: friends.map((item) => item as unknown as NimiRealmSocialContactRecord),
    pendingReceived,
    pendingSent,
    blocked: blockedUsers,
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
