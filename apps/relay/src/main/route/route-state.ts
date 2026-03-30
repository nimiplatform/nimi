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
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[relay:route] loadPersistedBinding failed', err);
    }
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
  } catch (err) {
    console.error('[relay:route] persistBinding failed', err);
  }
}

export type RouteInitDiagnostics = {
  loadStatus: RelayRouteOptions['loadStatus'];
  resolvedNull: boolean;
  bindingSource: 'local' | 'cloud' | null;
  issueCount: number;
};

export type RouteState = {
  getBinding(): RelayRouteBinding | null;
  getOptions(): RelayRouteOptions;
  getResolved(): ResolvedRelayRoute | null;
  getInitDiagnostics(): RouteInitDiagnostics;
  setBinding(binding: RelayRouteBinding): Promise<ResolvedRelayRoute | null>;
  refresh(runtime: PlatformClient['runtime']): Promise<RelayRouteOptions>;
  initialize(runtime: PlatformClient['runtime']): Promise<void>;
};

export function createRouteState(): RouteState {
  let binding: RelayRouteBinding | null = null;
  let runtimeRef: PlatformClient['runtime'] | null = null;
  let options: RelayRouteOptions = {
    local: { models: [], status: 'unavailable', error: 'route options not initialized' },
    connectors: [],
    selected: null,
    loadStatus: 'failed',
    issues: [{
      scope: 'connectors',
      kind: 'runtime-error',
      message: 'route options not initialized',
    }],
  };
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

    getInitDiagnostics(): RouteInitDiagnostics {
      return {
        loadStatus: options.loadStatus,
        resolvedNull: resolved === null,
        bindingSource: binding?.source ?? null,
        issueCount: options.issues.length,
      };
    },

    async setBinding(newBinding: RelayRouteBinding) {
      binding = newBinding;

      // If cached options are stale (e.g. local models empty because runtime
      // wasn't available during init), refresh before resolving.
      const needsLocalRefresh = newBinding.source === 'local' && options.local.models.length === 0;
      const needsCloudRefresh = newBinding.source === 'cloud' && options.connectors.length === 0;
      if ((needsLocalRefresh || needsCloudRefresh) && runtimeRef) {
        try {
          options = await loadRouteOptions(runtimeRef, binding);
        } catch {
          // Refresh failed — resolve with current (stale) options.
        }
      }

      resolved = resolveRelayRoute(binding, options);
      await persistBinding(binding);
      return resolved;
    },

    async refresh(runtime: PlatformClient['runtime']) {
      runtimeRef = runtime;
      options = await loadRouteOptions(runtime, binding);
      resolved = resolveRelayRoute(binding, options);
      return { ...options, selected: binding };
    },

    async initialize(runtime: PlatformClient['runtime']) {
      runtimeRef = runtime;
      binding = await loadPersistedBinding();
      options = await loadRouteOptions(runtime, binding);
      resolved = resolveRelayRoute(binding, options);
    },
  };
}
