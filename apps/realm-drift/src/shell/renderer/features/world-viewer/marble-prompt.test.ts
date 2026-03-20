import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RawWorldContext } from './marble-prompt.js';

const mockStream = vi.fn();

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      ai: {
        text: {
          stream: (...args: unknown[]) => mockStream(...args),
        },
      },
    },
  }),
}));

import { assembleRawContext, composeMarblePrompt, findWorldImageUrl } from './marble-prompt.js';

function makeFullContext(): RawWorldContext {
  return {
    world: {
      id: 'w1',
      name: 'Eldoria',
      description: 'A mystical fantasy realm of ancient magic',
      genre: 'Fantasy',
      era: 'Medieval',
      themes: ['Magic', 'Adventure', 'Dragons'],
      agents: [
        { id: 'a1', name: 'Gandara', bio: 'Wise wizard of the northern tower' },
        { id: 'a2', name: 'Kael', bio: 'Young warrior seeking redemption' },
      ],
    },
    worldview: {
      description: 'A vast continent divided by the Great Rift',
      geography: 'Mountains to the north, forests to the south',
      culture: 'Seven kingdoms united by the Council of Mages',
      history: 'Founded after the Dragon Wars 1000 years ago',
      lore: 'The Crystal Heart powers all magic in the realm',
    },
    scenes: [
      { id: 's1', name: 'Crystal Tower', description: 'A towering spire of pure crystal' },
      { id: 's2', name: 'Dragon Graveyard', description: 'Ancient bones cover the valley floor' },
    ],
    lorebooks: [
      { id: 'l1', title: 'The Dragon Wars', content: 'A thousand years ago, dragons and humans fought for dominion...' },
      { id: 'l2', title: 'Crystal Magic', content: 'All magic flows from the Crystal Heart deep within Mount Solara' },
    ],
  };
}

function makeSparseContext(): RawWorldContext {
  return {
    world: {
      id: 'w2',
      name: 'Empty World',
      agents: [],
    },
    worldview: {},
    scenes: [],
    lorebooks: [],
  };
}

describe('assembleRawContext', () => {
  it('assembles full context with all sections', () => {
    const result = assembleRawContext(makeFullContext());

    expect(result).toContain('World: Eldoria');
    expect(result).toContain('Genre: Fantasy');
    expect(result).toContain('Era: Medieval');
    expect(result).toContain('Themes: Magic, Adventure, Dragons');
    expect(result).toContain('Worldview:');
    expect(result).toContain('Geography: Mountains to the north');
    expect(result).toContain('Culture: Seven kingdoms');
    expect(result).toContain('Key Locations:');
    expect(result).toContain('Crystal Tower');
    expect(result).toContain('Lore Entries:');
    expect(result).toContain('The Dragon Wars');
    expect(result).toContain('Inhabitants:');
    expect(result).toContain('Gandara');
  });

  it('handles sparse context with minimal data', () => {
    const result = assembleRawContext(makeSparseContext());

    expect(result).toContain('World: Empty World');
    expect(result).not.toContain('Genre:');
    expect(result).not.toContain('Worldview:');
    expect(result).not.toContain('Key Locations:');
    expect(result).not.toContain('Lore Entries:');
    expect(result).not.toContain('Inhabitants:');
  });

  it('handles missing optional fields gracefully', () => {
    const ctx = makeFullContext();
    ctx.world.description = undefined;
    ctx.world.genre = undefined;
    ctx.worldview.geography = undefined;

    const result = assembleRawContext(ctx);

    expect(result).toContain('World: Eldoria');
    expect(result).not.toContain('Description:');
    expect(result).not.toContain('Genre:');
    expect(result).not.toContain('Geography:');
  });

  it('includes worldview physics fields (spaceTopology, coreSystem, causality, tone)', () => {
    const ctx = makeFullContext();
    ctx.worldview.spaceTopology = 'Infinite plane with floating islands';
    ctx.worldview.coreSystem = 'Mana crystallization engine';
    ctx.worldview.causality = 'Deterministic with magical exceptions';
    ctx.worldview.tone = 'Epic and mysterious';

    const result = assembleRawContext(ctx);

    expect(result).toContain('Space Topology: Infinite plane with floating islands');
    expect(result).toContain('Core System: Mana crystallization engine');
    expect(result).toContain('Causality: Deterministic with magical exceptions');
    expect(result).toContain('Tone: Epic and mysterious');
  });

  it('omits worldview physics fields when absent', () => {
    const ctx = makeSparseContext();

    const result = assembleRawContext(ctx);

    expect(result).not.toContain('Space Topology:');
    expect(result).not.toContain('Core System:');
    expect(result).not.toContain('Causality:');
    expect(result).not.toContain('Tone:');
  });
});

describe('composeMarblePrompt', () => {
  beforeEach(() => {
    mockStream.mockReset();
  });

  function makeAsyncIterable(parts: Array<{ type: string; text?: string; error?: string }>) {
    return {
      stream: (async function* () {
        for (const part of parts) {
          yield part;
        }
      })(),
    };
  }

  it('uses LLM to compose a visual prompt', async () => {
    mockStream.mockResolvedValue(makeAsyncIterable([
      { type: 'delta', text: 'A grand medieval ' },
      { type: 'delta', text: 'castle on a cliff' },
      { type: 'finish' },
    ]));

    const ctx = makeFullContext();
    const result = await composeMarblePrompt(ctx);

    expect(result).toBe('A grand medieval castle on a cliff');
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it('passes surfaceId realm-drift-prompt-gen in metadata', async () => {
    mockStream.mockResolvedValue(makeAsyncIterable([
      { type: 'delta', text: 'scene description' },
      { type: 'finish' },
    ]));

    const ctx = makeFullContext();
    await composeMarblePrompt(ctx);

    const callArgs = mockStream.mock.calls[0]![0];
    expect(callArgs.metadata).toEqual({ surfaceId: 'realm-drift-prompt-gen' });
    expect(callArgs.model).toBe('auto');
    expect(callArgs.route).toBe('cloud');
  });

  it('falls back to raw context when LLM throws', async () => {
    mockStream.mockRejectedValue(new Error('LLM unavailable'));

    const ctx = makeFullContext();
    const result = await composeMarblePrompt(ctx);

    expect(result).toContain('Create a single 3D scene from this sanitized world reference');
    expect(result).toContain('World: Eldoria');
    expect(result).toContain('Crystal Tower');
  });

  it('falls back to raw context when LLM returns empty', async () => {
    mockStream.mockResolvedValue(makeAsyncIterable([
      { type: 'finish' },
    ]));

    const ctx = makeFullContext();
    const result = await composeMarblePrompt(ctx);

    expect(result).toContain('Create a single 3D scene from this sanitized world reference');
    expect(result).toContain('World: Eldoria');
  });

  it('falls back to raw context on stream error part', async () => {
    mockStream.mockResolvedValue(makeAsyncIterable([
      { type: 'error', error: 'content filter' },
    ]));

    const ctx = makeFullContext();
    const result = await composeMarblePrompt(ctx);

    expect(result).toContain('World: Eldoria');
  });

  it('respects abort signal', async () => {
    const ac = new AbortController();
    let consumedChunks = 0;

    mockStream.mockResolvedValue({
      stream: (async function* () {
        yield { type: 'delta', text: 'first' };
        consumedChunks += 1;
        ac.abort();
        yield { type: 'delta', text: 'second' };
        consumedChunks += 1;
      })(),
    });

    const ctx = makeFullContext();
    const result = await composeMarblePrompt(ctx, ac.signal);

    expect(result).toBe('first');
    expect(consumedChunks).toBe(1);
  });

  it('sanitizes world data before composing prompts', () => {
    const ctx = makeFullContext();
    ctx.world.name = 'Eldoria<script>alert(1)</script>';
    const result = assembleRawContext(ctx);
    expect(result).toContain('World: Eldoria\\u003cscript\\u003ealert(1)\\u003c/script\\u003e');
  });
});

describe('findWorldImageUrl', () => {
  it('returns bannerUrl first', () => {
    const ctx: RawWorldContext = {
      world: {
        id: 'w1',
        name: 'Test',
        bannerUrl: 'https://example.com/banner.jpg',
        iconUrl: 'https://example.com/icon.jpg',
        agents: [],
      },
      worldview: {},
      scenes: [{ id: 's1', name: 'Scene', imageUrl: 'https://example.com/scene.jpg' }],
      lorebooks: [],
    };

    expect(findWorldImageUrl(ctx)).toBe('https://example.com/banner.jpg');
  });

  it('returns iconUrl as fallback when no bannerUrl', () => {
    const ctx: RawWorldContext = {
      world: {
        id: 'w1',
        name: 'Test',
        iconUrl: 'https://example.com/icon.jpg',
        agents: [],
      },
      worldview: {},
      scenes: [{ id: 's1', name: 'Scene', imageUrl: 'https://example.com/scene.jpg' }],
      lorebooks: [],
    };

    expect(findWorldImageUrl(ctx)).toBe('https://example.com/icon.jpg');
  });

  it('returns scene imageUrl as second fallback', () => {
    const ctx: RawWorldContext = {
      world: {
        id: 'w1',
        name: 'Test',
        agents: [],
      },
      worldview: {},
      scenes: [
        { id: 's1', name: 'Scene A' },
        { id: 's2', name: 'Scene B', imageUrl: 'https://example.com/scene-b.jpg' },
      ],
      lorebooks: [],
    };

    expect(findWorldImageUrl(ctx)).toBe('https://example.com/scene-b.jpg');
  });

  it('returns undefined when no images available', () => {
    const ctx: RawWorldContext = {
      world: {
        id: 'w1',
        name: 'Test',
        agents: [],
      },
      worldview: {},
      scenes: [{ id: 's1', name: 'Scene' }],
      lorebooks: [],
    };

    expect(findWorldImageUrl(ctx)).toBeUndefined();
  });
});
