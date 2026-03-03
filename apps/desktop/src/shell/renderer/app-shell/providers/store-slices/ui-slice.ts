import type { AppStoreSet, AppStoreState } from '../store-types';

type UiSlice = Pick<AppStoreState,
  | 'bootstrapReady'
  | 'bootstrapError'
  | 'activeTab'
  | 'previousTab'
  | 'selectedChatId'
  | 'selectedProfileId'
  | 'selectedWorldId'
  | 'chatProfilePanelTarget'
  | 'statusBanner'
  | 'setBootstrapReady'
  | 'setBootstrapError'
  | 'setActiveTab'
  | 'setSelectedChatId'
  | 'setSelectedProfileId'
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
    selectedWorldId: null,
    chatProfilePanelTarget: null,
    statusBanner: null,
    setBootstrapReady: (ready) => set({ bootstrapReady: ready }),
    setBootstrapError: (message) => set({ bootstrapError: message }),
    setActiveTab: (tab) => set({ activeTab: tab }),
    setSelectedChatId: (chatId) => set({ selectedChatId: chatId }),
    setSelectedProfileId: (profileId) => set({ selectedProfileId: profileId }),
    setSelectedWorldId: (worldId) => set({ selectedWorldId: worldId }),
    setChatProfilePanelTarget: (target) => set({ chatProfilePanelTarget: target }),
    navigateToProfile: (profileId, tab) =>
      set((state) => ({
        previousTab: state.activeTab,
        selectedProfileId: profileId,
        activeTab: tab,
      })),
    navigateToWorld: (worldId) =>
      set((state) => ({
        previousTab: state.activeTab,
        selectedWorldId: worldId,
        runtimeFields: {
          ...state.runtimeFields,
          worldId,
        },
        activeTab: 'world-detail',
      })),
    navigateBack: () =>
      set((state) => ({
        activeTab: state.previousTab || 'chat',
        previousTab: null,
        selectedProfileId: null,
        selectedWorldId: null,
      })),
    setStatusBanner: (banner) => set({ statusBanner: banner }),
  };
}
