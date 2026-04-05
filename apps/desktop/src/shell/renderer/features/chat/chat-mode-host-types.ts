import type { ReactNode } from 'react';
import type {
  CanonicalStagePanelProps,
  CanonicalTranscriptViewProps,
} from '@nimiplatform/nimi-kit/features/chat';
import type {
  ConversationCanonicalMessage,
  ConversationCharacterData,
  ConversationMode,
  ConversationModeAvailability,
  ConversationSetupAction,
  ConversationSetupState,
  ConversationShellAdapter,
  ConversationShellViewModel,
  ConversationTargetSummary,
  ConversationThreadSummary,
} from '@nimiplatform/nimi-kit/features/chat/headless';

export type DesktopConversationModeHost = {
  mode: ConversationMode;
  availability: ConversationModeAvailability;
  adapter: ConversationShellAdapter<unknown>;
  activeThreadId: string | null;
  targets?: readonly ConversationTargetSummary[];
  selectedTargetId?: string | null;
  messages?: readonly ConversationCanonicalMessage[];
  characterData?: ConversationCharacterData | null;
  settingsContent?: ReactNode;
  settingsDrawerTitle?: string;
  settingsDrawerSubtitle?: string | null;
  profileContent?: ReactNode;
  profileDrawerTitle?: string;
  profileDrawerSubtitle?: string | null;
  rightSidebarContent?: ReactNode;
  rightSidebarOverlayMenu?: ReactNode;
  rightSidebarResetKey?: string;
  transcriptProps?: Omit<CanonicalTranscriptViewProps, 'messages'>;
  stagePanelProps?: Omit<
    CanonicalStagePanelProps,
    'messages' | 'characterData' | 'anchorViewportRef' | 'cardAnchorOffsetPx' | 'onIntentOpenHistory'
  >;
  composerContent?: ReactNode;
  auxiliaryOverlayContent?: ReactNode;
  onSelectTarget?: (targetId: string | null) => void;
  onSelectThread?: (threadId: string) => void;
  onSetupAction?: (action: ConversationSetupAction) => void;
  renderEmptyState?: (viewModel: ConversationShellViewModel) => ReactNode;
  renderSetupDescription?: (
    setupState: ConversationSetupState,
    viewModel: ConversationShellViewModel,
  ) => ReactNode;
  renderThreadMeta?: (thread: ConversationThreadSummary) => ReactNode;
};
