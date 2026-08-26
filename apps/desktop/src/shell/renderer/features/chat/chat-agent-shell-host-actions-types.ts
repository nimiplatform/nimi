import type { MutableRefObject } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { ConversationTurnEvent } from '@nimiplatform/kit/features/chat/headless';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '../../bridge/runtime-bridge/types';
import type { AgentHostFlowFooterState } from './chat-agent-shell-host-flow';
import type {
  AgentSubmitDriverState,
} from './chat-agent-shell-submit-driver';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import type { AgentChatUserAttachment } from './chat-agent-runtime-turn-types';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import type { StreamController } from '../turns/stream-controller.js';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

export type AgentRunTurn = (input: {
  threadId: string;
  runtimeThreadId: string;
  conversationAnchorId: string;
  turnId: string;
  userMessage: {
    id: string;
    text: string;
    attachments: readonly AgentChatUserAttachment[];
  };
  signal: AbortSignal;
  textModelContextTokens: number | null;
  textMaxOutputTokensRequested: number | null;
  target: AgentLocalTargetSnapshot;
}) => AsyncIterable<ConversationTurnEvent>;

export type UseAgentConversationHostActionsInput = {
  now: () => number;
  sdk: DesktopRendererSdkPort;
  subjectUserId: string;
  streamController: StreamController;
  activeTarget: AgentLocalTargetSnapshot | null;
  activeThreadId: string | null;
  applyDriverEffects: (threadId: string, effects: ReturnType<typeof import('./chat-agent-shell-submit-driver').reduceAgentSubmitDriverEvent>) => AgentSubmitDriverState;
  bundle: AgentLocalThreadBundle | null;
  currentComposerTextRef: { current: string };
  queryClient: QueryClient;
  reportHostError: (error: unknown) => void;
  runAgentTurn: AgentRunTurn;
  selectedAgentHandle: string | null;
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
  setSelectionForAgentHandle: (agentHandle: string | null, conversationAnchorId: string | null) => void;
  setSubmittingThreadId: (threadId: string | null) => void;
  clearSelectedTarget: () => void;
  submittingThreadId: string | null;
  syncSelectionToThread: (thread: AgentLocalThreadSummary | AgentLocalThreadRecord | null) => void;
  t: TFunction;
  textModelContextTokens: number | null;
  textMaxOutputTokensRequested: number | null;
  targetByAgentHandle: Map<string, AgentLocalTargetSnapshot>;
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
  promise: Promise<AgentSubmitDriverState | void>;
};

export type ActiveSubmitRegistryRef = MutableRefObject<Map<string, ActiveAgentSubmit>>;
export type LockTokenRef = MutableRefObject<number>;
