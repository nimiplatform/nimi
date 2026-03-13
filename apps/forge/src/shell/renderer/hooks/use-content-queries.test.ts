import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockContentDataClient = vi.hoisted(() => ({
  getHomeFeed: vi.fn(),
  getVideoToken: vi.fn(),
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

import { useCreatorPostsQuery, useVideoTokenQuery } from './use-content-queries.js';

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
          media: [{ id: 'img1', type: 'IMAGE' }],
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

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0]).toMatchObject({
      id: 'p1',
      caption: 'Hello world',
      tags: ['fantasy'],
    });
    expect(result.current.data![0].media[0]).toMatchObject({ id: 'img1', type: 'IMAGE' });
  });

  it('preserves AUDIO media items from the feed payload', async () => {
    mockContentDataClient.getHomeFeed.mockResolvedValue({
      items: [
        {
          id: 'p-audio',
          caption: 'Theme song',
          media: [{ id: 'audio1', type: 'AUDIO', duration: 60 }],
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
      id: 'audio1',
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

    expect(result.current.data).toHaveLength(1);
    // authorId falls back to userId
    expect(result.current.data![0].authorId).toBe('user2');
    expect(result.current.data![0].worldId).toBe('w1');
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
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].id).toBe('p3');
  });
});

describe('useVideoTokenQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses uid in key and is enabled when uid is truthy', async () => {
    mockContentDataClient.getVideoToken.mockResolvedValue({ token: 'abc123' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useVideoTokenQuery('vid-uid-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockContentDataClient.getVideoToken).toHaveBeenCalledWith('vid-uid-1');
    expect(result.current.data).toMatchObject({ token: 'abc123' });
  });

  it('is disabled when uid is empty', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useVideoTokenQuery(''), { wrapper });

    await new Promise((r) => setTimeout(r, 50));
    expect(mockContentDataClient.getVideoToken).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});
