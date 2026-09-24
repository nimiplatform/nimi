// App work and App skill calls for the on-duty agent
// (Runtime rule agent-participation.app-work, SDK 0.17 / Kit 0.14).
// Runtime owns the agent's tool loop and the final commit; NimiDay only runs
// its own business skills for the calls it is given.

import type {
  NimiLocalAppClient,
  NimiLocalAppConversationToolCall,
  NimiLocalAppConversationToolResultInput,
  NimiLocalAppConversationToolScope,
  NimiLocalAppConversationWork,
} from '@nimiplatform/sdk/app';
import type { DayWork } from '../domain/work.js';

export type WorkSendInput = {
  readonly text: string;
  readonly requestId: string;
  readonly work: DayWork;
  /** Set for a routine NimiDay starts on its own; Runtime then records an App-originated turn. */
  readonly routineName?: string;
};

export type PendingToolCall = NimiLocalAppConversationToolCall;

export type ConversationWorkApi = {
  readonly send: (input: {
    readonly agentHandle: Parameters<NimiLocalAppClient['conversation']['send']>[0]['agentHandle'];
    readonly conversationAnchorId: string;
    readonly requestId: string;
    readonly parts: readonly { readonly kind: 'text'; readonly text: string }[];
    readonly work: NimiLocalAppConversationWork;
  }) => Promise<{ readonly turnId: string }>;
  readonly listToolCalls: (input: NimiLocalAppConversationToolScope) => Promise<readonly PendingToolCall[]>;
  readonly submitToolResult: (input: NimiLocalAppConversationToolResultInput) => Promise<{ readonly callId: string }>;
};

type ConversationLike = NimiLocalAppClient['conversation'];

export function conversationWorkApi(conversation: ConversationLike): ConversationWorkApi | null {
  // A carrier without the App-work operations cannot run skills; NimiDay says so instead of simulating them.
  if (typeof conversation.listToolCalls !== 'function' || typeof conversation.submitToolResult !== 'function') return null;
  return {
    send: (input) => conversation.send(input),
    listToolCalls: (input) => conversation.listToolCalls(input),
    submitToolResult: (input) => conversation.submitToolResult(input),
  };
}

export function toSdkWork(work: DayWork, routineName: string | undefined): NimiLocalAppConversationWork {
  return {
    workId: work.workId,
    ...(routineName ? { routineName: routineName.slice(0, 128) } : {}),
    instructions: work.instructions,
    sources: work.sources,
    tools: work.tools,
  };
}
