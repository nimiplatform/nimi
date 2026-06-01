import type { RealmModel } from '@nimiplatform/sdk/realm';
import {
  buildEmptyRealmPostFeedResponse,
  createRealmPost,
  createRealmReport,
  deleteRealmPost,
  likeRealmPost,
  loadRealmLikedPosts,
  loadRealmPostById,
  loadRealmPostFeed,
  unlikeRealmPost,
  updateRealmPostVisibility,
  type RealmPostFeedInput,
  type RealmSocialFeedApiCaller,
  type RealmSocialFeedErrorEmitter,
} from '@nimiplatform/sdk/realm';
import { isRealmOfflineErrorLike as isRealmOfflineError } from '@nimiplatform/sdk/types';
import {
  getOfflineCoordinator,
} from '@renderer/infra/offline';
import {
  filterBlockedPosts,
  isBlockedUser,
  isPostHiddenByBlockedAuthor,
} from './blocked-content';
import { queueSocialMutation } from './offline-social-outbox';

type CreateReportDto = RealmModel<'CreateReportDto'>;
type CreatePostDto = RealmModel<'CreatePostDto'>;
type FeedResponseDto = RealmModel<'FeedResponseDto'>;
type PostDto = RealmModel<'PostDto'>;
type ReportResponseDto = RealmModel<'ReportResponseDto'>;

/**
 * Canonical Realm feed scopes (Realm R-FEED-005, Desktop D-HOMEFEED-004).
 * Server-side filter branches; the renderer never infers scope membership
 * client-side.
 */
export type PostFeedScope = 'personal' | 'friends' | 'agent_activity';

export type LoadPostFeedInput = RealmPostFeedInput;

function filterFeedResponse(response: FeedResponseDto): FeedResponseDto {
  return {
    ...response,
    items: filterBlockedPosts(Array.isArray(response.items) ? response.items : []),
  };
}

export async function loadPostFeed(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
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

  if (normalized.authorId && isBlockedUser(normalized.authorId)) {
    return buildEmptyRealmPostFeedResponse(normalized);
  }

  const response = await loadRealmPostFeed(callApi, emitRealmDataError, normalized);
  return filterFeedResponse(response);
}

export async function loadLikedPosts(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  profileId: string,
  limit = 20,
  cursor?: string,
): Promise<FeedResponseDto> {
  const response = await loadRealmLikedPosts(callApi, emitRealmDataError, profileId, limit, cursor);
  return filterFeedResponse(response);
}

export async function loadPostById(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  postId: string,
): Promise<PostDto> {
  const post = await loadRealmPostById(callApi, emitRealmDataError, postId);
  if (isPostHiddenByBlockedAuthor(post)) {
    throw new Error('This post is unavailable because you blocked the author.');
  }
  return post;
}

export async function createPost(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  payload: CreatePostDto,
): Promise<PostDto> {
  return createRealmPost(callApi, emitRealmDataError, payload);
}

export async function deletePost(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  postId: string,
): Promise<void> {
  return deleteRealmPost(callApi, emitRealmDataError, postId);
}

export async function updatePostVisibility(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  postId: string,
  visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE',
): Promise<PostDto> {
  return updateRealmPostVisibility(callApi, emitRealmDataError, postId, visibility);
}

export async function likePost(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  postId: string,
): Promise<void> {
  try {
    await likeRealmPost(callApi, emitRealmDataError, postId);
  } catch (error) {
    if (isRealmOfflineError(error)) {
      await queueSocialMutation({
        kind: 'post-like',
        payload: { postId },
      });
      getOfflineCoordinator().markRealmRestReachable(false);
      return;
    }
    throw error;
  }
}

export async function unlikePost(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  postId: string,
): Promise<void> {
  try {
    await unlikeRealmPost(callApi, emitRealmDataError, postId);
  } catch (error) {
    if (isRealmOfflineError(error)) {
      await queueSocialMutation({
        kind: 'post-unlike',
        payload: { postId },
      });
      getOfflineCoordinator().markRealmRestReachable(false);
      return;
    }
    throw error;
  }
}

export async function createReport(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  payload: CreateReportDto,
): Promise<ReportResponseDto> {
  return createRealmReport(callApi, emitRealmDataError, payload);
}
