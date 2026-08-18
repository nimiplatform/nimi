import type { RuntimePageIdV11 } from './runtime-config-state-types';

export const RUNTIME_PAGE_META: Record<RuntimePageIdV11, { name: string; description: string }> = {
  overview: {
    name: 'Overview',
    description: 'Runtime status and quick actions.',
  },
  profiles: {
    name: 'Profiles',
    description: 'Export portable Loadout intent and import it through explicit model acquisition, Loadout, AIConfig, and selection confirmations.',
  },
  modelMarket: {
    name: 'Model Market',
    description: 'Recommended local models for this machine.',
  },
  localModels: {
    name: 'Local Models',
    description: 'Install, import, start, stop, and remove local models.',
  },
  loadouts: {
    name: 'Loadouts',
    description: 'Create and select machine-local execution Loadouts.',
  },
  modelCatalog: {
    name: 'Model Catalog',
    description: 'Inspect the Runtime provider model catalog.',
  },
  cloud: {
    name: 'Cloud Connectors',
    description: 'Configure API keys and connectors for cloud AI providers.',
  },
  environment: {
    name: 'Environment',
    description: 'Nimi-managed dependencies, engines, data root, storage, and repair.',
  },
};
