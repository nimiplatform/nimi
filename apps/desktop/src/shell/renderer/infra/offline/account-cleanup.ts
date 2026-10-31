import { AccountReasonCode } from '@nimiplatform/kit/core/sdk-contract';
import type { AppStoreState } from '../../app-shell/providers/store-types.js';
import type { OfflineAccountScope } from './types.js';

/** Only the typed current-account terminal transition may clear Home-owned data. */
export function deletedOfflineAccount(
  previous: AppStoreState['auth'],
  current: AppStoreState['auth'],
): OfflineAccountScope | null {
  if (current.accountReasonCode !== AccountReasonCode.ACCOUNT_DELETED
    || !current.deletedOwner || current.user) return null;
  const owner = current.deletedOwner;
  if (previous.accountReasonCode === AccountReasonCode.ACCOUNT_DELETED &&
      previous.deletedOwner?.accountId === owner.accountId && previous.deletedOwner.realmEnvironmentId === owner.realmEnvironmentId) return null;
  return owner;
}
