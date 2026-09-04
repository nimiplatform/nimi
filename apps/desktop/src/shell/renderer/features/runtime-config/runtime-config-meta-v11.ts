import type { RuntimePageIdV11 } from './runtime-config-state-types';

export const RUNTIME_PAGE_META: Record<RuntimePageIdV11, { name: string; description: string }> = {
  overview: {
    name: 'Overview',
    description: 'Runtime status and quick actions.',
  },
  profiles: {
    name: 'Profiles',
    description: 'Browse canonical recommendations and import or export portable Loadout intent through the existing explicit workflow.',
  },
  modelMarket: {
    name: 'Model Market',
    description: 'Discover, search, inspect, and download ModelAssets.',
  },
  localAssets: {
    name: 'Local Assets',
    description: 'Inspect inventory, transfers, imports, references, and storage.',
  },
  loadouts: {
    name: 'Loadouts',
    description: 'Create and select machine-local execution Loadouts.',
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
