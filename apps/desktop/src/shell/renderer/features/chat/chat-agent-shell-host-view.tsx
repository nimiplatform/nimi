import type { MouseEvent, ReactNode } from 'react';
import type {
  CanonicalMessageAccessorySlot,
  CanonicalMessageContentSlot,
  ConversationTargetSummary,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type { DesktopConversationModeHost } from './chat-shared-mode-host-types';
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
  transcriptWidthClassName?: string;
  transcriptWidthPositionClassName?: string;
  transcriptScrollViewportWidthClassName?: string;
  transcriptScrollViewportPositionClassName?: string;
  transcriptContentPaddingBottomClassName?: string;
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
      widthClassName: input.transcriptWidthClassName || 'max-w-[min(920px,calc(100vw-620px))]',
      widthPositionClassName: input.transcriptWidthPositionClassName || 'mx-auto',
      scrollViewportWidthClassName: input.transcriptScrollViewportWidthClassName || 'w-full',
      scrollViewportPositionClassName: input.transcriptScrollViewportPositionClassName || '',
      contentPaddingBottomClassName: input.transcriptContentPaddingBottomClassName || 'pb-6',
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
