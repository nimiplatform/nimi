import { startTransition } from 'react';
import type { OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';
import { DEFAULT_CHAT_SOURCE_FILTER, DEFAULT_CHAT_SETUP_STATE, DEFAULT_LAST_SELECTED_THREAD_BY_MODE, DEFAULT_VIEW_MODE_BY_SOURCE_TARGET } from '../../features/chat/chat-shell-types';
import type { ChatThinkingPreference } from '../../features/chat/chat-shared-thinking';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import { agentComposerDraftKey } from '../../features/chat/chat-agent-composer-draft.js';
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
  | 'agentConversationTargetByHandle'
  | 'pendingAgentComposerPrefill'
  | 'agentComposerPrefillSerial'
  | 'agentComposerDrafts'
  | 'agentComposerAttachments'
  | 'setAgentComposerAttachments'
  | 'pendingNimiComposerPrefill'
  | 'chatSetupState'
  | 'profileDetailOverlayOpen'
  | 'primaryRailVisible'
  | 'setPrimaryRailVisible'
  | 'chatProfilePanelTarget'
  | 'offlineTier'
  | 'setOfflineTier'
  | 'setBootstrapReady'
  | 'setBootstrapError'
  | 'setRuntimeMaintenance'
  | 'setChatThinkingPreference'
  | 'setChatSourceFilter'
  | 'setChatViewMode'
  | 'setLastSelectedThreadForMode'
  | 'setAgentConversationTargetSnapshot'
  | 'setPendingAgentComposerPrefill'
  | 'clearPendingAgentComposerPrefill'
  | 'setAgentComposerDraft'
  | 'setPendingNimiComposerPrefill'
  | 'clearPendingNimiComposerPrefill'
  | 'setChatSetupState'
  | 'setProfileDetailOverlayOpen'
  | 'setChatProfilePanelTarget'
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
    agentConversationTargetByHandle: {},
    pendingAgentComposerPrefill: null,
    pendingNimiComposerPrefill: null,
    agentComposerPrefillSerial: 0,
    agentComposerDrafts: {},
    agentComposerAttachments: {},
    chatSetupState: { ...DEFAULT_CHAT_SETUP_STATE },
    profileDetailOverlayOpen: false,
    primaryRailVisible: true,
    setPrimaryRailVisible: (visible) => set({ primaryRailVisible: visible }),
    chatProfilePanelTarget: null,
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
        return {
          agentConversationTargetByHandle: nextTargets,
        };
      }),
    setPendingAgentComposerPrefill: (input) =>
      set((state) => {
        const agentHandle = String(input.agentHandle || '').trim();
        const sourceKey = String(input.sourceKey || '').trim();
        const text = String(input.text || '').trim();
        const requestId = state.agentComposerPrefillSerial + 1;
        return {
          agentComposerPrefillSerial: requestId,
          pendingAgentComposerPrefill: text && (agentHandle || sourceKey)
            ? {
                ...(agentHandle ? { agentHandle } : {}),
                ...(sourceKey ? { sourceKey } : {}),
                text,
                requestId,
              }
            : null,
        };
      }),
    clearPendingAgentComposerPrefill: (requestId) =>
      set((state) =>
        state.pendingAgentComposerPrefill?.requestId === requestId
          ? { pendingAgentComposerPrefill: null }
          : {},
      ),
    setAgentComposerDraft: (accountId, agentHandle, text) =>
      set((state) => {
        const key = agentComposerDraftKey(accountId, agentHandle);
        if (!key || (state.agentComposerDrafts[key] ?? '') === text) return {};
        const { [key]: _previous, ...rest } = state.agentComposerDrafts;
        return { agentComposerDrafts: text ? { ...rest, [key]: text } : rest };
      }),
    setAgentComposerAttachments: (accountId, threadId, attachments) => set(state => {
      const key = agentComposerDraftKey(accountId, threadId);
      if (!key) return {};
      const nextUrls = new Set(attachments.map(item => item.previewUrl));
      for (const item of state.agentComposerAttachments[key] ?? []) {
        if (!nextUrls.has(item.previewUrl)) URL.revokeObjectURL(item.previewUrl);
      }
      const { [key]: _previous, ...rest } = state.agentComposerAttachments;
      return { agentComposerAttachments: attachments.length ? { ...rest, [key]: [...attachments] } : rest };
    }),
    setPendingNimiComposerPrefill: (input) =>
      set((state) => {
        const text = String(input || '').trim();
        const requestId = state.agentComposerPrefillSerial + 1;
        return {
          agentComposerPrefillSerial: requestId,
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
    setChatProfilePanelTarget: (target) => set({ chatProfilePanelTarget: target }),
    setStatusBanner: (banner) => emitFeedbackToast(banner),
  };
}
