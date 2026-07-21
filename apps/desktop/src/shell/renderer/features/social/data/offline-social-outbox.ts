import {
  executeNimiRealmSocialMutation,
} from '@nimiplatform/sdk/realm';
import { createNimiClientId } from '@nimiplatform/sdk';
import {
  getNimiErrorMessage as getErrorMessage,
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import { getOfflineOutboxManager } from '../../../infra/offline/outbox-manager';
import type {
  PersistentSocialMutationEntry,
  SocialMutationKind,
} from '../../../infra/offline/types';
import type { RealmApiCaller, RealmDataErrorEmitter } from './social-snapshot';

function createId(prefix: string): string {
  return createNimiClientId(prefix);
}

export async function queueSocialMutation(input: {
  kind: SocialMutationKind;
  payload: JsonObject;
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
  callApi: RealmApiCaller,
  entry: PersistentSocialMutationEntry,
): Promise<void> {
  return callApi(
    (realm) => executeNimiRealmSocialMutation(realm, entry),
    'Failed to execute Realm social mutation',
  );
}

export async function flushPendingSocialMutations(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
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
