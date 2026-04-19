import { startTransition } from 'react';
import type { OfflineTier } from '@runtime/offline/types.js';
import {
  DEFAULT_CHAT_SOURCE_FILTER,
  DEFAULT_CHAT_SETUP_STATE,
  DEFAULT_LAST_SELECTED_THREAD_BY_MODE,
  DEFAULT_SELECTED_TARGET_BY_SOURCE,
  DEFAULT_VIEW_MODE_BY_SOURCE_TARGET,
  EMPTY_AGENT_CONVERSATION_SELECTION,
  EMPTY_NIMI_CONVERSATION_SELECTION,
} from '@renderer/features/chat/chat-shell-types';
import { loadStoredChatThinkingPreference, persistStoredChatThinkingPreference } from '@renderer/features/chat/chat-settings-storage';
import type { AppStoreSet, AppStoreState } from './store-types';

const initialChatThinkingPreference = loadStoredChatThinkingPreference();

type UiSlice = Pick<AppStoreState,
  | 'bootstrapReady'
  | 'bootstrapError'
  | 'desktopReleaseInfo'
  | 'desktopReleaseError'
  | 'desktopUpdateState'
  | 'activeTab'
  | 'previousTab'
  | 'chatMode'
  | 'chatThinkingPreference'
  | 'chatSourceFilter'
  | 'selectedTargetBySource'
  | 'viewModeBySourceTarget'
  | 'lastSelectedThreadByMode'
  | 'nimiConversationSelection'
  | 'agentConversationSelection'
  | 'chatSetupState'
  | 'selectedChatId'
  | 'selectedProfileId'
  | 'selectedProfileIsAgent'
  | 'selectedWorldId'
  | 'selectedGiftTransactionId'
  | 'profileDetailOverlayOpen'
  | 'chatProfilePanelTarget'
  | 'offlineTier'
  | 'statusBanner'
  | 'modsFeedback'
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
  | 'setChatSetupState'
  | 'setSelectedChatId'
  | 'setSelectedProfileId'
  | 'setSelectedProfileIsAgent'
  | 'setSelectedWorldId'
  | 'setSelectedGiftTransactionId'
  | 'setProfileDetailOverlayOpen'
  | 'setChatProfilePanelTarget'
  | 'navigateToProfile'
  | 'navigateToWorld'
  | 'navigateToGiftInbox'
  | 'navigateBack'
  | 'setStatusBanner'
  | 'setModsFeedback'
>;

export function createUiSlice(set: AppStoreSet): UiSlice {
  return {
    bootstrapReady: false,
    bootstrapError: null,
    desktopReleaseInfo: null,
    desktopReleaseError: null,
    desktopUpdateState: null,
    activeTab: 'chat',
    previousTab: null,
    chatMode: 'ai',
    chatThinkingPreference: initialChatThinkingPreference,
    chatSourceFilter: DEFAULT_CHAT_SOURCE_FILTER,
    selectedTargetBySource: { ...DEFAULT_SELECTED_TARGET_BY_SOURCE },
    viewModeBySourceTarget: { ...DEFAULT_VIEW_MODE_BY_SOURCE_TARGET },
    lastSelectedThreadByMode: { ...DEFAULT_LAST_SELECTED_THREAD_BY_MODE },
    nimiConversationSelection: { ...EMPTY_NIMI_CONVERSATION_SELECTION },
    agentConversationSelection: { ...EMPTY_AGENT_CONVERSATION_SELECTION },
    chatSetupState: { ...DEFAULT_CHAT_SETUP_STATE },
    selectedChatId: null,
    selectedProfileId: null,
    selectedProfileIsAgent: null,
    selectedWorldId: null,
    selectedGiftTransactionId: null,
    profileDetailOverlayOpen: false,
    chatProfilePanelTarget: null,
    offlineTier: 'L0' as OfflineTier,
    statusBanner: null,
    modsFeedback: null,
    setOfflineTier: (tier) => set({ offlineTier: tier }),
    setBootstrapReady: (ready) => set({ bootstrapReady: ready }),
    setBootstrapError: (message) => set({ bootstrapError: message }),
    setDesktopReleaseInfo: (info) => set({ desktopReleaseInfo: info }),
    setDesktopReleaseError: (message) => set({ desktopReleaseError: message }),
    setDesktopUpdateState: (state) => set({ desktopUpdateState: state }),
    setActiveTab: (tab) => {
      startTransition(() => {
        set({ activeTab: tab });
      });
    },
    setChatMode: (mode) => {
      startTransition(() => {
        set({ chatMode: mode });
      });
    },
    setChatThinkingPreference: (preference) => {
      const normalizedPreference = preference === 'on' ? 'on' : 'off';
      persistStoredChatThinkingPreference(normalizedPreference);
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
          agent: selection.threadId,
        },
      })),
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
    setSelectedProfileIsAgent: (isAgent) => set({ selectedProfileIsAgent: isAgent }),
    setSelectedWorldId: (worldId) => set({ selectedWorldId: worldId }),
    setSelectedGiftTransactionId: (giftTransactionId) => set({ selectedGiftTransactionId: giftTransactionId }),
    setProfileDetailOverlayOpen: (open) => set({ profileDetailOverlayOpen: open }),
    setChatProfilePanelTarget: (target) => set({ chatProfilePanelTarget: target }),
    navigateToProfile: (profileId, tab) =>
      set((state) => ({
        previousTab: state.activeTab,
        selectedProfileId: profileId,
        selectedProfileIsAgent: tab === 'agent-detail',
        selectedGiftTransactionId: null,
        activeTab: tab,
      })),
    navigateToWorld: (worldId) => {
      const normalizedWorldId = String(worldId || '').trim();
      if (!normalizedWorldId) {
        return;
      }
      startTransition(() => {
        set((state) => ({
          previousTab: state.activeTab,
          selectedWorldId: normalizedWorldId,
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
          previousTab: state.activeTab === 'gift-inbox'
            ? state.previousTab
            : state.activeTab,
          selectedGiftTransactionId: normalizedGiftTransactionId,
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

        const target = state.previousTab || 'chat';
        const keepProfile = target === 'contacts' || target === 'home' || target === 'explore';
        return {
          activeTab: target,
          previousTab: null,
          selectedProfileId: keepProfile ? state.selectedProfileId : null,
          selectedProfileIsAgent: keepProfile ? state.selectedProfileIsAgent : null,
          selectedWorldId: target === 'world-detail' ? state.selectedWorldId : null,
          selectedGiftTransactionId: null,
        };
      }),
    setStatusBanner: (banner) => set({ statusBanner: banner }),
    setModsFeedback: (banner) => set({ modsFeedback: banner }),
  };
}
