import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import {
  buildEmptyNimiRealmPostFeedResponse,
  createNimiRealmPost,
  createNimiRealmReport,
  deleteNimiRealmPost,
  likeNimiRealmPost,
  loadNimiRealmLikedPosts,
  loadNimiRealmPostById,
  loadNimiRealmPostFeed,
  unlikeNimiRealmPost,
  updateNimiRealmPostVisibility,
  type NimiRealmPostFeedInput,
} from '@nimiplatform/sdk/realm';
import { isRealmOfflineErrorLike as isRealmOfflineError } from '@nimiplatform/sdk/types';
import {
  filterBlockedPosts,
  isBlockedUser,
  isPostHiddenByBlockedAuthor,
} from './blocked-content';
import type { RealmApiCaller, RealmDataErrorEmitter, SocialContactSnapshot } from './social-snapshot';
import type { RealmSocialOfflinePort } from './social-offline-port.js';

type CreateReportDto = RealmModel<'CreateReportDto'>;
type CreatePostDto = RealmModel<'CreatePostDto'>;
type FeedResponseDto = RealmModel<'FeedResponseDto'>;
type PostDto = RealmModel<'PostDto'>;
type ReportResponseDto = RealmModel<'ReportResponseDto'>;

/**
 * Canonical Realm feed scopes (Realm R-FEED-005, Desktop rule.nimi.desktop.product-surfaces.r018).
 * Server-side filter branches; the renderer never infers scope membership
 * client-side.
 */
export type PostFeedScope = 'personal' | 'friends' | 'persona_activity' | 'world_character_activity';

export type LoadPostFeedInput = NimiRealmPostFeedInput;

function filterFeedResponse(contacts: SocialContactSnapshot, response: FeedResponseDto): FeedResponseDto {
  return {
    ...response,
    items: filterBlockedPosts(contacts, Array.isArray(response.items) ? response.items : []),
  };
}

export async function loadPostFeed(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  contacts: SocialContactSnapshot,
  input: LoadPostFeedInput,
): Promise<FeedResponseDto> {
  const normalized: LoadPostFeedInput = {
    visibility: input.visibility,
    worldId: typeof input.worldId === 'string' ? input.worldId : undefined,
    authorId: typeof input.authorId === 'string' ? input.authorId : undefined,
    limit: typeof input.limit === 'number' ? input.limit : undefined,
    cursor: typeof input.cursor === 'string' ? input.cursor : undefined,
    scope: input.scope,
  };

  if (normalized.authorId && isBlockedUser(contacts, normalized.authorId)) {
    return buildEmptyNimiRealmPostFeedResponse(normalized);
  }

  const response = await callApi(
    (realm) => loadNimiRealmPostFeed(realm, emitRealmDataError, normalized),
    'Failed to load Realm post feed',
  );
  return filterFeedResponse(contacts, response);
}

export async function loadLikedPosts(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  contacts: SocialContactSnapshot,
  profileId: string,
  limit = 20,
  cursor?: string,
): Promise<FeedResponseDto> {
  const response = await callApi(
    (realm) => loadNimiRealmLikedPosts(realm, emitRealmDataError, profileId, limit, cursor),
    'Failed to load Realm liked posts',
  );
  return filterFeedResponse(contacts, response);
}

export async function loadPostById(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  contacts: SocialContactSnapshot,
  postId: string,
): Promise<PostDto> {
  const post = await callApi(
    (realm) => loadNimiRealmPostById(realm, emitRealmDataError, postId),
    'Failed to load Realm post',
  );
  if (isPostHiddenByBlockedAuthor(contacts, post)) {
    throw new Error('This post is unavailable because you blocked the author.');
  }
  return post;
}

export async function createPost(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  payload: CreatePostDto,
): Promise<PostDto> {
  return callApi(
    (realm) => createNimiRealmPost(realm, emitRealmDataError, payload),
    'Failed to create Realm post',
  );
}

export async function deletePost(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  postId: string,
): Promise<void> {
  return callApi(
    (realm) => deleteNimiRealmPost(realm, emitRealmDataError, postId),
    'Failed to delete Realm post',
  );
}

export async function updatePostVisibility(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  postId: string,
  visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE',
): Promise<PostDto> {
  return callApi(
    (realm) => updateNimiRealmPostVisibility(realm, emitRealmDataError, postId, visibility),
    'Failed to update Realm post visibility',
  );
}

export async function likePost(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  offline: RealmSocialOfflinePort,
  now: () => number,
  postId: string,
): Promise<void> {
  void now;
  try {
    await callApi(
      (realm) => likeNimiRealmPost(realm, emitRealmDataError, postId),
      'Failed to like Realm post',
    );
  } catch (error) {
    if (isRealmOfflineError(error)) {
      offline.markRealmUnreachable();
    }
    throw error;
  }
}

export async function unlikePost(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  offline: RealmSocialOfflinePort,
  now: () => number,
  postId: string,
): Promise<void> {
  void now;
  try {
    await callApi(
      (realm) => unlikeNimiRealmPost(realm, emitRealmDataError, postId),
      'Failed to unlike Realm post',
    );
  } catch (error) {
    if (isRealmOfflineError(error)) {
      offline.markRealmUnreachable();
    }
    throw error;
  }
}

export async function createReport(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  payload: CreateReportDto,
): Promise<ReportResponseDto> {
  return callApi(
    (realm) => createNimiRealmReport(realm, emitRealmDataError, payload),
    'Failed to create Realm report',
  );
}
