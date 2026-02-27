import type { Realm } from '@nimiplatform/sdk/realm';
import type { CreatePostDto } from '@nimiplatform/sdk/realm';
import type { DirectUploadResponseDto } from '@nimiplatform/sdk/realm';
import type { FeedResponseDto } from '@nimiplatform/sdk/realm';
import type { PostDto } from '@nimiplatform/sdk/realm';

type DataSyncApiCaller = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) => Promise<any>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

export type HomeFeedScope = 'all' | 'friends' | 'forYou';
export type LoadPostFeedInput = {
  visibility?: 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
  worldId?: string;
  authorId?: string;
  scope?: HomeFeedScope;
  limit?: number;
  cursor?: string;
};

function normalizeScope(
  scope: HomeFeedScope | undefined,
): 'all' | 'friends' | 'forYou' | undefined {
  if (scope === 'friends' || scope === 'forYou' || scope === 'all') {
    return scope;
  }
  return undefined;
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
    scope: normalizeScope(input.scope),
    limit: typeof input.limit === 'number' ? input.limit : undefined,
    cursor: typeof input.cursor === 'string' ? input.cursor : undefined,
  };
  try {
    return await callApi(
      (realm) => realm.services.PostService.getHomeFeed(
        normalized.visibility,
        normalized.worldId,
        normalized.authorId,
        normalized.scope,
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
): Promise<DirectUploadResponseDto> {
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
): Promise<{ uid: string; uploadURL: string }> {
  try {
    const payload = await callApi(
      (realm) => realm.services.MediaService.createVideoDirectUpload(),
      '创建视频上传失败',
    );
    const record = payload && typeof payload === 'object'
      ? payload as Record<string, unknown>
      : {};
    return {
      uid: typeof record.uid === 'string' ? record.uid : '',
      uploadURL: typeof record.uploadURL === 'string' ? record.uploadURL : '',
    };
  } catch (error) {
    emitDataSyncError('create-video-direct-upload', error);
    throw error;
  }
}
