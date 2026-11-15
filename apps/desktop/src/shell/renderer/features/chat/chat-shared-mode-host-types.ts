import type { HomeChatMode } from './chat-shell-types.js';
import type { ReactNode } from 'react';
import type {
  CanonicalStagePanelProps,
} from '@nimiplatform/kit/features/chat/components/canonical-stage-panel';
import type {
  CanonicalTranscriptViewProps,
} from '@nimiplatform/kit/features/chat/components/canonical-transcript-view';
import type {
  ConversationCanonicalMessage,
  ConversationCharacterData,
  ConversationModeAvailability,
  ConversationShellAdapter,
  ConversationTargetSummary,
} from '@nimiplatform/kit/features/chat/headless';

export type DesktopConversationModeHost = {
  mode: HomeChatMode;
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
  /** Optional world (worldview) label rendered in the settings drawer header next to the handle. */
  settingsDrawerWorld?: string | null;
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
  topContent?: ReactNode;
  composerContent?: ReactNode;
  auxiliaryOverlayContent?: ReactNode;
  /** Thinking toggle state for the header icon. */
  thinkingState?: 'on' | 'off' | 'unsupported';
  onThinkingToggle?: () => void;
  setupDescription?: ReactNode;
  /** Product-toned title/action copy and brand mark for the setup-blocking panel. */
  setupTitle?: ReactNode;
  /** Brand mark rendered on the setup-blocking panel. */
  setupIcon?: ReactNode;
  setupActionLabel?: string;
  onSelectTarget?: (targetId: string | null) => void;
  onSelectThread?: (threadId: string) => void;
  /** Content rendered in the new right panel (between conversation pane and contact rail). */
  rightPanelContent?: ReactNode;
  /** Create a new thread/session. Used by the Nimi Chat entry. */
  onCreateThread?: () => Promise<void>;
};
