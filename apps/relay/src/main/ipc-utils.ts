// RL-IPC-001 — Safe IPC handler registration utility
// Prevents "Attempted to register a second handler" errors when handlers are
// re-registered during re-authentication flows (logout → login).

import { ipcMain } from 'electron';

/**
 * Register an IPC handler safely — removes any existing handler for the same
 * channel before registering the new one.
 */
export function safeHandle(
  channel: string,
  handler: Parameters<typeof ipcMain.handle>[1],
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
}
