import { io, type Socket } from 'socket.io-client';
import { useAppStore } from '@renderer/app-shell/app-store.js';

type RealtimeEventHandler = {
  onChatEvent?: (event: ChatEvent) => void | Promise<void>;
  onMessageEdited?: (event: ChatEvent) => void | Promise<void>;
  onMessageRecalled?: (event: ChatEvent) => void | Promise<void>;
  onChatRead?: (event: ChatEvent) => void | Promise<void>;
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

    this.socket.on('chat:event', async (data: Record<string, unknown>) => {
      const parsed = this.parseChatEvent(data);
      if (!parsed) return;

      const { event, seq, kind } = parsed;
      if (this.seenEvents.has(event.eventId)) return;

      try {
        await this.applyChatEvent(kind, event, handlers);
      } catch {
        return;
      }

      this.addToSeenEvents(event.eventId);
      if (seq > this.lastAckSeq) {
        this.lastAckSeq = seq;
      }

      this.socket?.emit('chat:event.ack', {
        chatId: event.chatId,
        sessionId: this.sessionId,
        ackSeq: seq,
      });
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

  private parseChatEvent(data: Record<string, unknown>): { event: ChatEvent; seq: number; kind: string } | null {
    const eventId = String(data.eventId || data.id || '');
    if (!eventId) return null;
    const chatId = String(data.chatId || '');
    if (!chatId) return null;
    const seq = Number(data.seq || 0);
    if (!Number.isFinite(seq) || seq <= 0) return null;
    const kind = String(data.kind || data.type || 'message.created');
    if (!['message.created', 'message.edited', 'message.recalled', 'chat.read'].includes(kind)) return null;

    const payload = this.objectPayload(data.payload);
    const senderId = String(payload.senderId || payload.userId || data.senderId || data.userId || '');
    const content = this.eventContent(payload, data);
    if ((kind === 'message.created' || kind === 'message.edited') && (!senderId || !content)) {
      return null;
    }

    return {
      seq,
      kind,
      event: {
      eventId,
      chatId,
      type: kind,
      senderId,
      content,
      createdAt: String(payload.createdAt || data.createdAt || new Date().toISOString()),
      },
    };
  }

  private objectPayload(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private eventContent(payload: Record<string, unknown>, data: Record<string, unknown>): string | undefined {
    const message = this.objectPayload(payload.message);
    const value = payload.content ?? payload.text ?? message.content ?? message.text ?? data.content;
    return value === undefined || value === null ? undefined : String(value);
  }

  private async applyChatEvent(kind: string, event: ChatEvent, handlers: RealtimeEventHandler): Promise<void> {
    switch (kind) {
      case 'message.created':
        if (!handlers.onChatEvent) throw new Error('REALTIME_CHAT_EVENT_HANDLER_MISSING');
        await handlers.onChatEvent(event);
        break;
      case 'message.edited':
        if (!handlers.onMessageEdited) throw new Error('REALTIME_CHAT_EDIT_HANDLER_MISSING');
        await handlers.onMessageEdited(event);
        break;
      case 'message.recalled':
        if (!handlers.onMessageRecalled) throw new Error('REALTIME_CHAT_RECALL_HANDLER_MISSING');
        await handlers.onMessageRecalled(event);
        break;
      case 'chat.read':
        if (!handlers.onChatRead) throw new Error('REALTIME_CHAT_READ_HANDLER_MISSING');
        await handlers.onChatRead(event);
        break;
      default:
        throw new Error('REALTIME_CHAT_EVENT_KIND_UNSUPPORTED');
    }
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
