import type { MutableRefObject } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadBundle,
  AgentLocalThreadRecord,
  AgentLocalThreadSummary,
} from '../../bridge/runtime-bridge/types';
import type { AgentHostFlowFooterState } from './chat-agent-shell-host-flow';
import type { PendingAttachment } from '../turns/turn-input-attachments';
import type { AgentTurnLifecycleState } from './chat-agent-shell-lifecycle';
import type { StreamController } from '../turns/stream-controller.js';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';

export type UseAgentConversationHostActionsInput = {
  now: () => number;
  sdk: DesktopRendererSdkPort;
  subjectUserId: string;
  streamController: StreamController;
  activeTarget: AgentLocalTargetSnapshot | null;
  activeThreadId: string | null;
  bundle: AgentLocalThreadBundle | null;
  submissionPersistence?: Pick<ReturnType<typeof import('./chat-agent-composer-persistence').useAgentComposerPersistence>, 'prepare' | 'acknowledge'>;
  currentComposerTextRef: { current: string; readonly revision?: number };
  pendingAttachments?: readonly PendingAttachment[];
  queryClient: QueryClient;
  reportHostError: import('./chat-agent-shell-adapter-host-feedback').ReportAgentConversationHostError;
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
  retryOfTurnId?: string;
  parentMessageId?: string;
  text: string;
  attachments: readonly PendingAttachment[];
  /** The submitting composer still owns its unchanged draft, including attachments. */
  canUpdateDraft?: () => boolean;
};

export type LockTokenRef = MutableRefObject<number>;
