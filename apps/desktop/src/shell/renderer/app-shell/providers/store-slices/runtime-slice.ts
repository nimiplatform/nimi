import type { AppStoreSet, AppStoreState } from '../store-types';
import { INITIAL_RUNTIME_FIELDS } from '../store-types';

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
          targetType: String(defaults.targetType || 'AGENT'),
          targetAccountId: String(defaults.targetAccountId || ''),
          agentId: String(defaults.agentId || ''),
          worldId: String(defaults.worldId || ''),
          provider: String(defaults.provider || ''),
          runtimeModelType: 'chat',
          localProviderEndpoint: String(defaults.localProviderEndpoint || ''),
          localProviderModel: String(defaults.localProviderModel || ''),
          localOpenAiEndpoint: String(defaults.localOpenAiEndpoint || ''),
          localOpenAiApiKey: String(defaults.localOpenAiApiKey || ''),
          mode: 'STORY',
          turnIndex: 1,
          userConfirmedUpload: Boolean(defaults.userConfirmedUpload),
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
        runtimeFields: {
          ...state.runtimeFields,
          ...updates,
        },
      })),
  };
}
