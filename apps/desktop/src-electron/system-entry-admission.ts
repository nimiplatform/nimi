import { randomUUID } from 'node:crypto';
import type { SystemEntryAdmission, SystemEntryAdmissionState } from '../src/shell/shared/system-entry-types.js';

type AccountObservation = Readonly<{
  state: string;
  accountProjection?: Readonly<{ accountId: string; realmEnvironmentId: string }>;
}>;
type ProductObservation = Readonly<{
  state?: string;
  record?: null | Readonly<{ dataRoot?: null | Readonly<{ status?: string; rootActivationId?: string | null }> }>;
  rootHandoff?: null | Readonly<{ disposition?: string; rootActivationId?: string }>;
}>;

// @nimi-authority: rule.nimi.desktop.bridge-ipc.system-entry-isolation
/** The random generation fences views. Only the two owner reads admit work. */
export function createSystemEntryAdmission(input: {
  readAccount(): Promise<AccountObservation>;
  readProduct(): Promise<unknown>;
  normalWorkAllowed(): boolean;
  onInvalidated(): void;
  onScopeChanged?(previous: SystemEntryAdmission): void;
}) {
  let generation = randomUUID();
  let identity = '';
  let lastAccountIdentity = '';
  let state: SystemEntryAdmissionState = 'unknown';
  let locked = false;
  let invalidation = 0;
  let pending: Promise<SystemEntryAdmission> | undefined;
  const snapshot = (): SystemEntryAdmission => ({ generation, state });
  const invalidate = () => {
    invalidation += 1;
    generation = randomUUID();
    identity = '';
    state = locked ? 'locked' : 'unknown';
    input.onInvalidated();
  };
  const observeAccount = (account: AccountObservation | null) => {
    const next = account && (account.state === 'authenticated' || account.state === 'refresh-pending') && account.accountProjection
      ? `${account.accountProjection.realmEnvironmentId}:${account.accountProjection.accountId}` : '';
    if (next !== lastAccountIdentity || !next) {
      lastAccountIdentity = next;
      invalidate();
    }
  };
  const read = (): Promise<SystemEntryAdmission> => {
    if (locked) return Promise.resolve(snapshot());
    if (pending) return pending;
    const version = invalidation;
    pending = Promise.all([input.readAccount(), input.readProduct()]).then(([account, raw]) => {
      if (version !== invalidation) return snapshot();
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('system-entry-product-observation-invalid');
      const product = raw as ProductObservation;
      const activation = product.record?.dataRoot?.rootActivationId;
      const accountReady = (account.state === 'authenticated' || account.state === 'refresh-pending')
        && Boolean(account.accountProjection?.accountId && account.accountProjection.realmEnvironmentId);
      const productReady = input.normalWorkAllowed()
        && product.state === 'ready_for_use' && product.record?.dataRoot?.status === 'ready'
        && typeof activation === 'string' && activation.length > 0
        && product.rootHandoff?.disposition === 'active_current_process'
        && product.rootHandoff.rootActivationId === activation;
      const nextState: SystemEntryAdmissionState = !accountReady
        ? account.state === 'unavailable' ? 'unknown' : 'login-required'
        : productReady ? 'ready' : 'recovery-required';
      const nextIdentity = `${nextState}:${account.accountProjection?.realmEnvironmentId ?? ''}:${account.accountProjection?.accountId ?? ''}:${activation ?? ''}`;
      if (identity !== nextIdentity) {
        const previous = snapshot();
        generation = randomUUID();
        identity = nextIdentity;
        // The host consumes this newly read admission immediately. Calling its
        // external invalidation hook here would invalidate the read itself.
        input.onScopeChanged?.(previous);
      }
      lastAccountIdentity = accountReady ? `${account.accountProjection!.realmEnvironmentId}:${account.accountProjection!.accountId}` : '';
      state = nextState;
      return snapshot();
    }).catch(error => {
      if (version === invalidation) invalidate();
      throw error;
    }).finally(() => { pending = undefined; });
    return pending;
  };
  return {
    read, snapshot, invalidate, observeAccount,
    setLocked(value: boolean) { if (locked !== value) { locked = value; invalidate(); } },
  };
}
