import { getOfflineCacheManager } from '../../../infra/offline/cache-manager.js';
import { getOfflineCoordinator } from '../../../infra/offline/coordinator.js';
import { queueSocialMutation } from './offline-social-outbox.js';
import type { RealmSocialOfflinePort } from './social-offline-port.js';
import type { JsonObject } from '@nimiplatform/sdk/types';
import type { SocialMutationKind } from '../../../infra/offline/types.js';

export const productionRealmSocialOfflinePort: RealmSocialOfflinePort = Object.freeze({
  async syncProfileMetadata(key: string, profile: object) {
    const cache = await getOfflineCacheManager();
    await cache.syncProfileMetadata(key, profile);
  },
  async loadProfileMetadata<T extends object>(key: string): Promise<T | null> {
    const cache = await getOfflineCacheManager();
    return cache.getCachedProfileMetadata<T>(key);
  },
  markCacheFallbackUsed() {
    getOfflineCoordinator().markCacheFallbackUsed();
  },
  markRealmUnreachable() {
    getOfflineCoordinator().markRealmRestReachability('unreachable');
  },
  async queueSocialMutation(input: {
    readonly kind: SocialMutationKind;
    readonly payload: JsonObject;
    readonly now: () => number;
  }) {
    await queueSocialMutation(input);
  },
});
