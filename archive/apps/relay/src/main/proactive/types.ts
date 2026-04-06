// Relay proactive types — adapted from local-chat proactive/types.ts
// Removed: LocalChatReadContext, LocalChatAiClient from mod SDK
// Adapted: uses relay types

import type {
  LocalChatContextPacket,
  LocalChatSession,
  LocalChatTarget,
  LocalChatTurnAiClient,
} from '../chat-pipeline/types.js';
import type { JsonObject } from '../../shared/json.js';

export type LocalChatWakeStrategy = 'PASSIVE' | 'PROACTIVE' | null;

export type LocalChatProactiveReasonCode =
  | 'LOCAL_CHAT_PROACTIVE_ALLOWED'
  | 'LOCAL_CHAT_PROACTIVE_DISABLED_BY_USER_SETTING'
  | 'LOCAL_CHAT_PROACTIVE_DISABLED_BY_WAKE_STRATEGY'
  | 'LOCAL_CHAT_PROACTIVE_SOCIAL_PRECONDITION_FAILED'
  | 'LOCAL_CHAT_PROACTIVE_COOLDOWN_ACTIVE'
  | 'LOCAL_CHAT_PROACTIVE_DAILY_CAP_REACHED'
  | 'LOCAL_CHAT_PROACTIVE_POLICY_UNAVAILABLE';

export type LocalChatProactivePolicyResult = {
  allowed: boolean;
  reasonCode: LocalChatProactiveReasonCode;
  actionHint: string;
};

export type LocalChatProactiveGateInput = {
  allowProactiveContact: boolean;
  wakeStrategy: LocalChatWakeStrategy;
  targetId: string;
  sessionId: string;
  idleMs: number;
  nowMs: number;
};

export type LocalChatProactiveDecisionObject = {
  shouldContact: boolean;
  message: string;
  reason: string;
};

export type LocalChatProactiveDecisionInput = {
  aiClient: Pick<LocalChatTurnAiClient, 'generateObject'>;
  target: LocalChatTarget;
  contextPacket: LocalChatContextPacket;
};

export type LocalChatProactiveAuditEvent = {
  flowId: string;
  source: string;
  targetId: string;
  sessionId: string;
  reasonCode: LocalChatProactiveReasonCode;
  actionHint: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  details?: JsonObject;
};

export type LocalChatProactiveHeartbeatInput = {
  aiClient: LocalChatTurnAiClient;
  targets: LocalChatTarget[];
  viewerId: string;
  nowMs?: () => number;
  onAuditEvent?: (event: LocalChatProactiveAuditEvent) => void;
};

export type LocalChatProactiveSchedulerInput = {
  runCycle: () => Promise<void>;
  delayMsFactory?: () => number;
  onTickFailed?: (error: unknown) => void;
};

export type LocalChatProactiveCandidate = {
  session: LocalChatSession;
  target: LocalChatTarget;
  idleMs: number;
  wakeStrategy: LocalChatWakeStrategy;
};
