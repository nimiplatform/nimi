import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock before vi.mock — vi.mock is hoisted, but vi.fn() calls within factories work
vi.mock('socket.io-client', () => {
  const socket = {
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    connected: false,
  };
  return {
    io: vi.fn().mockReturnValue(socket),
    __mockSocket: socket,
  };
});

vi.mock('@renderer/app-shell/app-store.js', () => ({
  useAppStore: {
    getState: vi.fn().mockReturnValue({
      runtimeDefaults: {
        realm: { realmBaseUrl: 'http://localhost:3002', realtimeUrl: '' },
      },
      addOnlineUser: vi.fn(),
      removeOnlineUser: vi.fn(),
    }),
  },
}));

import { RealtimeConnection } from './realtime-connection.js';
import { io } from 'socket.io-client';

// Access mock socket from the mocked module
const socketModule = await import('socket.io-client') as unknown as {
  io: ReturnType<typeof vi.fn>;
  __mockSocket: {
    on: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
    connected: boolean;
  };
};
const mockSocket = socketModule.__mockSocket;

describe('RealtimeConnection', () => {
  let connection: RealtimeConnection;

  beforeEach(() => {
    connection = new RealtimeConnection();
    vi.clearAllMocks();
    mockSocket.connected = false;
  });

  it('connects with JWT token', () => {
    connection.connect('http://localhost:3002', 'jwt-token', {});

    expect(io).toHaveBeenCalledWith('http://localhost:3002', {
      auth: { token: 'jwt-token' },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: 10,
    });
  });

  it('registers event handlers on connect', () => {
    connection.connect('http://localhost:3002', 'jwt-token', {});

    const registeredEvents = mockSocket.on.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(registeredEvents).toContain('connect');
    expect(registeredEvents).toContain('chat:session.ready');
    expect(registeredEvents).toContain('chat:event');
    expect(registeredEvents).toContain('presence');
  });

  it('handles chat:session.ready event', () => {
    const onSessionReady = vi.fn();
    connection.connect('http://localhost:3002', 'jwt-token', { onSessionReady });

    const sessionReadyCall = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'chat:session.ready',
    );
    expect(sessionReadyCall).toBeTruthy();

    const handler = sessionReadyCall![1] as (data: Record<string, unknown>) => void;
    handler({ resumeToken: 'resume-123', sessionId: 'session-1' });

    expect(onSessionReady).toHaveBeenCalledWith('session-1');
  });

  it('deduplicates chat events by eventId', () => {
    const onChatEvent = vi.fn();
    connection.connect('http://localhost:3002', 'jwt-token', { onChatEvent });

    const chatEventCall = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'chat:event',
    );
    const handler = chatEventCall![1] as (data: Record<string, unknown>) => void;

    handler({ eventId: 'e1', chatId: 'c1', type: 'message', senderId: 'u1', content: 'hello' });
    expect(onChatEvent).toHaveBeenCalledTimes(1);

    // Duplicate should be dropped
    handler({ eventId: 'e1', chatId: 'c1', type: 'message', senderId: 'u1', content: 'hello' });
    expect(onChatEvent).toHaveBeenCalledTimes(1);

    // Different event passes through
    handler({ eventId: 'e2', chatId: 'c1', type: 'message', senderId: 'u2', content: 'world' });
    expect(onChatEvent).toHaveBeenCalledTimes(2);
  });

  it('disconnects cleanly', () => {
    connection.connect('http://localhost:3002', 'jwt-token', {});
    connection.disconnect();

    expect(mockSocket.removeAllListeners).toHaveBeenCalled();
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });

  it('reports connection status', () => {
    expect(connection.isConnected()).toBe(false);

    connection.connect('http://localhost:3002', 'jwt-token', {});
    mockSocket.connected = true;
    expect(connection.isConnected()).toBe(true);
  });
});
