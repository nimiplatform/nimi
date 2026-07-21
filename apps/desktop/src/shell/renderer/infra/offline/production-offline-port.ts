import { createNimiClientId } from '@nimiplatform/sdk';
import type { OfflineCoordinator } from '@nimiplatform/kit/core/offline-coordinator';
import type { DesktopRendererOfflinePort } from '../../renderer/offline-port.js';
import type { PersistentSocialMutationEntry } from './types.js';
import { OfflineCacheManager } from './cache-manager.js';
import { OfflineOutboxManager } from './outbox-manager.js';

export type DesktopProductionOfflinePort = DesktopRendererOfflinePort & {
  queueSocialMutationEntry(entry: PersistentSocialMutationEntry): Promise<void>;
  getPendingSocialMutationCount(): Promise<number>;
  getSocialMutationEntries(): Promise<PersistentSocialMutationEntry[]>;
  markSocialMutationSent(id: string): Promise<void>;
  markSocialMutationFailed(id: string, reason: string): Promise<void>;
};

export function createDesktopProductionOfflinePort(
  coordinator: OfflineCoordinator,
  options: { readonly enableEphemeralStore?: boolean } = {},
): DesktopProductionOfflinePort {
  const cache = new OfflineCacheManager(options);
  const outbox = new OfflineOutboxManager(options);
  let cacheOpen: Promise<void> | null = null;
  let outboxOpen: Promise<void> | null = null;
  let disposed = false;

  function requireActive(): void {
    if (disposed) throw new Error('DESKTOP_RENDERER_OFFLINE_DISPOSED');
  }

  async function openCache(): Promise<OfflineCacheManager> {
    requireActive();
    cacheOpen ||= cache.open();
    await cacheOpen;
    requireActive();
    return cache;
  }

  async function openOutbox(): Promise<OfflineOutboxManager> {
    requireActive();
    outboxOpen ||= outbox.open();
    await outboxOpen;
    requireActive();
    return outbox;
  }

  return Object.freeze({
    async syncChatList<T extends object>(chats: T[]) {
      await (await openCache()).syncChatList(chats);
    },
    async getCachedChatList<T extends object>() {
      return (await openCache()).getCachedChatList<T>();
    },
    async syncChatMessages<T extends object>(chatId: string, messages: T[]) {
      await (await openCache()).syncChatMessages(chatId, messages);
    },
    async getCachedMessages<T extends object>(chatId: string) {
      return (await openCache()).getCachedMessages<T>(chatId);
    },
    async syncProfileMetadata<T extends object>(profileKey: string, payload: T) {
      await (await openCache()).syncProfileMetadata(profileKey, payload);
    },
    async getCachedProfileMetadata<T extends object>(profileKey: string) {
      return (await openCache()).getCachedProfileMetadata<T>(profileKey);
    },
    async syncWorldList<T extends object>(worlds: T[]) {
      await (await openCache()).syncWorldList(worlds);
    },
    async getCachedWorldList<T extends object>() {
      return (await openCache()).getCachedWorldList<T>();
    },
    async syncWorldMetadata<T extends object>(worldId: string, payload: T) {
      await (await openCache()).syncWorldMetadata(worldId, payload);
    },
    async getCachedWorldMetadata<T extends object>(worldId: string) {
      return (await openCache()).getCachedWorldMetadata<T>(worldId);
    },
    async upsertChatOutboxEntry(entry: Parameters<DesktopRendererOfflinePort['upsertChatOutboxEntry']>[0]) {
      await (await openOutbox()).upsertChatOutboxEntry(entry);
    },
    async getChatOutboxEntry(clientMessageId: string) {
      return (await openOutbox()).getChatOutboxEntry(clientMessageId);
    },
    async getChatOutboxEntries(chatId?: string) {
      return (await openOutbox()).getChatOutboxEntries(chatId);
    },
    async markChatOutboxSent(clientMessageId: string) {
      await (await openOutbox()).markChatOutboxSent(clientMessageId);
    },
    async markChatOutboxFailed(clientMessageId: string, reason: string) {
      await (await openOutbox()).markChatOutboxFailed(clientMessageId, reason);
    },
    markCacheFallbackUsed() {
      requireActive();
      coordinator.markCacheFallbackUsed();
    },
    markRealmUnreachable() {
      requireActive();
      coordinator.markRealmRestReachability('unreachable');
    },
    getTier() {
      requireActive();
      return coordinator.getTier();
    },
    async queueSocialMutation(input: Parameters<DesktopRendererOfflinePort['queueSocialMutation']>[0]) {
      const manager = await openOutbox();
      await manager.queueSocialMutation({
        id: createNimiClientId(`social:${input.kind}`),
        kind: input.kind,
        payload: input.payload,
        enqueuedAt: input.now(),
        attempts: 0,
        status: 'pending',
      });
    },
    async queueSocialMutationEntry(entry: PersistentSocialMutationEntry) {
      await (await openOutbox()).queueSocialMutation(entry);
    },
    async getPendingSocialMutationCount() {
      return (await openOutbox()).getPendingSocialMutationCount();
    },
    async getSocialMutationEntries() {
      return (await openOutbox()).getSocialMutationEntries();
    },
    async markSocialMutationSent(id: string) {
      await (await openOutbox()).markSocialMutationSent(id);
    },
    async markSocialMutationFailed(id: string, reason: string) {
      await (await openOutbox()).markSocialMutationFailed(id, reason);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cache.close();
      outbox.close();
      cacheOpen = null;
      outboxOpen = null;
    },
  });
}
