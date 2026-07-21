import { callRealmApi, emitRealmDataError } from '../../../infra/realm/realm-api.js';
import { createRealmSocialData } from './realm-social-data.js';
import { productionRealmSocialOfflinePort } from './production-social-offline-port.js';

export function createProductionRealmSocialData() {
  return createRealmSocialData({
    callApi: callRealmApi,
    emitDataError: emitRealmDataError,
    now: Date.now,
    offline: productionRealmSocialOfflinePort,
  });
}

export const productionRealmSocialData = createProductionRealmSocialData();
