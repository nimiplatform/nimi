// Kit gates a local App's operations once its technical session is
// invalidated (Runtime restart, lost carrier, account or declaration change)
// until a session status check binds a fresh session on the same exact Host.
// Lab observes those failures so its runtime gate re-runs that check; the
// failed request itself is never retried.
const LAB_LOCAL_APP_SESSION_LOSS_REASONS: ReadonlySet<string> = new Set([
  'runtime-service-unavailable',
  'runtime-service-untrusted',
  'runtime-service-error-unclassified',
  'runtime-unauthenticated',
  'process-replaced',
  'account-changed',
  'runtime-restarted',
  'revoked',
  'project-changed',
  'local-app-snapshot-unavailable',
]);

const listeners = new Set<() => void>();

export function labLocalAppSessionLossReason(error: unknown): string | null {
  const reasonCode = typeof error === 'object' && error !== null
    ? (error as { readonly reasonCode?: unknown }).reasonCode
    : undefined;
  return typeof reasonCode === 'string' && LAB_LOCAL_APP_SESSION_LOSS_REASONS.has(reasonCode) ? reasonCode : null;
}

export function subscribeLabLocalAppSessionLoss(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function reportLabLocalAppSessionLoss(error: unknown): void {
  if (labLocalAppSessionLossReason(error) === null) return;
  for (const listener of [...listeners]) listener();
}

/**
 * Wraps the Kit standard-shell surface so an operation rejected for a lost
 * technical session is reported. The session namespace stays unwrapped: its
 * status check is the recovery itself.
 */
export function observeLabLocalAppSessionLoss<T extends object>(surface: T): T {
  return observeNamespace(surface, true) as T;
}

function observeNamespace(namespace: object, root: boolean): object {
  const observed: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(namespace)) {
    if (root && key === 'session') {
      observed[key] = entry;
    } else if (typeof entry === 'function') {
      observed[key] = observeOperation(entry as (...args: unknown[]) => unknown);
    } else if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      observed[key] = observeNamespace(entry, false);
    } else {
      observed[key] = entry;
    }
  }
  return observed;
}

function observeOperation(operation: (...args: unknown[]) => unknown) {
  return function observedOperation(this: unknown, ...args: unknown[]): unknown {
    const result = Reflect.apply(operation, this, args);
    if (result === null || typeof result !== 'object' || typeof (result as PromiseLike<unknown>).then !== 'function') {
      return result;
    }
    return Promise.resolve(result).catch((error: unknown) => {
      reportLabLocalAppSessionLoss(error);
      throw error;
    });
  };
}
