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

type RealmContextQueueEntry = {
  pending: number;
  tail: Promise<void>;
};

const contextQueues = new Map<string, RealmContextQueueEntry>();

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
  const entry = contextQueues.get(queueKey) ?? {
    pending: 0,
    tail: Promise.resolve(),
  };
  const previous = entry.tail;
  entry.pending += 1;
  contextQueues.set(queueKey, entry);
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
  entry.tail = nextQueue;
  void nextQueue.finally(() => {
    entry.pending -= 1;
    if (entry.pending === 0 && contextQueues.get(queueKey) === entry) {
      contextQueues.delete(queueKey);
    }
  });

  return current;
}

export function getRealmContextLockQueueSizeForTest(): number {
  return contextQueues.size;
}
