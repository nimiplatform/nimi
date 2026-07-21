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
import type { AppStoreSet, AppStoreState, AppTab } from './store-types';

export type UiSliceDependencies = {
  readonly initialChatThinkingPreference: ChatThinkingPreference;
  readonly persistChatThinkingPreference: (preference: ChatThinkingPreference) => void;
  readonly setActiveScopeForMode: (mode: AppStoreState['chatMode']) => void;
};

function pushNavigationBackStack(
  stack: readonly AppTab[],
  activeTab: AppTab,
  targetTab: AppTab,
): AppTab[] {
  if (activeTab === targetTab) {
    return [...stack];
  }

  const nextStack = [...stack];
  if (nextStack[nextStack.length - 1] !== activeTab) {
    nextStack.push(activeTab);
  }
  return nextStack;
}

type UiSlice = Pick<AppStoreState,
  | 'bootstrapReady'
  | 'bootstrapError'
  | 'desktopReleaseInfo'
  | 'desktopReleaseError'
  | 'desktopUpdateState'
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
  | 'agentConversationTargetByLocalRef'
  | 'pendingAgentComposerPrefill'
  | 'agentComposerPrefillSerial'
  | 'chatSetupState'
  | 'selectedChatId'
  | 'selectedProfileId'
  | 'selectedProfileIsSource'
  | 'selectedSourceRef'
  | 'selectedWorldId'
  | 'selectedWorldInitialSubpage'
  | 'selectedGiftTransactionId'
  | 'exploreActiveSection'
  | 'exploreSearchText'
  | 'appsDetailAppId'
  | 'profileDetailOverlayOpen'
  | 'chatProfilePanelTarget'
  | 'offlineTier'
  | 'statusBanner'
  | 'setOfflineTier'
  | 'setBootstrapReady'
  | 'setBootstrapError'
  | 'setDesktopReleaseInfo'
  | 'setDesktopReleaseError'
  | 'setDesktopUpdateState'
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
  | 'setSelectedProfileIsSource'
  | 'setSelectedSourceRef'
  | 'setSelectedWorldId'
  | 'setSelectedGiftTransactionId'
  | 'setExploreActiveSection'
  | 'setExploreSearchText'
  | 'setAppsDetailAppId'
  | 'setProfileDetailOverlayOpen'
  | 'setChatProfilePanelTarget'
  | 'navigateToProfile'
  | 'navigateToSourceDetail'
  | 'navigateToWorld'
  | 'navigateToGiftInbox'
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
    desktopReleaseInfo: null,
    desktopReleaseError: null,
    desktopUpdateState: null,
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
    agentConversationTargetByLocalRef: {},
    pendingAgentComposerPrefill: null,
    agentComposerPrefillSerial: 0,
    chatSetupState: { ...DEFAULT_CHAT_SETUP_STATE },
    selectedChatId: null,
    selectedProfileId: null,
    selectedProfileIsSource: null,
    selectedSourceRef: null,
    selectedWorldId: null,
    selectedWorldInitialSubpage: null,
    selectedGiftTransactionId: null,
    exploreActiveSection: 'worlds' as ExploreSectionId,
    exploreSearchText: '',
    appsDetailAppId: null,
    profileDetailOverlayOpen: false,
    chatProfilePanelTarget: null,
    offlineTier: 'L0' as OfflineTier,
    statusBanner: null,
    setOfflineTier: (tier) => set({ offlineTier: tier }),
    setBootstrapReady: (ready) => set({ bootstrapReady: ready }),
    setBootstrapError: (message) => set({ bootstrapError: message }),
    setDesktopReleaseInfo: (info) => set({ desktopReleaseInfo: info }),
    setDesktopReleaseError: (message) => set({ desktopReleaseError: message }),
    setDesktopUpdateState: (state) => set({ desktopUpdateState: state }),
    setActiveTab: (tab) => {
      startTransition(() => {
        set({ activeTab: tab, navigationBackStack: [] });
      });
    },
    setChatMode: (mode) => {
      // Rebind the active built-in chat AIConfig scope to the mode's canonical
      // scope (T3-1): `ai` -> feature:desktop.chat:nimi, `agent` ->
      // feature:desktop.chat:agent, `human`/`group` -> no built-in chat scope.
      // This rewires the AIConfig projection only; per-mode thread/session
      // selection state is independent and untouched.
      dependencies.setActiveScopeForMode(mode);
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
      set((state) => ({
        agentConversationTargetByLocalRef: {
          ...state.agentConversationTargetByLocalRef,
          [target.localAgentRef]: target,
        },
      })),
    setPendingAgentComposerPrefill: (input) =>
      set((state) => {
        const localAgentRef = String(input.localAgentRef || '').trim();
        const text = String(input.text || '').trim();
        const requestId = state.agentComposerPrefillSerial + 1;
        return {
          agentComposerPrefillSerial: requestId,
          pendingAgentComposerPrefill: localAgentRef && text
            ? { localAgentRef, text, requestId }
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
    setSelectedProfileIsSource: (isSource) => set({ selectedProfileIsSource: isSource }),
    setSelectedSourceRef: (sourceRef) => set({ selectedSourceRef: sourceRef }),
    setSelectedWorldId: (worldId) => set({ selectedWorldId: worldId, selectedWorldInitialSubpage: null }),
    setSelectedGiftTransactionId: (giftTransactionId) => set({ selectedGiftTransactionId: giftTransactionId }),
    setExploreActiveSection: (section) => set({ exploreActiveSection: section }),
    setExploreSearchText: (text) => set({ exploreSearchText: String(text || '') }),
    setAppsDetailAppId: (appId) => {
      const normalizedAppId = String(appId || '').trim();
      set({ appsDetailAppId: normalizedAppId || null });
    },
    setProfileDetailOverlayOpen: (open) => set({ profileDetailOverlayOpen: open }),
    setChatProfilePanelTarget: (target) => set({ chatProfilePanelTarget: target }),
    navigateToProfile: (profileId, tab) =>
      set((state) => ({
        navigationBackStack: pushNavigationBackStack(state.navigationBackStack, state.activeTab, tab),
        selectedProfileId: profileId,
        selectedProfileIsSource: tab === 'source-detail',
        selectedSourceRef: null,
        selectedGiftTransactionId: null,
        activeTab: tab,
      })),
    navigateToSourceDetail: (sourceRef) =>
      set((state) => ({
        navigationBackStack: pushNavigationBackStack(state.navigationBackStack, state.activeTab, 'source-detail'),
        selectedProfileId: sourceRef.id,
        selectedProfileIsSource: true,
        selectedSourceRef: sourceRef,
        selectedGiftTransactionId: null,
        activeTab: 'source-detail',
      })),
    navigateToWorld: (worldId, options) => {
      const normalizedWorldId = String(worldId || '').trim();
      if (!normalizedWorldId) {
        return;
      }
      startTransition(() => {
        set((state) => ({
          navigationBackStack: pushNavigationBackStack(state.navigationBackStack, state.activeTab, 'world-detail'),
          selectedSourceRef: null,
          selectedWorldId: normalizedWorldId,
          selectedWorldInitialSubpage: options?.initialSubpage ?? null,
          selectedGiftTransactionId: null,
          runtimeFields: {
            ...state.runtimeFields,
            worldId: normalizedWorldId,
          },
          activeTab: 'world-detail',
        }));
      });
    },
    navigateToGiftInbox: (giftTransactionId) => {
      const normalizedGiftTransactionId = String(giftTransactionId || '').trim() || null;
      startTransition(() => {
        set((state) => ({
          navigationBackStack: pushNavigationBackStack(state.navigationBackStack, state.activeTab, 'gift-inbox'),
          selectedGiftTransactionId: normalizedGiftTransactionId,
          selectedSourceRef: null,
          activeTab: 'gift-inbox',
        }));
      });
    },
    navigateBack: () =>
      set((state) => {
        if (state.activeTab === 'gift-inbox' && state.selectedGiftTransactionId) {
          return {
            selectedGiftTransactionId: null,
          };
        }

        const target = state.navigationBackStack[state.navigationBackStack.length - 1] ?? 'chat';
        const navigationBackStack = state.navigationBackStack.slice(0, -1);
        const keepProfile = target === 'home'
          || target === 'explore'
          || target === 'profile'
          || target === 'source-detail';
        return {
          activeTab: target,
          navigationBackStack,
          selectedProfileId: keepProfile ? state.selectedProfileId : null,
          selectedProfileIsSource: keepProfile ? state.selectedProfileIsSource : null,
          selectedSourceRef: keepProfile ? state.selectedSourceRef : null,
          selectedWorldId: target === 'world-detail' ? state.selectedWorldId : null,
          selectedWorldInitialSubpage: target === 'world-detail' ? state.selectedWorldInitialSubpage : null,
          selectedGiftTransactionId: null,
        };
      }),
    setStatusBanner: (banner) => set({ statusBanner: banner }),
  };
}
