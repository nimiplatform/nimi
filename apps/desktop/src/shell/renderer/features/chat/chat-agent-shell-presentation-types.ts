import type { useTranslation } from 'react-i18next';
import type {
  CanonicalMessageAccessorySlot,
  CanonicalMessageContentSlot,
  ConversationMessageViewModel,
  ConversationSetupState,
} from '@nimiplatform/kit/features/chat/headless';
import type { AgentLocalTargetSnapshot, AgentLocalThreadBundle, AgentLocalThreadSummary } from '../../bridge/runtime-bridge/types';
import type { AgentRuntimeConversationSummary } from './chat-agent-runtime-conversation-summaries';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import type { AgentCenterSession } from '@nimiplatform/kit/features/agent-center';
import type { AgentConversationSelection } from './chat-shell-types';
import type { AgentHostFlowFooterState } from './chat-agent-shell-host-flow';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import type { ChatThinkingPreference } from './chat-shared-thinking';
import type { StreamState } from '../turns/stream-controller';
import type { AgentChatExperienceSettings } from './chat-settings-storage';
import type {
  NimiRuntimeAgentInspectEventSummary,
  NimiRuntimeAgentInspectSnapshot,
} from '../../infra/runtime-agent-inspect';
import type {
  NimiRuntimeAgentAIConfigSnapshot,
} from '../../infra/runtime-agent-ai-config';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import type { AgentVoiceSessionShellState } from './chat-agent-voice-session.js';

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
  mutationPendingAction: string | null;
  onCancelPendingHook: (hookId: string) => void;
  onClearDyadicContext: () => void;
  onClearWorldContext: () => void;
  onDisableAutonomy: () => void;
  onEnableAutonomy: () => void;
  onRefreshInspect: () => void;
  onUpdateRuntimeState: (input: { statusText: string; worldId: string; userId: string }) => void;
  onUpdateAutonomyConfig: (input: { mode: string; dailyTokenBudget: string; maxTokensPerHook: string }) => void;
  recentRuntimeEvents: readonly NimiRuntimeAgentInspectEventSummary[];
  handleSubmit: (input: { text: string; attachments: readonly PendingAttachment[] }) => Promise<void>;
  hostFeedback: InlineFeedbackState | null;
  inputSelectionLocalAgentRef: AgentConversationSelection['localAgentRef'];
  isBundleLoading: boolean;
  messages: readonly ConversationMessageViewModel[];
  pendingAttachments: readonly PendingAttachment[];
  onDismissHostFeedback: () => void;
  onAttachmentsChange: (attachments: readonly PendingAttachment[]) => void;
  reasoningLabel: string;
  renderMessageAccessory?: CanonicalMessageAccessorySlot;
  renderMessageContent: CanonicalMessageContentSlot;
  runtimeAgentAIConfig: NimiRuntimeAgentAIConfigSnapshot | null;
  runtimeAgentAIConfigLoading: boolean;
  runtimeAgentAIConfigError: string | null;
  runtimeAgentCenterAdapter: AgentCenterSession | null;
  runtimeInspect: NimiRuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
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
    runtimeConversationSummaries?: readonly AgentRuntimeConversationSummary[];
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
    onToggle: () => void;
    onCancel: () => void;
  };
};
