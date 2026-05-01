import type { ConversationAnchorSnapshot } from './generated/runtime/v1/agent_service';
import type { SendAppMessageResponse } from './generated/runtime/v1/app';
import type { RuntimeAgentClient } from './types-client-interfaces.js';
import type {
  RuntimeAgentConsumeRequest,
  RuntimeAgentSessionSnapshot,
  RuntimeAgentSessionSnapshotRequest,
  RuntimeAgentTurnInterruptRequest,
  RuntimeAgentTurnRequest,
} from './types-runtime-agent-core.js';
import type { RuntimeAgentConsumeEvent } from './types-runtime-agent-events.js';
import type { RuntimeCallOptions, RuntimeStreamCallOptions } from './types.js';

export type * from './types-runtime-agent-core.js';
export type * from './types-runtime-agent-events.js';

export type RuntimeAgentAnchorsOpenRequest = {
  agentId: string;
  subjectUserId?: string;
  metadata?: Record<string, unknown>;
};

export type RuntimeAgentAnchorsSnapshotRequest = {
  agentId: string;
  conversationAnchorId: string;
  subjectUserId?: string;
};

export type RuntimeAgentAnchorsModule = {
  open(
    request: RuntimeAgentAnchorsOpenRequest,
    options?: RuntimeCallOptions,
  ): Promise<ConversationAnchorSnapshot>;
  getSnapshot(
    request: RuntimeAgentAnchorsSnapshotRequest,
    options?: RuntimeCallOptions,
  ): Promise<ConversationAnchorSnapshot>;
};

export type RuntimeAgentTurnsModule = {
  subscribe(
    request: RuntimeAgentConsumeRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<RuntimeAgentConsumeEvent>>;
  request(
    request: RuntimeAgentTurnRequest,
    options?: RuntimeCallOptions,
  ): Promise<SendAppMessageResponse>;
  interrupt(
    request: RuntimeAgentTurnInterruptRequest,
    options?: RuntimeCallOptions,
  ): Promise<SendAppMessageResponse>;
  getSessionSnapshot(
    request: RuntimeAgentSessionSnapshotRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<RuntimeAgentSessionSnapshot>;
};

export type RuntimeAgentModule = RuntimeAgentClient & {
  anchors: RuntimeAgentAnchorsModule;
  turns: RuntimeAgentTurnsModule;
};
