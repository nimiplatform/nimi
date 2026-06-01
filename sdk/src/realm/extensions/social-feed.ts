import type { Realm } from '../client.js';
import type { RealmModel } from '../generated/type-helpers.js';
import type { RealmFeedScope } from './feed.js';
import {
  enrichRealmProfileWithWorldBanner,
  type RealmSocialApiCaller,
  type RealmSocialErrorEmitter,
} from './social-snapshot.js';
import type { JsonObject } from '../../internal/utils.js';

type CreateReportDto = RealmModel<'CreateReportDto'>;
type CreatePostDto = RealmModel<'CreatePostDto'>;
type FeedPageMetaDto = RealmModel<'FeedPageMetaDto'>;
type FeedResponseDto = RealmModel<'FeedResponseDto'>;
type PostDto = RealmModel<'PostDto'>;
type ReportResponseDto = RealmModel<'ReportResponseDto'>;
type UserProfileDto = RealmModel<'UserProfileDto'>;

export type RealmSocialFeedApiCaller = RealmSocialApiCaller;
export type RealmSocialFeedErrorEmitter = RealmSocialErrorEmitter;

export type RealmPostFeedInput = {
  visibility?: 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
  worldId?: string;
  authorId?: string;
  limit?: number;
  cursor?: string;
  scope?: RealmFeedScope;
};

export type RealmSocialMutationKind =
  | 'post-like'
  | 'post-unlike';

export type RealmSocialMutationExecutionInput = {
  kind: RealmSocialMutationKind;
  payload: Record<string, unknown>;
};

export type LoadRealmExploreAgentsInput = {
  tag?: string | null;
  query?: string | null;
  limit?: number;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizePostFeedInput(input: RealmPostFeedInput): RealmPostFeedInput {
  return {
    visibility: input.visibility,
    worldId: typeof input.worldId === 'string' ? input.worldId : undefined,
    authorId: typeof input.authorId === 'string' ? input.authorId : undefined,
    limit: typeof input.limit === 'number' ? input.limit : undefined,
    cursor: typeof input.cursor === 'string' ? input.cursor : undefined,
    scope: input.scope,
  };
}

export function buildEmptyRealmPostFeedResponse(input: {
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

export async function loadRealmCurrentUserProfile(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
): Promise<UserProfileDto> {
  try {
    return await callApi((realm) => realm.services.MeService.getMe(), '获取当前用户失败');
  } catch (error) {
    emitRealmDataError('load-current-user', error);
    throw error;
  }
}

export async function updateRealmCurrentUserProfile(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  data: JsonObject,
): Promise<UserProfileDto> {
  try {
    return await callApi((realm) => realm.services.MeService.updateMe(data), '更新用户资料失败');
  } catch (error) {
    emitRealmDataError('update-user-profile', error);
    throw error;
  }
}

export async function loadRealmUserProfileById(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  id: string,
): Promise<UserProfileDto> {
  const normalizedId = normalizeText(id);
  try {
    const profile = await callApi(
      (realm) => realm.services.UserService.getUser(normalizedId),
      '获取用户资料失败',
    );
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      return profile as UserProfileDto;
    }
    return await enrichRealmProfileWithWorldBanner(callApi, profile as JsonObject);
  } catch (error) {
    emitRealmDataError('load-user-profile', error, { id: normalizedId });
    throw error;
  }
}

export async function addRealmFriendById(
  callApi: RealmSocialFeedApiCaller,
  userId: string,
  message?: string,
): Promise<{ id: string }> {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) {
    throw new Error('用户ID不能为空');
  }
  await callApi(
    (realm) => realm.services.UserService.addFriend(
      normalizedUserId,
      message ? { requestMessage: message } : undefined,
    ),
    '添加好友失败',
  );
  return { id: normalizedUserId };
}

export async function removeRealmFriendById(
  callApi: RealmSocialFeedApiCaller,
  userId: string,
): Promise<void> {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) {
    throw new Error('用户ID不能为空');
  }
  await callApi(
    (realm) => realm.services.UserService.removeFriend(normalizedUserId),
    '删除好友失败',
  );
}

export async function blockRealmUser(
  callApi: RealmSocialFeedApiCaller,
  contactId: string,
): Promise<{ id: string }> {
  const normalizedContactId = normalizeText(contactId);
  if (!normalizedContactId) {
    throw new Error('用户ID不能为空');
  }
  await callApi(
    (realm) => realm.services.MeService.blockUser(normalizedContactId),
    '拉黑用户失败',
  );
  return { id: normalizedContactId };
}

export async function unblockRealmUser(
  callApi: RealmSocialFeedApiCaller,
  contactId: string,
): Promise<{ id: string }> {
  const normalizedContactId = normalizeText(contactId);
  if (!normalizedContactId) {
    throw new Error('用户ID不能为空');
  }
  await callApi(
    (realm) => realm.services.MeService.unblockUser(normalizedContactId),
    '取消拉黑失败',
  );
  return { id: normalizedContactId };
}

export async function loadRealmPostFeed(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  input: RealmPostFeedInput,
): Promise<FeedResponseDto> {
  const normalized = normalizePostFeedInput(input);
  try {
    return await callApi(
      (realm) => realm.services.PostsService.getHomeFeed(
        normalized.visibility,
        normalized.worldId,
        normalized.authorId,
        normalized.limit,
        normalized.cursor,
        normalized.scope,
      ),
      'Failed to load posts',
    );
  } catch (error) {
    emitRealmDataError('load-post-feed', error, normalized);
    throw error;
  }
}

export async function loadRealmLikedPosts(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  profileId: string,
  limit = 20,
  cursor?: string,
): Promise<FeedResponseDto> {
  const normalizedProfileId = normalizeText(profileId);
  try {
    return await callApi(
      (realm) => realm.services.PostsService.listLikedPosts(undefined, limit, cursor, normalizedProfileId),
      'Failed to load liked posts',
    );
  } catch (error) {
    emitRealmDataError('load-liked-posts', error, {
      profileId: normalizedProfileId,
      limit,
      cursor,
    });
    throw error;
  }
}

export async function loadRealmPostById(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  postId: string,
): Promise<PostDto> {
  const normalizedPostId = normalizeText(postId);
  try {
    return await callApi(
      (realm) => realm.services.PostsService.getPost(normalizedPostId),
      'Failed to load post',
    );
  } catch (error) {
    emitRealmDataError('load-post-by-id', error, { postId: normalizedPostId });
    throw error;
  }
}

export async function createRealmPost(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  payload: CreatePostDto,
): Promise<PostDto> {
  try {
    return await callApi(
      (realm) => realm.services.PostsService.createPost(payload),
      'Failed to create post',
    );
  } catch (error) {
    emitRealmDataError('create-post', error, {
      attachmentCount: Array.isArray(payload.attachments) ? payload.attachments.length : 0,
      tagsCount: Array.isArray(payload.tags) ? payload.tags.length : 0,
    });
    throw error;
  }
}

export async function deleteRealmPost(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  postId: string,
): Promise<void> {
  try {
    await callApi(
      (realm) => realm.services.PostsService.deletePost(postId),
      'Failed to delete post',
    );
  } catch (error) {
    emitRealmDataError('delete-post', error, { postId });
    throw error;
  }
}

export async function updateRealmPostVisibility(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  postId: string,
  visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE',
): Promise<PostDto> {
  try {
    return await callApi(
      (realm) => realm.services.PostsService.updatePost(postId, { visibility }),
      'Failed to update post visibility',
    );
  } catch (error) {
    emitRealmDataError('update-post-visibility', error, {
      postId,
      visibility,
    });
    throw error;
  }
}

export async function likeRealmPost(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  postId: string,
): Promise<void> {
  try {
    await callApi(
      (realm) => realm.services.PostsService.likePost(postId),
      'Failed to like post',
    );
  } catch (error) {
    emitRealmDataError('like-post', error, { postId });
    throw error;
  }
}

export async function unlikeRealmPost(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  postId: string,
): Promise<void> {
  try {
    await callApi(
      (realm) => realm.services.PostsService.unlikePost(postId),
      'Failed to unlike post',
    );
  } catch (error) {
    emitRealmDataError('unlike-post', error, { postId });
    throw error;
  }
}

export async function createRealmReport(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  payload: CreateReportDto,
): Promise<ReportResponseDto> {
  try {
    return await callApi(
      (realm) => realm.services.GovernanceService.reportControllerCreateReport(payload),
      'Failed to create report',
    );
  } catch (error) {
    emitRealmDataError('create-report', error, {
      targetType: payload.targetType,
      targetId: payload.targetId,
      reason: payload.reason,
    });
    throw error;
  }
}

export async function executeRealmSocialMutation(
  callApi: RealmSocialFeedApiCaller,
  entry: RealmSocialMutationExecutionInput,
): Promise<void> {
  if (entry.kind === 'post-like') {
    const postId = normalizeText(entry.payload.postId);
    await callApi(
      (realm) => realm.services.PostsService.likePost(postId),
      '点赞失败',
    );
    return;
  }
  if (entry.kind === 'post-unlike') {
    const postId = normalizeText(entry.payload.postId);
    await callApi(
      (realm) => realm.services.PostsService.unlikePost(postId),
      '取消点赞失败',
    );
  }
}

export async function loadRealmExploreAgents(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  input: LoadRealmExploreAgentsInput = {},
): Promise<unknown> {
  const tag = input.tag?.trim() || undefined;
  const query = input.query?.trim() || undefined;
  const limit = input.limit ?? 20;
  try {
    return await callApi(
      (realm) => realm.services.SearchService.searchIndexedUsers(
        limit,
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        undefined,
        tag,
        undefined,
        undefined,
        undefined,
        undefined,
        query,
      ),
      '加载探索 Agent 失败',
    );
  } catch (error) {
    emitRealmDataError('load-explore-agents', error, { tag, query, limit });
    throw error;
  }
}

export async function loadRealmExploreFeedItems(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
  tag: string | null,
  limit: number,
  cursor?: string,
): Promise<unknown> {
  try {
    return await callApi(
      (realm) => realm.services.ExploreService.getExploreFeed(undefined, tag || undefined, limit, cursor),
      cursor ? '加载更多探索流失败' : '加载探索流失败',
    );
  } catch (error) {
    emitRealmDataError(cursor ? 'load-more-explore-feed' : 'load-explore-feed', error, { tag, limit });
    throw error;
  }
}
