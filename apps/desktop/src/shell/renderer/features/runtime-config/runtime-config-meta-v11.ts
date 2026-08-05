import type { RuntimePageIdV11 } from './runtime-config-state-types';

export const RUNTIME_PAGE_META: Record<RuntimePageIdV11, { name: string; description: string }> = {
  overview: {
    name: 'Overview',
    description: 'Runtime status and quick actions.',
  },
  profiles: {
    name: 'Profiles',
    description: 'Preview canonical portable AIProfiles and explicitly apply intent to the Nimi Desktop App AIConfig.',
  },
  models: {
    name: 'Models',
    description: 'Manage Runtime-owned local assets and inspect the provider catalog.',
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
