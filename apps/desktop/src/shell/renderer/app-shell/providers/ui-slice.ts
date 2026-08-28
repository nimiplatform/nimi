import { startTransition } from 'react';
import type { OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import type { ExploreSectionId } from '../../features/explore/explore-section-nav';
import {
  DEFAULT_CHAT_SOURCE_FILTER,
  DEFAULT_CHAT_SETUP_STATE,
  DEFAULT_LAST_SELECTED_THREAD_BY_MODE,
  DEFAULT_SELECTED_TARGET_BY_SOURCE,
  DEFAULT_VIEW_MODE_BY_SOURCE_TARGET,
  EMPTY_AGENT_CONVERSATION_SELECTION,
  EMPTY_NIMI_CONVERSATION_SELECTION,
} from '../../features/chat/chat-shell-types';
import type { ChatThinkingPreference } from '../../features/chat/chat-shared-thinking';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import { readCharacterSourceRefV3 } from '../../features/realm-source/realm-source-identity.js';
import type {
  AppStoreSet,
  AppStoreState,
  AppTab,
  NavigationRouteSnapshot,
} from './store-types';

export type UiSliceDependencies = {
  readonly initialChatThinkingPreference: ChatThinkingPreference;
  readonly persistChatThinkingPreference: (preference: ChatThinkingPreference) => void;
};

type NavigationState = Pick<AppStoreState,
  | 'activeTab'
  | 'navigationBackStack'
  | 'selectedProfileId'
  | 'selectedSourceRef'
  | 'selectedWorldId'
  | 'selectedWorldInitialSubpage'
>;

function toNavigationRouteSnapshot(state: NavigationState): NavigationRouteSnapshot {
  return {
    activeTab: state.activeTab,
    selectedProfileId: state.selectedProfileId,
    selectedSourceRef: state.selectedSourceRef,
    selectedWorldId: state.selectedWorldId,
    selectedWorldInitialSubpage: state.selectedWorldInitialSubpage,
  };
}

function pushNavigationBackStack(
  state: NavigationState,
  targetTab: AppTab,
): NavigationRouteSnapshot[] {
  if (state.activeTab === targetTab) {
    return [...state.navigationBackStack];
  }

  const currentRoute = toNavigationRouteSnapshot(state);
  const nextStack = [...state.navigationBackStack];
  if (nextStack[nextStack.length - 1]?.activeTab === currentRoute.activeTab) {
    nextStack[nextStack.length - 1] = currentRoute;
  } else {
    nextStack.push(currentRoute);
  }
  return nextStack;
}

const DEFAULT_BACK_ROUTE: NavigationRouteSnapshot = {
  activeTab: 'chat',
  selectedProfileId: null,
  selectedSourceRef: null,
  selectedWorldId: null,
  selectedWorldInitialSubpage: null,
};

type UiSlice = Pick<AppStoreState,
  | 'bootstrapReady'
  | 'bootstrapError'
  | 'activeTab'
  | 'navigationBackStack'
  | 'chatMode'
  | 'chatThinkingPreference'
  | 'chatSourceFilter'
  | 'selectedTargetBySource'
  | 'viewModeBySourceTarget'
  | 'lastSelectedThreadByMode'
  | 'nimiConversationSelection'
  | 'agentConversationSelection'
  | 'agentConversationTargetByHandle'
  | 'pendingAgentComposerPrefill'
  | 'agentComposerPrefillSerial'
  | 'chatSetupState'
  | 'selectedChatId'
  | 'selectedProfileId'
  | 'selectedSourceRef'
  | 'selectedWorldId'
  | 'selectedWorldInitialSubpage'
  | 'exploreActiveSection'
  | 'exploreSearchText'
  | 'appsDetailAppId'
  | 'appsDetailSection'
  | 'appsDetailNavigationRevision'
  | 'profileDetailOverlayOpen'
  | 'chatProfilePanelTarget'
  | 'offlineTier'
  | 'setOfflineTier'
  | 'setBootstrapReady'
  | 'setBootstrapError'
  | 'setActiveTab'
  | 'setChatMode'
  | 'setChatThinkingPreference'
  | 'setChatSourceFilter'
  | 'setSelectedTargetForSource'
  | 'setChatViewMode'
  | 'setLastSelectedThreadForMode'
  | 'setNimiConversationSelection'
  | 'setAgentConversationSelection'
  | 'setAgentConversationTargetSnapshot'
  | 'setPendingAgentComposerPrefill'
  | 'clearPendingAgentComposerPrefill'
  | 'setChatSetupState'
  | 'setSelectedChatId'
  | 'setSelectedProfileId'
  | 'setSelectedWorldId'
  | 'setExploreActiveSection'
  | 'setExploreSearchText'
  | 'setAppsDetailAppId'
  | 'setProfileDetailOverlayOpen'
  | 'setChatProfilePanelTarget'
  | 'navigateToProfile'
  | 'navigateToSourceDetail'
  | 'navigateToWorld'
  | 'navigateBack'
  | 'setStatusBanner'
>;

export function createUiSlice(
  set: AppStoreSet,
  dependencies: UiSliceDependencies,
): UiSlice {
  return {
    bootstrapReady: false,
    bootstrapError: null,
    activeTab: 'chat',
    navigationBackStack: [],
    chatMode: 'ai',
    chatThinkingPreference: dependencies.initialChatThinkingPreference,
    chatSourceFilter: DEFAULT_CHAT_SOURCE_FILTER,
    selectedTargetBySource: { ...DEFAULT_SELECTED_TARGET_BY_SOURCE },
    viewModeBySourceTarget: { ...DEFAULT_VIEW_MODE_BY_SOURCE_TARGET },
    lastSelectedThreadByMode: { ...DEFAULT_LAST_SELECTED_THREAD_BY_MODE },
    nimiConversationSelection: { ...EMPTY_NIMI_CONVERSATION_SELECTION },
    agentConversationSelection: { ...EMPTY_AGENT_CONVERSATION_SELECTION },
    agentConversationTargetByHandle: {},
    pendingAgentComposerPrefill: null,
    agentComposerPrefillSerial: 0,
    chatSetupState: { ...DEFAULT_CHAT_SETUP_STATE },
    selectedChatId: null,
    selectedProfileId: null,
    selectedSourceRef: null,
    selectedWorldId: null,
    selectedWorldInitialSubpage: null,
    exploreActiveSection: 'worlds' as ExploreSectionId,
    exploreSearchText: '',
    appsDetailAppId: null,
    appsDetailSection: null,
    appsDetailNavigationRevision: 0,
    profileDetailOverlayOpen: false,
    chatProfilePanelTarget: null,
    offlineTier: 'L0' as OfflineTier,
    setOfflineTier: (tier) => set({ offlineTier: tier }),
    setBootstrapReady: (ready) => set({ bootstrapReady: ready }),
    setBootstrapError: (message) => set({ bootstrapError: message }),
    setActiveTab: (tab) => {
      startTransition(() => {
        set({ activeTab: tab, navigationBackStack: [] });
      });
    },
    setChatMode: (mode) => {
      startTransition(() => {
        set({ chatMode: mode });
      });
    },
    setChatThinkingPreference: (preference) => {
      const normalizedPreference = preference === 'on' ? 'on' : 'off';
      dependencies.persistChatThinkingPreference(normalizedPreference);
      set({ chatThinkingPreference: normalizedPreference });
    },
    setChatSourceFilter: (filter) => {
      startTransition(() => {
        set({ chatSourceFilter: filter });
      });
    },
    setSelectedTargetForSource: (source, targetId) =>
      set((state) => ({
        selectedTargetBySource: {
          ...state.selectedTargetBySource,
          [source]: targetId,
        },
      })),
    setChatViewMode: (source, targetId, mode) =>
      set((state) => ({
        viewModeBySourceTarget: {
          ...state.viewModeBySourceTarget,
          [`${source}:${targetId}`]: mode,
        },
      })),
    setLastSelectedThreadForMode: (mode, threadId) =>
      set((state) => ({
        lastSelectedThreadByMode: {
          ...state.lastSelectedThreadByMode,
          [mode]: threadId,
        },
      })),
    setNimiConversationSelection: (selection) =>
      set((state) => ({
        nimiConversationSelection: selection,
        lastSelectedThreadByMode: {
          ...state.lastSelectedThreadByMode,
          ai: selection.threadId,
        },
      })),
    setAgentConversationSelection: (selection) =>
      set((state) => ({
        agentConversationSelection: selection,
        lastSelectedThreadByMode: {
          ...state.lastSelectedThreadByMode,
          agent: null,
        },
      })),
    setAgentConversationTargetSnapshot: (target) =>
      set((state) => {
        const agentHandle = String(target.agentHandle || '').trim();
        const conversationAnchorId = String(target.conversationAnchorId || '').trim();
        if (!agentHandle || !conversationAnchorId) {
          throw new Error('Desktop Agent Conversation target requires canonical handle and anchor.');
        }
        const replacedHandles = Object.entries(state.agentConversationTargetByHandle)
          .filter(([existingHandle, existing]) => (
            existingHandle !== agentHandle
            && String(existing.conversationAnchorId || '').trim() === conversationAnchorId
          ))
          .map(([existingHandle]) => existingHandle);
        const nextTargets = { ...state.agentConversationTargetByHandle };
        for (const replacedHandle of replacedHandles) delete nextTargets[replacedHandle];
        nextTargets[agentHandle] = target;
        const selectedHandle = String(state.agentConversationSelection.agentHandle || '').trim();
        const selectedAnchor = String(state.agentConversationSelection.conversationAnchorId || '').trim();
        const selectionRebound = replacedHandles.includes(selectedHandle)
          && selectedAnchor === conversationAnchorId;
        const selectedSidebarTarget = state.selectedTargetBySource.agent;
        return {
          agentConversationTargetByHandle: nextTargets,
          ...(selectionRebound
            ? {
              agentConversationSelection: {
                agentHandle,
                conversationAnchorId,
                targetId: agentHandle,
              },
            }
            : {}),
          ...(selectedSidebarTarget && replacedHandles.includes(selectedSidebarTarget)
            ? {
              selectedTargetBySource: {
                ...state.selectedTargetBySource,
                agent: agentHandle,
              },
            }
            : {}),
        };
      }),
    setPendingAgentComposerPrefill: (input) =>
      set((state) => {
        const agentHandle = String(input.agentHandle || '').trim();
        const text = String(input.text || '').trim();
        const requestId = state.agentComposerPrefillSerial + 1;
        return {
          agentComposerPrefillSerial: requestId,
          pendingAgentComposerPrefill: agentHandle && text
            ? { agentHandle, text, requestId }
            : null,
        };
      }),
    clearPendingAgentComposerPrefill: (requestId) =>
      set((state) => (
        state.pendingAgentComposerPrefill?.requestId === requestId
          ? { pendingAgentComposerPrefill: null }
          : {}
      )),
    setChatSetupState: (mode, setupState) =>
      set((state) => ({
        chatSetupState: {
          ...state.chatSetupState,
          [mode]: setupState,
        },
      })),
    setSelectedChatId: (chatId) =>
      set((state) => ({
        selectedChatId: chatId,
        lastSelectedThreadByMode: {
          ...state.lastSelectedThreadByMode,
          human: chatId,
        },
      })),
    setSelectedProfileId: (profileId) => set({ selectedProfileId: profileId }),
    setSelectedWorldId: (worldId) => set({ selectedWorldId: worldId, selectedWorldInitialSubpage: null }),
    setExploreActiveSection: (section) => set({ exploreActiveSection: section }),
    setExploreSearchText: (text) => set({ exploreSearchText: String(text || '') }),
    setAppsDetailAppId: (appId, section = null) => {
      const normalizedAppId = String(appId || '').trim();
      set((state) => ({
        appsDetailAppId: normalizedAppId || null,
        appsDetailSection: normalizedAppId ? section : null,
        appsDetailNavigationRevision: state.appsDetailNavigationRevision + 1,
      }));
    },
    setProfileDetailOverlayOpen: (open) => set({ profileDetailOverlayOpen: open }),
    setChatProfilePanelTarget: (target) => set({ chatProfilePanelTarget: target }),
    navigateToProfile: (profileId) => {
      const accountId = typeof profileId === 'string' ? profileId.trim() : '';
      if (!accountId || accountId.startsWith('local-agent:') || accountId.startsWith('runtime-source:')) {
        return;
      }
      set((state) => ({
        navigationBackStack: pushNavigationBackStack(state, 'profile'),
        selectedProfileId: accountId,
        selectedSourceRef: null,
        activeTab: 'profile',
      }));
    },
    navigateToSourceDetail: (sourceRefInput) => {
      const sourceRef = readCharacterSourceRefV3(sourceRefInput);
      if (!sourceRef) {
        return;
      }
      set((state) => ({
        navigationBackStack: pushNavigationBackStack(state, 'source-detail'),
        selectedSourceRef: sourceRef,
        activeTab: 'source-detail',
      }));
    },
    navigateToWorld: (worldId, options) => {
      const normalizedWorldId = String(worldId || '').trim();
      if (!normalizedWorldId) {
        return;
      }
      startTransition(() => {
        set((state) => ({
          navigationBackStack: pushNavigationBackStack(state, 'world-detail'),
          selectedSourceRef: null,
          selectedWorldId: normalizedWorldId,
          selectedWorldInitialSubpage: options?.initialSubpage ?? null,
          runtimeFields: {
            ...state.runtimeFields,
            worldId: normalizedWorldId,
          },
          activeTab: 'world-detail',
        }));
      });
    },
    navigateBack: () =>
      set((state) => {
        const target = state.navigationBackStack[state.navigationBackStack.length - 1] ?? DEFAULT_BACK_ROUTE;
        const navigationBackStack = state.navigationBackStack.slice(0, -1);
        return {
          activeTab: target.activeTab,
          navigationBackStack,
          selectedProfileId: target.selectedProfileId,
          selectedSourceRef: target.selectedSourceRef,
          selectedWorldId: target.selectedWorldId,
          selectedWorldInitialSubpage: target.selectedWorldInitialSubpage,
        };
      }),
    setStatusBanner: (banner) => emitFeedbackToast(banner),
  };
}
