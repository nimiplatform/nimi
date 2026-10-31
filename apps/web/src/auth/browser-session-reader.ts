import { extractNimiErrorFields } from '@nimiplatform/sdk/types';

function missingAccess(error: unknown): boolean {
  const code = extractNimiErrorFields(error).reasonCode;
  return code === 'AUTH_REQUIRED' || code === 'AUTH_TOKEN_EXPIRED';
}

/** One authoritative account read. Renewal is serialized and never replays writes. */
export function createBrowserSessionReader<T>(input: {
  read: () => Promise<T>;
  renew: () => Promise<void>;
  exclusive: (readOrRenew: () => Promise<T>, originalError: unknown) => Promise<T>;
}): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (pending) return pending;
    const run = async () => {
      try {
        return await input.read();
      } catch (initialError) {
        if (!missingAccess(initialError)) throw initialError;
        return input.exclusive(async () => {
          // Another tab may have renewed the shared cookie while this one waited.
          try {
            return await input.read();
          } catch (error) {
            if (!missingAccess(error)) throw error;
          }
          try {
            await input.renew();
          } catch (error) {
            const code = extractNimiErrorFields(error).reasonCode;
            if (
              [
                'AUTH_INVALID_REFRESH_TOKEN',
                'AUTH_REFRESH_TOKEN_REVOKED',
                'AUTH_REFRESH_TOKEN_REPLAY_DETECTED',
              ].includes(code || '')
            )
              throw initialError;
            throw error;
          }
          return input.read();
        }, initialError);
      }
    };
    pending = run().finally(() => {
      pending = null;
    });
    return pending;
  };
}
