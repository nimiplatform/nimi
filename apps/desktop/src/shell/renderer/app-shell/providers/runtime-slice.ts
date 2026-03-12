import type { AppStoreSet, AppStoreState } from './store-types';
import { INITIAL_RUNTIME_FIELDS } from './store-types';

type RuntimeSlice = Pick<AppStoreState,
  'runtimeDefaults'
  | 'runtimeFields'
  | 'setRuntimeDefaults'
  | 'setRuntimeField'
  | 'setRuntimeFields'
>;

export function createRuntimeSlice(set: AppStoreSet): RuntimeSlice {
  return {
    runtimeDefaults: null,
    runtimeFields: INITIAL_RUNTIME_FIELDS,
    setRuntimeDefaults: (defaults) =>
      set({
        runtimeDefaults: defaults,
        runtimeFields: {
          targetType: String(defaults.runtime.targetType || 'AGENT'),
          targetAccountId: String(defaults.runtime.targetAccountId || ''),
          agentId: String(defaults.runtime.agentId || ''),
          targetId: '',
          worldId: String(defaults.runtime.worldId || ''),
          provider: String(defaults.runtime.provider || ''),
          runtimeModelType: 'chat',
          localProviderEndpoint: String(defaults.runtime.localProviderEndpoint || ''),
          localProviderModel: String(defaults.runtime.localProviderModel || ''),
          localOpenAiEndpoint: String(defaults.runtime.localOpenAiEndpoint || ''),
          connectorId: String(defaults.runtime.connectorId || ''),
          mode: 'STORY',
          turnIndex: 1,
          userConfirmedUpload: Boolean(defaults.runtime.userConfirmedUpload),
        },
      }),
    setRuntimeField: (key, value) =>
      set((state) => ({
        runtimeFields: {
          ...state.runtimeFields,
          [key]: value,
        },
      })),
    setRuntimeFields: (updates) =>
      set((state) => ({
        runtimeFields: Object.fromEntries(
          Object.entries({
            ...state.runtimeFields,
            ...updates,
          }).filter(([, value]) => value !== undefined),
        ) as AppStoreState['runtimeFields'],
      })),
  };
}
