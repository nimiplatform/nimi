import type { FetchImpl } from './api-core';
import { normalizeRealmBaseUrl } from './api-core';

const DATA_SYNC_HOT_STATE_KEY = '__NIMI_DATA_SYNC_API_CONFIG__' as const;

export type DataSyncHotState = {
  realmBaseUrl: string;
  accessToken: string;
  refreshToken: string;
  fetchImpl: FetchImpl | null;
};

type DataSyncGlobalRef = typeof globalThis & {
  [DATA_SYNC_HOT_STATE_KEY]?: Partial<DataSyncHotState>;
};

export function readDataSyncHotState(): DataSyncHotState | null {
  const snapshot = (globalThis as DataSyncGlobalRef)[DATA_SYNC_HOT_STATE_KEY];
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const realmBaseUrl = (() => {
    try {
      return normalizeRealmBaseUrl(snapshot.realmBaseUrl);
    } catch {
      return '';
    }
  })();
  if (!realmBaseUrl) {
    return null;
  }
  return {
    realmBaseUrl,
    accessToken: String(snapshot.accessToken || ''),
    refreshToken: String(snapshot.refreshToken || ''),
    fetchImpl: typeof snapshot.fetchImpl === 'function' ? snapshot.fetchImpl : null,
  };
}

export function writeDataSyncHotState(state: DataSyncHotState) {
  const globalRef = globalThis as DataSyncGlobalRef;
  globalRef[DATA_SYNC_HOT_STATE_KEY] = {
    realmBaseUrl: state.realmBaseUrl,
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
    fetchImpl: state.fetchImpl,
  };
}
