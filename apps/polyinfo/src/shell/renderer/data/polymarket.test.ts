import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAnalysisPackage,
  buildImportedEventRecord,
  computeDisplayPriceProjection,
  fetchSectorHistory,
  mergeSectorMarketBatches,
  selectRealtimeMarketAssetIds,
} from './polymarket.js';
import type { PreparedMarket, SectorMarketBatch } from './types.js';

const bridgeMocks = vi.hoisted(() => ({
  hasTauriInvoke: vi.fn(() => false),
  invokeChecked: vi.fn(),
}));

vi.mock('@renderer/bridge', () => ({
  hasTauriInvoke: bridgeMocks.hasTauriInvoke,
  invokeChecked: bridgeMocks.invokeChecked,
}));

function createMarket(input: Partial<PreparedMarket> & Pick<PreparedMarket, 'id' | 'eventId' | 'eventTitle' | 'question' | 'slug' | 'volumeNum' | 'volume24hr' | 'liquidityNum' | 'spread' | 'yesTokenId' | 'tags'>): PreparedMarket {
  return {
    groupItemTitle: input.groupItemTitle,
    active: true,
    acceptingOrders: true,
    closed: false,
    ...input,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  bridgeMocks.hasTauriInvoke.mockReturnValue(false);
  vi.unstubAllGlobals();
});

describe('mergeSectorMarketBatches', () => {
  it('merges batches, keeps next cursor from tail batch, and dedupes markets', () => {
    const first: SectorMarketBatch = {
      markets: [
        createMarket({
          id: 'a',
          eventId: 'event-a',
          eventTitle: 'Event A',
          question: 'Question A',
          slug: 'a',
          volumeNum: 50,
          volume24hr: 10,
          liquidityNum: 20,
          spread: 0.01,
          yesTokenId: 'token-a',
          tags: [],
        }),
      ],
      nextCursor: 'cursor-2',
      hasMore: true,
    };
    const second: SectorMarketBatch = {
      markets: [
        createMarket({
          id: 'b',
          eventId: 'event-b',
          eventTitle: 'Event B',
          question: 'Question B',
          slug: 'b',
          volumeNum: 80,
          volume24hr: 10,
          liquidityNum: 20,
          spread: 0.01,
          yesTokenId: 'token-b',
          tags: [],
        }),
        createMarket({
          id: 'a',
          eventId: 'event-a',
          eventTitle: 'Event A',
          question: 'Question A',
          slug: 'a',
          volumeNum: 50,
          volume24hr: 10,
          liquidityNum: 20,
          spread: 0.01,
          yesTokenId: 'token-a',
          tags: [],
        }),
      ],
      nextCursor: 'cursor-3',
      hasMore: true,
    };

    expect(mergeSectorMarketBatches([first, second])).toMatchObject({
      nextCursor: 'cursor-3',
      hasMore: true,
    });
    expect(mergeSectorMarketBatches([first, second]).markets.map((market) => market.id)).toEqual(['b', 'a']);
  });

  it('stops advertising more pages once the tail batch is exhausted', () => {
    const first: SectorMarketBatch = {
      markets: [],
      nextCursor: 'cursor-2',
      hasMore: true,
    };
    const second: SectorMarketBatch = {
      markets: [],
      hasMore: false,
    };

    expect(mergeSectorMarketBatches([first, second])).toEqual({
      markets: [],
      nextCursor: undefined,
      hasMore: false,
    });
  });
});

describe('buildImportedEventRecord', () => {
  it('creates a stable imported event record from a cached payload', () => {
    const record = buildImportedEventRecord({
      sectorId: 'custom-1',
      now: 123,
      payload: {
        sourceEventId: 'event-1',
        slug: 'test-event',
        title: 'Test Event',
        markets: [
          createMarket({
            id: 'market-1',
            eventId: 'event-1',
            eventTitle: 'Test Event',
            eventSlug: 'test-event',
            question: 'Will it happen?',
            slug: 'market-1',
            volumeNum: 10,
            volume24hr: 1,
            liquidityNum: 2,
            spread: 0.02,
            yesTokenId: 'yes-token',
            tags: [],
          }),
        ],
      },
    });

    expect(record).toMatchObject({
      id: 'imported-event-1',
      sectorId: 'custom-1',
      sourceUrl: 'https://polymarket.com/event/test-event',
      sourceEventId: 'event-1',
      title: 'Test Event',
      staleState: 'active',
      createdAt: 123,
      updatedAt: 123,
    });
  });
});

describe('fetchSectorHistory', () => {
  it('uses the admitted bridge batch price history command instead of renderer fetch', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        history: {
          'yes-token': [{ t: 1000, p: 0.42 }],
        },
      }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    bridgeMocks.hasTauriInvoke.mockReturnValue(true);
    bridgeMocks.invokeChecked.mockResolvedValue({
      history: {
        'yes-token': [{ t: 1000, p: 0.42 }],
      },
    });

    await expect(fetchSectorHistory([
      createMarket({
        id: 'market-1',
        eventId: 'event-1',
        eventTitle: 'Test Event',
        question: 'Will it happen?',
        slug: 'market-1',
        volumeNum: 10,
        volume24hr: 1,
        liquidityNum: 2,
        spread: 0.02,
        yesTokenId: 'yes-token',
        tags: [],
      }),
    ])).resolves.toEqual({
      'market-1': [{ timestamp: 1_000_000, price: 0.42 }],
    });

    expect(bridgeMocks.invokeChecked).toHaveBeenCalledWith('polymarket_batch_prices_history', expect.objectContaining({
      markets: ['yes-token'],
      interval: 'max',
    }), expect.any(Function));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the admitted bridge is unavailable', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSectorHistory([
      createMarket({
        id: 'market-1',
        eventId: 'event-1',
        eventTitle: 'Test Event',
        question: 'Will it happen?',
        slug: 'market-1',
        volumeNum: 10,
        volume24hr: 1,
        liquidityNum: 2,
        spread: 0.02,
        yesTokenId: 'yes-token',
        tags: [],
      }),
    ])).rejects.toThrow('Polyinfo market data requires the admitted Tauri bridge.');

    expect(bridgeMocks.invokeChecked).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('buildAnalysisPackage', () => {
  it('fails closed instead of using a zero baseline when market history is missing', () => {
    const market = createMarket({
      id: 'market-1',
      eventId: 'event-1',
      eventTitle: 'Test Event',
      question: 'Will it happen?',
      slug: 'market-1',
      volumeNum: 10,
      volume24hr: 1,
      liquidityNum: 2,
      spread: 0.02,
      yesTokenId: 'yes-token',
      tags: [],
    });

    expect(() => buildAnalysisPackage({
      tag: { id: 'sector-1', label: 'Sector 1', slug: 'sector-1' },
      window: '24h',
      overlay: { narratives: [], coreVariables: [] },
      markets: [market],
      histories: {},
      liveByTokenId: {},
    })).toThrow('Missing canonical history window for market market-1');
  });

  it('carries degraded price provenance into analyst package context', () => {
    const market = createMarket({
      id: 'market-1',
      eventId: 'event-1',
      eventTitle: 'Test Event',
      question: 'Will it happen?',
      slug: 'market-1',
      volumeNum: 10,
      volume24hr: 1,
      liquidityNum: 2,
      spread: 0.02,
      bestBid: 0.2,
      bestAsk: 0.4,
      lastTradePrice: 0.31,
      yesTokenId: 'yes-token',
      tags: [],
    });

    const result = buildAnalysisPackage({
      tag: { id: 'sector-1', label: 'Sector 1', slug: 'sector-1' },
      window: '24h',
      overlay: { narratives: [], coreVariables: [] },
      markets: [market],
      histories: {
        'market-1': [{ timestamp: Date.now() - 25 * 60 * 60 * 1000, price: 0.25 }],
      },
      liveByTokenId: {},
    });

    expect(result.markets[0]).toMatchObject({
      currentProbability: 0.31,
      currentPriceProvenance: {
        source: 'last_trade',
        freshness: 'snapshot',
        degraded: true,
        reason: 'wide_spread_midpoint_rejected',
      },
    });
  });
});

describe('computeDisplayPriceProjection', () => {
  it('marks raw outcome price as degraded cache provenance', () => {
    expect(computeDisplayPriceProjection(createMarket({
      id: 'market-1',
      eventId: 'event-1',
      eventTitle: 'Test Event',
      question: 'Will it happen?',
      slug: 'market-1',
      volumeNum: 10,
      volume24hr: 1,
      liquidityNum: 2,
      spread: 0.02,
      rawOutcomePrice: 0.44,
      yesTokenId: 'yes-token',
      tags: [],
    }))).toEqual({
      price: 0.44,
      provenance: {
        source: 'outcome_cache',
        freshness: 'cache',
        degraded: true,
        reason: 'bid_ask_last_trade_unavailable',
      },
    });
  });
});

describe('selectRealtimeMarketAssetIds', () => {
  it('selects concrete active market asset ids for realtime subscription', () => {
    expect(selectRealtimeMarketAssetIds([
      createMarket({
        id: 'active',
        eventId: 'event-1',
        eventTitle: 'Test Event',
        question: 'Will it happen?',
        slug: 'active',
        volumeNum: 10,
        volume24hr: 1,
        liquidityNum: 2,
        spread: 0.02,
        yesTokenId: 'yes-token-b',
        tags: [],
      }),
      createMarket({
        id: 'duplicate',
        eventId: 'event-1',
        eventTitle: 'Test Event',
        question: 'Will it happen too?',
        slug: 'duplicate',
        volumeNum: 10,
        volume24hr: 1,
        liquidityNum: 2,
        spread: 0.02,
        yesTokenId: 'yes-token-b',
        tags: [],
      }),
      createMarket({
        id: 'closed',
        eventId: 'event-1',
        eventTitle: 'Test Event',
        question: 'Closed?',
        slug: 'closed',
        closed: true,
        volumeNum: 10,
        volume24hr: 1,
        liquidityNum: 2,
        spread: 0.02,
        yesTokenId: 'yes-token-a',
        tags: [],
      }),
    ])).toEqual(['yes-token-b']);
  });
});
