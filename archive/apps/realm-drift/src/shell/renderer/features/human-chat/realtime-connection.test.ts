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

  it('deduplicates chat events by eventId after applying payloads', async () => {
    const onChatEvent = vi.fn();
    connection.connect('http://localhost:3002', 'jwt-token', { onChatEvent });

    const chatEventCall = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'chat:event',
    );
    const handler = chatEventCall![1] as (data: Record<string, unknown>) => Promise<void>;

    await handler({ eventId: 'e1', seq: 1, chatId: 'c1', kind: 'message.created', payload: { senderId: 'u1', content: 'hello' } });
    expect(onChatEvent).toHaveBeenCalledTimes(1);
    expect(mockSocket.emit).toHaveBeenCalledWith('chat:event.ack', {
      chatId: 'c1',
      sessionId: '',
      ackSeq: 1,
    });

    // Duplicate should be dropped
    await handler({ eventId: 'e1', seq: 1, chatId: 'c1', kind: 'message.created', payload: { senderId: 'u1', content: 'hello' } });
    expect(onChatEvent).toHaveBeenCalledTimes(1);

    // Different event passes through
    await handler({ eventId: 'e2', seq: 2, chatId: 'c1', kind: 'message.created', payload: { senderId: 'u2', content: 'world' } });
    expect(onChatEvent).toHaveBeenCalledTimes(2);
  });

  it('does not ack until chat event application succeeds', async () => {
    const onChatEvent = vi.fn().mockImplementationOnce(() => {
      throw new Error('apply failed');
    });
    connection.connect('http://localhost:3002', 'jwt-token', { onChatEvent });

    const chatEventCall = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'chat:event',
    );
    const handler = chatEventCall![1] as (data: Record<string, unknown>) => Promise<void>;

    await handler({ eventId: 'e1', seq: 1, chatId: 'c1', kind: 'message.created', payload: { senderId: 'u1', content: 'hello' } });

    expect(onChatEvent).toHaveBeenCalledTimes(1);
    expect(mockSocket.emit).not.toHaveBeenCalledWith('chat:event.ack', expect.anything());

    onChatEvent.mockImplementationOnce(() => undefined);
    await handler({ eventId: 'e1', seq: 1, chatId: 'c1', kind: 'message.created', payload: { senderId: 'u1', content: 'hello' } });

    expect(onChatEvent).toHaveBeenCalledTimes(2);
    expect(mockSocket.emit).toHaveBeenCalledWith('chat:event.ack', {
      chatId: 'c1',
      sessionId: '',
      ackSeq: 1,
    });
  });

  it('refuses malformed chat events without acking', async () => {
    const onChatEvent = vi.fn();
    connection.connect('http://localhost:3002', 'jwt-token', { onChatEvent });

    const chatEventCall = mockSocket.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'chat:event',
    );
    const handler = chatEventCall![1] as (data: Record<string, unknown>) => Promise<void>;

    await handler({ eventId: 'e1', seq: 1, chatId: 'c1', kind: 'message.created', payload: { senderId: 'u1' } });

    expect(onChatEvent).not.toHaveBeenCalled();
    expect(mockSocket.emit).not.toHaveBeenCalledWith('chat:event.ack', expect.anything());
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
