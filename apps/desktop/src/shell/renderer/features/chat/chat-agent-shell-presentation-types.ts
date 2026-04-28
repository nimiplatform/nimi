import type { MouseEvent, ReactNode } from 'react';
import type { useTranslation } from 'react-i18next';
import type {
  CanonicalMessageAccessorySlot,
  CanonicalMessageContentSlot,
  ConversationCanonicalMessage,
  ConversationMessageViewModel,
  ConversationSetupState,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type { AgentLocalTargetSnapshot, AgentLocalThreadBundle, AgentLocalThreadSummary } from '@renderer/bridge/runtime-bridge/types';
import type { InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';
import type { AISchedulingJudgement } from '@nimiplatform/sdk/mod';
import type { AgentConversationSelection } from './chat-shell-types';
import type { AgentHostFlowFooterState } from './chat-agent-shell-host-flow';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import type { ChatThinkingPreference } from './chat-shared-thinking';
import type { StreamState } from '../turns/stream-controller';
import type { AgentChatExperienceSettings } from './chat-settings-storage';
import type { RuntimeAgentInspectEventSummary, RuntimeAgentInspectSnapshot } from '@renderer/infra/runtime-agent-inspect';
import type { AgentVoiceSessionShellState } from './chat-agent-voice-session';
import type { PendingAttachment } from '../turns/turn-input-attachments';

export type UseAgentConversationPresentationInput = {
  activeTarget: AgentLocalTargetSnapshot | null;
  accountId: string | null;
  activeThreadId: string | null;
  activeConversationAnchorId: string | null;
  bundle: AgentLocalThreadBundle | null;
  bundleError: unknown;
  composerReady: boolean;
  currentDraftTextRef: { current: string };
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
  recentRuntimeEvents: readonly RuntimeAgentInspectEventSummary[];
  handleSubmit: (input: { text: string; attachments: readonly PendingAttachment[] }) => Promise<void>;
  hostFeedback: InlineFeedbackState | null;
  initialModelSelection?: Partial<RouteModelPickerSelection>;
  inputSelectionAgentId: AgentConversationSelection['agentId'];
  isBundleLoading: boolean;
  messages: readonly ConversationMessageViewModel[];
  pendingAttachments: readonly PendingAttachment[];
  onDismissHostFeedback: () => void;
  onAttachmentsChange: (attachments: readonly PendingAttachment[]) => void;
  onMessageContextMenu?: (message: ConversationCanonicalMessage, event: MouseEvent<HTMLDivElement>) => void;
  onModelSelectionChange: (selection: RouteModelPickerSelection) => void;
  reasoningLabel: string;
  renderMessageAccessory?: CanonicalMessageAccessorySlot;
  renderMessageContent: CanonicalMessageContentSlot;
  routeReady: boolean;
  runtimeInspect: RuntimeAgentInspectSnapshot | null;
  runtimeInspectLoading: boolean;
  schedulingJudgement: AISchedulingJudgement | null;
  selectedTargetId: string | null;
  behaviorSettings: AgentChatExperienceSettings;
  setBehaviorSettings: (value: AgentChatExperienceSettings) => void;
  cognitionContent?: ReactNode;
  onDiagnosticsVisibilityChange?: (visible: boolean) => void;
  onOpenAgentCenter?: () => void;
  voiceSessionState: AgentVoiceSessionShellState;
  voiceCaptureState: {
    active: boolean;
    amplitude: number;
  } | null;
  voicePlaybackState: {
    conversationAnchorId: string;
    messageId: string;
    active: boolean;
    amplitude: number;
    visemeId: 'aa' | 'ee' | 'ih' | 'oh' | 'ou' | null;
  } | null;
  onVoiceSessionToggle: () => void;
  onVoiceSessionCancel: () => void;
  onEnterHandsFreeVoiceSession: () => void;
  onExitHandsFreeVoiceSession: () => void;
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
  agentRouteReady: boolean;
  clearChatsTargetName?: string | null;
  clearChatsDisabled?: boolean;
  onClearAgentHistory?: () => Promise<void> | void;
};
