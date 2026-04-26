import { describe, expect, it } from 'vitest';
import { buildImportedEventRecord, mergeSectorMarketBatches } from './polymarket.js';
import type { PreparedMarket, SectorMarketBatch } from './types.js';

function createMarket(input: Partial<PreparedMarket> & Pick<PreparedMarket, 'id' | 'eventId' | 'eventTitle' | 'question' | 'slug' | 'volumeNum' | 'volume24hr' | 'liquidityNum' | 'spread' | 'yesTokenId' | 'tags'>): PreparedMarket {
  return {
    groupItemTitle: input.groupItemTitle,
    active: true,
    acceptingOrders: true,
    closed: false,
    ...input,
  };
}

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
