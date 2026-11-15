import type {
  ConversationMode,
  ConversationSourceFilter,
  ConversationSetupState,
  ConversationViewMode,
} from '@nimiplatform/kit/features/chat/headless';

export type NimiConversationSelection = {
  threadId: string | null;
};

export type HomeChatMode = Extract<ConversationMode, 'ai' | 'human'>;

export type LastSelectedThreadByMode = Partial<Record<HomeChatMode, string | null>>;
export type ChatSetupStateByMode = Partial<Record<HomeChatMode, ConversationSetupState | null>>;
export type SelectedTargetBySource = Partial<Record<HomeChatMode, string | null>>;
export type ViewModeBySourceTarget = Partial<Record<string, ConversationViewMode>>;

export const DEFAULT_LAST_SELECTED_THREAD_BY_MODE: LastSelectedThreadByMode = {
  ai: null,
  human: null,
};

export const DEFAULT_SELECTED_TARGET_BY_SOURCE: SelectedTargetBySource = {
  ai: 'ai:assistant',
  human: null,
};

export const DEFAULT_CHAT_SOURCE_FILTER: ConversationSourceFilter = 'all';
export const DEFAULT_VIEW_MODE_BY_SOURCE_TARGET: ViewModeBySourceTarget = {};

export const EMPTY_NIMI_CONVERSATION_SELECTION: NimiConversationSelection = {
  threadId: null,
};

export const DEFAULT_CHAT_SETUP_STATE: ChatSetupStateByMode = {
  ai: null,
  human: null,
};
