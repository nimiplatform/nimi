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
  advanced: {
    name: 'Advanced',
    description: 'Rendering preferences, updates, and developer-only surfaces.',
  },
};

const RESET_LOG_FLAG_KEY = '__nimiRuntimeConfigV11ResetLogged__';

export function wasRuntimeConfigV11ResetLogged(): boolean {
  const root = globalThis as Record<string, unknown>;
  return Boolean(root[RESET_LOG_FLAG_KEY]);
}

export function markRuntimeConfigV11ResetLogged(): void {
  const root = globalThis as Record<string, unknown>;
  root[RESET_LOG_FLAG_KEY] = true;
}
