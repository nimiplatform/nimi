import type { OfflineCoordinator } from '@nimiplatform/kit/core/offline-coordinator';
import type { DesktopRendererOfflinePort } from '../../renderer/offline-port.js';
import { OfflineCacheManager } from './cache-manager.js';
import { OfflineOutboxManager } from './outbox-manager.js';
import { deleteOfflineDatabase } from './database.js';
import { offlineScopeKey, type OfflineAccessScope, type OfflineAccountScope } from './types.js';

export type DesktopProductionOfflinePort = DesktopRendererOfflinePort;
type ScopeStore = { cache: OfflineCacheManager; outbox: OfflineOutboxManager; ready: Promise<void> };

// @nimi-authority: rule.nimi.desktop.shell-runtime.r009
// @nimi-authority: rule.nimi.desktop.shell-runtime.r010
export function createDesktopProductionOfflinePort(
  coordinator: OfflineCoordinator,
  options: { readonly enableEphemeralStore?: boolean; readonly readScope?: () => OfflineAccessScope | null } = {},
): DesktopProductionOfflinePort {
  const stores = new Map<string, ScopeStore>();
  const purged = new Set<string>();
  const draftWrites = new Map<string, Promise<void>>();
  let disposed = false;
  function currentScope(): OfflineAccessScope {
    if (disposed) throw new Error('DESKTOP_RENDERER_OFFLINE_DISPOSED');
    const scope = options.readScope?.();
    if (!scope) throw new Error('OFFLINE_ACCOUNT_SCOPE_REQUIRED');
    if (purged.has(offlineScopeKey(scope))) throw new Error('OFFLINE_ACCOUNT_DELETED');
    return { ...scope };
  }
  function check(scope: OfflineAccessScope) {
    const current = currentScope();
    if (current.generation !== scope.generation || offlineScopeKey(current) !== offlineScopeKey(scope)) throw new Error('OFFLINE_ACCOUNT_CHANGED');
  }
  async function open(scope: OfflineAccessScope): Promise<ScopeStore> {
    check(scope);
    const key = offlineScopeKey(scope);
    let store = stores.get(key);
    if (!store) {
      const cache = new OfflineCacheManager({ ...options, scope });
      const outbox = new OfflineOutboxManager({ ...options, scope });
      store = { cache, outbox, ready: Promise.all([cache.open(), outbox.open()]).then(() => undefined) };
      stores.set(key, store);
      void store.ready.catch(() => { if (stores.get(key) === store) stores.delete(key); });
    }
    await store.ready;
    check(scope);
    return store;
  }
  async function run<T>(scope: OfflineAccessScope, task: (store: ScopeStore) => Promise<T>): Promise<T> {
    const value = await task(await open(scope));
    check(scope);
    return value;
  }
  function port(captured?: OfflineAccessScope): DesktopProductionOfflinePort {
    const scope = () => { const value = captured ?? currentScope(); check(value); return value; };
    return Object.freeze({
      capture: () => port(scope()),
      async purgeAccount(account: OfflineAccountScope) {
        const key = offlineScopeKey(account);
        purged.add(key);
        const store = stores.get(key);
        if (store) {
          await store.ready.catch(() => undefined);
          store.cache.close(); store.outbox.close(); stores.delete(key);
        }
        await deleteOfflineDatabase(account);
      },
      syncChatList: <T extends object>(chats: T[]) => run(scope(), s => s.cache.syncChatList(chats)),
      getCachedChatList: <T extends object>() => run(scope(), s => s.cache.getCachedChatList<T>()),
      syncChatMessages: <T extends object>(chatId: string, messages: T[]) => run(scope(), s => s.cache.syncChatMessages(chatId, messages)),
      getCachedMessages: <T extends object>(chatId: string) => run(scope(), s => s.cache.getCachedMessages<T>(chatId)),
      syncProfileMetadata: <T extends object>(key: string, payload: T) => run(scope(), s => s.cache.syncProfileMetadata(key, payload)),
      getCachedProfileMetadata: <T extends object>(key: string) => run(scope(), s => s.cache.getCachedProfileMetadata<T>(key)),
      removeProfileMetadata: key => run(scope(), s => s.cache.removeProfileMetadata(key)),
      saveHumanDraft(draft) {
        const owner = scope();
        const key = JSON.stringify([offlineScopeKey(owner), draft.peerAccountId]);
        const write = (draftWrites.get(key) ?? Promise.resolve()).catch(() => undefined)
          .then(() => run(owner, s => s.cache.saveHumanDraft(draft)));
        draftWrites.set(key, write);
        void write.finally(() => { if (draftWrites.get(key) === write) draftWrites.delete(key); }).catch(() => undefined);
        return write;
      },
      async loadHumanDraft(peerAccountId) {
        const owner = scope();
        await draftWrites.get(JSON.stringify([offlineScopeKey(owner), peerAccountId]));
        return run(owner, s => s.cache.loadHumanDraft(peerAccountId));
      },
      upsertChatOutboxEntry: entry => run(scope(), s => s.outbox.upsertChatOutboxEntry(entry)),
      getChatOutboxEntry: id => run(scope(), s => s.outbox.getChatOutboxEntry(id)),
      getChatOutboxEntries: chatId => run(scope(), s => s.outbox.getChatOutboxEntries(chatId)),
      removeChatOutboxEntry: id => run(scope(), s => s.outbox.removeChatOutboxEntry(id)),
      markChatOutboxFailed: (id, reason) => run(scope(), s => s.outbox.markChatOutboxFailed(id, reason)),
      markCacheFallbackUsed() { if (captured) check(captured); coordinator.markCacheFallbackUsed(); },
      markRealmUnreachable() { if (captured) check(captured); coordinator.markRealmRestReachability('unreachable'); },
      getTier: () => coordinator.getTier(),
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const store of stores.values()) void store.ready.finally(() => { store.cache.close(); store.outbox.close(); }).catch(() => undefined);
        stores.clear();
      },
    } satisfies DesktopRendererOfflinePort);
  }
  return port();
}
