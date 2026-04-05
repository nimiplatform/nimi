import type {
  ConversationMode,
  ConversationSourceFilter,
  ConversationSetupState,
  ConversationViewMode,
} from '@nimiplatform/nimi-kit/features/chat/headless';

export type AiConversationRouteSnapshot = {
  routeKind: 'local' | 'cloud';
  connectorId: string | null;
  provider: string | null;
  modelId: string | null;
  routeBinding: Record<string, unknown> | null;
};

export type AiConversationSelection = {
  threadId: string | null;
  routeSnapshot: AiConversationRouteSnapshot | null;
};

export type AgentConversationSelection = {
  threadId: string | null;
  agentId: string | null;
  targetId: string | null;
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
  ai: null,
  human: null,
  agent: null,
};

export const DEFAULT_CHAT_SOURCE_FILTER: ConversationSourceFilter = 'all';
export const DEFAULT_VIEW_MODE_BY_SOURCE_TARGET: ViewModeBySourceTarget = {};

export const EMPTY_AI_CONVERSATION_SELECTION: AiConversationSelection = {
  threadId: null,
  routeSnapshot: null,
};

export const EMPTY_AGENT_CONVERSATION_SELECTION: AgentConversationSelection = {
  threadId: null,
  agentId: null,
  targetId: null,
};

export const DEFAULT_CHAT_SETUP_STATE: ChatSetupStateByMode = {
  ai: null,
  human: null,
  agent: null,
};
