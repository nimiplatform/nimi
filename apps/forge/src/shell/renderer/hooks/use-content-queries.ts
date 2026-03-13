/**
 * Forge Content Resource Queries (FG-CONTENT-001..007)
 */

import { useQuery } from '@tanstack/react-query';
import {
  getHomeFeed,
  getMediaAsset,
} from '@renderer/data/content-data-client.js';

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

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

// ── Normalizers ──────────────────────────────────────────────

function toPostList(payload: unknown): PostSummary[] {
  const record = toRecord(payload);
  const items = Array.isArray(record.items) ? (record.items as unknown[])
    : Array.isArray(payload) ? (payload as unknown[])
    : [];
  return items
    .map((item) => toRecord(item))
    .map((item) => ({
      id: String(item.id || ''),
      caption: String(item.caption || ''),
      media: Array.isArray(item.media)
        ? (item.media as unknown[]).map((m) => {
            const mr = toRecord(m);
            const rawType = String(mr.type || 'IMAGE');
            const type: PostMediaItem['type'] = rawType === 'VIDEO'
              ? 'VIDEO'
              : rawType === 'AUDIO'
                ? 'AUDIO'
                : 'IMAGE';
            return {
              type,
              assetId: String(mr.assetId || ''),
              url: mr.url ? String(mr.url) : undefined,
              duration: mr.duration ? Number(mr.duration) : undefined,
              thumbnail: mr.thumbnail ? String(mr.thumbnail) : undefined,
            };
          })
        : [],
      tags: Array.isArray(item.tags) ? (item.tags as unknown[]).map((t) => String(t || '')) : [],
      authorId: String(item.authorId || item.userId || ''),
      worldId: item.worldId ? String(item.worldId) : null,
      createdAt: String(item.createdAt || ''),
      updatedAt: String(item.updatedAt || ''),
    }))
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

export function useMediaAssetQuery(assetId: string) {
  return useQuery({
    queryKey: ['forge', 'content', 'media-asset', assetId],
    enabled: Boolean(assetId),
    retry: false,
    queryFn: async () => toRecord(await getMediaAsset(assetId)),
  });
}
