import { describe, it, expect, vi, beforeEach } from 'vitest';

const storage = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
});

const mockMediaService = {
  createImageDirectUpload: vi.fn(),
  createVideoDirectUpload: vi.fn(),
  getVideoToken: vi.fn(),
};

const mockPostService = {
  createPost: vi.fn(),
  getHomeFeed: vi.fn(),
  getPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
};

const mockWorldpostService = {
  getWorldPosts: vi.fn(),
};

vi.mock('@runtime/platform-client.js', () => ({
  getPlatformClient: () => ({
    realm: {
      services: {
        MediaService: mockMediaService,
        PostService: mockPostService,
        WorldpostService: mockWorldpostService,
      },
    },
  }),
}));

const cdc = await import('./content-data-client.js');

describe('content-data-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
  });

  describe('media upload', () => {
    it('createImageDirectUpload calls MediaService', async () => {
      mockMediaService.createImageDirectUpload.mockResolvedValue({ uploadUrl: 'https://up', imageId: 'i1' });
      const result = await cdc.createImageDirectUpload();
      expect(mockMediaService.createImageDirectUpload).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ uploadUrl: 'https://up', imageId: 'i1' });
    });

    it('createVideoDirectUpload calls MediaService', async () => {
      mockMediaService.createVideoDirectUpload.mockResolvedValue({ uploadUrl: 'https://up', uid: 'v1' });
      const result = await cdc.createVideoDirectUpload();
      expect(mockMediaService.createVideoDirectUpload).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ uploadUrl: 'https://up', uid: 'v1' });
    });

    it('getVideoToken calls with uid', async () => {
      mockMediaService.getVideoToken.mockResolvedValue({ token: 'tok123' });
      const result = await cdc.getVideoToken('v1');
      expect(mockMediaService.getVideoToken).toHaveBeenCalledWith('v1');
      expect(result).toEqual({ token: 'tok123' });
    });
  });

  describe('posts', () => {
    it('createPost passes payload', async () => {
      const payload = { content: 'Hello' };
      await cdc.createPost(payload);
      expect(mockPostService.createPost).toHaveBeenCalledWith(payload);
    });

    it('getHomeFeed passes params', async () => {
      await cdc.getHomeFeed({ worldId: 'w1', limit: 10 });
      expect(mockPostService.getHomeFeed).toHaveBeenCalledWith(undefined, 'w1', undefined, 10, undefined);
    });

    it('getPost passes postId', async () => {
      await cdc.getPost('p1');
      expect(mockPostService.getPost).toHaveBeenCalledWith('p1', undefined);
    });

    it('updatePost passes postId and payload', async () => {
      await cdc.updatePost('p1', { content: 'Updated' });
      expect(mockPostService.updatePost).toHaveBeenCalledWith('p1', { content: 'Updated' });
    });

    it('deletePost passes postId', async () => {
      await cdc.deletePost('p1');
      expect(mockPostService.deletePost).toHaveBeenCalledWith('p1');
    });

    it('getWorldPosts passes worldId and params', async () => {
      await cdc.getWorldPosts('w1', { limit: 5 });
      expect(mockWorldpostService.getWorldPosts).toHaveBeenCalledWith('w1', undefined, undefined, 5, undefined);
    });
  });

  describe('publishing workspace', () => {
    it('listPublishingChannels returns local defaults', async () => {
      await cdc.updateChannel('INTERNAL_AGENT_PROFILE', {
        enabled: true,
        defaultIdentity: 'AGENT',
        defaultAgentId: 'agent-1',
      });

      const result = await cdc.listPublishingChannels() as Array<Record<string, unknown>>;
      expect(result).toHaveLength(2);
      expect(result[0]?.defaultIdentity).toBe('AGENT');
      expect(result[0]?.defaultAgentId).toBe('agent-1');
      expect(result[1]?.enabled).toBe(true);
    });

    it('createRelease persists a local draft', async () => {
      const draft = await cdc.createRelease({
        title: 'Draft 1',
        caption: 'hello',
        tags: ['tag-a'],
        media: [{ id: 'img-1', type: 'IMAGE' }],
      }) as Record<string, unknown>;

      expect(draft.id).toBeTruthy();
      const drafts = await cdc.listReleases() as Array<Record<string, unknown>>;
      expect(drafts).toHaveLength(1);
      expect(drafts[0]?.title).toBe('Draft 1');
    });

    it('getRelease returns an existing draft', async () => {
      const draft = await cdc.createRelease({ title: 'Draft 2' }) as Record<string, unknown>;
      const loaded = await cdc.getRelease(String(draft.id));
      expect(loaded).toMatchObject({ title: 'Draft 2' });
    });

    it('updateRelease updates an existing draft', async () => {
      const draft = await cdc.createRelease({ title: 'Draft 3' }) as Record<string, unknown>;
      const updated = await cdc.updateRelease(String(draft.id), {
        caption: 'updated caption',
        tags: ['x', 'y'],
      }) as Record<string, unknown>;

      expect(updated.caption).toBe('updated caption');
      expect(updated.tags).toEqual(['x', 'y']);
    });

    it('publishRelease creates a post and marks draft published', async () => {
      mockPostService.createPost.mockResolvedValue({ id: 'post-1' });
      const draft = await cdc.createRelease({
        title: 'Draft 4',
        caption: 'ready',
        tags: ['alpha'],
        media: [{ id: 'img-2', type: 'IMAGE' }],
      }) as Record<string, unknown>;

      const published = await cdc.publishRelease(String(draft.id)) as Record<string, unknown>;

      expect(mockPostService.createPost).toHaveBeenCalledWith({
        media: [{ id: 'img-2', type: 'IMAGE' }],
        caption: 'ready',
        tags: ['alpha'],
      });
      expect(published.status).toBe('PUBLISHED');
      expect(published.lastPublishedPostId).toBe('post-1');
    });

    it('publishRelease rejects agent drafts for now', async () => {
      const draft = await cdc.createRelease({
        identity: 'AGENT',
        agentId: 'agent-2',
        media: [{ id: 'img-3', type: 'IMAGE' }],
      }) as Record<string, unknown>;

      await expect(cdc.publishRelease(String(draft.id))).rejects.toThrow('Agent-identity publishing requires platform agent-post capability');
    });

    it('listDeliveries derives local delivery rows', async () => {
      mockPostService.createPost.mockResolvedValue({ id: 'post-2' });
      await cdc.updateChannel('INTERNAL_AGENT_PROFILE', { enabled: true });
      const draft = await cdc.createRelease({
        media: [{ id: 'img-4', type: 'IMAGE' }],
      }) as Record<string, unknown>;
      await cdc.publishRelease(String(draft.id));

      const deliveries = await cdc.listDeliveries(String(draft.id)) as Array<Record<string, unknown>>;
      expect(deliveries).toHaveLength(2);
      expect(deliveries[0]?.status).toBe('PUBLISHED');
    });

    it('connectChannel enables a local channel', async () => {
      await cdc.connectChannel('INTERNAL_AGENT_PROFILE');
      const channels = await cdc.listPublishingChannels() as Array<Record<string, unknown>>;
      expect(channels.find((item) => item.id === 'INTERNAL_AGENT_PROFILE')?.enabled).toBe(true);
    });

    it('updateChannel persists defaults and enabled state', async () => {
      await cdc.updateChannel('INTERNAL_FEED', {
        enabled: false,
        defaultIdentity: 'AGENT',
        defaultAgentId: 'agent-9',
      });

      const channels = await cdc.listPublishingChannels() as Array<Record<string, unknown>>;
      expect(channels.find((item) => item.id === 'INTERNAL_FEED')?.enabled).toBe(false);
      expect(channels[0]?.defaultIdentity).toBe('AGENT');
      expect(channels[0]?.defaultAgentId).toBe('agent-9');
    });

    it('updateRelease deletes a draft when delete flag is set', async () => {
      const draft = await cdc.createRelease({ title: 'Draft 5' }) as Record<string, unknown>;
      await cdc.updateRelease(String(draft.id), { delete: true });
      const drafts = await cdc.listReleases() as Array<Record<string, unknown>>;
      expect(drafts).toHaveLength(0);
    });
  });
});
