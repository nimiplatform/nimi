import { startTransition } from 'react';
import type { OfflineTier } from '@runtime/offline/types.js';
import type { AppStoreSet, AppStoreState } from './store-types';

type UiSlice = Pick<AppStoreState,
  | 'bootstrapReady'
  | 'bootstrapError'
  | 'desktopReleaseInfo'
  | 'desktopReleaseError'
  | 'desktopUpdateState'
  | 'activeTab'
  | 'previousTab'
  | 'selectedChatId'
  | 'selectedProfileId'
  | 'selectedProfileIsAgent'
  | 'selectedWorldId'
  | 'selectedGiftTransactionId'
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
    selectedChatId: null,
    selectedProfileId: null,
    selectedProfileIsAgent: null,
    selectedWorldId: null,
    selectedGiftTransactionId: null,
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
        set({ activeTab: tab });
      });
    },
    setSelectedChatId: (chatId) => set({ selectedChatId: chatId }),
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

        return {
          activeTab: state.previousTab || 'chat',
          previousTab: null,
          selectedProfileId: state.previousTab === 'contacts' || state.previousTab === 'home' || state.previousTab === 'explore'
            ? state.selectedProfileId
            : null,
          selectedProfileIsAgent: state.previousTab === 'contacts' || state.previousTab === 'home' || state.previousTab === 'explore'
            ? state.selectedProfileIsAgent
            : null,
          selectedWorldId: null,
          selectedGiftTransactionId: null,
        };
      }),
    setStatusBanner: (banner) => set({ statusBanner: banner }),
  };
}
