import { asNimiError, createNimiError, extractNimiErrorFields } from '@nimiplatform/sdk/types';

const rejectedRefreshReasons = new Set(['AUTH_INVALID_REFRESH_TOKEN', 'AUTH_REFRESH_TOKEN_REVOKED',
  'AUTH_REFRESH_TOKEN_REPLAY_DETECTED', 'AUTH_TOKEN_EXPIRED', 'AUTH_SESSION_REVOKED',
  'AUTH_INVALID_CREDENTIALS', 'AUTH_INVALID_TOKEN_TYPE', 'AUTH_ACCOUNT_RESTRICTED', 'AUTH_ACCOUNT_NOT_FOUND']);

export class BrowserSessionRenewalBlockedError extends Error {
  constructor(cause?: unknown) {
    super('Automatic session renewal is unavailable. Sign in again to continue.', { cause });
    this.name = 'BrowserSessionRenewalBlockedError';
  }
}

// Used inside the existing origin-wide Web Lock. This stores no credentials or
// account projection: it prevents a later tab/reload from replaying a cookie
// after the previous rotation's result was lost. Only a new completed login
// may clear an uncertain attempt; a still-valid access cookie proves nothing
// about whether the refresh cookie was rotated.
export function createBrowserSessionRenewal(input: {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  key: string;
  renew: () => Promise<void>;
}) {
  const clearCompletedAttempt = () => {
    try { input.storage.removeItem(input.key); } catch {
      // Realm has already completed the operation. Storage failure may leave
      // renewal blocked, but cannot turn a confirmed login into a failed one.
    }
  };
  return {
    async renew(): Promise<void> {
      let prior: string | null;
      try { prior = input.storage.getItem(input.key); } catch (error) {
        throw new BrowserSessionRenewalBlockedError(error);
      }
      if (prior && rejectedRefreshReasons.has(prior)) throw createNimiError({
        reasonCode: prior, source: 'sdk', message: 'The previous browser session renewal was rejected. Sign in again.',
      });
      if (prior) throw new BrowserSessionRenewalBlockedError();
      try { input.storage.setItem(input.key, 'pending'); } catch (error) {
        throw new BrowserSessionRenewalBlockedError(error);
      }
      try {
        await input.renew();
      } catch (error) {
        const failure = asNimiError(error);
        if (failure.reasonCode === 'AUTH_RATE_LIMITED' && failure.details?.status === 429) {
          clearCompletedAttempt();
          throw error;
        }
        if (rejectedRefreshReasons.has(failure.reasonCode)) {
          try { input.storage.setItem(input.key, failure.reasonCode); } catch { /* The pending marker still denies replay. */ }
          throw error;
        }
        if (failure.reasonCode === 'ACCOUNT_DELETED') throw error;
        throw new BrowserSessionRenewalBlockedError(error);
      }
      clearCompletedAttempt();
    },
    async confirmLogin<T>(readAccount: () => Promise<T>): Promise<T> {
      const account = await readAccount();
      clearCompletedAttempt();
      return account;
    },
  };
}

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
