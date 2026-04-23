import { describe, expect, it } from 'vitest';
import { mergeSectorMarketBatches } from './polymarket.js';
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
