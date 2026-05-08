import { computeDisplayPriceProjection } from '@renderer/data/polymarket.js';
import type { AnalysisPackageMarket, PreparedMarket, PriceProvenance } from '@renderer/data/types.js';

export type EventOutcomeDisplayItem = {
  marketId: string;
  label: string;
  probability: number;
  priceProvenance: PriceProvenance;
  delta?: number;
};

function getDisplayPrice(
  market: PreparedMarket,
  analyzedMarket: AnalysisPackageMarket | undefined,
): { probability: number; priceProvenance: PriceProvenance } {
  if (analyzedMarket?.currentPriceProvenance) {
    return {
      probability: analyzedMarket.currentProbability,
      priceProvenance: analyzedMarket.currentPriceProvenance,
    };
  }
  const projection = computeDisplayPriceProjection(market);
  return {
    probability: analyzedMarket?.currentProbability ?? projection.price,
    priceProvenance: projection.provenance,
  };
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
    const displayPrice = getDisplayPrice(market, analyzedMarket);
    return [{
      marketId: market.id,
      label: 'Yes',
      probability: displayPrice.probability,
      priceProvenance: displayPrice.priceProvenance,
      delta: analyzedMarket?.delta,
    }];
  }

  return [...visibleMarkets]
    .map((market) => {
      const analyzedMarket = analysisMarketsById.get(market.id);
      const displayPrice = getDisplayPrice(market, analyzedMarket);
      return {
        marketId: market.id,
        label: getDisplayLabel(market),
        probability: displayPrice.probability,
        priceProvenance: displayPrice.priceProvenance,
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
    .map(({ marketId, label, probability, priceProvenance, delta }) => ({
      marketId,
      label,
      probability,
      priceProvenance,
      delta,
    }));
}
