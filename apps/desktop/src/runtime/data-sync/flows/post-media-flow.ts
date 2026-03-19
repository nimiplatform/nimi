import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import {
  getOfflineCoordinator,
  isRealmOfflineError,
} from '@runtime/offline';
import { queueSocialMutation } from '../offline-social-outbox';

type CreateReportDto = RealmModel<'CreateReportDto'>;
type CreatePostDto = RealmModel<'CreatePostDto'>;
type FeedResponseDto = RealmModel<'FeedResponseDto'>;
type FinalizeMediaAssetDto = RealmModel<'FinalizeMediaAssetDto'>;
type MediaAssetDetailDto = RealmModel<'MediaAssetDetailDto'>;
type MediaDirectUploadSessionDto = RealmModel<'MediaDirectUploadSessionDto'>;
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
  try {
    return await callApi(
      (realm) => realm.services.PostService.getHomeFeed(
        normalized.visibility,
        normalized.worldId,
        normalized.authorId,
        normalized.limit,
        normalized.cursor,
      ),
      '加载帖子失败',
    );
  } catch (error) {
    emitDataSyncError('load-post-feed', error, normalized);
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
      (realm) => realm.services.PostService.createPost(payload),
      '发布帖子失败',
    );
  } catch (error) {
    emitDataSyncError('create-post', error, {
      mediaCount: Array.isArray(payload.media) ? payload.media.length : 0,
      tagsCount: Array.isArray(payload.tags) ? payload.tags.length : 0,
    });
    throw error;
  }
}

export async function createImageDirectUpload(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<MediaDirectUploadSessionDto> {
  try {
    return await callApi(
      (realm) => realm.services.MediaService.createImageDirectUpload(),
      '创建图片上传失败',
    );
  } catch (error) {
    emitDataSyncError('create-image-direct-upload', error);
    throw error;
  }
}

export async function createVideoDirectUpload(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<MediaDirectUploadSessionDto> {
  try {
    return await callApi(
      (realm) => realm.services.MediaService.createVideoDirectUpload(),
      '创建视频上传失败',
    );
  } catch (error) {
    emitDataSyncError('create-video-direct-upload', error);
    throw error;
  }
}

export async function finalizeMediaAsset(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  assetId: string,
  payload: FinalizeMediaAssetDto,
): Promise<MediaAssetDetailDto> {
  try {
    return await callApi(
      (realm) => realm.services.MediaService.finalizeMediaAsset(assetId, payload),
      '完成媒体资源上传失败',
    );
  } catch (error) {
    emitDataSyncError('finalize-media-asset', error, { assetId });
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
      (realm) => realm.services.PostService.deletePost(postId),
      '删除帖子失败',
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
      (realm) => realm.services.PostService.updatePost(postId, { visibility }),
      '更新帖子可见性失败',
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
      (realm) => realm.services.PostService.likePost(postId),
      '点赞失败',
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
      (realm) => realm.services.PostService.unlikePost(postId),
      '取消点赞失败',
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
      '举报失败',
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
