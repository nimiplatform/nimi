import type { useTranslation } from 'react-i18next';
import type {
  CanonicalMessageAccessorySlot,
  CanonicalMessageContentSlot,
  ConversationMessageViewModel,
  ConversationSetupState,
} from '@nimiplatform/kit/features/chat/headless';
import type { AgentLocalTargetSnapshot, AgentLocalThreadBundle, AgentLocalThreadSummary } from '../../bridge/runtime-bridge/types';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import type { AgentCenterSession } from '@nimiplatform/kit/features/agent-center';
import type { AgentConversationSelection } from './chat-shell-types';
import type { AgentHostFlowFooterState } from './chat-agent-shell-host-flow';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import type { ChatThinkingPreference } from './chat-shared-thinking';
import type { StreamState } from '../turns/stream-controller';
import type { AgentChatExperienceSettings } from './chat-settings-storage';
import type { RuntimeCommittedStatusProjection } from './chat-agent-shell-visible-state';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import type {
  AgentVoiceSessionShellState,
  AgentVoiceTranscriptProjection,
} from './chat-agent-voice-session.js';
import type { AgentEmptyStateCharacterPresence } from './chat-agent-empty-state-character-presence.js';

export type UseAgentConversationPresentationInput = {
  activeTarget: AgentLocalTargetSnapshot | null;
  accountId: string | null;
  activeThreadId: string | null;
  activeConversationAnchorId: string | null;
  bundle: AgentLocalThreadBundle | null;
  bundleError: unknown;
  composerPrefillRequestId: number | null;
  composerReady: boolean;
  currentComposerTextRef: { current: string };
  currentFooterHostState: {
    footerState: AgentHostFlowFooterState;
    lifecycle: AgentTurnLifecycleState;
  } | null;
  handleSubmit: (input: { text: string; attachments: readonly PendingAttachment[] }) => Promise<void>;
  hostFeedback: InlineFeedbackState | null;
  inputSelectionAgentHandle: AgentConversationSelection['agentHandle'];
  isBundleLoading: boolean;
  messages: readonly ConversationMessageViewModel[];
  pendingAttachments: readonly PendingAttachment[];
  onDismissHostFeedback: () => void;
  onAttachmentsChange: (attachments: readonly PendingAttachment[]) => void;
  onComposerPrefillRequest?: (text: string) => void;
  emptyStateCharacterPresence?: AgentEmptyStateCharacterPresence | null;
  reasoningLabel: string;
  renderMessageAccessory?: CanonicalMessageAccessorySlot;
  renderMessageContent: CanonicalMessageContentSlot;
  runtimeAgentCenterAdapter: AgentCenterSession | null;
  runtimeCommittedStatus: RuntimeCommittedStatusProjection | null;
  selectedTargetId: string | null;
  behaviorSettings: AgentChatExperienceSettings;
  setBehaviorSettings: (value: AgentChatExperienceSettings) => void;
  developerModeEnabled: boolean;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  onOpenAgentCenter?: () => void;
  onCloseAgentCenter?: () => void;
  agentCenterOpen?: boolean;
  setupState: ConversationSetupState;
  streamState: StreamState | null;
  submittingThreadId: string | null;
  t: ReturnType<typeof useTranslation>['t'];
  targetSummariesInput: {
    targets: readonly AgentLocalTargetSnapshot[];
    threads: readonly AgentLocalThreadSummary[];
  };
  targetsPending: boolean;
  thinkingPreference: ChatThinkingPreference;
  thinkingSupported: boolean;
  thinkingUnsupportedReason: string | null;
  voiceInput: {
    available: boolean;
    state: AgentVoiceSessionShellState;
    captureState: {
      active: boolean;
      amplitude: number;
    };
    transcript: AgentVoiceTranscriptProjection | null;
    onToggle: () => void;
    onCancel: () => void;
  };
};
