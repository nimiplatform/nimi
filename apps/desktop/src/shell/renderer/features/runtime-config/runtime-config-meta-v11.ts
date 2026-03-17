import type { RuntimePageIdV11 } from './runtime-config-state-types';

export const RUNTIME_PAGE_META: Record<RuntimePageIdV11, { name: string; description: string }> = {
  overview: {
    name: 'Overview',
    description: 'Dashboard with system stats, capability coverage, and quick actions.',
  },
  recommend: {
    name: 'Recommend',
    description: 'Model-index powered leaderboard for local chat, image, and video recommendations.',
  },
  local: {
    name: 'Local Models',
    description: 'Search, install, and manage local AI models.',
  },
  cloud: {
    name: 'Cloud API',
    description: 'Configure API keys for cloud provider connectors.',
  },
  catalog: {
    name: 'Catalog',
    description: 'Provider model/voice yaml catalog (default + custom).',
  },
  runtime: {
    name: 'Runtime',
    description: 'Daemon lifecycle, health, audit log, EAA, and provider diagnostics.',
  },
  mods: {
    name: 'Mods',
    description: 'Recommended local AI profile setup for registered mods.',
  },
  'data-management': {
    name: 'Data Management',
    description: 'Storage usage, cache, and account data controls.',
  },
  performance: {
    name: 'Performance',
    description: 'Rendering preferences, updates, and runtime info.',
  },
  'mod-developer': {
    name: 'Mod Developer',
    description: 'Developer mode, mod sources, diagnostics, and reload tools.',
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
