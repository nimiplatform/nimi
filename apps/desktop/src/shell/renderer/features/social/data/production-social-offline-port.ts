import { getOfflineCoordinator } from '../../../infra/offline/coordinator.js';
import { createDesktopProductionOfflinePort } from '../../../infra/offline/production-offline-port.js';
import type { RealmSocialOfflinePort } from './social-offline-port.js';

export const productionDesktopOfflinePort = createDesktopProductionOfflinePort(
  getOfflineCoordinator(),
);

export const productionRealmSocialOfflinePort: RealmSocialOfflinePort = Object.freeze({
  syncProfileMetadata: productionDesktopOfflinePort.syncProfileMetadata,
  loadProfileMetadata: productionDesktopOfflinePort.getCachedProfileMetadata,
  markCacheFallbackUsed: productionDesktopOfflinePort.markCacheFallbackUsed,
  markRealmUnreachable: productionDesktopOfflinePort.markRealmUnreachable,
  queueSocialMutation: productionDesktopOfflinePort.queueSocialMutation,
});
