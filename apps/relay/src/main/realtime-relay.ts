// RL-INTOP-003 — Socket.io Connection
// RL-IPC-009 — Realtime Event Forwarding
// Main process maintains socket.io connection for real-time human chat interop

import { io, type Socket } from 'socket.io-client';
import { type WebContents } from 'electron';
import { safeHandle } from './ipc-utils.js';

let socket: Socket | null = null;

/**
 * Initialize socket.io connection to Realm realtime endpoint.
 * Events are forwarded to the renderer via IPC.
 * Safe to call multiple times — disconnects any existing socket first.
 */
export function initRealtimeRelay(
  realmUrl: string,
  accessToken: string,
  getWebContents: () => WebContents | null,
): void {
  // Disconnect previous socket before creating a new one (re-login safety)
  if (socket) {
    socket.disconnect();
    socket = null;
  }

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
  safeHandle('relay:realtime:subscribe', (_event, channel: string) => {
    socket?.emit('join', channel);
  });

  safeHandle('relay:realtime:unsubscribe', (_event, channel: string) => {
    socket?.emit('leave', channel);
  });
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}
