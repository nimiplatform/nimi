import type { AppStoreSet, AppStoreState } from './store-types';
import { INITIAL_RUNTIME_FIELDS } from './store-types';
import {
  scopeKeyFromRef,
} from './desktop-ai-config-storage';
import {
  toConversationCapabilityRouteProjectionFields,
} from '@renderer/features/chat/conversation-capability';
import {
  bindDesktopAIConfigAppStore,
  getDesktopAIConfigService,
} from './desktop-ai-config-service';
import { getActiveScope } from '@renderer/features/chat/chat-shared-active-ai-config-scope';
import { bindProjectionRefreshToSurface } from '@renderer/features/chat/conversation-capability-projection';
import { applyAIProfileToConfig } from '@nimiplatform/sdk/mod';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';

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
  | 'aiConfig'
  | 'conversationCapabilityProjectionByCapability'
  | 'agentEffectiveCapabilityResolution'
  | 'setRuntimeDefaults'
  | 'setRuntimeField'
  | 'setRuntimeFields'
  | 'setRuntimeRouteProjection'
  | 'setAIConfig'
  | 'applyAIProfile'
  | 'setConversationCapabilityBinding'
  | 'setConversationCapabilityProjections'
  | 'setAgentEffectiveCapabilityResolution'
>;

export function createRuntimeSlice(set: AppStoreSet): RuntimeSlice {
  const initialAIConfig = getDesktopAIConfigService().aiConfig.get(getActiveScope());

  // Bind the surface so it can push config updates to the store.
  // Surface is the unified write owner; store is a read projection.
  // Phase 6: dynamically checks getActiveScope() so scope switches
  // are immediately reflected in the filter.
  bindDesktopAIConfigAppStore((updatedScopeKey, config) => {
    if (updatedScopeKey === scopeKeyFromRef(getActiveScope())) {
      set({ aiConfig: config });
    }
  });
  // S-AICONF-006: surface subscription drives projection refresh centrally.
  bindProjectionRefreshToSurface();

  return {
    runtimeDefaults: null,
    runtimeFields: INITIAL_RUNTIME_FIELDS,
    aiConfig: initialAIConfig,
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
    setAIConfig: (config) => {
      // Delegate to surface as unified write owner. commitConfig inside
      // the surface handles persistence + in-memory + app store push + subscribers.
      getDesktopAIConfigService().aiConfig.update(config.scopeRef, config);
    },
    applyAIProfile: (profile) =>
      set((state) => {
        const nextConfig = applyAIProfileToConfig(state.aiConfig, profile);
        getDesktopAIConfigService().aiConfig.update(nextConfig.scopeRef, nextConfig);
        return {};
      }),
    setConversationCapabilityBinding: (capability, binding) =>
      set((state) => {
        const nextBindings = { ...state.aiConfig.capabilities.selectedBindings };
        if (binding === undefined) {
          delete nextBindings[capability];
        } else {
          nextBindings[capability] = binding as RuntimeRouteBinding | null;
        }
        const nextConfig = {
          ...state.aiConfig,
          capabilities: {
            ...state.aiConfig.capabilities,
            selectedBindings: nextBindings,
          },
        };
        getDesktopAIConfigService().aiConfig.update(nextConfig.scopeRef, nextConfig);
        return {};
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
