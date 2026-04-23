import { computeDisplayPrice } from '@renderer/data/polymarket.js';
import type { AnalysisPackageMarket, PreparedMarket } from '@renderer/data/types.js';

export type EventOutcomeDisplayItem = {
  marketId: string;
  label: string;
  probability: number;
  delta?: number;
};

function getDisplayProbability(
  market: PreparedMarket,
  analyzedMarket: AnalysisPackageMarket | undefined,
): number {
  return analyzedMarket?.currentProbability ?? computeDisplayPrice(market);
}

function getDisplayLabel(market: PreparedMarket): string {
  const groupItemTitle = String(market.groupItemTitle || '').trim();
  if (groupItemTitle) {
    return groupItemTitle;
  }
  const question = String(market.question || '').trim();
  return question || 'Unknown';
}

export function buildEventOutcomeDisplay(
  markets: PreparedMarket[],
  analysisMarketsById: Map<string, AnalysisPackageMarket>,
): EventOutcomeDisplayItem[] {
  const visibleMarkets = markets.filter((market) => market.active !== false && market.closed !== true);
  if (visibleMarkets.length === 0) {
    return [];
  }

  if (visibleMarkets.length === 1) {
    const market = visibleMarkets[0]!;
    const analyzedMarket = analysisMarketsById.get(market.id);
    return [{
      marketId: market.id,
      label: 'Yes',
      probability: getDisplayProbability(market, analyzedMarket),
      delta: analyzedMarket?.delta,
    }];
  }

  return [...visibleMarkets]
    .map((market) => {
      const analyzedMarket = analysisMarketsById.get(market.id);
      return {
        marketId: market.id,
        label: getDisplayLabel(market),
        probability: getDisplayProbability(market, analyzedMarket),
        delta: analyzedMarket?.delta,
        volumeNum: market.volumeNum,
      };
    })
    .sort((left, right) => (
      right.probability - left.probability
      || right.volumeNum - left.volumeNum
      || left.label.localeCompare(right.label)
    ))
    .slice(0, 5)
    .map(({ marketId, label, probability, delta }) => ({
      marketId,
      label,
      probability,
      delta,
    }));
}
