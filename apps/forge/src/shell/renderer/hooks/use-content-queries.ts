/**
 * Forge Content Resource Queries (FG-CONTENT-001..007)
 */

import { useQuery } from '@tanstack/react-query';
import {
  getHomeFeed,
  getMediaAsset,
  listMediaAssets,
} from '@renderer/data/content-data-client.js';
import type { RealmModel } from '@nimiplatform/sdk/realm';

type FeedPayload = Awaited<ReturnType<typeof getHomeFeed>>;
type MediaAssetsPayload = Awaited<ReturnType<typeof listMediaAssets>>;
type MediaAssetPayload = Awaited<ReturnType<typeof getMediaAsset>>;
type FeedResponseDto = RealmModel<'FeedResponseDto'>;
type PostDto = RealmModel<'PostDto'>;
type MediaAssetDetailDto = RealmModel<'MediaAssetDetailDto'>;

// ── Types ────────────────────────────────────────────────────

export type PostMediaItem = {
  type: 'IMAGE' | 'VIDEO' | 'AUDIO';
  assetId: string;
  url?: string;
  duration?: number;
  thumbnail?: string;
};

export type PostSummary = {
  id: string;
  caption: string;
  media: PostMediaItem[];
  tags: string[];
  authorId: string;
  worldId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaAssetSummary = {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'AUDIO';
  provider: string;
  status: string;
  storageRef: string;
  url: string | null;
  ownerKind: string;
  ownerId: string;
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
      media: Array.isArray(item.media)
        ? item.media.map((mediaItem: NonNullable<PostDto['media']>[number]) => {
            const rawType = String(mediaItem.type || 'IMAGE');
            const type: PostMediaItem['type'] = rawType === 'VIDEO'
              ? 'VIDEO'
              : rawType === 'AUDIO'
                ? 'AUDIO'
                : 'IMAGE';
            return {
              type,
              assetId: String(mediaItem.assetId || ''),
              url: mediaItem.url ? String(mediaItem.url) : undefined,
              duration: mediaItem.duration ? Number(mediaItem.duration) : undefined,
              thumbnail: mediaItem.thumbnail ? String(mediaItem.thumbnail) : undefined,
            };
          })
        : [],
      tags: Array.isArray(item.tags) ? item.tags.map((tag: string) => String(tag || '')) : [],
      authorId: String(item.authorId || item.userId || ''),
      worldId: item.worldId ? String(item.worldId) : null,
      createdAt: String(item.createdAt || ''),
      updatedAt: String(item.updatedAt || ''),
    }))
    .filter((item) => Boolean(item.id));
}

function toMediaAssetList(payload: MediaAssetsPayload): MediaAssetSummary[] {
  const items = Array.isArray(payload) ? payload : [];
  return items
    .map((item) => item as MediaAssetDetailDto)
    .map((item) => {
      const rawType = String(item.mediaType || 'IMAGE');
      const mediaType: MediaAssetSummary['mediaType'] = rawType === 'VIDEO'
        ? 'VIDEO'
        : rawType === 'AUDIO'
          ? 'AUDIO'
          : 'IMAGE';
      return {
        id: String(item.id || ''),
        mediaType,
        provider: String(item.provider || ''),
        status: String(item.status || ''),
        storageRef: String(item.storageRef || ''),
        url: item.url ? String(item.url) : null,
        ownerKind: String(item.ownerKind || ''),
        ownerId: String(item.ownerId || ''),
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

export function useMediaAssetsQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'content', 'media-assets'],
    enabled,
    retry: false,
    queryFn: async () => toMediaAssetList(await listMediaAssets()),
  });
}

export function useMediaAssetQuery(assetId: string) {
  return useQuery({
    queryKey: ['forge', 'content', 'media-asset', assetId],
    enabled: Boolean(assetId),
    retry: false,
      queryFn: async () => await getMediaAsset(assetId) as MediaAssetPayload,
  });
}
