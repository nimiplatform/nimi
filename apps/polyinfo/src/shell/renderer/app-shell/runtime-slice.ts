import type { AppStoreSet, AppStoreState } from './store-types.js';
import { createEmptyAIConfig } from '@nimiplatform/sdk/mod';
import {
  createPolyinfoAIScopeRef,
  savePersistedAIConfig,
} from '@renderer/data/runtime-routes.js';

type RuntimeSlice = Pick<AppStoreState,
  'runtimeDefaults'
  | 'aiConfig'
  | 'setRuntimeDefaults'
  | 'setAIConfig'
>;

export function createRuntimeSlice(set: AppStoreSet): RuntimeSlice {
  return {
    runtimeDefaults: null,
    aiConfig: createEmptyAIConfig(createPolyinfoAIScopeRef()),
    setRuntimeDefaults: (defaults) => set({
      runtimeDefaults: defaults,
    }),
    setAIConfig: (config) => {
      savePersistedAIConfig(config);
      set({
        aiConfig: config,
      });
    },
  };
}
