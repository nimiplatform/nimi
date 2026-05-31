export type {
  ConnectivityStatus,
  OfflineCoordinatorTimer,
  OfflineTier,
  OfflineTierChange,
} from '@nimiplatform/kit/core/offline-coordinator';
export {
  ConnectivityMonitor,
  OFFLINE_RECONNECT_INITIAL_DELAY_MS,
  OFFLINE_RECONNECT_MAX_DELAY_MS,
  OfflineCoordinator,
  OfflineStateManager,
} from '@nimiplatform/kit/core/offline-coordinator';
export type {
  PersistentOutboxEntry,
  PersistentSocialMutationEntry,
  SocialMutationKind,
} from './types.js';
export {
  OFFLINE_CACHE_MAX_CHATS,
  OFFLINE_CACHE_MAX_MESSAGES_PER_CHAT,
  OFFLINE_OUTBOX_MAX_ENTRIES,
} from './types.js';
export { OfflineCacheManager, getOfflineCacheManager } from './cache-manager.js';
export { getOfflineCoordinator } from './coordinator.js';
export {
  createOfflineError,
  getErrorMessage,
  isNimiErrorLike,
  isRealmOfflineError,
  isRuntimeOfflineError,
} from './errors.js';
