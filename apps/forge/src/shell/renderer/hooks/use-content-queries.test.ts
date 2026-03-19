import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockContentDataClient = vi.hoisted(() => ({
  getHomeFeed: vi.fn(),
  listMediaAssets: vi.fn(),
  getMediaAsset: vi.fn(),
  createImageDirectUpload: vi.fn(),
  createVideoDirectUpload: vi.fn(),
  createAudioDirectUpload: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  getPost: vi.fn(),
  getWorldPosts: vi.fn(),
  listPublishingChannels: vi.fn(),
  listReleases: vi.fn(),
  createRelease: vi.fn(),
  getRelease: vi.fn(),
  updateRelease: vi.fn(),
  publishRelease: vi.fn(),
  listDeliveries: vi.fn(),
  connectChannel: vi.fn(),
  updateChannel: vi.fn(),
}));

vi.mock('@renderer/data/content-data-client.js', () => mockContentDataClient);

import { useCreatorPostsQuery, useMediaAssetQuery, useMediaAssetsQuery } from './use-content-queries.js';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useCreatorPostsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns query and fetches posts', async () => {
    mockContentDataClient.getHomeFeed.mockResolvedValue({
      items: [
        {
          id: 'p1',
          caption: 'Hello world',
          media: [{ assetId: 'asset-img1', type: 'IMAGE' }],
          tags: ['fantasy'],
          authorId: 'user1',
          worldId: null,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCreatorPostsQuery(undefined, true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data ?? [];
    expect(data).toHaveLength(1);
    const [firstPost] = data;
    expect(firstPost).toMatchObject({
      id: 'p1',
      caption: 'Hello world',
      tags: ['fantasy'],
    });
    expect(firstPost?.media[0]).toMatchObject({ assetId: 'asset-img1', type: 'IMAGE' });
  });

  it('preserves AUDIO media items from the feed payload', async () => {
    mockContentDataClient.getHomeFeed.mockResolvedValue({
      items: [
        {
          id: 'p-audio',
          caption: 'Theme song',
          media: [{ assetId: 'asset-audio1', type: 'AUDIO', duration: 60 }],
          tags: ['cinematic'],
          authorId: 'user-audio',
          worldId: null,
          createdAt: '2026-03-01',
          updatedAt: '2026-03-01',
        },
      ],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCreatorPostsQuery(undefined, true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0]?.media[0]).toMatchObject({
      assetId: 'asset-audio1',
      type: 'AUDIO',
      duration: 60,
    });
  });

  it('toPostList normalizer handles array payload (not wrapped in { items })', async () => {
    mockContentDataClient.getHomeFeed.mockResolvedValue([
      {
        id: 'p2',
        caption: 'Direct array',
        media: [],
        tags: [],
        userId: 'user2',
        worldId: 'w1',
        createdAt: '2026-02-01',
        updatedAt: '2026-02-01',
      },
    ]);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCreatorPostsQuery(undefined, true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data ?? [];
    expect(data).toHaveLength(1);
    // authorId falls back to userId
    const [firstPost] = data;
    expect(firstPost?.authorId).toBe('user2');
    expect(firstPost?.worldId).toBe('w1');
  });

  it('toPostList normalizer handles { items: [...] } payload', async () => {
    mockContentDataClient.getHomeFeed.mockResolvedValue({
      items: [
        { id: 'p3', caption: 'Wrapped', media: [], tags: [], authorId: 'u3', createdAt: '', updatedAt: '' },
      ],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCreatorPostsQuery(undefined, true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data ?? [];
    expect(data).toHaveLength(1);
    expect(data[0]?.id).toBe('p3');
  });
});

describe('useMediaAssetQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses assetId in key and is enabled when assetId is truthy', async () => {
    mockContentDataClient.getMediaAsset.mockResolvedValue({ id: 'asset-v1', url: 'https://stream.example.com/v1' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useMediaAssetQuery('asset-v1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockContentDataClient.getMediaAsset).toHaveBeenCalledWith('asset-v1');
    expect(result.current.data).toMatchObject({ id: 'asset-v1', url: 'https://stream.example.com/v1' });
  });

  it('is disabled when assetId is empty', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useMediaAssetQuery(''), { wrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockContentDataClient.getMediaAsset).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useMediaAssetsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes media asset list payload from the asset endpoint', async () => {
    mockContentDataClient.listMediaAssets.mockResolvedValue([
      {
        id: 'asset-1',
        mediaType: 'VIDEO',
        provider: 'CF_STREAM',
        status: 'READY',
        storageRef: 'video-cf-1',
        url: 'https://stream.example.com/v1',
        ownerKind: 'WORLD',
        ownerId: 'world-1',
        deliveryAccess: 'SIGNED',
        title: 'Launch Trailer',
        label: 'Trailer',
        tags: ['launch'],
        worldId: 'world-1',
        agentId: null,
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
      },
    ]);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useMediaAssetsQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockContentDataClient.listMediaAssets).toHaveBeenCalledWith();
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'asset-1',
        mediaType: 'VIDEO',
        ownerKind: 'WORLD',
        ownerId: 'world-1',
        deliveryAccess: 'SIGNED',
        title: 'Launch Trailer',
      }),
    ]);
  });
});
