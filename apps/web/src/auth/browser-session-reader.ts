import { extractNimiErrorFields } from '@nimiplatform/sdk/types';

function missingAccess(error: unknown): boolean {
  const code = extractNimiErrorFields(error).reasonCode;
  return code === 'AUTH_REQUIRED' || code === 'AUTH_TOKEN_EXPIRED';
}

type BrowserAccountRead<T> =
  | { account: T }
  | { error: unknown; noRefreshCookie?: boolean };

/** Renewal is serialized and followed by an authoritative account read. */
export function createBrowserSessionReader<T>(input: {
  read: () => Promise<BrowserAccountRead<T>>;
  renew: () => Promise<void>;
  exclusive: (readOrRenew: () => Promise<T>, originalError: unknown) => Promise<T>;
}): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (pending) return pending;
    const run = async () => {
      const initial = await input.read();
      if ('account' in initial) return initial.account;
      if (initial.noRefreshCookie || !missingAccess(initial.error)) throw initial.error;

      return input.exclusive(async () => {
        // Another tab may have renewed or cleared the shared cookies while this one waited.
        const current = await input.read();
        if ('account' in current) return current.account;
        if (current.noRefreshCookie || !missingAccess(current.error)) throw current.error;

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
            throw initial.error;
          throw error;
        }
        const renewed = await input.read();
        if ('account' in renewed) return renewed.account;
        throw renewed.error;
      }, initial.error);
    };
    pending = run().finally(() => {
      pending = null;
    });
    return pending;
  };
}
