import type { MutableRefObject } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { ConversationTurnEvent } from '@nimiplatform/nimi-kit/features/chat/headless';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import type { AgentHostFlowFooterState } from './chat-agent-shell-host-flow';
import type {
  AgentSubmitDriverState,
} from './chat-agent-shell-submit-driver';
import type { ChatAgentVoiceWorkflowReferenceAudio } from './chat-agent-runtime';
import type {
  AgentVoiceWorkflowCapability,
  AgentEffectiveCapabilityResolution,
  AIConfig,
  AISnapshot,
} from './conversation-capability';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import type { AgentChatUserAttachment } from './chat-ai-execution-engine';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';

export type AgentRunTurn = (input: {
  threadId: string;
  turnId: string;
  userMessage: {
    id: string;
    text: string;
    attachments: readonly AgentChatUserAttachment[];
  };
  history: ReturnType<typeof import('./chat-agent-shell-core').toConversationHistoryMessages>;
  signal: AbortSignal;
  agentResolution: AgentEffectiveCapabilityResolution;
  textExecutionSnapshot: AISnapshot;
  imageExecutionSnapshot: AISnapshot | null;
  voiceExecutionSnapshot: AISnapshot | null;
  voiceWorkflowExecutionSnapshotByCapability: Partial<Record<AgentVoiceWorkflowCapability, AISnapshot | null>>;
  latestVoiceCapture: ChatAgentVoiceWorkflowReferenceAudio | null;
  textModelContextTokens: number | null;
  textMaxOutputTokensRequested: number | null;
  target: AgentLocalTargetSnapshot;
}) => AsyncIterable<ConversationTurnEvent>;

export type UseAgentConversationHostActionsInput = {
  activeTarget: AgentLocalTargetSnapshot | null;
  activeThreadId: string | null;
  aiConfig: AIConfig;
  applyDriverEffects: (threadId: string, effects: ReturnType<typeof import('./chat-agent-shell-submit-driver').reduceAgentSubmitDriverEvent>) => AgentSubmitDriverState;
  bundle: AgentLocalThreadBundle | null;
  currentDraftTextRef: { current: string };
  draftText: string | null | undefined;
  draftUpdatedAtMs: number | null | undefined;
  latestVoiceCaptureByThreadRef: {
    current: Record<string, ChatAgentVoiceWorkflowReferenceAudio | undefined>;
  };
  queryClient: QueryClient;
  reportHostError: (error: unknown) => void;
  runAgentTurn: AgentRunTurn;
  selectedAgentId: string | null;
  selectedThreadRecord: AgentLocalThreadSummary | null;
  setBundleCache: (
    threadId: string,
    updater: (current: AgentLocalThreadBundle | null | undefined) => AgentLocalThreadBundle | null | undefined,
  ) => void;
  setFooterHostState: (
    threadId: string,
    nextState: {
      footerState: AgentHostFlowFooterState;
      lifecycle: AgentTurnLifecycleState;
    } | null,
  ) => void;
  setSelectionForAgent: (agentId: string | null) => void;
  setSubmittingThreadId: (threadId: string | null) => void;
  setThreadsCache: (updater: (current: AgentLocalThreadSummary[]) => AgentLocalThreadSummary[]) => void;
  clearSelectedTarget: () => void;
  submittingThreadId: string | null;
  syncSelectionToThread: (thread: AgentLocalThreadSummary | AgentLocalThreadRecord | null) => void;
  t: TFunction;
  textModelContextTokens: number | null;
  textMaxOutputTokensRequested: number | null;
  targetByAgentId: Map<string, AgentLocalTargetSnapshot>;
  targetsReady: boolean;
  threads: readonly AgentLocalThreadSummary[];
  threadsReady: boolean;
};

export type AgentConversationSubmitPayload = {
  text: string;
  attachments: readonly PendingAttachment[];
};

export type ActiveAgentSubmit = {
  threadId: string;
  turnId: string;
  interruptible: boolean;
  overrideRequested: boolean;
  abort: () => void;
  promise: Promise<void>;
};

export type ActiveSubmitRegistryRef = MutableRefObject<Map<string, ActiveAgentSubmit>>;
export type LockTokenRef = MutableRefObject<number>;
