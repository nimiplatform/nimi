import {
  executeRealmSocialMutation,
  type RealmSocialFeedApiCaller,
  type RealmSocialFeedErrorEmitter,
} from '@nimiplatform/sdk/realm';
import { createNimiClientId } from '@nimiplatform/sdk/runtime';
import {
  getNimiErrorMessage as getErrorMessage,
  isRealmOfflineErrorLike as isRealmOfflineError,
} from '@nimiplatform/sdk/types';
import {
  getOfflineOutboxManager,
  type PersistentSocialMutationEntry,
  type SocialMutationKind,
} from '@renderer/infra/offline';

function createId(prefix: string): string {
  return createNimiClientId(prefix);
}

export async function queueSocialMutation(input: {
  kind: SocialMutationKind;
  payload: Record<string, unknown>;
}): Promise<PersistentSocialMutationEntry> {
  const manager = await getOfflineOutboxManager();
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
  const manager = await getOfflineOutboxManager();
  return await manager.getPendingSocialMutationCount();
}

async function executeSocialMutation(
  callApi: RealmSocialFeedApiCaller,
  entry: PersistentSocialMutationEntry,
): Promise<void> {
  return executeRealmSocialMutation(callApi, entry);
}

export async function flushPendingSocialMutations(
  callApi: RealmSocialFeedApiCaller,
  emitRealmDataError: RealmSocialFeedErrorEmitter,
): Promise<void> {
  const manager = await getOfflineOutboxManager();
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
      emitRealmDataError('flush-social-outbox', error, {
        kind: entry.kind,
        id: entry.id,
      });
    }
  }
}
