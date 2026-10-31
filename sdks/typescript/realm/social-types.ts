import type {
  PendingFriendRequestDto,
  PendingFriendRequestListDto,
  RealmTypedClient,
  UserProfileDto,
} from '../core-generated/realm-typed-client';
import type { JsonObject } from '../types';

export type NimiRealmSocialContactRecord = JsonObject;

export interface NimiRealmSocialContactSnapshot {
  readonly friends: readonly NimiRealmSocialContactRecord[];
  readonly pendingReceived: readonly NimiRealmSocialContactRecord[];
  readonly pendingSent: readonly NimiRealmSocialContactRecord[];
  readonly blocked: readonly NimiRealmSocialContactRecord[];
}

export type NimiRealmSocialDataErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

export type NimiRealmPendingFriendRequestDto = PendingFriendRequestDto;
export type NimiRealmPendingFriendRequestListDto = PendingFriendRequestListDto;

export type NimiRealmSocialProfileView = UserProfileDto;

export interface NimiRealmSocialApi {
  readonly account: Pick<RealmTypedClient, 'getMe' | 'updateMe'>;
  readonly social: Pick<RealmTypedClient, 'addFriend' | 'blockUser' | 'applyFriendshipAction' | 'getMyRelationshipWithUser' | 'unblockUser'>;
  readonly generated: Pick<
    RealmTypedClient,
    | 'getMyBlockedUsers'
    | 'getMyPendingFriendRequests'
    | 'getUser'
    | 'listMyFriendsWithDetails'
    | 'reportControllerCreateReport'
  >;
}
