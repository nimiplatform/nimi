/**
 * Content Data Client — Forge adapter (FG-CONTENT-001..007)
 *
 * Direct SDK realm client calls for media upload, posts, and content operations.
 * Publish workspace helpers below are app-level placeholders, not missing backend APIs.
 */

import { getPlatformClient } from '@nimiplatform/sdk';
import type { RealmModel, RealmServiceArgs } from '@nimiplatform/sdk/realm';
import {
  listPublishChannels,
  getPublishSettings,
  updatePublishSettings,
  listPublishDrafts,
  createPublishDraft,
  getPublishDraft,
  updatePublishDraft,
  deletePublishDraft,
  markPublishDraftPublished,
  listPublishDeliveries,
  type PublishDraftMedia,
  type PublishWorkspaceState,
} from './publish-workspace-data.js';

function realm() {
  return getPlatformClient().realm;
}

type CreateAudioDirectUploadInput = RealmServiceArgs<'MediaService', 'createAudioDirectUpload'>[0];
type UpdateMediaAssetInput = RealmServiceArgs<'MediaService', 'updateMediaAsset'>[1];
type FinalizeMediaAssetInput = RealmServiceArgs<'MediaService', 'finalizeMediaAsset'>[1];
type CreatePostInput = RealmServiceArgs<'PostService', 'createPost'>[0];
type UpdatePostInput = RealmServiceArgs<'PostService', 'updatePost'>[1];
type PostDto = RealmModel<'PostDto'>;
export type PublishChannelListItem = ReturnType<typeof listPublishChannels>[number] & {
  defaultIdentity: PublishWorkspaceState['settings']['defaultIdentity'];
  defaultAgentId: PublishWorkspaceState['settings']['defaultAgentId'];
};
export type PublishReleaseDraft = ReturnType<typeof listPublishDrafts>[number];
export type PublishChannelUpdateInput = {
  defaultIdentity?: PublishWorkspaceState['settings']['defaultIdentity'];
  defaultAgentId?: string | null;
  enabled?: boolean;
};
export type ForgeCreateAudioDirectUploadInput = CreateAudioDirectUploadInput & {
  [key: string]: unknown;
};
export type ForgeUpdateMediaAssetInput = UpdateMediaAssetInput & {
  [key: string]: unknown;
};
export type ForgeFinalizeMediaAssetInput = FinalizeMediaAssetInput & {
  [key: string]: unknown;
};
export type ForgeCreatePostInput = CreatePostInput | {
  content?: string;
  caption?: string;
  media?: CreatePostInput['media'];
  tags?: string[];
  [key: string]: unknown;
};
export type ForgeUpdatePostInput = UpdatePostInput | {
  content?: string;
  visibility?: UpdatePostInput['visibility'];
  [key: string]: unknown;
};
export type ReleaseMutationInput = {
  title?: string;
  caption?: string;
  tags?: string[];
  media?: Array<PublishDraftMedia | { id?: string; assetId?: string; type?: PublishDraftMedia['type'] }>;
  identity?: PublishWorkspaceState['settings']['defaultIdentity'];
  agentId?: string | null;
  delete?: boolean;
};
type PublishDelivery = ReturnType<typeof listPublishDeliveries>[number];

function toDraftMediaList(input: unknown): PublishDraftMedia[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input
    .map((item) => {
      const media = item && typeof item === 'object'
        ? (item as { assetId?: unknown; id?: unknown; type?: unknown })
        : {};
      return {
        assetId: String(media.assetId || media.id || '').trim(),
        type: (String(media.type || 'IMAGE') === 'VIDEO' ? 'VIDEO' : 'IMAGE') as PublishDraftMedia['type'],
      };
    })
    .filter((item) => Boolean(item.assetId));
}

function toChannelPatch(
  channelId: 'INTERNAL_FEED' | 'INTERNAL_AGENT_PROFILE',
  enabled: boolean,
): Partial<Record<keyof PublishWorkspaceState['settings']['channels'], { enabled: boolean }>> {
  return {
    [channelId]: { enabled },
  };
}

// ── Media Upload ─────────────────────────────────────────────

export async function createImageDirectUpload(requireSignedUrls?: string) {
  return realm().services.MediaService.createImageDirectUpload(requireSignedUrls);
}

export async function createVideoDirectUpload(requireSignedUrls?: string) {
  return realm().services.MediaService.createVideoDirectUpload(requireSignedUrls);
}

export async function createAudioDirectUpload(payload: ForgeCreateAudioDirectUploadInput = {}) {
  return realm().services.MediaService.createAudioDirectUpload(payload);
}

export async function listMediaAssets() {
  return realm().services.MediaService.listMediaAssets();
}

export async function getMediaAsset(assetId: string) {
  return realm().services.MediaService.getMediaAsset(assetId);
}

export async function updateMediaAsset(assetId: string, payload: ForgeUpdateMediaAssetInput) {
  return realm().services.MediaService.updateMediaAsset(assetId, payload);
}

export async function finalizeMediaAsset(assetId: string, payload: ForgeFinalizeMediaAssetInput = {}) {
  return realm().services.MediaService.finalizeMediaAsset(assetId, payload);
}

export async function deleteMediaAsset(assetId: string) {
  return realm().services.MediaService.deleteMediaAsset(assetId);
}

// ── Posts ─────────────────────────────────────────────────────

export async function createPost(payload: ForgeCreatePostInput) {
  return realm().services.PostService.createPost({
    media: Array.isArray(payload.media) ? payload.media : [],
    caption: payload.caption || ('content' in payload ? payload.content : undefined),
    tags: payload.tags,
  });
}

export async function getHomeFeed(params?: {
  visibility?: string;
  worldId?: string;
  authorId?: string;
  limit?: number;
  cursor?: string;
}) {
  return realm().services.PostService.getHomeFeed(
    params?.visibility,
    params?.worldId,
    params?.authorId,
    params?.limit,
    params?.cursor,
  );
}

export async function getPost(postId: string, worldId?: string) {
  return realm().services.PostService.getPost(postId, worldId);
}

export async function updatePost(postId: string, payload: ForgeUpdatePostInput) {
  return realm().services.PostService.updatePost(postId, {
    visibility: payload.visibility,
  });
}

export async function deletePost(postId: string) {
  return realm().services.PostService.deletePost(postId);
}

// ── World Posts ──────────────────────────────────────────────

export async function getWorldPosts(worldId: string, params?: {
  visibility?: string;
  authorId?: string;
  limit?: number;
  cursor?: string;
}) {
  return realm().services.WorldpostService.getWorldPosts(
    worldId,
    params?.visibility,
    params?.authorId,
    params?.limit,
    params?.cursor,
  );
}

// ── Publish Workspace (app-level workflow) ───────────────────

export async function listPublishingChannels(): Promise<PublishChannelListItem[]> {
  const settings = getPublishSettings();
  return listPublishChannels().map((channel) => ({
    ...channel,
    defaultIdentity: settings.defaultIdentity,
    defaultAgentId: settings.defaultAgentId,
  }));
}

export async function listReleases(params?: { status?: string }): Promise<ReturnType<typeof listPublishDrafts>> {
  return listPublishDrafts(params?.status ? String(params.status) : undefined);
}

export async function createRelease(payload: ReleaseMutationInput): Promise<ReturnType<typeof createPublishDraft>> {
  return createPublishDraft({
    title: payload.title ? String(payload.title) : '',
    caption: payload.caption ? String(payload.caption) : '',
    tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag || '')).filter(Boolean) : [],
    media: toDraftMediaList(payload.media) || [],
    identity: String(payload.identity || 'USER') === 'AGENT' ? 'AGENT' : 'USER',
    agentId: payload.agentId ? String(payload.agentId) : null,
  });
}

export async function getRelease(releaseId: string): Promise<NonNullable<ReturnType<typeof getPublishDraft>>> {
  const draft = getPublishDraft(releaseId);
  if (!draft) {
    throw new Error('Publish draft not found');
  }
  return draft;
}

export async function updateRelease(releaseId: string, payload: ReleaseMutationInput): Promise<ReturnType<typeof updatePublishDraft> | { id: string; deleted: true }> {
  if (payload.delete === true) {
    deletePublishDraft(releaseId);
    return { id: releaseId, deleted: true };
  }
  return updatePublishDraft(releaseId, {
    title: payload.title !== undefined ? String(payload.title || '') : undefined,
    caption: payload.caption !== undefined ? String(payload.caption || '') : undefined,
    tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag || '')).filter(Boolean) : undefined,
    media: toDraftMediaList(payload.media),
    identity: payload.identity !== undefined ? (String(payload.identity) === 'AGENT' ? 'AGENT' : 'USER') : undefined,
    agentId: payload.agentId !== undefined ? (payload.agentId ? String(payload.agentId) : null) : undefined,
  });
}

export async function publishRelease(releaseId: string): Promise<ReturnType<typeof markPublishDraftPublished>> {
  const draft = getPublishDraft(releaseId);
  if (!draft) {
    throw new Error('Publish draft not found');
  }
  if (draft.identity === 'AGENT') {
    throw new Error('Agent-identity publishing requires platform agent-post capability, which is not yet exposed through the Forge realm client.');
  }
  if (draft.media.length === 0) {
    throw new Error('At least one image or video asset is required to publish');
  }
  const created = await createPost({
    media: draft.media.map((item) => ({ assetId: item.assetId, type: item.type })),
    caption: draft.caption || undefined,
    tags: draft.tags.length > 0 ? draft.tags : undefined,
  });
  const postId = String((created as PostDto).id || '').trim();
  if (!postId) {
    throw new Error('Publish succeeded without returning a post id');
  }
  return markPublishDraftPublished(releaseId, postId);
}

export async function listDeliveries(releaseId: string): Promise<PublishDelivery[]> {
  return listPublishDeliveries(releaseId);
}

export async function connectChannel(channelId: 'INTERNAL_FEED' | 'INTERNAL_AGENT_PROFILE'): Promise<ReturnType<typeof updatePublishSettings>> {
  if (channelId !== 'INTERNAL_FEED' && channelId !== 'INTERNAL_AGENT_PROFILE') {
    throw new Error('Unsupported publish channel');
  }
  return updatePublishSettings({
    channels: toChannelPatch(channelId, true),
  });
}

export async function updateChannel(
  channelId: 'INTERNAL_FEED' | 'INTERNAL_AGENT_PROFILE',
  payload: PublishChannelUpdateInput,
): Promise<ReturnType<typeof updatePublishSettings>> {
  if (channelId !== 'INTERNAL_FEED' && channelId !== 'INTERNAL_AGENT_PROFILE') {
    throw new Error('Unsupported publish channel');
  }
  return updatePublishSettings({
    defaultIdentity: payload.defaultIdentity !== undefined
      ? (String(payload.defaultIdentity) === 'AGENT' ? 'AGENT' : 'USER')
      : undefined,
    defaultAgentId: payload.defaultAgentId !== undefined
      ? (payload.defaultAgentId ? String(payload.defaultAgentId) : null)
      : undefined,
    channels: toChannelPatch(channelId, typeof payload.enabled === 'boolean' ? payload.enabled : true),
  });
}
