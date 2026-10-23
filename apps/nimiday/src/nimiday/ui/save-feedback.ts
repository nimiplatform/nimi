import type { Copy } from '../i18n/index.js';
import type { StoreSnapshot } from '../store/day-store.js';

export function saveFailureMessage(copy: Copy, snapshot: Pick<StoreSnapshot, 'saveErrorKind'>, fallback = copy.common.saveFailed): string {
  switch (snapshot.saveErrorKind) {
    case 'capacity': return copy.common.saveCapacityFailed;
    case 'invalid-data': return copy.common.saveInvalidDataFailed;
    case 'uncertain': return copy.common.saveUncertain;
    default: return fallback;
  }
}
