// Route IPC handlers — relay:route:* channels (RL-IPC-001)

import { ipcMain } from 'electron';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import type { RouteState } from './route-state.js';
import type { RelayRouteBinding } from './types.js';

export function registerRouteHandlers(runtime: Runtime, routeState: RouteState): void {
  // List available route options (local models + connectors)
  ipcMain.handle('relay:route:options', async () => {
    return routeState.getOptions();
  });

  // Get current binding
  ipcMain.handle('relay:route:binding:get', async () => {
    return routeState.getBinding();
  });

  // Set binding and resolve
  ipcMain.handle('relay:route:binding:set', async (_event, input: RelayRouteBinding) => {
    return await routeState.setBinding(input);
  });

  // Get current resolved snapshot
  ipcMain.handle('relay:route:snapshot', async () => {
    return routeState.getResolved();
  });

  // Refresh options from runtime
  ipcMain.handle('relay:route:refresh', async () => {
    return await routeState.refresh(runtime);
  });
}
