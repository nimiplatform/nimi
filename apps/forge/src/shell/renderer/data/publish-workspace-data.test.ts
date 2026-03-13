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

const mod = await import('./publish-workspace-data.js');

describe('publish-workspace-data', () => {
  beforeEach(() => {
    storage.clear();
  });

  // ── 1. Default state (empty storage) ──────────────────────────────────

  describe('default state', () => {
    it('returns proper defaults when storage is empty', () => {
      const settings = mod.getPublishSettings();
      expect(settings.defaultIdentity).toBe('USER');
      expect(settings.defaultAgentId).toBeNull();
      expect(settings.channels.INTERNAL_FEED.enabled).toBe(true);
      expect(settings.channels.INTERNAL_AGENT_PROFILE.enabled).toBe(false);
    });

    it('returns empty drafts list when storage is empty', () => {
      const drafts = mod.listPublishDrafts();
      expect(drafts).toEqual([]);
    });
  });

  // ── 2. listPublishChannels ────────────────────────────────────────────

  describe('listPublishChannels', () => {
    it('returns exactly 2 channels', () => {
      const channels = mod.listPublishChannels();
      expect(channels).toHaveLength(2);
    });

    it('returns channels with correct shape', () => {
      const channels = mod.listPublishChannels();
      for (const channel of channels) {
        expect(channel).toHaveProperty('id');
        expect(channel).toHaveProperty('type');
        expect(channel).toHaveProperty('label');
        expect(channel).toHaveProperty('description');
        expect(channel).toHaveProperty('enabled');
        expect(typeof channel.label).toBe('string');
        expect(typeof channel.description).toBe('string');
        expect(typeof channel.enabled).toBe('boolean');
      }
    });

    it('INTERNAL_FEED is enabled by default', () => {
      const channels = mod.listPublishChannels();
      const feed = channels.find((c) => c.id === 'INTERNAL_FEED');
      expect(feed).toBeDefined();
      expect(feed!.enabled).toBe(true);
      expect(feed!.label).toBe('Internal Feed');
    });

    it('INTERNAL_AGENT_PROFILE is disabled by default', () => {
      const channels = mod.listPublishChannels();
      const agent = channels.find((c) => c.id === 'INTERNAL_AGENT_PROFILE');
      expect(agent).toBeDefined();
      expect(agent!.enabled).toBe(false);
      expect(agent!.label).toBe('Agent Profile');
    });
  });

  // ── 3. getPublishSettings ─────────────────────────────────────────────

  describe('getPublishSettings', () => {
    it('returns default settings from empty storage', () => {
      const settings = mod.getPublishSettings();
      expect(settings).toEqual({
        defaultIdentity: 'USER',
        defaultAgentId: null,
        channels: {
          INTERNAL_FEED: { enabled: true },
          INTERNAL_AGENT_PROFILE: { enabled: false },
        },
      });
    });
  });

  // ── 4. updatePublishSettings ──────────────────────────────────────────

  describe('updatePublishSettings', () => {
    it('persists defaultIdentity change', () => {
      mod.updatePublishSettings({ defaultIdentity: 'AGENT' });
      const settings = mod.getPublishSettings();
      expect(settings.defaultIdentity).toBe('AGENT');
    });

    it('persists defaultAgentId change', () => {
      mod.updatePublishSettings({ defaultAgentId: 'agent-42' });
      const settings = mod.getPublishSettings();
      expect(settings.defaultAgentId).toBe('agent-42');
    });

    it('clears defaultAgentId with null', () => {
      mod.updatePublishSettings({ defaultAgentId: 'agent-1' });
      mod.updatePublishSettings({ defaultAgentId: null });
      const settings = mod.getPublishSettings();
      expect(settings.defaultAgentId).toBeNull();
    });

    it('enables a disabled channel', () => {
      mod.updatePublishSettings({
        channels: { INTERNAL_AGENT_PROFILE: { enabled: true } },
      });
      const settings = mod.getPublishSettings();
      expect(settings.channels.INTERNAL_AGENT_PROFILE.enabled).toBe(true);
      // Verify INTERNAL_FEED was not affected
      expect(settings.channels.INTERNAL_FEED.enabled).toBe(true);
    });

    it('disables an enabled channel', () => {
      mod.updatePublishSettings({
        channels: { INTERNAL_FEED: { enabled: false } },
      });
      const settings = mod.getPublishSettings();
      expect(settings.channels.INTERNAL_FEED.enabled).toBe(false);
      // Verify INTERNAL_AGENT_PROFILE was not affected
      expect(settings.channels.INTERNAL_AGENT_PROFILE.enabled).toBe(false);
    });

    it('returns the updated settings', () => {
      const result = mod.updatePublishSettings({ defaultIdentity: 'AGENT' });
      expect(result.defaultIdentity).toBe('AGENT');
    });

    it('persists changes across reads', () => {
      mod.updatePublishSettings({
        defaultIdentity: 'AGENT',
        defaultAgentId: 'a-99',
        channels: {
          INTERNAL_FEED: { enabled: false },
          INTERNAL_AGENT_PROFILE: { enabled: true },
        },
      });
      const settings = mod.getPublishSettings();
      expect(settings.defaultIdentity).toBe('AGENT');
      expect(settings.defaultAgentId).toBe('a-99');
      expect(settings.channels.INTERNAL_FEED.enabled).toBe(false);
      expect(settings.channels.INTERNAL_AGENT_PROFILE.enabled).toBe(true);
    });

    it('writes to localStorage', () => {
      mod.updatePublishSettings({ defaultIdentity: 'AGENT' });
      const raw = storage.get('nimi:forge:publish-workspace');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.settings.defaultIdentity).toBe('AGENT');
    });
  });

  // ── 5. createPublishDraft ─────────────────────────────────────────────

  describe('createPublishDraft', () => {
    it('creates and returns a draft with an id', () => {
      const draft = mod.createPublishDraft({ title: 'My Draft' });
      expect(draft.id).toBeTruthy();
      expect(typeof draft.id).toBe('string');
    });

    it('sets timestamps on creation', () => {
      const before = new Date().toISOString();
      const draft = mod.createPublishDraft({ title: 'Timestamped' });
      const after = new Date().toISOString();
      expect(draft.createdAt).toBeTruthy();
      expect(draft.updatedAt).toBeTruthy();
      expect(draft.createdAt >= before).toBe(true);
      expect(draft.createdAt <= after).toBe(true);
      expect(draft.createdAt).toBe(draft.updatedAt);
    });

    it('sets status to DRAFT', () => {
      const draft = mod.createPublishDraft({ title: 'New' });
      expect(draft.status).toBe('DRAFT');
    });

    it('sets lastPublishedAt and lastPublishedPostId to null', () => {
      const draft = mod.createPublishDraft({ title: 'Fresh' });
      expect(draft.lastPublishedAt).toBeNull();
      expect(draft.lastPublishedPostId).toBeNull();
    });

    it('stores title, caption, tags, and media', () => {
      const draft = mod.createPublishDraft({
        title: '  Trimmed Title  ',
        caption: 'Some caption',
        tags: ['alpha', 'beta'],
        media: [{ assetId: 'img-1', type: 'IMAGE' }],
      });
      expect(draft.title).toBe('Trimmed Title');
      expect(draft.caption).toBe('Some caption');
      expect(draft.tags).toEqual(['alpha', 'beta']);
      expect(draft.media).toEqual([{ assetId: 'img-1', type: 'IMAGE' }]);
    });

    it('uses default identity from settings when not specified', () => {
      const draft = mod.createPublishDraft({ title: 'Default identity' });
      expect(draft.identity).toBe('USER');
    });

    it('uses AGENT identity when explicitly specified', () => {
      const draft = mod.createPublishDraft({ title: 'Agent post', identity: 'AGENT' });
      expect(draft.identity).toBe('AGENT');
    });

    it('uses default agentId from settings when not specified', () => {
      mod.updatePublishSettings({ defaultAgentId: 'agent-default' });
      const draft = mod.createPublishDraft({ title: 'With default agent' });
      expect(draft.agentId).toBe('agent-default');
    });

    it('uses specified agentId over default', () => {
      mod.updatePublishSettings({ defaultAgentId: 'agent-default' });
      const draft = mod.createPublishDraft({ title: 'Override', agentId: 'agent-override' });
      expect(draft.agentId).toBe('agent-override');
    });

    it('filters empty tags', () => {
      const draft = mod.createPublishDraft({ title: 'Tags', tags: ['good', '', 'also-good'] });
      expect(draft.tags).toEqual(['good', 'also-good']);
    });

    it('filters media without id', () => {
      const draft = mod.createPublishDraft({
        title: 'Media filter',
        media: [
          { assetId: 'valid', type: 'IMAGE' },
          { assetId: '', type: 'VIDEO' },
        ],
      });
      expect(draft.media).toEqual([{ assetId: 'valid', type: 'IMAGE' }]);
    });

    it('persists the draft to localStorage', () => {
      mod.createPublishDraft({ title: 'Persisted' });
      const raw = storage.get('nimi:forge:publish-workspace');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.drafts).toHaveLength(1);
      expect(parsed.drafts[0].title).toBe('Persisted');
    });
  });

  // ── 6. listPublishDrafts ──────────────────────────────────────────────

  describe('listPublishDrafts', () => {
    it('returns empty array when no drafts exist', () => {
      expect(mod.listPublishDrafts()).toEqual([]);
    });

    it('returns drafts sorted by updatedAt descending', () => {
      const d1 = mod.createPublishDraft({ title: 'First' });
      const d2 = mod.createPublishDraft({ title: 'Second' });
      const d3 = mod.createPublishDraft({ title: 'Third' });
      const list = mod.listPublishDrafts();
      expect(list).toHaveLength(3);
      const [first, second, third] = list;
      // Most recent first (createPublishDraft sets updatedAt = now, so d3 is newest)
      expect(first?.id).toBe(d3.id);
      expect(second?.id).toBe(d2.id);
      expect(third?.id).toBe(d1.id);
    });

    it('returns all drafts when status is undefined', () => {
      mod.createPublishDraft({ title: 'A' });
      mod.createPublishDraft({ title: 'B' });
      expect(mod.listPublishDrafts()).toHaveLength(2);
    });

    it('returns all drafts when status is ALL', () => {
      mod.createPublishDraft({ title: 'A' });
      mod.createPublishDraft({ title: 'B' });
      expect(mod.listPublishDrafts('ALL')).toHaveLength(2);
    });

    it('filters by DRAFT status', () => {
      const d1 = mod.createPublishDraft({ title: 'Draft One' });
      const d2 = mod.createPublishDraft({ title: 'Draft Two' });
      mod.markPublishDraftPublished(d1.id, 'post-1');

      const draftsOnly = mod.listPublishDrafts('DRAFT');
      expect(draftsOnly).toHaveLength(1);
      expect(draftsOnly[0]?.id).toBe(d2.id);
    });

    it('filters by PUBLISHED status', () => {
      const d1 = mod.createPublishDraft({ title: 'Draft One' });
      mod.createPublishDraft({ title: 'Draft Two' });
      mod.markPublishDraftPublished(d1.id, 'post-1');

      const published = mod.listPublishDrafts('PUBLISHED');
      expect(published).toHaveLength(1);
      expect(published[0]?.id).toBe(d1.id);
      expect(published[0]?.status).toBe('PUBLISHED');
    });
  });

  // ── 7. getPublishDraft ────────────────────────────────────────────────

  describe('getPublishDraft', () => {
    it('returns an existing draft', () => {
      const created = mod.createPublishDraft({ title: 'Find Me' });
      const found = mod.getPublishDraft(created.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Find Me');
      expect(found!.id).toBe(created.id);
    });

    it('returns null for a non-existent id', () => {
      const result = mod.getPublishDraft('does-not-exist');
      expect(result).toBeNull();
    });

    it('returns null when storage is empty', () => {
      expect(mod.getPublishDraft('any-id')).toBeNull();
    });
  });

  // ── 8. updatePublishDraft ─────────────────────────────────────────────

  describe('updatePublishDraft', () => {
    it('updates title', () => {
      const draft = mod.createPublishDraft({ title: 'Old Title' });
      const updated = mod.updatePublishDraft(draft.id, { title: 'New Title' });
      expect(updated.title).toBe('New Title');
    });

    it('updates caption', () => {
      const draft = mod.createPublishDraft({ title: 'Cap', caption: 'old' });
      const updated = mod.updatePublishDraft(draft.id, { caption: 'new caption' });
      expect(updated.caption).toBe('new caption');
    });

    it('updates tags', () => {
      const draft = mod.createPublishDraft({ title: 'Tags', tags: ['a'] });
      const updated = mod.updatePublishDraft(draft.id, { tags: ['b', 'c'] });
      expect(updated.tags).toEqual(['b', 'c']);
    });

    it('updates media', () => {
      const draft = mod.createPublishDraft({ title: 'Media' });
      const updated = mod.updatePublishDraft(draft.id, {
        media: [{ assetId: 'vid-1', type: 'VIDEO' }],
      });
      expect(updated.media).toEqual([{ assetId: 'vid-1', type: 'VIDEO' }]);
    });

    it('updates identity', () => {
      const draft = mod.createPublishDraft({ title: 'Identity' });
      const updated = mod.updatePublishDraft(draft.id, { identity: 'AGENT' });
      expect(updated.identity).toBe('AGENT');
    });

    it('updates agentId', () => {
      const draft = mod.createPublishDraft({ title: 'Agent' });
      const updated = mod.updatePublishDraft(draft.id, { agentId: 'agent-new' });
      expect(updated.agentId).toBe('agent-new');
    });

    it('clears agentId with null', () => {
      const draft = mod.createPublishDraft({ title: 'Clear Agent', agentId: 'agent-1' });
      const updated = mod.updatePublishDraft(draft.id, { agentId: null });
      expect(updated.agentId).toBeNull();
    });

    it('updates the updatedAt timestamp', () => {
      const draft = mod.createPublishDraft({ title: 'Timestamps' });
      const originalUpdatedAt = draft.updatedAt;
      // Small delay to ensure timestamp difference
      const updated = mod.updatePublishDraft(draft.id, { title: 'Updated' });
      expect(updated.updatedAt >= originalUpdatedAt).toBe(true);
    });

    it('preserves fields not in the patch', () => {
      const draft = mod.createPublishDraft({
        title: 'Preserve',
        caption: 'keep me',
        tags: ['tag1'],
      });
      const updated = mod.updatePublishDraft(draft.id, { title: 'Changed' });
      expect(updated.caption).toBe('keep me');
      expect(updated.tags).toEqual(['tag1']);
    });

    it('throws on non-existent draft', () => {
      expect(() => mod.updatePublishDraft('bad-id', { title: 'Nope' })).toThrow(
        'Publish draft not found',
      );
    });

    it('persists changes to localStorage', () => {
      const draft = mod.createPublishDraft({ title: 'Persist Update' });
      mod.updatePublishDraft(draft.id, { title: 'Updated Title' });
      const loaded = mod.getPublishDraft(draft.id);
      expect(loaded!.title).toBe('Updated Title');
    });
  });

  // ── 9. deletePublishDraft ─────────────────────────────────────────────

  describe('deletePublishDraft', () => {
    it('removes an existing draft', () => {
      const draft = mod.createPublishDraft({ title: 'To Delete' });
      expect(mod.listPublishDrafts()).toHaveLength(1);
      mod.deletePublishDraft(draft.id);
      expect(mod.listPublishDrafts()).toHaveLength(0);
    });

    it('does not throw when deleting non-existent id', () => {
      expect(() => mod.deletePublishDraft('nonexistent')).not.toThrow();
    });

    it('does not affect other drafts', () => {
      const d1 = mod.createPublishDraft({ title: 'Keep' });
      const d2 = mod.createPublishDraft({ title: 'Remove' });
      mod.deletePublishDraft(d2.id);
      const remaining = mod.listPublishDrafts();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe(d1.id);
    });

    it('getPublishDraft returns null after deletion', () => {
      const draft = mod.createPublishDraft({ title: 'Gone' });
      mod.deletePublishDraft(draft.id);
      expect(mod.getPublishDraft(draft.id)).toBeNull();
    });
  });

  // ── 10. markPublishDraftPublished ─────────────────────────────────────

  describe('markPublishDraftPublished', () => {
    it('sets status to PUBLISHED', () => {
      const draft = mod.createPublishDraft({ title: 'Publish Me' });
      const result = mod.markPublishDraftPublished(draft.id, 'post-abc');
      expect(result.status).toBe('PUBLISHED');
    });

    it('sets lastPublishedPostId', () => {
      const draft = mod.createPublishDraft({ title: 'Post ID' });
      const result = mod.markPublishDraftPublished(draft.id, 'post-xyz');
      expect(result.lastPublishedPostId).toBe('post-xyz');
    });

    it('sets lastPublishedAt to a valid ISO timestamp', () => {
      const before = new Date().toISOString();
      const draft = mod.createPublishDraft({ title: 'Timestamp' });
      const result = mod.markPublishDraftPublished(draft.id, 'post-1');
      const after = new Date().toISOString();
      expect(result.lastPublishedAt).toBeTruthy();
      expect(result.lastPublishedAt! >= before).toBe(true);
      expect(result.lastPublishedAt! <= after).toBe(true);
    });

    it('updates the updatedAt timestamp', () => {
      const draft = mod.createPublishDraft({ title: 'Update TS' });
      const result = mod.markPublishDraftPublished(draft.id, 'post-1');
      expect(result.updatedAt >= draft.updatedAt).toBe(true);
    });

    it('persists the published state', () => {
      const draft = mod.createPublishDraft({ title: 'Persist Publish' });
      mod.markPublishDraftPublished(draft.id, 'post-2');
      const loaded = mod.getPublishDraft(draft.id);
      expect(loaded!.status).toBe('PUBLISHED');
      expect(loaded!.lastPublishedPostId).toBe('post-2');
    });

    it('throws on non-existent draft', () => {
      expect(() => mod.markPublishDraftPublished('bad-id', 'post-1')).toThrow(
        'Publish draft not found',
      );
    });
  });

  // ── 11. listPublishDeliveries ─────────────────────────────────────────

  describe('listPublishDeliveries', () => {
    it('returns empty array for non-existent draft', () => {
      const deliveries = mod.listPublishDeliveries('nonexistent');
      expect(deliveries).toEqual([]);
    });

    it('returns rows only for enabled channels', () => {
      // Default: INTERNAL_FEED enabled, INTERNAL_AGENT_PROFILE disabled
      const draft = mod.createPublishDraft({ title: 'Deliveries' });
      const deliveries = mod.listPublishDeliveries(draft.id);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.channelId).toBe('INTERNAL_FEED');
    });

    it('returns rows for all enabled channels', () => {
      mod.updatePublishSettings({
        channels: { INTERNAL_AGENT_PROFILE: { enabled: true } },
      });
      const draft = mod.createPublishDraft({ title: 'All channels' });
      const deliveries = mod.listPublishDeliveries(draft.id);
      expect(deliveries).toHaveLength(2);
      const channelIds = deliveries.map((d) => d.channelId);
      expect(channelIds).toContain('INTERNAL_FEED');
      expect(channelIds).toContain('INTERNAL_AGENT_PROFILE');
    });

    it('returns no rows when all channels are disabled', () => {
      mod.updatePublishSettings({
        channels: { INTERNAL_FEED: { enabled: false } },
      });
      const draft = mod.createPublishDraft({ title: 'No channels' });
      const deliveries = mod.listPublishDeliveries(draft.id);
      expect(deliveries).toHaveLength(0);
    });

    it('delivery status is DRAFT for unpublished drafts', () => {
      const draft = mod.createPublishDraft({ title: 'Draft status' });
      const deliveries = mod.listPublishDeliveries(draft.id);
      expect(deliveries[0]?.status).toBe('DRAFT');
      expect(deliveries[0]?.publishedPostId).toBeNull();
      expect(deliveries[0]?.publishedAt).toBeNull();
    });

    it('delivery status is PUBLISHED for published drafts', () => {
      const draft = mod.createPublishDraft({ title: 'Published status' });
      mod.markPublishDraftPublished(draft.id, 'post-99');
      const deliveries = mod.listPublishDeliveries(draft.id);
      expect(deliveries[0]?.status).toBe('PUBLISHED');
      expect(deliveries[0]?.publishedPostId).toBe('post-99');
      expect(deliveries[0]?.publishedAt).toBeTruthy();
    });
  });

  // ── 12. Corrupted JSON in localStorage ────────────────────────────────

  describe('corrupted localStorage', () => {
    it('falls back to defaults when JSON is invalid', () => {
      storage.set('nimi:forge:publish-workspace', '{{{{not valid json');
      const settings = mod.getPublishSettings();
      expect(settings.defaultIdentity).toBe('USER');
      expect(settings.defaultAgentId).toBeNull();
      expect(settings.channels.INTERNAL_FEED.enabled).toBe(true);
      expect(settings.channels.INTERNAL_AGENT_PROFILE.enabled).toBe(false);
    });

    it('returns empty drafts when JSON is invalid', () => {
      storage.set('nimi:forge:publish-workspace', 'corrupted!');
      const drafts = mod.listPublishDrafts();
      expect(drafts).toEqual([]);
    });

    it('returns default channels when JSON is invalid', () => {
      storage.set('nimi:forge:publish-workspace', '<<garbage>>');
      const channels = mod.listPublishChannels();
      expect(channels).toHaveLength(2);
      expect(channels[0]?.enabled).toBe(true);
      expect(channels[1]?.enabled).toBe(false);
    });

    it('recovers after corrupted state is overwritten by a write', () => {
      storage.set('nimi:forge:publish-workspace', 'bad data');
      // Creating a draft should write valid state over corrupted data
      const draft = mod.createPublishDraft({ title: 'Recovery' });
      expect(draft.title).toBe('Recovery');
      const loaded = mod.getPublishDraft(draft.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBe('Recovery');
    });

    it('falls back to defaults when stored value is a non-object JSON literal', () => {
      storage.set('nimi:forge:publish-workspace', '"just a string"');
      const settings = mod.getPublishSettings();
      expect(settings.defaultIdentity).toBe('USER');
    });

    it('handles missing nested fields gracefully', () => {
      storage.set('nimi:forge:publish-workspace', JSON.stringify({ settings: null, drafts: null }));
      const settings = mod.getPublishSettings();
      expect(settings.defaultIdentity).toBe('USER');
      expect(settings.channels.INTERNAL_FEED.enabled).toBe(true);
      const drafts = mod.listPublishDrafts();
      expect(drafts).toEqual([]);
    });

    it('skips drafts with missing id', () => {
      storage.set(
        'nimi:forge:publish-workspace',
        JSON.stringify({
          settings: {},
          drafts: [
            { id: 'valid-1', title: 'Good' },
            { id: '', title: 'Empty ID' },
            { title: 'No ID field' },
          ],
        }),
      );
      const drafts = mod.listPublishDrafts();
      expect(drafts).toHaveLength(1);
      expect(drafts[0]?.id).toBe('valid-1');
    });
  });
});
