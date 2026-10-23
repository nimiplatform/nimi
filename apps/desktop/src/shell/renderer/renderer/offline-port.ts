import type { JsonObject } from '@nimiplatform/sdk/types';
import type {
  PersistentOutboxEntry,
} from '../infra/offline/types.js';

export interface DesktopRendererOfflinePort {
  syncChatList<T extends object>(chats: T[]): Promise<void>;
  getCachedChatList<T extends object = JsonObject>(): Promise<T[]>;
  syncChatMessages<T extends object>(chatId: string, messages: T[]): Promise<void>;
  getCachedMessages<T extends object = JsonObject>(chatId: string): Promise<T[]>;
  syncProfileMetadata<T extends object>(profileKey: string, payload: T): Promise<void>;
  getCachedProfileMetadata<T extends object = JsonObject>(profileKey: string): Promise<T | null>;
  upsertChatOutboxEntry(entry: PersistentOutboxEntry): Promise<void>;
  getChatOutboxEntry(clientMessageId: string): Promise<PersistentOutboxEntry | undefined>;
  getChatOutboxEntries(chatId?: string): Promise<PersistentOutboxEntry[]>;
  markChatOutboxSent(clientMessageId: string): Promise<void>;
  markChatOutboxFailed(clientMessageId: string, reason: string): Promise<void>;
  markCacheFallbackUsed(): void;
  markRealmUnreachable(): void;
  getTier(): 'L0' | 'L1' | 'L2';
  dispose(): void;
}
