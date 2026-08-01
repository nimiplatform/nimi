import type { RuntimePageIdV11 } from './runtime-config-state-types';

export const RUNTIME_PAGE_META: Record<RuntimePageIdV11, { name: string; description: string }> = {
  overview: {
    name: 'Overview',
    description: 'Runtime readiness, capability coverage, readiness reasons, and quick actions.',
  },
  profiles: {
    name: 'Profiles',
    description: 'Account profile templates: review default, edit custom library, and move portable files.',
  },
  models: {
    name: 'Models',
    description: 'Recommended, installed, and catalog AI models for local capabilities.',
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
