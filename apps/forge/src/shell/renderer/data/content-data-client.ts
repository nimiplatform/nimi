/**
 * Content Data Client — Forge adapter (FG-CONTENT-001..007)
 *
 * Direct SDK realm client calls for media upload, posts, and content operations.
 * Publish workspace helpers below are app-level placeholders, not missing backend APIs.
 */

import { getPlatformClient } from '@runtime/platform-client.js';
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

function toDraftMediaList(input: unknown): PublishDraftMedia[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input
    .map((item) => {
      const media = item && typeof item === 'object' ? item as Record<string, unknown> : {};
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

export async function createAudioDirectUpload(payload?: Record<string, unknown>) {
  return realm().services.MediaService.createAudioDirectUpload(payload || {});
}

export async function getMediaAsset(assetId: string) {
  return realm().services.MediaService.getMediaAsset(assetId);
}

export async function finalizeMediaAsset(assetId: string, payload?: Record<string, unknown>) {
  return realm().services.MediaService.finalizeMediaAsset(assetId, payload || {});
}

// ── Posts ─────────────────────────────────────────────────────

export async function createPost(payload: Record<string, unknown>) {
  return realm().services.PostService.createPost(payload);
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

export async function updatePost(postId: string, payload: Record<string, unknown>) {
  return realm().services.PostService.updatePost(postId, payload);
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

export async function listPublishingChannels(): Promise<unknown> {
  const settings = getPublishSettings();
  return listPublishChannels().map((channel) => ({
    ...channel,
    defaultIdentity: settings.defaultIdentity,
    defaultAgentId: settings.defaultAgentId,
  }));
}

export async function listReleases(_params?: Record<string, unknown>): Promise<unknown> {
  return listPublishDrafts(_params?.status ? String(_params.status) : undefined);
}

export async function createRelease(_payload: Record<string, unknown>): Promise<unknown> {
  return createPublishDraft({
    title: _payload.title ? String(_payload.title) : '',
    caption: _payload.caption ? String(_payload.caption) : '',
    tags: Array.isArray(_payload.tags) ? _payload.tags.map((tag) => String(tag || '')).filter(Boolean) : [],
    media: toDraftMediaList(_payload.media) || [],
    identity: String(_payload.identity || 'USER') === 'AGENT' ? 'AGENT' : 'USER',
    agentId: _payload.agentId ? String(_payload.agentId) : null,
  });
}

export async function getRelease(_releaseId: string): Promise<unknown> {
  const draft = getPublishDraft(_releaseId);
  if (!draft) {
    throw new Error('Publish draft not found');
  }
  return draft;
}

export async function updateRelease(_releaseId: string, _payload: Record<string, unknown>): Promise<unknown> {
  if (_payload.delete === true) {
    deletePublishDraft(_releaseId);
    return { id: _releaseId, deleted: true };
  }
  return updatePublishDraft(_releaseId, {
    title: _payload.title !== undefined ? String(_payload.title || '') : undefined,
    caption: _payload.caption !== undefined ? String(_payload.caption || '') : undefined,
    tags: Array.isArray(_payload.tags) ? _payload.tags.map((tag) => String(tag || '')).filter(Boolean) : undefined,
    media: toDraftMediaList(_payload.media),
    identity: _payload.identity !== undefined ? (String(_payload.identity) === 'AGENT' ? 'AGENT' : 'USER') : undefined,
    agentId: _payload.agentId !== undefined ? (_payload.agentId ? String(_payload.agentId) : null) : undefined,
  });
}

export async function publishRelease(_releaseId: string): Promise<unknown> {
  const draft = getPublishDraft(_releaseId);
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
  const createdRecord = created && typeof created === 'object' ? created as Record<string, unknown> : {};
  const postId = String(createdRecord.id || '').trim();
  if (!postId) {
    throw new Error('Publish succeeded without returning a post id');
  }
  return markPublishDraftPublished(_releaseId, postId);
}

export async function listDeliveries(_releaseId: string): Promise<unknown> {
  return listPublishDeliveries(_releaseId);
}

export async function connectChannel(_channelId: string): Promise<unknown> {
  if (_channelId !== 'INTERNAL_FEED' && _channelId !== 'INTERNAL_AGENT_PROFILE') {
    throw new Error('Unsupported publish channel');
  }
  return updatePublishSettings({
    channels: toChannelPatch(_channelId, true),
  });
}

export async function updateChannel(_channelId: string, _payload: Record<string, unknown>): Promise<unknown> {
  if (_channelId !== 'INTERNAL_FEED' && _channelId !== 'INTERNAL_AGENT_PROFILE') {
    throw new Error('Unsupported publish channel');
  }
  return updatePublishSettings({
    defaultIdentity: _payload.defaultIdentity !== undefined
      ? (String(_payload.defaultIdentity) === 'AGENT' ? 'AGENT' : 'USER')
      : undefined,
    defaultAgentId: _payload.defaultAgentId !== undefined
      ? (_payload.defaultAgentId ? String(_payload.defaultAgentId) : null)
      : undefined,
    channels: toChannelPatch(_channelId, typeof _payload.enabled === 'boolean' ? _payload.enabled : true),
  });
}
