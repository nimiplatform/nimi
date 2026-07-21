import type { AppStoreSet, AppStoreState } from './store-types';
import { INITIAL_RUNTIME_FIELDS } from './store-types';
import type { NimiAIConfig } from '@nimiplatform/sdk/ai';

const RETIRED_ROUTE_RUNTIME_FIELD_KEYS = new Set([
  'provider',
  'runtimeModelType',
  'localProviderEndpoint',
  'localProviderModel',
  'localOpenAiEndpoint',
  'connectorId',
]);

type RuntimeSlice = Pick<AppStoreState,
  'runtimeDefaults'
  | 'runtimeFields'
  | 'aiConfig'
  | 'conversationCapabilityProjectionByCapability'
  | 'agentEffectiveCapabilityResolution'
  | 'setRuntimeDefaults'
  | 'setRuntimeField'
  | 'setRuntimeFields'
  | 'setAIConfig'
  | 'setConversationCapabilityProjections'
  | 'setAgentEffectiveCapabilityResolution'
>;

export type RuntimeSliceDependencies = {
  readonly initialAIConfig: NimiAIConfig;
  readonly commitAIConfig: (config: NimiAIConfig) => void;
};

export function createRuntimeSlice(
  set: AppStoreSet,
  dependencies: RuntimeSliceDependencies,
): RuntimeSlice {
  return {
    runtimeDefaults: null,
    runtimeFields: INITIAL_RUNTIME_FIELDS,
    aiConfig: dependencies.initialAIConfig,
    conversationCapabilityProjectionByCapability: {},
    agentEffectiveCapabilityResolution: null,
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
        if (RETIRED_ROUTE_RUNTIME_FIELD_KEYS.has(String(key))) {
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
          value !== undefined && !RETIRED_ROUTE_RUNTIME_FIELD_KEYS.has(key)
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
    setAIConfig: (config) => {
      dependencies.commitAIConfig(config);
      set({ aiConfig: config });
    },
    setConversationCapabilityProjections: (projections) =>
      set((state) => {
        const nextProjectionByCapability = {
          ...state.conversationCapabilityProjectionByCapability,
          ...projections,
        };
        return {
          conversationCapabilityProjectionByCapability: nextProjectionByCapability,
        };
      }),
    setAgentEffectiveCapabilityResolution: (resolution) =>
      set({
        agentEffectiveCapabilityResolution: resolution,
      }),
  };
}
