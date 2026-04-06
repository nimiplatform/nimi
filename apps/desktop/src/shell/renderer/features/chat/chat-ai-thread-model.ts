import type {
  ConversationMessageViewModel,
  ConversationThreadSummary,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type {
  ApiConnector,
  LocalModelOptionV11,
  RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import type {
  ChatAiMessageContent,
  ChatAiMessageError,
  ChatAiMessageRecord,
  ChatAiThreadSummary,
} from '@renderer/bridge/runtime-bridge/types';
import type { AiConversationResolvedRoute } from './chat-ai-route-readiness';

export const AI_NEW_CONVERSATION_TITLE = 'New conversation';
const AI_THREAD_TITLE_MAX_LENGTH = 80;

function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasChatCapability(capabilities: readonly string[]): boolean {
  return capabilities.includes('chat');
}

function compareLocalModels(left: LocalModelOptionV11, right: LocalModelOptionV11): number {
  const rank = (status: LocalModelOptionV11['status']) => {
    if (status === 'active') return 0;
    if (status === 'installed') return 1;
    if (status === 'unhealthy') return 2;
    return 3;
  };
  const rankDelta = rank(left.status) - rank(right.status);
  if (rankDelta !== 0) {
    return rankDelta;
  }
  return left.model.localeCompare(right.model);
}

export function isResolvedRouteEqual(
  left: AiConversationResolvedRoute | null | undefined,
  right: AiConversationResolvedRoute | null | undefined,
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.routeKind === right.routeKind
    && left.connectorId === right.connectorId
    && left.provider === right.provider
    && left.modelId === right.modelId;
}

export function hasAiConversationThread(
  threads: readonly ChatAiThreadSummary[],
  threadId: string | null | undefined,
): boolean {
  const normalizedThreadId = normalizeText(threadId);
  if (!normalizedThreadId) {
    return false;
  }
  return threads.some((thread) => thread.id === normalizedThreadId);
}

export function resolveAiConversationActiveThreadId(input: {
  threads: readonly ChatAiThreadSummary[];
  selectionThreadId: string | null | undefined;
  lastSelectedThreadId: string | null | undefined;
}): string | null {
  if (hasAiConversationThread(input.threads, input.selectionThreadId)) {
    return normalizeText(input.selectionThreadId);
  }
  if (hasAiConversationThread(input.threads, input.lastSelectedThreadId)) {
    return normalizeText(input.lastSelectedThreadId);
  }
  return null;
}

export function pickPreferredChatLocalModel(
  state: RuntimeConfigStateV11 | null,
): LocalModelOptionV11 | null {
  if (!state) {
    return null;
  }
  const models = state.local.models
    .filter((model) => model.status !== 'removed' && hasChatCapability(model.capabilities))
    .sort(compareLocalModels);
  return models[0] || null;
}

export function pickChatCapableConnectorModel(
  connector: ApiConnector,
  preferredModelId?: string | null,
): string | null {
  const models = connector.models
    .map((modelId) => normalizeText(modelId))
    .filter(Boolean);
  if (models.length === 0) {
    return null;
  }

  const capabilityMap = connector.modelCapabilities || {};
  const modelSupportsChat = (modelId: string) => {
    const capabilities = capabilityMap[modelId];
    if (!Array.isArray(capabilities) || capabilities.length === 0) {
      return Object.keys(capabilityMap).length === 0;
    }
    return capabilities.includes('chat');
  };

  const preferred = normalizeText(preferredModelId);
  if (preferred && models.includes(preferred) && modelSupportsChat(preferred)) {
    return preferred;
  }

  return models.find((modelId) => modelSupportsChat(modelId)) || null;
}

export function getResolvedRouteDisplaySummary(
  route: AiConversationResolvedRoute | null,
  state: RuntimeConfigStateV11 | null,
): { label: string; detail: string } {
  if (!route) {
    return {
      label: 'Route unavailable',
      detail: 'Select a local or cloud route before starting a conversation.',
    };
  }

  if (route.routeKind === 'local') {
    const localModel = pickPreferredChatLocalModel(state);
    return {
      label: 'Local runtime',
      detail: localModel
        ? `${localModel.engine} · ${localModel.model}`
        : 'No active local chat model',
    };
  }

  return {
    label: route.provider || 'Cloud route',
    detail: route.modelId || route.connectorId || 'Missing model selection',
  };
}

export function toConversationThreadSummary(
  thread: ChatAiThreadSummary,
): ConversationThreadSummary {
  return {
    id: thread.id,
    mode: 'ai',
    title: thread.title,
    previewText: '',
    createdAt: toIsoString(thread.updatedAtMs),
    updatedAt: toIsoString(thread.updatedAtMs),
    unreadCount: 0,
    status: thread.archivedAtMs == null ? 'active' : 'archived',
    pinned: false,
    targetId: 'ai',
    targetLabel: 'AI',
  };
}

function toContentText(contentText: string, content: ChatAiMessageContent): string {
  const normalizedContentText = String(contentText || '');
  if (normalizedContentText) {
    return normalizedContentText;
  }
  return content.parts
    .map((part: ChatAiMessageContent['parts'][number]) => String(part.text || ''))
    .join('\n')
    .trim();
}

function toErrorMessage(error: ChatAiMessageError | null): string | null {
  if (!error) {
    return null;
  }
  return normalizeText(error.message) || normalizeText(error.code) || 'Message failed';
}

export function toConversationMessageViewModel(
  message: ChatAiMessageRecord,
): ConversationMessageViewModel {
  const reasoningText = typeof message.content.metadata.reasoningText === 'string'
    ? message.content.metadata.reasoningText
    : null;
  return {
    id: message.id,
    threadId: message.threadId,
    role: message.role,
    text: toContentText(message.contentText, message.content),
    createdAt: toIsoString(message.createdAtMs),
    updatedAt: toIsoString(message.updatedAtMs),
    status: message.status,
    error: toErrorMessage(message.error),
    metadata: {
      traceId: message.traceId,
      parentMessageId: message.parentMessageId,
      reasoningText,
    },
  };
}

export function createPlainTextMessageContent(text: string): ChatAiMessageContent {
  return {
    parts: [{ type: 'text', text }],
    toolCalls: [],
    attachments: [],
    metadata: {},
  };
}

export function createAssistantMessageContent(text: string, reasoningText?: string | null): ChatAiMessageContent {
  const normalizedReasoningText = String(reasoningText || '').trim();
  return {
    parts: [{ type: 'text', text }],
    toolCalls: [],
    attachments: [],
    metadata: normalizedReasoningText
      ? { reasoningText: normalizedReasoningText }
      : {},
  };
}

export function trimThreadTitleFromUserMessage(text: string): string {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return AI_NEW_CONVERSATION_TITLE;
  }
  return normalized.slice(0, AI_THREAD_TITLE_MAX_LENGTH);
}

export function resolveThreadTitleAfterFirstSend(currentTitle: string, userText: string): string {
  if (normalizeText(currentTitle) !== AI_NEW_CONVERSATION_TITLE) {
    return currentTitle;
  }
  return trimThreadTitleFromUserMessage(userText);
}
