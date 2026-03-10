import { startTransition } from 'react';
import type { OfflineTier } from '@runtime/offline/types.js';
import type { AppStoreSet, AppStoreState } from './store-types';

type UiSlice = Pick<AppStoreState,
  | 'bootstrapReady'
  | 'bootstrapError'
  | 'activeTab'
  | 'previousTab'
  | 'selectedChatId'
  | 'selectedProfileId'
  | 'selectedProfileIsAgent'
  | 'selectedWorldId'
  | 'chatProfilePanelTarget'
  | 'offlineTier'
  | 'statusBanner'
  | 'setOfflineTier'
  | 'setBootstrapReady'
  | 'setBootstrapError'
  | 'setActiveTab'
  | 'setSelectedChatId'
  | 'setSelectedProfileId'
  | 'setSelectedProfileIsAgent'
  | 'setSelectedWorldId'
  | 'setChatProfilePanelTarget'
  | 'navigateToProfile'
  | 'navigateToWorld'
  | 'navigateBack'
  | 'setStatusBanner'
>;

export function createUiSlice(set: AppStoreSet): UiSlice {
  return {
    bootstrapReady: false,
    bootstrapError: null,
    activeTab: 'chat',
    previousTab: null,
    selectedChatId: null,
    selectedProfileId: null,
    selectedProfileIsAgent: null,
    selectedWorldId: null,
    chatProfilePanelTarget: null,
    offlineTier: 'L0' as OfflineTier,
    statusBanner: null,
    setOfflineTier: (tier) => set({ offlineTier: tier }),
    setBootstrapReady: (ready) => set({ bootstrapReady: ready }),
    setBootstrapError: (message) => set({ bootstrapError: message }),
    setActiveTab: (tab) => set({ activeTab: tab }),
    setSelectedChatId: (chatId) => set({ selectedChatId: chatId }),
    setSelectedProfileId: (profileId) => set({ selectedProfileId: profileId }),
    setSelectedProfileIsAgent: (isAgent) => set({ selectedProfileIsAgent: isAgent }),
    setSelectedWorldId: (worldId) => set({ selectedWorldId: worldId }),
    setChatProfilePanelTarget: (target) => set({ chatProfilePanelTarget: target }),
    navigateToProfile: (profileId, tab) =>
      set((state) => ({
        previousTab: state.activeTab,
        selectedProfileId: profileId,
        selectedProfileIsAgent: tab === 'agent-detail',
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
          runtimeFields: {
            ...state.runtimeFields,
            worldId: normalizedWorldId,
          },
          activeTab: 'world-detail',
        }));
      });
    },
    navigateBack: () =>
      set((state) => ({
        activeTab: state.previousTab || 'chat',
        previousTab: null,
        selectedProfileId: state.previousTab === 'contacts' || state.previousTab === 'home' || state.previousTab === 'explore'
          ? state.selectedProfileId
          : null,
        selectedProfileIsAgent: state.previousTab === 'contacts' || state.previousTab === 'home' || state.previousTab === 'explore'
          ? state.selectedProfileIsAgent
          : null,
        selectedWorldId: null,
      })),
    setStatusBanner: (banner) => set({ statusBanner: banner }),
  };
}
