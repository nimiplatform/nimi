// RL-INTOP-003 — Socket.io Connection
// RL-IPC-009 — Realtime Event Forwarding
// Main process maintains socket.io connection for real-time human chat interop

import { io, type Socket } from 'socket.io-client';
import { type WebContents } from 'electron';
import { safeHandle } from './ipc-utils.js';
import type { RelayEventMap, RelayInvokeMap } from '../shared/ipc-contract.js';
import { normalizeRelayRealtimeUrl } from './url-guards.js';

let socket: Socket | null = null;

type RealtimeMessageEvent = RelayEventMap['relay:realtime:message'];
type RealtimePresenceEvent = RelayEventMap['relay:realtime:presence'];
type RealtimeStatusEvent = RelayEventMap['relay:realtime:status'];
type RealtimeSubscribeRequest = RelayInvokeMap['relay:realtime:subscribe']['request'];
type RealtimeUnsubscribeRequest = RelayInvokeMap['relay:realtime:unsubscribe']['request'];

/**
 * Initialize socket.io connection to Realm realtime endpoint.
 * Events are forwarded to the renderer via IPC.
 * Safe to call multiple times — disconnects any existing socket first.
 */
export function initRealtimeRelay(
  realmUrl: string,
  accessToken: string,
  getWebContents: () => WebContents | null,
  options?: { allowInsecureHttp?: boolean },
): void {
  // Disconnect previous socket before creating a new one (re-login safety)
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  socket = io(normalizeRelayRealtimeUrl(realmUrl, options), {
    auth: { token: accessToken },
    transports: ['websocket'],
    autoConnect: true,
    reconnection: true,
  });

  // Forward socket.io events to renderer (RL-IPC-009)
  socket.on('message', (data: RealtimeMessageEvent) => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('relay:realtime:message', data);
    }
  });

  socket.on('presence', (data: RealtimePresenceEvent) => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) {
      wc.send('relay:realtime:presence', data);
    }
  });

  socket.on('connect', () => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) {
      const payload: RealtimeStatusEvent = { connected: true };
      wc.send('relay:realtime:status', payload);
    }
  });

  socket.on('disconnect', () => {
    const wc = getWebContents();
    if (wc && !wc.isDestroyed()) {
      const payload: RealtimeStatusEvent = { connected: false };
      wc.send('relay:realtime:status', payload);
    }
  });

  // IPC handlers for subscribe/unsubscribe
  safeHandle('relay:realtime:subscribe', (_event, channel: RealtimeSubscribeRequest) => {
    socket?.emit('join', channel);
  });

  safeHandle('relay:realtime:unsubscribe', (_event, channel: RealtimeUnsubscribeRequest) => {
    socket?.emit('leave', channel);
  });
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}
