// RL-INTOP-003 — Socket.io Connection
// RL-IPC-009 — Realtime Event Forwarding
// Main process maintains socket.io connection for real-time human chat interop

import { io, type Socket } from 'socket.io-client';
import { ipcMain, type WebContents } from 'electron';

let socket: Socket | null = null;

/**
 * Initialize socket.io connection to Realm realtime endpoint.
 * Events are forwarded to the renderer via IPC.
 */
export function initRealtimeRelay(
  realmUrl: string,
  accessToken: string,
  getWebContents: () => WebContents | null,
): void {
  socket = io(realmUrl, {
    auth: { token: accessToken },
    transports: ['websocket'],
    autoConnect: true,
    reconnection: true,
  });

  // Forward socket.io events to renderer (RL-IPC-009)
  socket.on('message', (data: unknown) => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('relay:realtime:message', data);
    }
  });

  socket.on('presence', (data: unknown) => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('relay:realtime:presence', data);
    }
  });

  socket.on('connect', () => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('relay:realtime:status', { connected: true });
    }
  });

  socket.on('disconnect', () => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('relay:realtime:status', { connected: false });
    }
  });

  // IPC handlers for subscribe/unsubscribe
  ipcMain.handle('relay:realtime:subscribe', (_event, channel: string) => {
    socket?.emit('join', channel);
  });

  ipcMain.handle('relay:realtime:unsubscribe', (_event, channel: string) => {
    socket?.emit('leave', channel);
  });
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}
