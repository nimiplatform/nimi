import { io, type Socket } from 'socket.io-client';
import { useAppStore } from '@renderer/app-shell/app-store.js';

type RealtimeEventHandler = {
  onChatEvent?: (event: ChatEvent) => void;
  onMessageEdited?: (event: ChatEvent) => void;
  onMessageRecalled?: (event: ChatEvent) => void;
  onChatRead?: (event: ChatEvent) => void;
  onPresence?: (userId: string, online: boolean) => void;
  onSessionReady?: (sessionId: string) => void;
  onSyncRequired?: (chatId: string) => void;
};

export type ChatEvent = {
  eventId: string;
  chatId: string;
  type: string;
  senderId: string;
  content?: string;
  createdAt: string;
};

const LRU_MAX_SIZE = 1000;

export class RealtimeConnection {
  private socket: Socket | null = null;
  private seenEvents = new Map<string, boolean>();
  private resumeToken = '';
  private sessionId = '';
  private lastAckSeq = 0;
  private handlers: RealtimeEventHandler = {};

  connect(realtimeUrl: string, accessToken: string, handlers: RealtimeEventHandler): void {
    this.handlers = handlers;
    this.disconnect();

    const url = realtimeUrl || this.deriveRealtimeUrl();
    if (!url) return;

    this.socket = io(url, {
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: 10,
    });

    this.socket.on('connect', () => {
      // Send resume if we have a token
      if (this.resumeToken) {
        this.socket?.emit('chat:session.open', {
          resumeToken: this.resumeToken,
          lastAckSeq: this.lastAckSeq,
        });
      }
    });

    this.socket.on('chat:session.ready', (data: Record<string, unknown>) => {
      this.resumeToken = String(data.resumeToken || '');
      this.sessionId = String(data.sessionId || '');
      handlers.onSessionReady?.(this.sessionId);
    });

    this.socket.on('chat:event', (data: Record<string, unknown>) => {
      const event = this.parseChatEvent(data);
      if (!event) return;

      // Dedup by eventId
      if (this.seenEvents.has(event.eventId)) return;
      this.addToSeenEvents(event.eventId);

      // Update ack seq if present
      const seq = Number(data.seq || 0);
      if (seq > this.lastAckSeq) {
        this.lastAckSeq = seq;
      }

      // Send acknowledgment per RD-HCHAT-005
      this.socket?.emit('chat:event.ack', {
        chatId: event.chatId,
        sessionId: this.sessionId,
        ackSeq: seq,
      });

      // Dispatch by event kind per RD-HCHAT-005
      const kind = String(data.kind || event.type || '');
      switch (kind) {
        case 'message.edited':
          handlers.onMessageEdited?.(event);
          break;
        case 'message.recalled':
          handlers.onMessageRecalled?.(event);
          break;
        case 'chat.read':
          handlers.onChatRead?.(event);
          break;
        default:
          // message.created or unknown — treat as new message
          handlers.onChatEvent?.(event);
          break;
      }
    });

    this.socket.on('presence', (data: Record<string, unknown>) => {
      const userId = String(data.userId || '');
      const online = Boolean(data.online ?? data.status === 'online');
      if (userId) {
        handlers.onPresence?.(userId, online);

        // Update store
        const store = useAppStore.getState();
        if (online) {
          store.addOnlineUser(userId);
        } else {
          store.removeOnlineUser(userId);
        }
      }
    });

    this.socket.on('chat:session.sync_required', (data: Record<string, unknown>) => {
      const chatId = String(data.chatId || '');
      // Notify handler for REST sync fallback per RD-HCHAT-005
      handlers.onSyncRequired?.(chatId);

      // Also attempt session resume
      this.socket?.emit('chat:session.open', {
        resumeToken: this.resumeToken,
        lastAckSeq: this.lastAckSeq,
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  private parseChatEvent(data: Record<string, unknown>): ChatEvent | null {
    const eventId = String(data.eventId || data.id || '');
    if (!eventId) return null;

    return {
      eventId,
      chatId: String(data.chatId || ''),
      type: String(data.type || 'message'),
      senderId: String(data.senderId || data.userId || ''),
      content: data.content ? String(data.content) : undefined,
      createdAt: String(data.createdAt || new Date().toISOString()),
    };
  }

  private addToSeenEvents(eventId: string): void {
    if (this.seenEvents.size >= LRU_MAX_SIZE) {
      // Remove oldest entry
      const firstKey = this.seenEvents.keys().next().value;
      if (firstKey !== undefined) {
        this.seenEvents.delete(firstKey);
      }
    }
    this.seenEvents.set(eventId, true);
  }

  private deriveRealtimeUrl(): string {
    const defaults = useAppStore.getState().runtimeDefaults;
    if (defaults?.realm.realtimeUrl) return defaults.realm.realtimeUrl;
    if (defaults?.realm.realmBaseUrl) return defaults.realm.realmBaseUrl;
    return '';
  }
}

// Singleton instance
export const realtimeConnection = new RealtimeConnection();
