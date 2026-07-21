import type { JsonObject } from '@nimiplatform/sdk/types';
import type {
  PersistentOutboxEntry,
  SocialMutationKind,
} from '../infra/offline/types.js';

export interface DesktopRendererOfflinePort {
  syncChatList<T extends object>(chats: T[]): Promise<void>;
  getCachedChatList<T extends object = JsonObject>(): Promise<T[]>;
  syncChatMessages<T extends object>(chatId: string, messages: T[]): Promise<void>;
  getCachedMessages<T extends object = JsonObject>(chatId: string): Promise<T[]>;
  syncProfileMetadata<T extends object>(profileKey: string, payload: T): Promise<void>;
  getCachedProfileMetadata<T extends object = JsonObject>(profileKey: string): Promise<T | null>;
  syncWorldList<T extends object>(worlds: T[]): Promise<void>;
  getCachedWorldList<T extends object = JsonObject>(): Promise<T[]>;
  syncWorldMetadata<T extends object>(worldId: string, payload: T): Promise<void>;
  getCachedWorldMetadata<T extends object = JsonObject>(worldId: string): Promise<T | null>;
  upsertChatOutboxEntry(entry: PersistentOutboxEntry): Promise<void>;
  getChatOutboxEntry(clientMessageId: string): Promise<PersistentOutboxEntry | undefined>;
  getChatOutboxEntries(chatId?: string): Promise<PersistentOutboxEntry[]>;
  markChatOutboxSent(clientMessageId: string): Promise<void>;
  markChatOutboxFailed(clientMessageId: string, reason: string): Promise<void>;
  markCacheFallbackUsed(): void;
  markRealmUnreachable(): void;
  getTier(): 'L0' | 'L1' | 'L2';
  queueSocialMutation(input: {
    readonly kind: SocialMutationKind;
    readonly payload: JsonObject;
    readonly now: () => number;
  }): Promise<void>;
  dispose(): void;
}

export function createUnavailableDesktopRendererOfflinePort(
  reason = 'DESKTOP_RENDERER_OFFLINE_UNAVAILABLE',
): DesktopRendererOfflinePort {
  const unavailable = async (): Promise<never> => {
    throw new Error(reason);
  };
  const unavailableSync = (): never => {
    throw new Error(reason);
  };
  return Object.freeze({
    syncChatList: unavailable,
    getCachedChatList: unavailable,
    syncChatMessages: unavailable,
    getCachedMessages: unavailable,
    syncProfileMetadata: unavailable,
    getCachedProfileMetadata: unavailable,
    syncWorldList: unavailable,
    getCachedWorldList: unavailable,
    syncWorldMetadata: unavailable,
    getCachedWorldMetadata: unavailable,
    upsertChatOutboxEntry: unavailable,
    getChatOutboxEntry: unavailable,
    getChatOutboxEntries: unavailable,
    markChatOutboxSent: unavailable,
    markChatOutboxFailed: unavailable,
    markCacheFallbackUsed: unavailableSync,
    markRealmUnreachable: unavailableSync,
    getTier: unavailableSync,
    queueSocialMutation: unavailable,
    dispose() {},
  });
}
