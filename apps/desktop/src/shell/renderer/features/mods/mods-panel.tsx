import { useEffect, useState } from 'react';
import { useModsPanelModel } from './mods-panel-controller';
import { ModsPanelView } from './mods-panel-view';
import { useMarketplacePageModel } from '@renderer/features/marketplace/marketplace-controller';
import { MarketplaceView } from '@renderer/features/marketplace/marketplace-view';
import {
  loadStoredModsPanelSection,
  persistStoredModsPanelSection,
  type ModsPanelSection,
} from './mods-panel-state';

export function ModsPanel(props: { initialSection?: ModsPanelSection }) {
  const model = useModsPanelModel();
  const marketplaceModel = useMarketplacePageModel();
  const [section, setSection] = useState<ModsPanelSection>(() => (
    props.initialSection || loadStoredModsPanelSection()
  ));

  useEffect(() => {
    persistStoredModsPanelSection(section);
  }, [section]);

  useEffect(() => {
    if (props.initialSection) {
      setSection(props.initialSection);
    }
  }, [props.initialSection]);

  if (section === 'marketplace') {
    return (
      <MarketplaceView
        {...marketplaceModel}
        embedded
        onOpenLibrary={() => setSection('library')}
      />
    );
  }

  return (
    <ModsPanelView
      {...model}
      onOpenMarketplace={() => setSection('marketplace')}
    />
  );
}
