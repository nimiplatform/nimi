// Route state manager — singleton holding binding + options + resolved route
// Persists binding to <userData>/relay-route-binding.json

import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { PlatformClient } from '@nimiplatform/sdk';
import type {
  RelayRouteBinding,
  RelayRouteOptions,
  ResolvedRelayRoute,
} from './types.js';
import { loadRouteOptions } from './route-options.js';
import { resolveRelayRoute } from './route-resolver.js';

function getBindingFilePath(): string {
  return path.join(app.getPath('userData'), 'relay-route-binding.json');
}

async function loadPersistedBinding(): Promise<RelayRouteBinding | null> {
  try {
    const raw = await fs.readFile(getBindingFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as RelayRouteBinding;
    if (parsed && (parsed.source === 'local' || parsed.source === 'cloud')) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function persistBinding(binding: RelayRouteBinding | null): Promise<void> {
  try {
    const dirPath = path.dirname(getBindingFilePath());
    await fs.mkdir(dirPath, { recursive: true });
    if (binding) {
      await fs.writeFile(getBindingFilePath(), JSON.stringify(binding, null, 2), 'utf-8');
    }
  } catch {
    // Swallow write errors
  }
}

export type RouteState = {
  getBinding(): RelayRouteBinding | null;
  getOptions(): RelayRouteOptions;
  getResolved(): ResolvedRelayRoute | null;
  setBinding(binding: RelayRouteBinding): Promise<ResolvedRelayRoute | null>;
  refresh(runtime: PlatformClient['runtime']): Promise<RelayRouteOptions>;
  initialize(runtime: PlatformClient['runtime']): Promise<void>;
};

export function createRouteState(): RouteState {
  let binding: RelayRouteBinding | null = null;
  let options: RelayRouteOptions = { local: { models: [] }, connectors: [], selected: null };
  let resolved: ResolvedRelayRoute | null = null;

  return {
    getBinding() {
      return binding;
    },

    getOptions() {
      return { ...options, selected: binding };
    },

    getResolved() {
      return resolved;
    },

    async setBinding(newBinding: RelayRouteBinding) {
      binding = newBinding;
      resolved = resolveRelayRoute(binding, options);
      await persistBinding(binding);
      return resolved;
    },

    async refresh(runtime: PlatformClient['runtime']) {
      options = await loadRouteOptions(runtime, binding);
      resolved = resolveRelayRoute(binding, options);
      return { ...options, selected: binding };
    },

    async initialize(runtime: PlatformClient['runtime']) {
      binding = await loadPersistedBinding();
      options = await loadRouteOptions(runtime, binding);
      resolved = resolveRelayRoute(binding, options);
    },
  };
}
