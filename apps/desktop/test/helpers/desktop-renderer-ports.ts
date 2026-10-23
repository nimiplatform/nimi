import type { DesktopRendererFirstRunPort } from '../../src/shell/renderer/renderer/first-run-port.js';
import type { DesktopRendererWorldFollowPort } from '../../src/shell/renderer/renderer/world-follow-port.js';
import type { DesktopRendererOfflinePort } from '../../src/shell/renderer/renderer/offline-port.js';
import type { DesktopRendererSupportRepairPort } from '../../src/shell/renderer/renderer/support-repair-port.js';
import type { DesktopRendererSupportLogsPort } from '../../src/shell/renderer/renderer/support-logs-port.js';
import type { DesktopRendererSystemResourcesPort } from '../../src/shell/renderer/renderer/system-resources-port.js';
import type { DesktopRendererVoiceCapturePort } from '../../src/shell/renderer/renderer/voice-capture-port.js';
import type { DesktopRendererAvatarHandoffPort } from '../../src/shell/renderer/renderer/avatar-handoff-port.js';
import type { DesktopRendererLocalModelProgressPort } from '../../src/shell/renderer/renderer/local-model-progress-port.js';
import type { DesktopRendererVirtualizationPort, DesktopVirtualizerOptions, DesktopVirtualizerProjection } from '../../src/shell/renderer/renderer/virtualization-port.js';
import type { DesktopRendererAuthPort } from '../../src/shell/renderer/renderer/auth-port.js';
import type { DesktopRendererSettingsPort } from '../../src/shell/renderer/renderer/settings-port.js';
import type { AppearancePreferences } from '../../src/shell/renderer/features/settings/settings-device-preferences.js';

function authUnadmitted(): never {
  throw new Error('TEST_DESKTOP_AUTH_UNADMITTED');
}

export function createTestDesktopRendererAuthPort(): DesktopRendererAuthPort {
  return Object.freeze({
    oauthBridge: Object.freeze({
      hasShellHostInvoke: () => false,
      oauthListenForCode: async () => authUnadmitted(),
      openExternalUrl: async () => authUnadmitted(),
      focusMainWindow: async () => authUnadmitted(),
    }),
    runtimeAccountBroker: Object.freeze({
      begin: async () => authUnadmitted(),
      complete: async () => authUnadmitted(),
    }),
  });
}

export function createTestDesktopRendererSettingsPort(): DesktopRendererSettingsPort {
  let appearancePreferences: AppearancePreferences = {
    theme: 'system',
    reduceMotion: false,
  };
  const appearanceListeners = new Set<(preferences: AppearancePreferences) => void>();

  return Object.freeze({
    loadAppearancePreferences: () => ({ ...appearancePreferences }),
    persistAppearancePreferences(preferences: AppearancePreferences) {
      appearancePreferences = { ...preferences };
      for (const listener of appearanceListeners) listener({ ...appearancePreferences });
    },
    subscribeAppearancePreferences(listener: (preferences: AppearancePreferences) => void) {
      appearanceListeners.add(listener);
      return () => appearanceListeners.delete(listener);
    },
    async estimateStorageUsage() {
      return Object.freeze({
        localStorageBytes: 0,
        estimatedUsageBytes: 0,
        estimatedQuotaBytes: 0,
      });
    },
    async loadStorageDirs() {
      throw new Error('TEST_DESKTOP_STORAGE_DIRS_UNADMITTED');
    },
    async pickDataRootDirectory() {
      throw new Error('TEST_DESKTOP_DATA_ROOT_REPLACEMENT_UNADMITTED');
    },
    async replaceDataRoot() {
      throw new Error('TEST_DESKTOP_DATA_ROOT_REPLACEMENT_UNADMITTED');
    },
    async loadCheckSync() {
      throw new Error('TEST_DESKTOP_CHECK_SYNC_UNADMITTED');
    },
    async startCheckSync() {
      throw new Error('TEST_DESKTOP_CHECK_SYNC_UNADMITTED');
    },
  });
}

export function createUnavailableDesktopFirstRunPort(code: string): DesktopRendererFirstRunPort {
  const rejected = (): never => { throw new Error(code); };
  return Object.freeze({
    available: () => false,
    getHomeProfileStatus: async () => rejected(),
    retryHomeProfile: async () => rejected(),
    ensureRecordCreated: async () => rejected(),
    pickDataRootDirectory: async () => rejected(),
    selectDataRoot: async () => rejected(),
    getRecord: async () => rejected(),
    admitReadyForUse: async () => rejected(),
    getSelectedDataRoot: async () => rejected(),
    pickNewEmptyDataRootDirectory: async () => rejected(),
    replaceDataRootInMaintenance: async () => rejected(),
    relaunchFromMaintenance: async () => rejected(),
  });
}

export function createUnavailableDesktopRendererWorldFollowPort(
  reason = 'DESKTOP_RENDERER_WORLD_FOLLOW_UNAVAILABLE',
): DesktopRendererWorldFollowPort {
  const unavailable = (): never => {
    throw new Error(reason);
  };
  return Object.freeze({
    read: unavailable,
    write: unavailable,
    subscribe: unavailable,
  });
}

export function createUnavailableDesktopRendererOfflinePort(
  reason = 'DESKTOP_RENDERER_OFFLINE_UNAVAILABLE',
): DesktopRendererOfflinePort {
  const unavailable = async (): Promise<never> => {
    throw new Error(reason);
  };
  const unavailableSync = (): never => {
    throw new Error(reason);
  };
  return Object.freeze({
    syncChatList: unavailable,
    getCachedChatList: unavailable,
    syncChatMessages: unavailable,
    getCachedMessages: unavailable,
    syncProfileMetadata: unavailable,
    getCachedProfileMetadata: unavailable,
    upsertChatOutboxEntry: unavailable,
    getChatOutboxEntry: unavailable,
    getChatOutboxEntries: unavailable,
    markChatOutboxSent: unavailable,
    markChatOutboxFailed: unavailable,
    markCacheFallbackUsed: unavailableSync,
    markRealmUnreachable: unavailableSync,
    getTier: unavailableSync,
    queueSocialMutation: unavailable,
    dispose() {},
  });
}

export function createUnavailableDesktopRendererSupportRepairPort(
  reason = 'DESKTOP_RENDERER_SUPPORT_REPAIR_UNAVAILABLE',
): DesktopRendererSupportRepairPort {
  const unavailable = async (): Promise<never> => {
    throw new Error(reason);
  };
  return Object.freeze({
    loadProductControlRecord: unavailable,
    loadStorageDirs: unavailable,
    planDataCleanup: unavailable,
    executeDataCleanup: unavailable,
    planAppHostCacheCleanup: unavailable,
    executeAppHostCacheCleanup: unavailable,
  });
}

export function createUnavailableDesktopRendererSupportLogsPort(
  reason = 'DESKTOP_RENDERER_SUPPORT_LOGS_UNAVAILABLE',
): DesktopRendererSupportLogsPort {
  const unavailable = async (): Promise<never> => {
    throw new Error(reason);
  };
  return Object.freeze({
    loadStorageDirs: unavailable,
    exportLogs: unavailable,
  });
}

export function createUnavailableDesktopRendererSystemResourcesPort(
  reason = 'DESKTOP_RENDERER_SYSTEM_RESOURCES_UNAVAILABLE',
): DesktopRendererSystemResourcesPort {
  return Object.freeze({
    async load() {
      throw new Error(reason);
    },
  });
}

export function createUnavailableDesktopRendererVoiceCapturePort(
  reason = 'DESKTOP_RENDERER_VOICE_CAPTURE_UNAVAILABLE',
): DesktopRendererVoiceCapturePort {
  return Object.freeze({
    async start() {
      throw new Error(reason);
    },
  });
}

export function createUnavailableDesktopRendererAvatarHandoffPort(
  reason = 'DESKTOP_RENDERER_AVATAR_HANDOFF_UNAVAILABLE',
): DesktopRendererAvatarHandoffPort {
  const unavailable = async (): Promise<never> => {
    throw new Error(reason);
  };
  return Object.freeze({
    available: () => false,
    launch: unavailable,
  });
}

export function createMemoryDesktopRendererLocalModelProgressPort(): DesktopRendererLocalModelProgressPort {
  let dismissed: readonly string[] = [];
  let setupAutodiscoverClaimed = false;
  return Object.freeze({
    loadDismissedSessionIds: () => [...dismissed],
    persistDismissedSessionIds(sessionIds: readonly string[]) {
      dismissed = [...sessionIds];
    },
    claimSetupAutodiscover() {
      if (setupAutodiscoverClaimed) return false;
      setupAutodiscoverClaimed = true;
      return true;
    },
  });
}

export function createDeterministicDesktopVirtualizationPort(): DesktopRendererVirtualizationPort {
  return Object.freeze({
    useVirtualizer(options: DesktopVirtualizerOptions): DesktopVirtualizerProjection {
      const size = options.estimateSize();
      const items = options.enabled
        ? Array.from({ length: options.count }, (_, index) => Object.freeze({ index, start: index * size }))
        : [];
      return Object.freeze({
        getTotalSize: () => options.enabled ? options.count * size : 0,
        getVirtualItems: () => items,
        measureElement: () => undefined,
      });
    },
  });
}
