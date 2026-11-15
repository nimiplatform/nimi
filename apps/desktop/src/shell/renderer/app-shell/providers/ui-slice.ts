import { startTransition } from 'react';
import type { OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import { DEFAULT_CHAT_SOURCE_FILTER, DEFAULT_CHAT_SETUP_STATE, DEFAULT_LAST_SELECTED_THREAD_BY_MODE, DEFAULT_VIEW_MODE_BY_SOURCE_TARGET } from '../../features/chat/chat-shell-types';
import type { ChatThinkingPreference } from '../../features/chat/chat-shared-thinking';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import { homePartnerDraftKey } from '../../features/home/home-partner-draft.js';
import type { AppStoreSet, AppStoreState } from './store-types';

export type UiSliceDependencies = {
  readonly initialChatThinkingPreference: ChatThinkingPreference;
  readonly persistChatThinkingPreference: (preference: ChatThinkingPreference) => void;
};

type UiSlice = Pick<AppStoreState,
  | 'bootstrapReady'
  | 'bootstrapError'
  | 'runtimeMaintenance'
  | 'chatThinkingPreference'
  | 'chatSourceFilter'
  | 'viewModeBySourceTarget'
  | 'lastSelectedThreadByMode'
  | 'nimiComposerPrefillSerial'
  | 'homePartnerDrafts'
  | 'pendingNimiComposerPrefill'
  | 'chatSetupState'
  | 'profileDetailOverlayOpen'
  | 'primaryRailVisible'
  | 'setPrimaryRailVisible'
  | 'offlineTier'
  | 'setOfflineTier'
  | 'setBootstrapReady'
  | 'setBootstrapError'
  | 'setRuntimeMaintenance'
  | 'setChatThinkingPreference'
  | 'setChatSourceFilter'
  | 'setChatViewMode'
  | 'setLastSelectedThreadForMode'
  | 'setHomePartnerDraft'
  | 'setPendingNimiComposerPrefill'
  | 'clearPendingNimiComposerPrefill'
  | 'setChatSetupState'
  | 'setProfileDetailOverlayOpen'
  | 'setStatusBanner'
>;

export function createUiSlice(
  set: AppStoreSet,
  dependencies: UiSliceDependencies): UiSlice {
  return {
    bootstrapReady: false,
    bootstrapError: null,
    runtimeMaintenance: null,
    chatThinkingPreference: dependencies.initialChatThinkingPreference,
    chatSourceFilter: DEFAULT_CHAT_SOURCE_FILTER,
    viewModeBySourceTarget: { ...DEFAULT_VIEW_MODE_BY_SOURCE_TARGET },
    lastSelectedThreadByMode: { ...DEFAULT_LAST_SELECTED_THREAD_BY_MODE },
    pendingNimiComposerPrefill: null,
    nimiComposerPrefillSerial: 0,
    homePartnerDrafts: {},
    chatSetupState: { ...DEFAULT_CHAT_SETUP_STATE },
    profileDetailOverlayOpen: false,
    primaryRailVisible: true,
    setPrimaryRailVisible: (visible) => set({ primaryRailVisible: visible }),
    offlineTier: 'L0' as OfflineTier,
    setOfflineTier: (tier) => set({ offlineTier: tier }),
    setBootstrapReady: (ready) => set({ bootstrapReady: ready }),
    setBootstrapError: (message) => set({ bootstrapError: message }),
    setRuntimeMaintenance: (reasonCode) => set({ runtimeMaintenance: reasonCode }),
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
    setHomePartnerDraft: (accountId, partnerRef, text) =>
      set((state) => {
        const key = homePartnerDraftKey(accountId, partnerRef);
        if (!key || (state.homePartnerDrafts[key] ?? '') === text) return {};
        const { [key]: _previous, ...rest } = state.homePartnerDrafts;
        return { homePartnerDrafts: text ? { ...rest, [key]: text } : rest };
      }),
    setPendingNimiComposerPrefill: (input) =>
      set((state) => {
        const text = String(input || '').trim();
        const requestId = state.nimiComposerPrefillSerial + 1;
        return {
          nimiComposerPrefillSerial: requestId,
          pendingNimiComposerPrefill: text ? { text, requestId } : null,
        };
      }),
    clearPendingNimiComposerPrefill: (requestId) =>
      set((state) =>
        state.pendingNimiComposerPrefill?.requestId === requestId
          ? { pendingNimiComposerPrefill: null }
          : {},
      ),
    setChatSetupState: (mode, setupState) =>
      set((state) => ({
        chatSetupState: {
          ...state.chatSetupState,
          [mode]: setupState,
        },
      })),
    setProfileDetailOverlayOpen: (open) => set({ profileDetailOverlayOpen: open }),
    setStatusBanner: (banner) => emitFeedbackToast(banner),
  };
}
