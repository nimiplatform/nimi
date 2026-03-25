import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockContentDataClient = vi.hoisted(() => ({
  getHomeFeed: vi.fn(),
  listResources: vi.fn(),
  getResource: vi.fn(),
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

import { useCreatorPostsQuery, useResourceQuery, useResourcesQuery } from './use-content-queries.js';

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
          attachments: [{ targetType: 'RESOURCE', targetId: 'resource-img1', displayKind: 'IMAGE' }],
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
    expect(firstPost?.attachments[0]).toMatchObject({
      targetType: 'RESOURCE',
      targetId: 'resource-img1',
      displayKind: 'IMAGE',
    });
  });

  it('preserves AUDIO media items from the feed payload', async () => {
    mockContentDataClient.getHomeFeed.mockResolvedValue({
      items: [
        {
          id: 'p-audio',
          caption: 'Theme song',
          attachments: [{ targetType: 'RESOURCE', targetId: 'resource-audio1', displayKind: 'AUDIO', duration: 60 }],
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

    expect(result.current.data?.[0]?.attachments[0]).toMatchObject({
      targetType: 'RESOURCE',
      targetId: 'resource-audio1',
      displayKind: 'AUDIO',
      duration: 60,
    });
  });

  it('preserves nested preview attachments for card-backed feed items', async () => {
    mockContentDataClient.getHomeFeed.mockResolvedValue({
      items: [
        {
          id: 'p-card',
          caption: 'Original release',
          attachments: [{
            targetType: 'ASSET',
            targetId: 'asset-1',
            displayKind: 'CARD',
            title: 'Original Song',
            subtitle: 'TRACK',
            preview: {
              targetType: 'RESOURCE',
              targetId: 'resource-preview-1',
              displayKind: 'IMAGE',
              url: 'https://cdn.example.com/preview.jpg',
            },
          }],
          tags: ['music'],
          authorId: 'user-card',
          worldId: null,
          createdAt: '2026-03-01',
          updatedAt: '2026-03-01',
        },
      ],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCreatorPostsQuery(undefined, true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0]?.attachments[0]).toMatchObject({
      targetType: 'ASSET',
      targetId: 'asset-1',
      displayKind: 'CARD',
      title: 'Original Song',
      subtitle: 'TRACK',
      preview: {
        targetType: 'RESOURCE',
        targetId: 'resource-preview-1',
        displayKind: 'IMAGE',
        url: 'https://cdn.example.com/preview.jpg',
      },
    });
  });

  it('fails closed when feed attachments contain an invalid targetType', async () => {
    mockContentDataClient.getHomeFeed.mockResolvedValue({
      items: [
        {
          id: 'p-invalid',
          caption: 'Broken payload',
          attachments: [{ targetType: 'LEGACY_RESOURCE', targetId: 'legacy-1', displayKind: 'IMAGE' }],
          tags: [],
          authorId: 'user-invalid',
          worldId: null,
          createdAt: '2026-03-01',
          updatedAt: '2026-03-01',
        },
      ],
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useCreatorPostsQuery(undefined, true), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe('forge-content-invalid-attachment-target-type');
  });

  it('toPostList normalizer handles array payload (not wrapped in { items })', async () => {
    mockContentDataClient.getHomeFeed.mockResolvedValue([
      {
        id: 'p2',
        caption: 'Direct array',
        attachments: [],
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
        { id: 'p3', caption: 'Wrapped', attachments: [], tags: [], authorId: 'u3', createdAt: '', updatedAt: '' },
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

describe('useResourceQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses resourceId in key and is enabled when resourceId is truthy', async () => {
    mockContentDataClient.getResource.mockResolvedValue({ id: 'resource-v1', url: 'https://stream.example.com/v1' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useResourceQuery('resource-v1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockContentDataClient.getResource).toHaveBeenCalledWith('resource-v1');
    expect(result.current.data).toMatchObject({ id: 'resource-v1', url: 'https://stream.example.com/v1' });
  });

  it('is disabled when resourceId is empty', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useResourceQuery(''), { wrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockContentDataClient.getResource).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useResourcesQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes resource list payload from the resource endpoint', async () => {
    mockContentDataClient.listResources.mockResolvedValue([
      {
        id: 'resource-1',
        resourceType: 'VIDEO',
        provider: 'CF_STREAM',
        status: 'READY',
        storageRef: 'video-cf-1',
        url: 'https://stream.example.com/v1',
        controllerKind: 'WORLD',
        controllerId: 'world-1',
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
    const { result } = renderHook(() => useResourcesQuery(true), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockContentDataClient.listResources).toHaveBeenCalledWith();
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'resource-1',
        resourceType: 'VIDEO',
        controllerKind: 'WORLD',
        controllerId: 'world-1',
        deliveryAccess: 'SIGNED',
        title: 'Launch Trailer',
      }),
    ]);
  });
});
