export type {
  OfflineTier,
  OfflineTierChange,
  ConnectivityStatus,
  PersistentOutboxEntry,
  PersistentSocialMutationEntry,
  SocialMutationKind,
} from './types.js';

export {
  OUTBOX_MAX_ENTRIES,
  RECONNECT_INITIAL_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  CACHE_MAX_CHATS,
  CACHE_MAX_MESSAGES_PER_CHAT,
} from './types.js';

export { ConnectivityMonitor } from './connectivity-monitor.js';
export { OfflineStateManager } from './offline-state-manager.js';
export { OfflineCacheManager, getOfflineCacheManager } from './cache-manager.js';
export { getOfflineCoordinator, OfflineCoordinator } from './coordinator.js';
export {
  createOfflineError,
  getErrorMessage,
  isNimiErrorLike,
  isRealmOfflineError,
  isRuntimeOfflineError,
} from './errors.js';
