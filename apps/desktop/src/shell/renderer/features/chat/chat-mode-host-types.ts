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
  ConversationShellAdapter,
  ConversationTargetSummary,
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
  rightSidebarAutoOpenKey?: string | null;
  transcriptProps?: Omit<CanonicalTranscriptViewProps, 'messages'>;
  stagePanelProps?: Omit<
    CanonicalStagePanelProps,
    'messages' | 'characterData' | 'anchorViewportRef' | 'cardAnchorOffsetPx' | 'onIntentOpenHistory'
  >;
  composerContent?: ReactNode;
  auxiliaryOverlayContent?: ReactNode;
  setupDescription?: ReactNode;
  onSelectTarget?: (targetId: string | null) => void;
  onSelectThread?: (threadId: string) => void;
  /** Content rendered in the new right panel (between conversation pane and contact rail). */
  rightPanelContent?: ReactNode;
  /** Create a new AI thread/session. Only meaningful for AI mode. */
  onCreateThread?: () => Promise<void>;
  /** Archive a thread by ID. Only meaningful for AI mode. */
  onArchiveThread?: (threadId: string) => Promise<void>;
  /** Rename a thread. Only meaningful for AI mode. */
  onRenameThread?: (threadId: string, title: string) => void;
};
