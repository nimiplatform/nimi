import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListMyWorlds = vi.fn();
const mockGetWorldDetailWithAgents = vi.fn();
const mockGetWorldview = vi.fn();
const mockGetWorldScenes = vi.fn();
const mockGetWorldLorebooks = vi.fn();

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    realm: {
      services: {
        WorldControlService: {
          worldControlControllerListMyWorlds: (...args: unknown[]) => mockListMyWorlds(...args),
        },
        WorldsService: {
          worldControllerGetWorldDetailWithAgents: (...args: unknown[]) => mockGetWorldDetailWithAgents(...args),
          worldControllerGetWorldview: (...args: unknown[]) => mockGetWorldview(...args),
          worldControllerGetWorldScenes: (...args: unknown[]) => mockGetWorldScenes(...args),
          worldControllerGetWorldLorebooks: (...args: unknown[]) => mockGetWorldLorebooks(...args),
        },
      },
    },
  }),
}));

import {
  listMyWorlds,
  getWorldDetailWithAgents,
  getWorldview,
  listWorldScenes,
  listWorldLorebooks,
} from './world-browser-data.js';

describe('listMyWorlds', () => {
  beforeEach(() => {
    mockListMyWorlds.mockReset();
  });

  it('returns mapped WorldSummary[] from API response with worlds wrapper', async () => {
    mockListMyWorlds.mockResolvedValue({
      worlds: [
        { id: 'w1', name: 'Eldoria', description: 'A fantasy realm', agentCount: 3 },
        { id: 'w2', name: 'Nexus', description: 'Sci-fi hub', agentCount: 5 },
      ],
    });

    const result = await listMyWorlds();

    expect(mockListMyWorlds).toHaveBeenCalledWith();
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('w1');
    expect(result[0]!.name).toBe('Eldoria');
    expect(result[1]!.id).toBe('w2');
    expect(result[1]!.name).toBe('Nexus');
  });

  it('returns mapped WorldSummary[] from API response with items wrapper', async () => {
    mockListMyWorlds.mockResolvedValue({
      items: [
        { id: 'w3', name: 'Arcadia', agentCount: 1 },
      ],
    });

    const result = await listMyWorlds();

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('w3');
    expect(result[0]!.name).toBe('Arcadia');
  });

  it('returns empty array when response is not an array', async () => {
    mockListMyWorlds.mockResolvedValue({ message: 'unexpected shape' });

    const result = await listMyWorlds();

    expect(result).toEqual([]);
  });

  it('maps all fields correctly including bannerUrl/iconUrl fallback field names', async () => {
    mockListMyWorlds.mockResolvedValue({
      worlds: [
        {
          id: 'w4',
          name: 'Realm One',
          description: 'Desc',
          genre: 'Fantasy',
          era: 'Medieval',
          themes: ['magic', 'dragons'],
          status: 'active',
          banner: 'https://example.com/banner.jpg',
          icon: 'https://example.com/icon.png',
          agentsCount: 7,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-06-01T00:00:00Z',
        },
      ],
    });

    const result = await listMyWorlds();
    const world = result[0]!;

    expect(world.id).toBe('w4');
    expect(world.name).toBe('Realm One');
    expect(world.description).toBe('Desc');
    expect(world.genre).toBe('Fantasy');
    expect(world.era).toBe('Medieval');
    expect(world.themes).toEqual(['magic', 'dragons']);
    expect(world.status).toBe('active');
    expect(world.bannerUrl).toBe('https://example.com/banner.jpg');
    expect(world.iconUrl).toBe('https://example.com/icon.png');
    expect(world.agentCount).toBe(7);
    expect(world.createdAt).toBe('2025-01-01T00:00:00Z');
    expect(world.updatedAt).toBe('2025-06-01T00:00:00Z');
  });

  it('handles missing optional fields gracefully', async () => {
    mockListMyWorlds.mockResolvedValue({
      worlds: [
        { id: 'w5', name: 'Bare World' },
      ],
    });

    const result = await listMyWorlds();
    const world = result[0]!;

    expect(world.id).toBe('w5');
    expect(world.name).toBe('Bare World');
    expect(world.description).toBeUndefined();
    expect(world.genre).toBeUndefined();
    expect(world.era).toBeUndefined();
    expect(world.themes).toEqual([]);
    expect(world.status).toBeUndefined();
    expect(world.bannerUrl).toBeUndefined();
    expect(world.iconUrl).toBeUndefined();
    expect(world.agentCount).toBe(0);
    expect(world.createdAt).toBeUndefined();
    expect(world.updatedAt).toBeUndefined();
  });
});

describe('getWorldDetailWithAgents', () => {
  beforeEach(() => {
    mockGetWorldDetailWithAgents.mockReset();
  });

  it('maps world detail and agents correctly', async () => {
    mockGetWorldDetailWithAgents.mockResolvedValue({
      id: 'w1',
      name: 'Eldoria',
      description: 'A mystical realm',
      genre: 'Fantasy',
      era: 'Medieval',
      themes: ['magic'],
      bannerUrl: 'https://example.com/banner.jpg',
      iconUrl: 'https://example.com/icon.png',
      agents: [
        { id: 'a1', name: 'Gandara', handle: 'gandara', bio: 'Wise wizard', avatarUrl: 'https://example.com/avatar.png', ownerType: 'system' },
        { id: 'a2', name: 'Elara', handle: 'elara', bio: 'Forest guardian' },
      ],
    });

    const result = await getWorldDetailWithAgents('w1');

    expect(mockGetWorldDetailWithAgents).toHaveBeenCalledWith('w1', 4);
    expect(result.id).toBe('w1');
    expect(result.name).toBe('Eldoria');
    expect(result.description).toBe('A mystical realm');
    expect(result.genre).toBe('Fantasy');
    expect(result.era).toBe('Medieval');
    expect(result.themes).toEqual(['magic']);
    expect(result.bannerUrl).toBe('https://example.com/banner.jpg');
    expect(result.iconUrl).toBe('https://example.com/icon.png');
    expect(result.agents).toHaveLength(2);
    expect(result.agents[0]!.id).toBe('a1');
    expect(result.agents[0]!.name).toBe('Gandara');
    expect(result.agents[0]!.handle).toBe('gandara');
    expect(result.agents[0]!.bio).toBe('Wise wizard');
    expect(result.agents[0]!.avatarUrl).toBe('https://example.com/avatar.png');
    expect(result.agents[0]!.ownerType).toBe('system');
  });

  it('maps agent bio fallback from description field', async () => {
    mockGetWorldDetailWithAgents.mockResolvedValue({
      id: 'w2',
      name: 'World Two',
      agents: [
        { id: 'a3', name: 'Shadow', description: 'A mysterious figure' },
      ],
    });

    const result = await getWorldDetailWithAgents('w2');

    expect(result.agents[0]!.bio).toBe('A mysterious figure');
  });

  it('returns empty agents array when none present', async () => {
    mockGetWorldDetailWithAgents.mockResolvedValue({
      id: 'w3',
      name: 'Empty World',
    });

    const result = await getWorldDetailWithAgents('w3');

    expect(result.agents).toEqual([]);
  });
});

describe('getWorldview', () => {
  beforeEach(() => {
    mockGetWorldview.mockReset();
  });

  it('returns all worldview fields when present', async () => {
    mockGetWorldview.mockResolvedValue({
      description: 'A vast continent',
      lore: 'Ancient legends speak of...',
      geography: 'Mountains and rivers',
      culture: 'Diverse kingdoms',
      history: 'Founded in the first age',
      spaceTopology: 'Connected realms',
      coreSystem: 'Magic-based economy',
      causality: 'Deterministic',
      tone: 'Epic and somber',
    });

    const result = await getWorldview('w1');

    expect(mockGetWorldview).toHaveBeenCalledWith('w1');
    expect(result.description).toBe('A vast continent');
    expect(result.lore).toBe('Ancient legends speak of...');
    expect(result.geography).toBe('Mountains and rivers');
    expect(result.culture).toBe('Diverse kingdoms');
    expect(result.history).toBe('Founded in the first age');
    expect(result.spaceTopology).toBe('Connected realms');
    expect(result.coreSystem).toBe('Magic-based economy');
    expect(result.causality).toBe('Deterministic');
    expect(result.tone).toBe('Epic and somber');
  });

  it('returns undefined for missing optional fields', async () => {
    mockGetWorldview.mockResolvedValue({
      description: 'Only description provided',
    });

    const result = await getWorldview('w2');

    expect(result.description).toBe('Only description provided');
    expect(result.lore).toBeUndefined();
    expect(result.geography).toBeUndefined();
    expect(result.culture).toBeUndefined();
    expect(result.history).toBeUndefined();
    expect(result.spaceTopology).toBeUndefined();
    expect(result.coreSystem).toBeUndefined();
    expect(result.causality).toBeUndefined();
    expect(result.tone).toBeUndefined();
  });
});

describe('listWorldScenes', () => {
  beforeEach(() => {
    mockGetWorldScenes.mockReset();
  });

  it('returns mapped scenes from scenes wrapper', async () => {
    mockGetWorldScenes.mockResolvedValue({
      scenes: [
        { id: 's1', name: 'Castle Hall', description: 'Grand entrance', imageUrl: 'https://example.com/hall.jpg' },
        { id: 's2', name: 'Dark Forest', description: 'Twisted trees', image: 'https://example.com/forest.jpg' },
      ],
    });

    const result = await listWorldScenes('w1');

    expect(mockGetWorldScenes).toHaveBeenCalledWith('w1');
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('s1');
    expect(result[0]!.name).toBe('Castle Hall');
    expect(result[0]!.description).toBe('Grand entrance');
    expect(result[0]!.imageUrl).toBe('https://example.com/hall.jpg');
    expect(result[1]!.id).toBe('s2');
    expect(result[1]!.imageUrl).toBe('https://example.com/forest.jpg');
  });

  it('returns empty array for empty response', async () => {
    mockGetWorldScenes.mockResolvedValue({ scenes: [] });

    const result = await listWorldScenes('w2');

    expect(result).toEqual([]);
  });
});

describe('listWorldLorebooks', () => {
  beforeEach(() => {
    mockGetWorldLorebooks.mockReset();
  });

  it('returns mapped lorebooks with enabled/constant booleans', async () => {
    mockGetWorldLorebooks.mockResolvedValue({
      lorebooks: [
        { id: 'lb1', title: 'Magic System', content: 'Detailed magic rules', category: 'systems', enabled: true, constant: false },
        { id: 'lb2', title: 'World History', content: 'Timeline of events', category: 'history', enabled: false, constant: true },
      ],
    });

    const result = await listWorldLorebooks('w1');

    expect(mockGetWorldLorebooks).toHaveBeenCalledWith('w1');
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('lb1');
    expect(result[0]!.title).toBe('Magic System');
    expect(result[0]!.content).toBe('Detailed magic rules');
    expect(result[0]!.category).toBe('systems');
    expect(result[0]!.enabled).toBe(true);
    expect(result[0]!.constant).toBe(false);
    expect(result[1]!.id).toBe('lb2');
    expect(result[1]!.enabled).toBe(false);
    expect(result[1]!.constant).toBe(true);
  });

  it('handles missing title by falling back to name', async () => {
    mockGetWorldLorebooks.mockResolvedValue({
      lorebooks: [
        { id: 'lb3', name: 'Fallback Name', content: 'Some content' },
      ],
    });

    const result = await listWorldLorebooks('w1');

    expect(result[0]!.title).toBe('Fallback Name');
  });

  it('returns empty array for empty response', async () => {
    mockGetWorldLorebooks.mockResolvedValue({ lorebooks: [] });

    const result = await listWorldLorebooks('w2');

    expect(result).toEqual([]);
  });
});
