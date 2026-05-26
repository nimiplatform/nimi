import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const mockContentDataClient = vi.hoisted(() => ({
  createImageDirectUpload: vi.fn(),
  createVideoDirectUpload: vi.fn(),
  createAudioDirectUpload: vi.fn(),
  updateResource: vi.fn(),
  deleteResource: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  getHomeFeed: vi.fn(),
  getVideoToken: vi.fn(),
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

import { useContentMutations } from './use-content-mutations.js';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useContentMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all expected content and resource mutation objects', () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useContentMutations(), { wrapper });

    expect(result.current).toHaveProperty('imageUploadMutation');
    expect(result.current).toHaveProperty('videoUploadMutation');
    expect(result.current).toHaveProperty('audioUploadMutation');
    expect(result.current).toHaveProperty('updateResourceMutation');
    expect(result.current).toHaveProperty('deleteResourceMutation');
    expect(result.current).toHaveProperty('createPostMutation');
    expect(result.current).toHaveProperty('updatePostMutation');
    expect(result.current).toHaveProperty('deletePostMutation');
  });

  it('imageUploadMutation calls createImageDirectUpload', async () => {
    mockContentDataClient.createImageDirectUpload.mockResolvedValue({ uploadUrl: 'https://upload.example.com' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useContentMutations(), { wrapper });

    await act(async () => {
      result.current.imageUploadMutation.mutate(undefined);
    });

    await vi.waitFor(() => expect(result.current.imageUploadMutation.isSuccess).toBe(true));
    expect(mockContentDataClient.createImageDirectUpload).toHaveBeenCalled();
  });

  it('createPostMutation calls createPost with payload', async () => {
    mockContentDataClient.createPost.mockResolvedValue({ id: 'p1' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useContentMutations(), { wrapper });

    await act(async () => {
      result.current.createPostMutation.mutate({ caption: 'My post', attachments: [] });
    });

    await vi.waitFor(() => expect(result.current.createPostMutation.isSuccess).toBe(true));
    expect(mockContentDataClient.createPost).toHaveBeenCalledWith({ caption: 'My post', attachments: [] });
  });

  it('updateResourceMutation calls updateResource with resource id and payload', async () => {
    mockContentDataClient.updateResource.mockResolvedValue({ id: 'resource-1' });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useContentMutations(), { wrapper });

    await act(async () => {
      result.current.updateResourceMutation.mutate({ resourceId: 'resource-1', payload: { title: 'Updated' } });
    });

    await vi.waitFor(() => expect(result.current.updateResourceMutation.isSuccess).toBe(true));
    expect(mockContentDataClient.updateResource).toHaveBeenCalledWith('resource-1', { title: 'Updated' });
  });

  it('deleteResourceMutation calls deleteResource with resource id', async () => {
    mockContentDataClient.deleteResource.mockResolvedValue(undefined);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useContentMutations(), { wrapper });

    await act(async () => {
      result.current.deleteResourceMutation.mutate('resource-1');
    });

    await vi.waitFor(() => expect(result.current.deleteResourceMutation.isSuccess).toBe(true));
    expect(mockContentDataClient.deleteResource).toHaveBeenCalledWith('resource-1');
  });

  it('updatePostMutation calls updatePost with postId and payload', async () => {
    mockContentDataClient.updatePost.mockResolvedValue({});

    const wrapper = createWrapper();
    const { result } = renderHook(() => useContentMutations(), { wrapper });

    await act(async () => {
      result.current.updatePostMutation.mutate({ postId: 'p1', payload: { caption: 'Updated' } });
    });

    await vi.waitFor(() => expect(result.current.updatePostMutation.isSuccess).toBe(true));
    expect(mockContentDataClient.updatePost).toHaveBeenCalledWith('p1', { caption: 'Updated' });
  });

  it('deletePostMutation calls deletePost with postId', async () => {
    mockContentDataClient.deletePost.mockResolvedValue({});

    const wrapper = createWrapper();
    const { result } = renderHook(() => useContentMutations(), { wrapper });

    await act(async () => {
      result.current.deletePostMutation.mutate('p1');
    });

    await vi.waitFor(() => expect(result.current.deletePostMutation.isSuccess).toBe(true));
    expect(mockContentDataClient.deletePost).toHaveBeenCalledWith('p1');
  });
});
