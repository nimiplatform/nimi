import type { AppStoreSet, AppStoreState } from './store-types';
import { INITIAL_RUNTIME_FIELDS } from './store-types';
import {
  loadConversationCapabilitySelectionStore,
  persistConversationCapabilitySelectionStore,
} from './conversation-capability-selection-storage';
import {
  toConversationCapabilityRouteProjectionFields,
  updateConversationCapabilityBinding,
  updateConversationCapabilityDefaultRefs,
} from '@renderer/features/chat/conversation-capability';

const ROUTE_RELATED_RUNTIME_FIELD_KEYS = new Set([
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
  | 'conversationCapabilitySelectionStore'
  | 'conversationCapabilityProjectionByCapability'
  | 'agentEffectiveCapabilityResolution'
  | 'setRuntimeDefaults'
  | 'setRuntimeField'
  | 'setRuntimeFields'
  | 'setRuntimeRouteProjection'
  | 'setConversationCapabilitySelectionStore'
  | 'setConversationCapabilityBinding'
  | 'setConversationCapabilityDefaultRefs'
  | 'setConversationCapabilityProjections'
  | 'setAgentEffectiveCapabilityResolution'
>;

export function createRuntimeSlice(set: AppStoreSet): RuntimeSlice {
  const initialSelectionStore = loadConversationCapabilitySelectionStore();
  return {
    runtimeDefaults: null,
    runtimeFields: INITIAL_RUNTIME_FIELDS,
    conversationCapabilitySelectionStore: initialSelectionStore,
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
          provider: '',
          runtimeModelType: 'chat',
          localProviderEndpoint: '',
          localProviderModel: '',
          localOpenAiEndpoint: '',
          connectorId: '',
          mode: 'STORY',
          turnIndex: 1,
          userConfirmedUpload: Boolean(defaults.runtime.userConfirmedUpload),
        },
      }),
    setRuntimeField: (key, value) =>
      set((state) => {
        if (ROUTE_RELATED_RUNTIME_FIELD_KEYS.has(key)) {
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
          value !== undefined && !ROUTE_RELATED_RUNTIME_FIELD_KEYS.has(key)
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
    setRuntimeRouteProjection: (updates) =>
      set((state) => ({
        runtimeFields: {
          ...state.runtimeFields,
          provider: String(updates.provider || ''),
          runtimeModelType: String(updates.runtimeModelType || 'chat'),
          localProviderEndpoint: String(updates.localProviderEndpoint || ''),
          localProviderModel: String(updates.localProviderModel || ''),
          localOpenAiEndpoint: String(updates.localOpenAiEndpoint || ''),
          connectorId: String(updates.connectorId || ''),
        },
      })),
    setConversationCapabilitySelectionStore: (store) => {
      persistConversationCapabilitySelectionStore(store);
      set({
        conversationCapabilitySelectionStore: store,
      });
    },
    setConversationCapabilityBinding: (capability, binding) =>
      set((state) => {
        const nextStore = updateConversationCapabilityBinding(
          state.conversationCapabilitySelectionStore,
          capability,
          binding,
        );
        persistConversationCapabilitySelectionStore(nextStore);
        return {
          conversationCapabilitySelectionStore: nextStore,
        };
      }),
    setConversationCapabilityDefaultRefs: (updates) =>
      set((state) => {
        const nextStore = updateConversationCapabilityDefaultRefs(
          state.conversationCapabilitySelectionStore,
          updates,
        );
        persistConversationCapabilitySelectionStore(nextStore);
        return {
          conversationCapabilitySelectionStore: nextStore,
        };
      }),
    setConversationCapabilityProjections: (projections) =>
      set((state) => {
        const nextProjectionByCapability = {
          ...state.conversationCapabilityProjectionByCapability,
          ...projections,
        };
        const textProjection = nextProjectionByCapability['text.generate'] || null;
        return {
          conversationCapabilityProjectionByCapability: nextProjectionByCapability,
          runtimeFields: {
            ...state.runtimeFields,
            ...toConversationCapabilityRouteProjectionFields(textProjection),
          },
        };
      }),
    setAgentEffectiveCapabilityResolution: (resolution) =>
      set({
        agentEffectiveCapabilityResolution: resolution,
      }),
  };
}
