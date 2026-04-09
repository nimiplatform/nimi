import type { ReactNode } from 'react';
import type {
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
      loadingLabel: input.labels.loadingLabel,
      footerContent: input.footerContent,
      renderMessageContent: input.renderMessageContent,
      pendingFirstBeat: input.footerViewState.pendingFirstBeat,
      onStopGenerating: input.onStopGenerating,
    },
    stagePanelProps: {
      footerContent: input.footerContent,
      renderMessageContent: input.renderMessageContent,
      pendingFirstBeat: input.footerViewState.pendingFirstBeat,
    },
  };
}
