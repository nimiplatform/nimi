/**
 * Content Data Client — Forge adapter (FG-CONTENT-001..007)
 *
 * Direct SDK realm client calls for resource upload, posts, and content operations.
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
  type PublishDraftAttachment,
  type PublishWorkspaceState,
} from './publish-workspace-data.js';

export type { PublishDraftAttachment };

function realm() {
  return getPlatformClient().realm;
}

type CreateAudioDirectUploadInput = RealmServiceArgs<'ResourcesService', 'createAudioDirectUpload'>[0];
type UpdateResourceInput = RealmServiceArgs<'ResourcesService', 'updateResource'>[1];
type FinalizeResourceInput = RealmServiceArgs<'ResourcesService', 'finalizeResource'>[1];
type CreatePostInput = RealmServiceArgs<'PostsService', 'createPost'>[0];
type UpdatePostInput = RealmServiceArgs<'PostsService', 'updatePost'>[1];
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
export type ForgeUpdateResourceInput = UpdateResourceInput & {
  [key: string]: unknown;
};
export type ForgeFinalizeResourceInput = FinalizeResourceInput & {
  [key: string]: unknown;
};
export type ForgeCreatePostInput = CreatePostInput | {
  content?: string;
  caption?: string;
  attachments?: CreatePostInput['attachments'];
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
  attachments?: Array<PublishDraftAttachment>;
  identity?: PublishWorkspaceState['settings']['defaultIdentity'];
  agentId?: string | null;
  delete?: boolean;
};
type PublishDelivery = ReturnType<typeof listPublishDeliveries>[number];

function parseDraftAttachmentTargetType(value: unknown): PublishDraftAttachment['targetType'] | null {
  const normalized = String(value || '').trim();
  if (normalized === 'RESOURCE' || normalized === 'ASSET' || normalized === 'BUNDLE') {
    return normalized;
  }
  return null;
}

function parseDraftAttachmentDisplayKind(value: unknown): PublishDraftAttachment['displayKind'] | null {
  const normalized = String(value || '').trim();
  if (
    normalized === 'IMAGE'
    || normalized === 'VIDEO'
    || normalized === 'AUDIO'
    || normalized === 'TEXT'
    || normalized === 'CARD'
  ) {
    return normalized;
  }
  return null;
}

function toDraftAttachmentList(input: unknown): PublishDraftAttachment[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input
    .map((item) => {
      const attachment = item && typeof item === 'object'
        ? (item as { targetType?: unknown; targetId?: unknown; displayKind?: unknown })
        : {};
      const targetType = parseDraftAttachmentTargetType(attachment.targetType);
      const displayKind = parseDraftAttachmentDisplayKind(attachment.displayKind);
      const targetId = String(attachment.targetId || '').trim();
      if (!targetType || !displayKind || !targetId) {
        return null;
      }
      return { targetType, targetId, displayKind };
    })
    .filter((item): item is PublishDraftAttachment => item !== null);
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
  return realm().services.ResourcesService.createImageDirectUpload(requireSignedUrls);
}

export async function createVideoDirectUpload(requireSignedUrls?: string) {
  return realm().services.ResourcesService.createVideoDirectUpload(requireSignedUrls);
}

export async function createAudioDirectUpload(payload: ForgeCreateAudioDirectUploadInput = {}) {
  return realm().services.ResourcesService.createAudioDirectUpload(payload);
}

export async function listResources() {
  return realm().services.ResourcesService.listResources();
}

export async function getResource(resourceId: string) {
  return realm().services.ResourcesService.getResource(resourceId);
}

export async function updateResource(resourceId: string, payload: ForgeUpdateResourceInput) {
  return realm().services.ResourcesService.updateResource(resourceId, payload);
}

export async function finalizeResource(resourceId: string, payload: ForgeFinalizeResourceInput = {}) {
  return realm().services.ResourcesService.finalizeResource(resourceId, payload);
}

export async function deleteResource(resourceId: string) {
  return realm().services.ResourcesService.deleteResource(resourceId);
}

// ── File Upload (manual pick → presigned URL → finalize) ────

export type FileUploadResult = {
  resourceId: string;
  url: string;
};

export async function uploadFileAsResource(file: File): Promise<FileUploadResult> {
  const session = await createImageDirectUpload();
  const record = session && typeof session === 'object' && !Array.isArray(session)
    ? session as Record<string, unknown>
    : {};
  const uploadUrl = String(record.uploadUrl || '');
  const resourceId = String(record.resourceId || record.id || '');

  if (!uploadUrl || !resourceId) {
    throw new Error('FORGE_FILE_UPLOAD_NO_SESSION');
  }

  const formData = new FormData();
  formData.append('file', file, file.name);
  let uploadResponse = await fetch(uploadUrl, { method: 'POST', body: formData });
  if (!uploadResponse.ok) {
    uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'image/png' },
    });
  }
  if (!uploadResponse.ok) {
    throw new Error(`FORGE_FILE_UPLOAD_FAILED: ${uploadResponse.status}`);
  }

  const finalized = await finalizeResource(resourceId, {});
  const finalRecord = finalized && typeof finalized === 'object' && !Array.isArray(finalized)
    ? finalized as Record<string, unknown>
    : {};

  return {
    resourceId,
    url: String(finalRecord.url || ''),
  };
}

// ── Posts ─────────────────────────────────────────────────────

export async function createPost(payload: ForgeCreatePostInput) {
  return realm().services.PostsService.createPost({
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
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
  return realm().services.PostsService.getHomeFeed(
    params?.visibility,
    params?.worldId,
    params?.authorId,
    params?.limit,
    params?.cursor,
  );
}

export async function getPost(postId: string, worldId?: string) {
  return realm().services.PostsService.getPost(postId, worldId);
}

export async function updatePost(postId: string, payload: ForgeUpdatePostInput) {
  return realm().services.PostsService.updatePost(postId, {
    visibility: payload.visibility,
  });
}

export async function deletePost(postId: string) {
  return realm().services.PostsService.deletePost(postId);
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
    attachments: toDraftAttachmentList(payload.attachments) || [],
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
    attachments: toDraftAttachmentList(payload.attachments),
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
  if (draft.attachments.length === 0) {
    throw new Error('At least one attachment is required to publish');
  }
  const created = await createPost({
    attachments: draft.attachments.map((item) => ({
      targetType: item.targetType,
      targetId: item.targetId,
    })),
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
