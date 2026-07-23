import type { ReactNode } from 'react';
import type {
  CanonicalMessageAccessorySlot,
  CanonicalMessageContentSlot,
  ConversationTargetSummary,
} from '@nimiplatform/kit/features/chat/headless';
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
    pendingAgentRoleLabel: string;
    pendingThinkingLabel: string;
    pendingStopLabel: string;
    todayLabel: string;
    yesterdayLabel: string;
  };
  transcriptWidthClassName?: string;
  transcriptWidthPositionClassName?: string;
  transcriptScrollViewportWidthClassName?: string;
  transcriptScrollViewportPositionClassName?: string;
  transcriptContentPaddingBottomClassName?: string;
  renderMessageContent: CanonicalMessageContentSlot;
  renderMessageAccessory?: CanonicalMessageAccessorySlot;
  onStopGenerating?: () => void;
}): AgentConversationHostView {
  const formatDateLabel = ({ date, diffDays }: { date: Date; diffDays: number }) => {
    if (diffDays === 0) {
      return input.labels.todayLabel;
    }
    if (diffDays === 1) {
      return input.labels.yesterdayLabel;
    }
    return date.toLocaleDateString();
  };

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
      pendingAgentRoleLabel: input.labels.pendingAgentRoleLabel,
      pendingThinkingLabel: input.labels.pendingThinkingLabel,
      pendingStopLabel: input.labels.pendingStopLabel,
      formatDateLabel,
      widthClassName: input.transcriptWidthClassName || 'max-w-[min(920px,calc(100cqw-620px))]',
      widthPositionClassName: input.transcriptWidthPositionClassName || 'mx-auto',
      scrollViewportWidthClassName: input.transcriptScrollViewportWidthClassName || 'w-full',
      scrollViewportPositionClassName: input.transcriptScrollViewportPositionClassName || '',
      contentPaddingBottomClassName: input.transcriptContentPaddingBottomClassName || 'pb-6',
      footerContent: input.footerContent,
      renderMessageContent: input.renderMessageContent,
      renderMessageAccessory: input.renderMessageAccessory,
      pendingFirstBeat: input.footerViewState.pendingFirstBeat,
      disableRpContent: true,
      onStopGenerating: input.onStopGenerating,
    },
    stagePanelProps: {
      footerContent: input.footerContent,
      renderMessageContent: input.renderMessageContent,
      renderMessageAccessory: input.renderMessageAccessory,
      pendingFirstBeat: input.footerViewState.pendingFirstBeat,
      pendingAgentRoleLabel: input.labels.pendingAgentRoleLabel,
      pendingThinkingLabel: input.labels.pendingThinkingLabel,
      disableRpContent: true,
    },
  };
}
