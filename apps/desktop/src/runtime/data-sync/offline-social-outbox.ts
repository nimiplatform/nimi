import type { Realm } from '@nimiplatform/sdk/realm';
import {
  getErrorMessage,
  getOfflineCacheManager,
  isRealmOfflineError,
  type PersistentSocialMutationEntry,
  type SocialMutationKind,
} from '@runtime/offline';

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

function createId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}:${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export async function queueSocialMutation(input: {
  kind: SocialMutationKind;
  payload: Record<string, unknown>;
}): Promise<PersistentSocialMutationEntry> {
  const manager = await getOfflineCacheManager();
  const entry: PersistentSocialMutationEntry = {
    id: createId(`social:${input.kind}`),
    kind: input.kind,
    payload: input.payload,
    enqueuedAt: Date.now(),
    attempts: 0,
    status: 'pending',
  };
  await manager.queueSocialMutation(entry);
  return entry;
}

export async function countPendingSocialMutations(): Promise<number> {
  const manager = await getOfflineCacheManager();
  return await manager.getPendingSocialMutationCount();
}

async function executeSocialMutation(
  callApi: DataSyncApiCaller,
  entry: PersistentSocialMutationEntry,
): Promise<void> {
  if (entry.kind === 'friend-add') {
    const userId = String(entry.payload.userId || '').trim();
    await callApi(
      (realm) => realm.services.UserService.addFriend(userId),
      '添加好友失败',
    );
    return;
  }
  if (entry.kind === 'friend-remove') {
    const userId = String(entry.payload.userId || '').trim();
    await callApi(
      (realm) => realm.services.UserService.removeFriend(userId),
      '移除好友失败',
    );
    return;
  }
  if (entry.kind === 'post-like') {
    const postId = String(entry.payload.postId || '').trim();
    await callApi(
      (realm) => realm.services.PostService.likePost(postId),
      '点赞失败',
    );
    return;
  }
  if (entry.kind === 'post-unlike') {
    const postId = String(entry.payload.postId || '').trim();
    await callApi(
      (realm) => realm.services.PostService.unlikePost(postId),
      '取消点赞失败',
    );
    return;
  }
}

export async function flushPendingSocialMutations(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<void> {
  const manager = await getOfflineCacheManager();
  const entries = await manager.getSocialMutationEntries();
  for (const entry of entries) {
    if (entry.status !== 'pending') {
      continue;
    }
    try {
      await executeSocialMutation(callApi, entry);
      await manager.markSocialMutationSent(entry.id);
    } catch (error) {
      if (isRealmOfflineError(error)) {
        await manager.queueSocialMutation({
          ...entry,
          attempts: entry.attempts + 1,
        });
        continue;
      }
      const reason = getErrorMessage(error, 'social mutation failed');
      await manager.markSocialMutationFailed(entry.id, reason);
      emitDataSyncError('flush-social-outbox', error, {
        kind: entry.kind,
        id: entry.id,
      });
    }
  }
}
