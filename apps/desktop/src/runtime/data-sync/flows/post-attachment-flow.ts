import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import {
  getOfflineCoordinator,
  isRealmOfflineError,
} from '@runtime/offline';
import {
  filterBlockedPosts,
  isBlockedUser,
  isPostHiddenByBlockedAuthor,
} from '../blocked-content';
import { queueSocialMutation } from '../offline-social-outbox';

type CreateReportDto = RealmModel<'CreateReportDto'>;
type CreatePostDto = RealmModel<'CreatePostDto'>;
type FeedPageMetaDto = RealmModel<'FeedPageMetaDto'>;
type FeedResponseDto = RealmModel<'FeedResponseDto'>;
type FinalizeResourceDto = RealmModel<'FinalizeResourceDto'>;
type ResourceDetailDto = RealmModel<'ResourceDetailDto'>;
type ResourceDirectUploadSessionDto = RealmModel<'ResourceDirectUploadSessionDto'>;
type PostDto = RealmModel<'PostDto'>;
type ReportResponseDto = RealmModel<'ReportResponseDto'>;

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

export type LoadPostFeedInput = {
  visibility?: 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
  worldId?: string;
  authorId?: string;
  limit?: number;
  cursor?: string;
};

function buildEmptyFeedResponse(input: {
  cursor?: string;
  limit?: number;
}): FeedResponseDto {
  const page: FeedPageMetaDto = {
    cursor: input.cursor ?? null,
    limit: input.limit,
    nextCursor: null,
  };

  return {
    items: [],
    page,
  };
}

function filterFeedResponse(response: FeedResponseDto): FeedResponseDto {
  return {
    ...response,
    items: filterBlockedPosts(Array.isArray(response.items) ? response.items : []),
  };
}

export async function loadPostFeed(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  input: LoadPostFeedInput,
): Promise<FeedResponseDto> {
  const normalized: LoadPostFeedInput = {
    visibility: input.visibility,
    worldId: typeof input.worldId === 'string' ? input.worldId : undefined,
    authorId: typeof input.authorId === 'string' ? input.authorId : undefined,
    limit: typeof input.limit === 'number' ? input.limit : undefined,
    cursor: typeof input.cursor === 'string' ? input.cursor : undefined,
  };

  if (normalized.authorId && isBlockedUser(normalized.authorId)) {
    return buildEmptyFeedResponse(normalized);
  }

  try {
    const response = await callApi(
      (realm) => realm.services.PostsService.getHomeFeed(
        normalized.visibility,
        normalized.worldId,
        normalized.authorId,
        normalized.limit,
        normalized.cursor,
      ),
      'Failed to load posts',
    );
    return filterFeedResponse(response);
  } catch (error) {
    emitDataSyncError('load-post-feed', error, normalized);
    throw error;
  }
}

export async function loadLikedPosts(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  profileId: string,
  limit = 20,
  cursor?: string,
): Promise<FeedResponseDto> {
  const normalizedProfileId = String(profileId || '').trim();

  try {
    const response = await callApi(
      (realm) => realm.services.PostsService.listLikedPosts(undefined, limit, cursor, normalizedProfileId),
      'Failed to load liked posts',
    );
    return filterFeedResponse(response);
  } catch (error) {
    emitDataSyncError('load-liked-posts', error, {
      profileId: normalizedProfileId,
      limit,
      cursor,
    });
    throw error;
  }
}

export async function loadPostById(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  postId: string,
): Promise<PostDto> {
  const normalizedPostId = String(postId || '').trim();

  try {
    const post = await callApi(
      (realm) => realm.services.PostsService.getPost(normalizedPostId),
      'Failed to load post',
    );
    if (isPostHiddenByBlockedAuthor(post)) {
      throw new Error('This post is unavailable because you blocked the author.');
    }
    return post;
  } catch (error) {
    emitDataSyncError('load-post-by-id', error, { postId: normalizedPostId });
    throw error;
  }
}

export async function createPost(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  payload: CreatePostDto,
): Promise<PostDto> {
  try {
    return await callApi(
      (realm) => realm.services.PostsService.createPost(payload),
      'Failed to create post',
    );
  } catch (error) {
    emitDataSyncError('create-post', error, {
      attachmentCount: Array.isArray(payload.attachments) ? payload.attachments.length : 0,
      tagsCount: Array.isArray(payload.tags) ? payload.tags.length : 0,
    });
    throw error;
  }
}

export async function createImageDirectUpload(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<ResourceDirectUploadSessionDto> {
  try {
    return await callApi(
      (realm) => realm.services.ResourcesService.createImageDirectUpload(),
      'Failed to create image upload',
    );
  } catch (error) {
    emitDataSyncError('create-image-direct-upload', error);
    throw error;
  }
}

export async function createVideoDirectUpload(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<ResourceDirectUploadSessionDto> {
  try {
    return await callApi(
      (realm) => realm.services.ResourcesService.createVideoDirectUpload(),
      'Failed to create video upload',
    );
  } catch (error) {
    emitDataSyncError('create-video-direct-upload', error);
    throw error;
  }
}

export async function finalizeResource(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  resourceId: string,
  payload: FinalizeResourceDto,
): Promise<ResourceDetailDto> {
  try {
    return await callApi(
      (realm) => realm.services.ResourcesService.finalizeResource(resourceId, payload),
      'Failed to finalize resource',
    );
  } catch (error) {
    emitDataSyncError('finalize-resource', error, { resourceId });
    throw error;
  }
}

export async function deletePost(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  postId: string,
): Promise<void> {
  try {
    await callApi(
      (realm) => realm.services.PostsService.deletePost(postId),
      'Failed to delete post',
    );
  } catch (error) {
    emitDataSyncError('delete-post', error, { postId });
    throw error;
  }
}

export async function updatePostVisibility(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  postId: string,
  visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE',
): Promise<PostDto> {
  try {
    return await callApi(
      (realm) => realm.services.PostsService.updatePost(postId, { visibility }),
      'Failed to update post visibility',
    );
  } catch (error) {
    emitDataSyncError('update-post-visibility', error, {
      postId,
      visibility,
    });
    throw error;
  }
}

export async function likePost(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  postId: string,
): Promise<void> {
  try {
    await callApi(
      (realm) => realm.services.PostsService.likePost(postId),
      'Failed to like post',
    );
  } catch (error) {
    if (isRealmOfflineError(error)) {
      await queueSocialMutation({
        kind: 'post-like',
        payload: { postId },
      });
      getOfflineCoordinator().markRealmRestReachable(false);
      return;
    }
    emitDataSyncError('like-post', error, { postId });
    throw error;
  }
}

export async function unlikePost(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  postId: string,
): Promise<void> {
  try {
    await callApi(
      (realm) => realm.services.PostsService.unlikePost(postId),
      'Failed to unlike post',
    );
  } catch (error) {
    if (isRealmOfflineError(error)) {
      await queueSocialMutation({
        kind: 'post-unlike',
        payload: { postId },
      });
      getOfflineCoordinator().markRealmRestReachable(false);
      return;
    }
    emitDataSyncError('unlike-post', error, { postId });
    throw error;
  }
}

export async function createReport(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  payload: CreateReportDto,
): Promise<ReportResponseDto> {
  try {
    return await callApi(
      (realm) => realm.services.GovernanceService.reportControllerCreateReport(payload),
      'Failed to create report',
    );
  } catch (error) {
    emitDataSyncError('create-report', error, {
      targetType: payload.targetType,
      targetId: payload.targetId,
      reason: payload.reason,
    });
    throw error;
  }
}
