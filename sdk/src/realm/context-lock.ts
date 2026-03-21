import { Realm } from './client.js';
import type { RealmFetchImpl, RealmTokenRefreshResult } from './client-types.js';

export type RealmContextInput = {
  realmBaseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  fetchImpl?: RealmFetchImpl | null;
  onTokenRefreshed?: (result: RealmTokenRefreshResult) => void;
  onRefreshFailed?: (error: unknown) => void;
};

const contextQueues = new Map<string, Promise<void>>();

function createRealmContext(input: RealmContextInput): Realm {
  const refreshToken = String(input.refreshToken || '').trim();
  return new Realm({
    baseUrl: input.realmBaseUrl,
    auth: {
      accessToken: async () => String(input.accessToken || ''),
      refreshToken: refreshToken || undefined,
      onTokenRefreshed: input.onTokenRefreshed,
      onRefreshFailed: input.onRefreshFailed,
    },
    fetchImpl: input.fetchImpl || undefined,
  });
}

export async function withRealmContextLock<T>(
  input: RealmContextInput,
  task: (realm: Realm) => Promise<T>,
): Promise<T> {
  const queueKey = String(input.realmBaseUrl || '').trim();
  const previous = contextQueues.get(queueKey) || Promise.resolve();
  const current = previous.then(async () => {
    const realm = createRealmContext(input);
    try {
      await realm.connect();
      return await task(realm);
    } finally {
      await realm.close();
    }
  });

  const nextQueue = current.then(
    () => undefined,
    () => undefined,
  );
  contextQueues.set(queueKey, nextQueue);
  void nextQueue.finally(() => {
    if (contextQueues.get(queueKey) === nextQueue) {
      contextQueues.delete(queueKey);
    }
  });

  return current;
}
