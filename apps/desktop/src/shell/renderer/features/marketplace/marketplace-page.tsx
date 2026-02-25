import { useMarketplacePageModel } from './marketplace-controller';
import { MarketplaceView } from './marketplace-view';

export function MarketplacePage() {
  const model = useMarketplacePageModel();
  return <MarketplaceView {...model} />;
}
