import type { AppStoreSet, AppStoreState } from './store-types';
import { INITIAL_RUNTIME_FIELDS } from './store-types';

const RETIRED_ROUTE_RUNTIME_FIELD_KEYS: readonly string[] = [
  'provider',
  'runtimeModelType',
  'localProviderEndpoint',
  'localProviderModel',
  'localOpenAiEndpoint',
  'connectorId',
];

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
          targetType: String(defaults.runtime.targetType || ''),
          targetAccountId: String(defaults.runtime.targetAccountId || ''),
          agentId: String(defaults.runtime.agentId || ''),
          targetId: '',
          worldId: String(defaults.runtime.worldId || ''),
          mode: 'STORY',
          turnIndex: 1,
          userConfirmedUpload: Boolean(defaults.runtime.userConfirmedUpload),
        },
      }),
    setRuntimeField: (key, value) =>
      set((state) => {
        if (RETIRED_ROUTE_RUNTIME_FIELD_KEYS.includes(String(key))) {
          return {};
        }
        return {
          runtimeFields: {
            ...state.runtimeFields,
            [key]: value,
          },
        };
      }),
    setRuntimeFields: (updates) =>
      set((state) => {
        const allowedEntries = Object.entries(updates).filter(([key, value]) => (
          value !== undefined && !RETIRED_ROUTE_RUNTIME_FIELD_KEYS.includes(key)
        ));
        if (allowedEntries.length === 0) {
          return {};
        }
        return {
          runtimeFields: Object.fromEntries(
            Object.entries({
              ...state.runtimeFields,
              ...Object.fromEntries(allowedEntries),
            }).filter(([, value]) => value !== undefined),
          ) as AppStoreState['runtimeFields'],
        };
      }),
  };
}
