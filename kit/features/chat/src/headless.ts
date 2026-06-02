export type {
  AttachmentAdapter,
  CanonicalMessageAccessorySlot,
  CanonicalMessageAvatarSlot,
  CanonicalMessageContentSlot,
  CanonicalMessageRenderContext,
  CanonicalRuntimeInspectPanelKey,
  CanonicalRuntimeInspectPanelState,
  CanonicalRuntimeInspectProps,
  CanonicalRuntimeInspectSectionData,
  CanonicalRuntimeInspectStatusChip,
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
  ConversationInteractionStateSummary,
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
export { useChatComposer } from './hooks/use-chat-composer.js';
export type {
  ConversationBeatModality,
  ConversationContinuityAdapter,
  ConversationContinuityCancelInput,
  ConversationContinuityCommitInput,
  ConversationContinuityLoadInput,
  ConversationGenerationAdapter,
  ConversationOrchestrationModeId,
  ConversationOrchestrationProvider,
  ConversationProjectionRebuildResult,
  ConversationProviderCapabilities,
  ConversationRuntimeAdapter,
  ConversationRuntimeTextMessage,
  ConversationRuntimeTextRequest,
  ConversationRuntimeTrace,
  ConversationRuntimeUsage,
  ConversationTurnError,
  ConversationTurnEvent,
  ConversationTurnEventByType,
  ConversationTurnHistoryMessage,
  ConversationTurnInput,
  ConversationTurnRole,
  ConversationVoiceAdapter,
  KnownConversationOrchestrationModeId,
} from './orchestration/contracts.js';
export {
  CONVERSATION_ORCHESTRATION_MODE_IDS,
  matchConversationTurnEvent,
} from './orchestration/contracts.js';
export type {
  ConversationCapabilityGuardKey,
} from './orchestration/capability-guards.js';
export type {
  ConversationHistoryBudget,
  ConversationHistoryWindowResult,
  ConversationTokenCounter,
} from './orchestration/history-window.js';
export type {
  UseChatComposerOptions,
  UseChatComposerResult,
} from './hooks/use-chat-composer.js';
export {
  buildConversationHistoryWindow,
  estimateConversationMessageChars,
  estimateConversationTokenCountFromChars,
  measureConversationHistoryBudget,
  SIMPLE_AI_COMPLETION_RESERVE,
  SIMPLE_AI_HISTORY_BUDGET,
} from './orchestration/history-window.js';
export {
  hasConversationCapability,
  requireConversationGenerationAdapter,
  requireConversationVoiceAdapter,
} from './orchestration/capability-guards.js';
export {
  ConversationOrchestrationRegistry,
  ConversationProviderNotRegisteredError,
} from './orchestration/registry.js';
export { CONVERSATION_MODES } from './types.js';
import type {
  ConversationComposerAdapter,
  ConversationMode,
  ConversationModeAvailability,
  ConversationSetupIssueCode,
  ConversationSetupState,
  ConversationShellAdapter,
  ConversationShellViewModel,
  ConversationThreadSummary,
} from './types.js';
import { CONVERSATION_MODES } from './types.js';

const CONVERSATION_MODE_SET = new Set<string>(CONVERSATION_MODES);

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

export type ConversationRuntimeRouteProjectionLike = {
  supported?: boolean;
  reasonCode?: string | null;
} | null | undefined;

export type ConversationRuntimeRouteSetupStateOptions = {
  mode?: ConversationMode;
  projection: ConversationRuntimeRouteProjectionLike;
  issueCode?: ConversationSetupIssueCode;
  actionTargetId?: 'runtime-overview' | 'runtime-local' | 'runtime-cloud';
  returnToMode?: ConversationMode;
  detailByReasonCode?: Partial<Record<string, string>>;
};

const DEFAULT_RUNTIME_ROUTE_SETUP_DETAIL_BY_REASON_CODE: Record<string, string> = {
  selection_missing: 'Select an AI route before sending a message.',
  selection_cleared: 'Select an AI route before sending a message.',
  binding_unresolved: 'The selected AI route is unavailable. Pick another route.',
  route_unhealthy: 'The selected AI route is unhealthy. Pick another route.',
  metadata_missing: 'The selected AI route metadata is unavailable. Pick another route.',
};

const DEFAULT_RUNTIME_ROUTE_SETUP_DETAIL = 'The selected AI route is unavailable. Pick another route.';

export function resolveConversationRuntimeRouteSetupStateFromProjection(
  input: ConversationRuntimeRouteSetupStateOptions,
): ConversationSetupState {
  const mode = input.mode ?? 'ai';
  if (input.projection?.supported) {
    return createReadyConversationSetupState(mode);
  }

  const reasonCode = typeof input.projection?.reasonCode === 'string'
    ? input.projection.reasonCode
    : '';
  const detail = input.detailByReasonCode?.[reasonCode]
    ?? DEFAULT_RUNTIME_ROUTE_SETUP_DETAIL_BY_REASON_CODE[reasonCode]
    ?? DEFAULT_RUNTIME_ROUTE_SETUP_DETAIL;

  return {
    mode,
    status: 'setup-required',
    issues: [{
      code: input.issueCode ?? 'ai-thread-route-unavailable',
      detail,
    }],
    primaryAction: {
      kind: 'open-settings',
      targetId: input.actionTargetId ?? 'runtime-overview',
      returnToMode: input.returnToMode ?? mode,
    },
  };
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
