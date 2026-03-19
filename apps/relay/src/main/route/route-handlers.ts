// Route IPC handlers — relay:route:* channels (RL-IPC-001)

import type { Runtime } from '@nimiplatform/sdk/runtime';
import type { RouteState } from './route-state.js';
import type { RelayRouteBinding } from './types.js';
import { safeHandle } from '../ipc-utils.js';

export function registerRouteHandlers(runtime: Runtime, routeState: RouteState): void {
  // List available route options (local models + connectors)
  safeHandle('relay:route:options', async () => {
    return routeState.getOptions();
  });

  // Get current binding
  safeHandle('relay:route:binding:get', async () => {
    return routeState.getBinding();
  });

  // Set binding and resolve
  safeHandle('relay:route:binding:set', async (_event, input: RelayRouteBinding) => {
    return await routeState.setBinding(input);
  });

  // Get current resolved snapshot
  safeHandle('relay:route:snapshot', async () => {
    return routeState.getResolved();
  });

  // Refresh options from runtime
  safeHandle('relay:route:refresh', async () => {
    return await routeState.refresh(runtime);
  });
}
