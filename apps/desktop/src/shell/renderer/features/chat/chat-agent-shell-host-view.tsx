import type { MouseEvent, ReactNode } from 'react';
import type {
  CanonicalMessageAccessorySlot,
  CanonicalMessageContentSlot,
  ConversationTargetSummary,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type { DesktopConversationModeHost } from './chat-mode-host-types';
import type { AgentFooterViewState } from './chat-agent-shell-footer-state';

export type AgentConversationHostView = Pick<
  DesktopConversationModeHost,
  'availability' | 'selectedTargetId' | 'transcriptProps' | 'stagePanelProps'
>;

export function resolveAgentConversationHostView(input: {
  threads: readonly ConversationTargetSummary[];
  selectedTargetId: string | null;
  loading: boolean;
  error: string | null;
  footerViewState: AgentFooterViewState;
  footerContent: ReactNode;
  labels: {
    emptyTitle: string;
    emptyDescription: string;
    emptyEyebrow: string;
    loadingLabel: string;
  };
  renderMessageContent: CanonicalMessageContentSlot;
  renderMessageAccessory?: CanonicalMessageAccessorySlot;
  onMessageContextMenu?: (message: import('@nimiplatform/nimi-kit/features/chat/headless').ConversationCanonicalMessage, event: MouseEvent<HTMLDivElement>) => void;
  onStopGenerating?: () => void;
}): AgentConversationHostView {
  return {
    availability: {
      mode: 'agent',
      label: 'Agent',
      enabled: true,
      badge: input.threads.length > 0 ? input.threads.length : null,
      disabledReason: null,
    },
    selectedTargetId: input.selectedTargetId,
    transcriptProps: {
      loading: input.loading,
      error: input.error,
      emptyEyebrow: input.labels.emptyEyebrow,
      emptyTitle: input.labels.emptyTitle,
      emptyDescription: input.labels.emptyDescription,
      emptyStateVariant: 'compact',
      loadingLabel: input.labels.loadingLabel,
      widthClassName: 'max-w-[min(920px,calc(100vw-620px))]',
      footerContent: input.footerContent,
      renderMessageContent: input.renderMessageContent,
      renderMessageAccessory: input.renderMessageAccessory,
      onMessageContextMenu: input.onMessageContextMenu,
      pendingFirstBeat: input.footerViewState.pendingFirstBeat,
      onStopGenerating: input.onStopGenerating,
    },
    stagePanelProps: {
      footerContent: input.footerContent,
      renderMessageContent: input.renderMessageContent,
      renderMessageAccessory: input.renderMessageAccessory,
      onMessageContextMenu: input.onMessageContextMenu,
      pendingFirstBeat: input.footerViewState.pendingFirstBeat,
    },
  };
}
