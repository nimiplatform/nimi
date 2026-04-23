import { describe, expect, it } from 'vitest';
import type { AnalysisPackageMarket, PreparedMarket } from '@renderer/data/types.js';
import { buildEventOutcomeDisplay } from './sector-market-display.js';

function createMarket(input: Partial<PreparedMarket> & Pick<PreparedMarket, 'id' | 'question'>): PreparedMarket {
  return {
    id: input.id,
    eventId: input.eventId ?? 'evt-1',
    eventTitle: input.eventTitle ?? 'Test Event',
    question: input.question,
    groupItemTitle: input.groupItemTitle,
    slug: input.slug ?? input.id,
    active: input.active,
    acceptingOrders: input.acceptingOrders,
    closed: input.closed,
    volumeNum: input.volumeNum ?? 0,
    volume24hr: input.volume24hr ?? 0,
    liquidityNum: input.liquidityNum ?? 0,
    spread: input.spread ?? 0,
    bestBid: input.bestBid,
    bestAsk: input.bestAsk,
    lastTradePrice: input.lastTradePrice,
    rawOutcomePrice: input.rawOutcomePrice,
    yesTokenId: input.yesTokenId ?? `yes-${input.id}`,
    noTokenId: input.noTokenId ?? `no-${input.id}`,
    tags: input.tags ?? [],
  };
}

function createAnalysisMarket(input: Partial<AnalysisPackageMarket> & Pick<AnalysisPackageMarket, 'id' | 'question'>): AnalysisPackageMarket {
  return {
    id: input.id,
    question: input.question,
    currentProbability: input.currentProbability ?? 0,
    windowStartProbability: input.windowStartProbability ?? 0,
    delta: input.delta ?? 0,
    volumeNum: input.volumeNum ?? 0,
    volume24hr: input.volume24hr ?? 0,
    liquidityNum: input.liquidityNum ?? 0,
    spread: input.spread ?? 0,
    weightTier: input.weightTier ?? 'watch',
    eventTitle: input.eventTitle ?? 'Test Event',
    coreVariableIds: input.coreVariableIds ?? [],
    coreVariableTitles: input.coreVariableTitles ?? [],
  };
}

describe('buildEventOutcomeDisplay', () => {
  it('returns only the yes probability for single-market events', () => {
    const market = createMarket({
      id: 'm1',
      question: 'Will it happen?',
      bestBid: 0.75,
      bestAsk: 0.79,
    });

    const result = buildEventOutcomeDisplay([market], new Map());

    expect(result).toEqual([{
      marketId: 'm1',
      label: 'Yes',
      probability: 0.77,
      delta: undefined,
    }]);
  });

  it('keeps only the top five options for multi-outcome events', () => {
    const markets = [
      createMarket({ id: 'a', question: 'Will it be in Pakistan?', groupItemTitle: 'Pakistan', volumeNum: 100 }),
      createMarket({ id: 'b', question: 'Will it be in Turkey?', groupItemTitle: 'Turkey', volumeNum: 80 }),
      createMarket({ id: 'c', question: 'Will it be in Oman?', groupItemTitle: 'Oman', volumeNum: 60 }),
      createMarket({ id: 'd', question: 'Will it be in Qatar?', groupItemTitle: 'Qatar', volumeNum: 50 }),
      createMarket({ id: 'e', question: 'Will it be in Switzerland?', groupItemTitle: 'Switzerland', volumeNum: 40 }),
      createMarket({ id: 'f', question: 'Will it be in another country?', groupItemTitle: 'Other', volumeNum: 30 }),
    ];
    const analysisMarketsById = new Map<string, AnalysisPackageMarket>([
      ['a', createAnalysisMarket({ id: 'a', question: 'Pakistan', currentProbability: 0.77 })],
      ['b', createAnalysisMarket({ id: 'b', question: 'Turkey', currentProbability: 0.04 })],
      ['c', createAnalysisMarket({ id: 'c', question: 'Oman', currentProbability: 0.03 })],
      ['d', createAnalysisMarket({ id: 'd', question: 'Qatar', currentProbability: 0.02 })],
      ['e', createAnalysisMarket({ id: 'e', question: 'Switzerland', currentProbability: 0.045 })],
      ['f', createAnalysisMarket({ id: 'f', question: 'Other', currentProbability: 0.031 })],
    ]);

    const result = buildEventOutcomeDisplay(markets, analysisMarketsById);

    expect(result.map((item) => item.label)).toEqual([
      'Pakistan',
      'Switzerland',
      'Turkey',
      'Other',
      'Oman',
    ]);
    expect(result).toHaveLength(5);
  });

  it('prefers group item title over the long market question', () => {
    const markets = [
      createMarket({
        id: 'dem',
        question: 'Will the Democratic Party control the House after the 2026 Midterm elections?',
        groupItemTitle: 'Democratic Party',
        volumeNum: 100,
      }),
      createMarket({
        id: 'rep',
        question: 'Will the Republican Party control the House after the 2026 Midterm elections?',
        groupItemTitle: 'Republican Party',
        volumeNum: 90,
      }),
    ];
    const analysisMarketsById = new Map<string, AnalysisPackageMarket>([
      ['dem', createAnalysisMarket({ id: 'dem', question: markets[0]!.question, currentProbability: 0.845 })],
      ['rep', createAnalysisMarket({ id: 'rep', question: markets[1]!.question, currentProbability: 0.145 })],
    ]);

    const result = buildEventOutcomeDisplay(markets, analysisMarketsById);

    expect(result.map((item) => item.label)).toEqual(['Democratic Party', 'Republican Party']);
  });

  it('filters out inactive options before rendering', () => {
    const markets = [
      createMarket({
        id: 'active-1',
        question: 'Will the Democratic Party control the House after the 2026 Midterm elections?',
        groupItemTitle: 'Democratic Party',
        active: true,
      }),
      createMarket({
        id: 'inactive-1',
        question: 'Will Party A control the House after the 2026 Midterm elections?',
        groupItemTitle: 'Party A',
        active: false,
      }),
    ];
    const analysisMarketsById = new Map<string, AnalysisPackageMarket>([
      ['active-1', createAnalysisMarket({ id: 'active-1', question: markets[0]!.question, currentProbability: 0.845 })],
      ['inactive-1', createAnalysisMarket({ id: 'inactive-1', question: markets[1]!.question, currentProbability: 0.01 })],
    ]);

    const result = buildEventOutcomeDisplay(markets, analysisMarketsById);

    expect(result.map((item) => item.label)).toEqual(['Yes']);
    expect(result[0]?.probability).toBe(0.845);
  });
});
