import type { AppearancePreferences } from '../features/settings/settings-device-preferences.js';
import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';
import type { CheckSyncNextAction } from '../../shared/check-sync-next-action.js';

export type DesktopRendererCheckSyncProjection = {
  readonly run: null | {
    readonly runId: string;
    readonly rootActivationId: string;
    readonly trigger: 'activation' | 'manual' | 'interrupted_recovery';
    readonly state: 'running' | 'completed' | 'failed' | 'superseded';
    readonly owners: readonly {
      readonly ownerId: string;
      readonly state: 'pending' | 'running' | 'completed' | 'failed';
      readonly resources: readonly {
        readonly kind: string;
        readonly reference?: string;
        readonly locator?: string;
        readonly status: 'available' | 'unavailable' | 'incompatible' | 'unknown' | 'conflict' | 'failed';
        readonly change?: 'rebased' | 'adopted' | 'rebuilt';
        readonly reason: string;
        readonly nextAction?: CheckSyncNextAction;
      }[];
    }[];
    readonly unclaimed: readonly { readonly locator: string; readonly status: 'unknown'; readonly reason: string }[];
  };
  readonly obligation: null | { readonly rootActivationId: string; readonly state: 'required' | 'completed' };
  readonly error: string | null;
};

export type DesktopRendererRootReplacementProjection = Omit<NimiProductControlRecordProjection, 'configMutation'> & {
  readonly activation?: null | {
    readonly activated: boolean;
    readonly reasonCode: 'DATA_ROOT_REPLACED' | 'DATA_ROOT_UNCHANGED' | 'DATA_ROOT_OVERLAPS_CURRENT' | 'DATA_ROOT_NOT_EMPTY';
    readonly actionHint: 'restart_runtime_and_check_sync' | 'run_check_sync' | 'choose_path_disjoint_root' | 'choose_new_empty_root';
  };
  readonly configMutation?: null | {
    readonly disposition: 'applied' | 'restart_required' | 'repair_required';
    readonly reasonCode: string;
    readonly actionHint: string;
  };
};

export type DesktopRendererStorageUsage = {
  readonly localStorageBytes: number;
  readonly estimatedUsageBytes: number;
  readonly estimatedQuotaBytes: number;
};

export type DesktopRendererStorageDirs = {
  readonly dataRoot: string;
  readonly modelsDir: string;
  readonly dependenciesDir: string;
  readonly environmentsDir: string;
  readonly appsDir: string;
  readonly accountsDir: string;
  readonly logsDir: string;
  readonly auditDir: string;
};

export interface DesktopRendererSettingsPort {
  loadAppearancePreferences(): AppearancePreferences;
  persistAppearancePreferences(preferences: AppearancePreferences): void;
  subscribeAppearancePreferences(
    listener: (preferences: AppearancePreferences) => void,
  ): () => void;
  estimateStorageUsage(): Promise<DesktopRendererStorageUsage>;
  loadStorageDirs(): Promise<DesktopRendererStorageDirs>;
  pickDataRootDirectory(): Promise<string | null>;
  replaceDataRoot(targetRoot: string): Promise<DesktopRendererRootReplacementProjection>;
  loadCheckSync(): Promise<DesktopRendererCheckSyncProjection>;
  startCheckSync(): Promise<DesktopRendererCheckSyncProjection>;
}

export function createMemoryDesktopRendererSettingsPort(): DesktopRendererSettingsPort {
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
      throw new Error('DESKTOP_SIMULATOR_STORAGE_DIRS_UNADMITTED');
    },
    async pickDataRootDirectory() {
      throw new Error('DESKTOP_SIMULATOR_DATA_ROOT_REPLACEMENT_UNADMITTED');
    },
    async replaceDataRoot() {
      throw new Error('DESKTOP_SIMULATOR_DATA_ROOT_REPLACEMENT_UNADMITTED');
    },
    async loadCheckSync() {
      throw new Error('DESKTOP_SIMULATOR_CHECK_SYNC_UNADMITTED');
    },
    async startCheckSync() {
      throw new Error('DESKTOP_SIMULATOR_CHECK_SYNC_UNADMITTED');
    },
  });
}
