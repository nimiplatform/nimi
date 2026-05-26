/**
 * Forge Content Resource Queries (FG-CONTENT-001..007)
 */

import { useQuery } from '@tanstack/react-query';
import {
  getHomeFeed,
  getResource,
  listResources,
} from '@renderer/data/content-data-client.js';
import type { RealmModel } from '@nimiplatform/sdk/realm';

type FeedPayload = Awaited<ReturnType<typeof getHomeFeed>>;
type ResourcesPayload = Awaited<ReturnType<typeof listResources>>;
type ResourcePayload = Awaited<ReturnType<typeof getResource>>;
type FeedResponseDto = RealmModel<'FeedResponseDto'>;
type PostDto = RealmModel<'PostDto'>;
type ResourceDetailDto = RealmModel<'ResourceDetailDto'>;

// ── Types ────────────────────────────────────────────────────

export type PostAttachmentItem = {
  displayKind: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'CARD';
  targetType: 'RESOURCE' | 'ASSET' | 'BUNDLE';
  targetId: string;
  url?: string;
  duration?: number;
  thumbnail?: string;
  title?: string;
  subtitle?: string;
  preview?: PostAttachmentItem;
};

export type PostSummary = {
  id: string;
  caption: string;
  attachments: PostAttachmentItem[];
  tags: string[];
  authorId: string;
  worldId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ResourceSummary = {
  id: string;
  resourceType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'TEXT';
  provider: string;
  status: string;
  storageRef: string;
  url: string | null;
  controllerKind: string;
  controllerId: string;
  worldId: string | null;
  agentId: string | null;
  deliveryAccess: string;
  label: string | null;
  title: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

// ── Normalizers ──────────────────────────────────────────────

function isPostDto(value: unknown): value is PostDto {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseAttachmentTargetType(value: unknown): PostAttachmentItem['targetType'] | null {
  const normalized = String(value || '').trim();
  if (normalized === 'RESOURCE' || normalized === 'ASSET' || normalized === 'BUNDLE') {
    return normalized;
  }
  return null;
}

function parseAttachmentDisplayKind(value: unknown): PostAttachmentItem['displayKind'] | null {
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

function toPostAttachmentItem(
  attachmentItem: NonNullable<PostDto['attachments']>[number],
): PostAttachmentItem {
  const targetType = parseAttachmentTargetType(attachmentItem.targetType);
  if (!targetType) {
    throw new Error('forge-content-invalid-attachment-target-type');
  }
  const targetId = String(attachmentItem.targetId || '').trim();
  if (!targetId) {
    throw new Error('forge-content-attachment-target-id-required');
  }
  const displayKind = parseAttachmentDisplayKind(attachmentItem.displayKind);
  if (!displayKind) {
    throw new Error('forge-content-invalid-attachment-display-kind');
  }
  return {
    displayKind,
    targetType,
    targetId,
    url: attachmentItem.url ? String(attachmentItem.url) : undefined,
    duration: attachmentItem.duration ? Number(attachmentItem.duration) : undefined,
    thumbnail: attachmentItem.thumbnail ? String(attachmentItem.thumbnail) : undefined,
    title: attachmentItem.title ? String(attachmentItem.title) : undefined,
    subtitle: attachmentItem.subtitle ? String(attachmentItem.subtitle) : undefined,
    preview: attachmentItem.preview
      ? toPostAttachmentItem(attachmentItem.preview as NonNullable<PostDto['attachments']>[number])
      : undefined,
  };
}

function toPostList(payload: FeedPayload): PostSummary[] {
  const items = Array.isArray((payload as FeedResponseDto).items)
    ? (payload as FeedResponseDto).items
    : Array.isArray(payload) ? payload
    : [];
  return items
    .filter(isPostDto)
    .map((item) => ({
      id: String(item.id || ''),
      caption: String(item.caption || ''),
      attachments: Array.isArray(item.attachments)
        ? item.attachments.map((attachmentItem: NonNullable<PostDto['attachments']>[number]) =>
            toPostAttachmentItem(attachmentItem),
          )
        : [],
      tags: Array.isArray(item.tags) ? item.tags.map((tag: string) => String(tag || '')) : [],
      authorId: String(item.authorId || item.userId || ''),
      worldId: item.worldId ? String(item.worldId) : null,
      createdAt: String(item.createdAt || ''),
      updatedAt: String(item.updatedAt || ''),
    }))
    .filter((item) => Boolean(item.id));
}

function toResourceList(payload: ResourcesPayload): ResourceSummary[] {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : [];
  return items
    .map((item) => item as ResourceDetailDto)
    .map((item) => {
      const rawType = String(item.resourceType || 'IMAGE');
      const resourceType: ResourceSummary['resourceType'] = rawType === 'VIDEO'
        ? 'VIDEO'
        : rawType === 'AUDIO'
          ? 'AUDIO'
          : rawType === 'TEXT'
            ? 'TEXT'
            : 'IMAGE';
      return {
        id: String(item.id || ''),
        resourceType,
        provider: String(item.provider || ''),
        status: String(item.status || ''),
        storageRef: String(item.storageRef || ''),
        url: item.url ? String(item.url) : null,
        controllerKind: String(item.controllerKind || ''),
        controllerId: String(item.controllerId || ''),
        worldId: item.worldId ? String(item.worldId) : null,
        agentId: item.agentId ? String(item.agentId) : null,
        deliveryAccess: String(item.deliveryAccess || ''),
        label: item.label ? String(item.label) : null,
        title: item.title ? String(item.title) : null,
        tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag || '')).filter(Boolean) : [],
        createdAt: String(item.createdAt || ''),
        updatedAt: String(item.updatedAt || ''),
      };
    })
    .filter((item) => Boolean(item.id));
}

// ── Hooks ────────────────────────────────────────────────────

export function useCreatorPostsQuery(params?: {
  worldId?: string;
  limit?: number;
  cursor?: string;
}, enabled = true) {
  return useQuery({
    queryKey: ['forge', 'content', 'posts', params],
    enabled,
    retry: false,
    queryFn: async () => toPostList(await getHomeFeed(params)),
  });
}

export function useResourcesQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'content', 'resources'],
    enabled,
    retry: false,
    queryFn: async () => toResourceList(await listResources()),
  });
}

export function useResourceQuery(resourceId: string) {
  return useQuery({
    queryKey: ['forge', 'content', 'resource', resourceId],
    enabled: Boolean(resourceId),
    retry: false,
      queryFn: async () => await getResource(resourceId) as ResourcePayload,
  });
}
