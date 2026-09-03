import type {
  ConversationMode,
  ConversationSourceFilter,
  ConversationSetupState,
  ConversationViewMode,
} from '@nimiplatform/kit/features/chat/headless';

export type NimiConversationSelection = {
  threadId: string | null;
};

export type AgentConversationSelection = {
  agentHandle: string | null;
  conversationAnchorId: string | null;
  targetId: string | null;
};

export type AgentComposerPrefill = {
  agentHandle?: string;
  sourceKey?: string;
  text: string;
  requestId: number;
};

export type LastSelectedThreadByMode = Partial<Record<ConversationMode, string | null>>;
export type ChatSetupStateByMode = Partial<Record<ConversationMode, ConversationSetupState | null>>;
export type SelectedTargetBySource = Partial<Record<ConversationMode, string | null>>;
export type ViewModeBySourceTarget = Partial<Record<string, ConversationViewMode>>;

export const DEFAULT_LAST_SELECTED_THREAD_BY_MODE: LastSelectedThreadByMode = {
  ai: null,
  human: null,
  agent: null,
};

export const DEFAULT_SELECTED_TARGET_BY_SOURCE: SelectedTargetBySource = {
  ai: 'ai:assistant',
  human: null,
  agent: null,
};

export const DEFAULT_CHAT_SOURCE_FILTER: ConversationSourceFilter = 'all';
export const DEFAULT_VIEW_MODE_BY_SOURCE_TARGET: ViewModeBySourceTarget = {};

export const EMPTY_NIMI_CONVERSATION_SELECTION: NimiConversationSelection = {
  threadId: null,
};

export const EMPTY_AGENT_CONVERSATION_SELECTION: AgentConversationSelection = {
  agentHandle: null,
  conversationAnchorId: null,
  targetId: null,
};

export const DEFAULT_CHAT_SETUP_STATE: ChatSetupStateByMode = {
  ai: null,
  human: null,
  agent: null,
};
