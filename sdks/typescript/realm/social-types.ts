import type {
  CreateRealmSourceConnectionDto,
  RealmTypedClient,
  RealmSourceConnectionDto,
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

export interface NimiRealmPendingFriendRequestDto {
  readonly userId?: string;
  readonly requestedAt?: string;
  readonly requestMessage?: string;
}

export interface NimiRealmPendingFriendRequestListDto {
  readonly received?: readonly NimiRealmPendingFriendRequestDto[];
  readonly sent?: readonly NimiRealmPendingFriendRequestDto[];
}

export type NimiRealmSocialProfileView = JsonObject & Partial<UserProfileDto>;
export type NimiRealmCoreSourceRef = CreateRealmSourceConnectionDto['sourceRef'];
export type NimiRealmSourceConnectionView = RealmSourceConnectionDto;

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
    | 'sourceConnectionControllerConnect'
    | 'sourceConnectionControllerGet'
    | 'sourceConnectionControllerList'
    | 'sourceConnectionControllerRemove'
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
