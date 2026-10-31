import { asNimiError, extractNimiErrorFields } from '@nimiplatform/sdk/types';

export type AccountTerminationIntent = { expectedAccountId: string; operation_id: string };
export type AccountTerminationReceipt = { operation_id: string; deleted_at: string };
type IntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const prefix = (scope: string) => `nimi:account-termination:${encodeURIComponent(scope)}:`;

function readIntent(value: string | null): AccountTerminationIntent | null {
  try {
    const parsed = JSON.parse(value || 'null') as Partial<AccountTerminationIntent> | null;
    return parsed && typeof parsed.expectedAccountId === 'string' && typeof parsed.operation_id === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(parsed.operation_id)
      ? { expectedAccountId: parsed.expectedAccountId, operation_id: parsed.operation_id } : null;
  } catch { return null; }
}

export function getAccountTerminationIntent(storage: IntentStorage, scope: string, accountId: string, createId: () => string): AccountTerminationIntent {
  const key = prefix(scope) + encodeURIComponent(accountId);
  const existing = readIntent(storage.getItem(key));
  if (existing?.expectedAccountId === accountId) return existing;
  const intent = { expectedAccountId: accountId, operation_id: createId() };
  storage.setItem(key, JSON.stringify(intent));
  return intent;
}

export function clearAccountTerminationIntent(storage: IntentStorage, scope: string, intent: AccountTerminationIntent): void {
  storage.removeItem(prefix(scope) + encodeURIComponent(intent.expectedAccountId));
}

/** Only the authenticated owner's typed, exact committed operation confirms a
 * response lost before a reload. An ordinary 401 or local stored intent never does. */
export function recoverAccountTerminationReceipt(storage: IntentStorage, scope: string, error: unknown): AccountTerminationReceipt | null {
  const fields = extractNimiErrorFields(error);
  if (fields.reasonCode !== 'ACCOUNT_DELETED') return null;
  const details = asNimiError(error).details as Record<string, unknown> | undefined;
  const payload = details?.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload.operation_id !== 'string' || typeof payload.deleted_at !== 'string' || !Number.isFinite(Date.parse(payload.deleted_at))) return null;
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix(scope))) continue;
    const intent = readIntent(storage.getItem(key));
    if (intent?.operation_id === payload.operation_id) {
      storage.removeItem(key);
      return { operation_id: payload.operation_id, deleted_at: payload.deleted_at };
    }
  }
  return null;
}
