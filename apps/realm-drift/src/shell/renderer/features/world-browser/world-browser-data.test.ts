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

  it('returns mapped WorldSummary[] from API response with items wrapper', async () => {
    mockListMyWorlds.mockResolvedValue({
      items: [
        { id: 'w3', name: 'Arcadia', description: 'A bright world', status: 'ACTIVE', updatedAt: '2026-01-01T00:00:00Z' },
      ],
    });

    const result = await listMyWorlds();

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('w3');
    expect(result[0]!.name).toBe('Arcadia');
    expect(result[0]!.description).toBe('A bright world');
    expect(result[0]!.status).toBe('ACTIVE');
    expect(result[0]!.updatedAt).toBe('2026-01-01T00:00:00Z');
    expect(result[0]!.agentCount).toBe(0);
  });

  it('rejects invalid list shape instead of returning pseudo-success', async () => {
    mockListMyWorlds.mockResolvedValue({ message: 'unexpected shape' });

    await expect(listMyWorlds()).rejects.toThrow('WORLD_BROWSER_WORLD_LIST_CONTRACT_INVALID');
  });

  it('only maps canonical world summary fields', async () => {
    mockListMyWorlds.mockResolvedValue({
      items: [
        {
          id: 'w4',
          name: 'Realm One',
          description: 'Desc',
          status: 'ACTIVE',
          updatedAt: '2025-06-01T00:00:00Z',
        },
      ],
    });

    const result = await listMyWorlds();
    const world = result[0]!;

    expect(world.id).toBe('w4');
    expect(world.name).toBe('Realm One');
    expect(world.description).toBe('Desc');
    expect(world.status).toBe('ACTIVE');
    expect(world.bannerUrl).toBeUndefined();
    expect(world.iconUrl).toBeUndefined();
    expect(world.agentCount).toBe(0);
    expect(world.createdAt).toBeUndefined();
    expect(world.updatedAt).toBe('2025-06-01T00:00:00Z');
  });

  it('rejects missing required world summary fields', async () => {
    mockListMyWorlds.mockResolvedValue({
      items: [
        { id: 'w5', name: 'Bare World' },
      ],
    });

    await expect(listMyWorlds()).rejects.toThrow('WORLD_BROWSER_WORLD_UPDATED_AT_REQUIRED');
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
        { id: 'a1', name: 'Gandara', handle: 'gandara', bio: 'Wise wizard', avatarUrl: 'https://example.com/avatar.png' },
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
  });

  it('does not map legacy agent description into bio', async () => {
    mockGetWorldDetailWithAgents.mockResolvedValue({
      id: 'w2',
      name: 'World Two',
      agents: [
        { id: 'a3', name: 'Shadow', description: 'A mysterious figure' },
      ],
    });

    const result = await getWorldDetailWithAgents('w2');

    expect(result.agents[0]!.bio).toBeUndefined();
  });

  it('rejects missing canonical agents list', async () => {
    mockGetWorldDetailWithAgents.mockResolvedValue({
      id: 'w3',
      name: 'Empty World',
    });

    await expect(getWorldDetailWithAgents('w3')).rejects.toThrow(
      'WORLD_BROWSER_WORLD_AGENTS_CONTRACT_INVALID',
    );
  });
});

describe('getWorldview', () => {
  beforeEach(() => {
    mockGetWorldview.mockReset();
  });

  it('returns all worldview fields when present', async () => {
    mockGetWorldview.mockResolvedValue({
      timeModel: { type: 'LINEAR', unit: 'day', timeFlowRatio: 2 },
      spaceTopology: {
        type: 'MULTI_REGION',
        boundary: 'FINITE',
        dimensions: 3,
        realms: [{ name: 'Material Plane' }],
      },
      causality: { type: 'DETERMINISTIC', karmaEnabled: true, fateWeight: 0.8 },
      coreSystem: { name: 'Arcane Engine', description: 'Mana-based power network' },
      languages: { languages: [{ id: 'lang-1', name: 'Common' }] },
      resources: { types: [{ id: 'res-1', name: 'Mana Crystal' }] },
      locations: { regions: [{ id: 'reg-1', name: 'Northreach', description: 'Cold frontier' }] },
      visualGuide: { artStyle: 'Painterly', atmosphere: 'Epic' },
    });

    const result = await getWorldview('w1');

    expect(mockGetWorldview).toHaveBeenCalledWith('w1');
    expect(result.timeModel).toContain('LINEAR');
    expect(result.timeModel).toContain('unit day');
    expect(result.spaceTopology).toContain('MULTI_REGION');
    expect(result.spaceTopology).toContain('Material Plane');
    expect(result.coreSystem).toContain('Arcane Engine');
    expect(result.causality).toContain('DETERMINISTIC');
    expect(result.languages).toBe('Common');
    expect(result.resources).toBe('Mana Crystal');
    expect(result.locations).toContain('Northreach');
    expect(result.visualGuide).toContain('Painterly');
  });

  it('returns undefined summaries when optional worldview modules are absent', async () => {
    mockGetWorldview.mockResolvedValue({
      timeModel: { type: 'LINEAR' },
      spaceTopology: { type: 'PLANAR', boundary: 'FINITE' },
      causality: { type: 'DETERMINISTIC' },
      coreSystem: { name: 'Qi' },
    });

    const result = await getWorldview('w2');

    expect(result.timeModel).toContain('LINEAR');
    expect(result.languages).toBeUndefined();
    expect(result.resources).toBeUndefined();
    expect(result.locations).toBeUndefined();
    expect(result.visualGuide).toBeUndefined();
  });
});

describe('listWorldScenes', () => {
  beforeEach(() => {
    mockGetWorldScenes.mockReset();
  });

  it('returns mapped scenes from canonical items wrapper', async () => {
    mockGetWorldScenes.mockResolvedValue({
      items: [
        { id: 's1', name: 'Castle Hall', description: 'Grand entrance' },
        { id: 's2', name: 'Dark Forest', description: 'Twisted trees' },
      ],
    });

    const result = await listWorldScenes('w1');

    expect(mockGetWorldScenes).toHaveBeenCalledWith('w1');
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('s1');
    expect(result[0]!.name).toBe('Castle Hall');
    expect(result[0]!.description).toBe('Grand entrance');
    expect(result[0]!.imageUrl).toBeUndefined();
    expect(result[1]!.id).toBe('s2');
    expect(result[1]!.imageUrl).toBeUndefined();
  });

  it('rejects invalid scene list shape', async () => {
    mockGetWorldScenes.mockResolvedValue({ scenes: [] });

    await expect(listWorldScenes('w2')).rejects.toThrow('WORLD_BROWSER_SCENE_LIST_CONTRACT_INVALID');
  });
});

describe('listWorldLorebooks', () => {
  beforeEach(() => {
    mockGetWorldLorebooks.mockReset();
  });

  it('returns mapped lorebooks from canonical items wrapper', async () => {
    mockGetWorldLorebooks.mockResolvedValue({
      items: [
        { id: 'lb1', key: 'magic.system', name: 'Magic System', content: 'Detailed magic rules' },
        { id: 'lb2', key: 'world.history', name: 'World History', content: 'Timeline of events' },
      ],
    });

    const result = await listWorldLorebooks('w1');

    expect(mockGetWorldLorebooks).toHaveBeenCalledWith('w1');
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('lb1');
    expect(result[0]!.title).toBe('Magic System');
    expect(result[0]!.content).toBe('Detailed magic rules');
    expect(result[1]!.id).toBe('lb2');
  });

  it('uses canonical lorebook key when display name is absent', async () => {
    mockGetWorldLorebooks.mockResolvedValue({
      items: [
        { id: 'lb3', key: 'fallback.name', content: 'Some content' },
      ],
    });

    const result = await listWorldLorebooks('w1');

    expect(result[0]!.title).toBe('fallback.name');
  });

  it('rejects invalid lorebook list shape', async () => {
    mockGetWorldLorebooks.mockResolvedValue({ lorebooks: [] });

    await expect(listWorldLorebooks('w2')).rejects.toThrow('WORLD_BROWSER_LOREBOOK_LIST_CONTRACT_INVALID');
  });
});
