import type {
  PendingFriendRequestDto,
  PendingFriendRequestListDto,
  RealmTypedClient,
  UserProfileDto,
} from '../core-generated/realm-typed-client';
import type { JsonObject } from '../types';
import type { NimiRealmFeedScope } from './feed';

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
  readonly social: Pick<RealmTypedClient, 'addFriend' | 'blockUser' | 'removeFriend' | 'unblockUser'>;
  readonly generated: Pick<
    RealmTypedClient,
    | 'createPost'
    | 'deletePost'
    | 'getExploreFeed'
    | 'getHomeFeed'
    | 'getMyBlockedUsers'
    | 'getMyPendingFriendRequests'
    | 'getPost'
    | 'getUser'
    | 'likePost'
    | 'listLikedPosts'
    | 'listMyFriendsWithDetails'
    | 'reportControllerCreateReport'
    | 'unlikePost'
    | 'updatePost'
  >;
}

export type NimiRealmPostFeedInput = {
  readonly visibility?: 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
  readonly worldId?: string;
  readonly authorId?: string;
  readonly limit?: number;
  readonly cursor?: string;
  readonly scope?: NimiRealmFeedScope;
};

export type NimiRealmSocialMutationKind =
  | 'post-like'
  | 'post-unlike';

export interface NimiRealmSocialMutationExecutionInput {
  readonly kind: NimiRealmSocialMutationKind | string;
  readonly payload: JsonObject;
}
