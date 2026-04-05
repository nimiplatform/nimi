export type {
  AttachmentAdapter,
  CanonicalMessageAccessorySlot,
  CanonicalMessageAvatarSlot,
  CanonicalMessageContentSlot,
  CanonicalMessageRenderContext,
  CanonicalTranscriptGroup,
  ConversationCanonicalMessage,
  ConversationCanonicalMessageKind,
  ConversationCanonicalSession,
  ConversationCapabilityState,
  ChatComposerAdapter,
  ChatComposerState,
  ChatComposerSubmitInput,
  ConversationCharacterBadge,
  ConversationCharacterData,
  ConversationComposerAdapter,
  ConversationModeAvailability,
  ConversationMessageRole,
  ConversationMessageStatus,
  ConversationMessageViewModel,
  ConversationMode,
  ConversationSetupAction,
  ConversationSourceAdapter,
  ConversationSourceFilter,
  ConversationSourceKind,
  ConversationSetupIssue,
  ConversationSetupIssueCode,
  ConversationSetupState,
  ConversationShellAdapter,
  ConversationShellViewModel,
  ConversationTargetSummary,
  ConversationThreadAdapter,
  ConversationThreadStatus,
  ConversationThreadSummary,
  ConversationViewMode,
} from './types.js';
export { normalizeRealmMessagePayload } from './realm/codec.js';
export { useChatComposer } from './hooks/use-chat-composer.js';
export type {
  UseChatComposerOptions,
  UseChatComposerResult,
} from './hooks/use-chat-composer.js';
export { CONVERSATION_MODES } from './types.js';
import type {
  ConversationComposerAdapter,
  ConversationMode,
  ConversationModeAvailability,
  ConversationSetupState,
  ConversationShellAdapter,
  ConversationShellViewModel,
  ConversationThreadSummary,
} from './types.js';

const CONVERSATION_MODE_SET = new Set<string>(['ai', 'human', 'agent']);

export function isConversationMode(value: unknown): value is ConversationMode {
  return typeof value === 'string' && CONVERSATION_MODE_SET.has(value);
}

export function createReadyConversationSetupState(
  mode: ConversationMode,
): ConversationSetupState {
  return {
    mode,
    status: 'ready',
    issues: [],
    primaryAction: null,
  };
}

export function hasConversationSetupBlockingState(
  state: ConversationSetupState | null | undefined,
): boolean {
  return Boolean(state && state.status !== 'ready');
}

export function resolveConversationThreadById(
  threads: readonly ConversationThreadSummary[],
  threadId: string | null | undefined,
): ConversationThreadSummary | null {
  const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';
  if (!normalizedThreadId) {
    return null;
  }
  return threads.find((thread) => thread.id === normalizedThreadId) || null;
}

export function hasConversationComposer(
  input: {
    setupState: ConversationSetupState;
    composerAdapter: ConversationComposerAdapter<unknown> | null;
    activeThreadId: string | null | undefined;
  },
): boolean {
  if (input.setupState.status !== 'ready') {
    return false;
  }
  if (!input.composerAdapter) {
    return false;
  }
  return Boolean(typeof input.activeThreadId === 'string' && input.activeThreadId.trim());
}

function resolveConversationModes(
  activeMode: ConversationMode,
  modes: readonly ConversationModeAvailability[] | null | undefined,
): readonly ConversationModeAvailability[] {
  if (modes && modes.length > 0) {
    return modes;
  }
  return [{
    mode: activeMode,
    label: activeMode.toUpperCase(),
    enabled: true,
    badge: null,
    disabledReason: null,
  }];
}

function readConversationThreads(
  adapter: ConversationShellAdapter<unknown>,
): readonly ConversationThreadSummary[] {
  const result = adapter.threadAdapter.listThreads();
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    throw new TypeError('createConversationShellViewModel requires a synchronous thread adapter result');
  }
  return Array.isArray(result) ? result : [];
}

export function createConversationShellViewModel(
  input: {
    adapter: ConversationShellAdapter<unknown>;
    activeMode?: ConversationMode;
    activeThreadId?: string | null;
    modes?: readonly ConversationModeAvailability[] | null;
  },
): ConversationShellViewModel {
  const activeMode = input.activeMode ?? input.adapter.mode;
  const activeThreadId = typeof input.activeThreadId === 'string' && input.activeThreadId.trim()
    ? input.activeThreadId
    : null;
  const threads = readConversationThreads(input.adapter);
  const selectedThread = resolveConversationThreadById(threads, activeThreadId);
  const canCompose = hasConversationComposer({
    setupState: input.adapter.setupState,
    composerAdapter: input.adapter.composerAdapter as ConversationComposerAdapter<unknown> | null,
    activeThreadId: selectedThread?.id || null,
  });

  return {
    activeMode,
    modes: resolveConversationModes(activeMode, input.modes),
    setupState: input.adapter.setupState,
    threads,
    activeThreadId,
    selectedThread,
    canCompose,
    composerPlaceholder: canCompose
      ? input.adapter.composerAdapter?.placeholder || null
      : null,
  };
}
