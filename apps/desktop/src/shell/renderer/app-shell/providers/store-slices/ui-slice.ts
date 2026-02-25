import type { AppStoreSet, AppStoreState } from '../store-types';

type UiSlice = Pick<AppStoreState,
  | 'bootstrapReady'
  | 'bootstrapError'
  | 'activeTab'
  | 'previousTab'
  | 'selectedChatId'
  | 'selectedProfileId'
  | 'selectedWorldId'
  | 'statusBanner'
  | 'setBootstrapReady'
  | 'setBootstrapError'
  | 'setActiveTab'
  | 'setSelectedChatId'
  | 'setSelectedProfileId'
  | 'setSelectedWorldId'
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
    statusBanner: null,
    setBootstrapReady: (ready) => set({ bootstrapReady: ready }),
    setBootstrapError: (message) => set({ bootstrapError: message }),
    setActiveTab: (tab) => set({ activeTab: tab }),
    setSelectedChatId: (chatId) => set({ selectedChatId: chatId }),
    setSelectedProfileId: (profileId) => set({ selectedProfileId: profileId }),
    setSelectedWorldId: (worldId) => set({ selectedWorldId: worldId }),
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
