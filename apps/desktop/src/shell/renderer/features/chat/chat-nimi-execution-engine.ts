import type {
  ConversationRuntimeTextMessage,
  ConversationTurnHistoryMessage,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import {
  createNimiError,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  AgentLocalBeatModality,
  AgentLocalTargetSnapshot,
  AgentLocalTurnContext,
} from '@renderer/bridge/runtime-bridge/types';
import type { AgentResolvedBehavior } from './chat-agent-behavior';
import type { AgentEffectiveCapabilityResolution } from './conversation-capability';
import {
  buildContinuityDigest,
  buildContinuitySummary,
  buildRuntimeRequestPreview,
  buildUserMessageContent,
  countOccurrences,
  createInitialBudget,
  estimateAgentLocalChatTokens,
  estimateRuntimeMessageTokens,
  normalizeHistoryForRuntime,
  normalizeText,
  packHistoryMessages,
  reduceSystemPrompt,
  resolveModelContextTokens,
} from './chat-nimi-execution-engine-internals';

export const AI_CHAT_EXECUTION_ENGINE_ID = 'ai-chat-execution-engine.v1';
export const AI_CHAT_EXECUTION_ENGINE_DIAGNOSTICS_VERSION = 'v1';

export type AgentLocalChatContextBudget = {
  modelContextTokens: number;
  outputReserveTokens: number;
  paddingTokens: number;
  promptBudgetTokens: number;
  systemBudgetTokens: number;
  historyBudgetTokens: number;
};

export type AgentLocalChatPromptEstimate = {
  totalInputTokens: number;
  systemTokens: number;
  historyTokens: number;
  userTokens: number;
  droppedHistoryMessages: number;
  droppedMemoryEntries: number;
  droppedRecallEntries: number;
  droppedArtifactFacts: number;
};

export type AgentLocalChatPromptDiagnostics = {
  engineId: typeof AI_CHAT_EXECUTION_ENGINE_ID;
  diagnosticsVersion: typeof AI_CHAT_EXECUTION_ENGINE_DIAGNOSTICS_VERSION;
  firstConsumerId: 'agent-local-chat-v1';
  contextWindowSource: 'route-profile' | 'default-estimate';
  budget: AgentLocalChatContextBudget;
  estimate: AgentLocalChatPromptEstimate;
  continuity: {
    snapshotIncluded: boolean;
    retainedMemoryEntries: number;
    retainedRecallEntries: number;
    retainedArtifactFacts: number;
    bioCharLimit: number;
  };
  transcript: {
    retainedHistoryMessages: number;
    emittedMessages: number;
    trimmedLeadingAssistantMessages: number;
  };
  maxOutputTokensRequested: number | null;
  promptOverflow: boolean;
};

export type AgentLocalChatPromptDiagnosticsInspection = AgentLocalChatPromptDiagnostics;

export type AiChatExecutionEngineReuseAdmissionCode =
  | 'consumer_scope_text_chat'
  | 'consumer_owns_semantics'
  | 'consumer_supplies_continuity_inputs'
  | 'consumer_accepts_structured_messages'
  | 'shared_authority_change_required'
  | 'behavior_authority_change_required'
  | 'memory_authority_change_required'
  | 'policy_authority_change_required'
  | 'settings_authority_change_required'
  | 'voice_or_video_scope_not_admitted';

export type AiChatExecutionEngineReuseAssessmentInput = {
  consumerId: string;
  modality: 'text-chat' | 'voice-chat' | 'video-chat' | 'other';
  consumerOwnsSemantics: boolean;
  consumerSuppliesContinuityInputs: boolean;
  acceptsStructuredMessages: boolean;
  requiresSharedAuthorityChange?: boolean;
  requiresBehaviorAuthorityChange?: boolean;
  requiresMemoryAuthorityChange?: boolean;
  requiresPolicyAuthorityChange?: boolean;
  requiresSettingsAuthorityChange?: boolean;
};

export type AiChatExecutionEngineReuseAssessment = {
  engineId: typeof AI_CHAT_EXECUTION_ENGINE_ID;
  status: 'ready' | 'preflight_required';
  consumerId: string;
  admitted: boolean;
  reasons: AiChatExecutionEngineReuseAdmissionCode[];
};

export type AgentChatContinuityArtifactFact = {
  modality: Exclude<AgentLocalBeatModality, 'text'>;
  status: string;
  note?: string;
};

export type AgentChatContinuityDigest = {
  snapshot: {
    relationshipState: string;
    emotionalTemperature: number;
    commitments: unknown;
    userPrefs: unknown;
    openLoops: unknown;
  } | null;
  memory: string[];
  recall: string[];
  artifactFacts: AgentChatContinuityArtifactFact[];
};

export type AgentLocalChatExecutionTextRequest = {
  // Debug-only preview of the actual message payload sent to runtime.
  prompt: string;
  messages: readonly ConversationRuntimeTextMessage[];
  systemPrompt: string | null;
  diagnostics: AgentLocalChatPromptDiagnostics;
};

export type AgentChatUserAttachment = {
  kind: 'image';
  url: string;
  mimeType: string | null;
  name: string;
  resourceId: string | null;
};

export type BuildAgentLocalChatExecutionTextRequestInput = {
  systemPrompt: string | null;
  targetSnapshot: AgentLocalTargetSnapshot;
  history: readonly ConversationTurnHistoryMessage[];
  userText: string;
  currentUserMessageId?: string | null;
  userAttachments?: readonly AgentChatUserAttachment[];
  omitUserMessageFromMessages?: boolean;
  followUpInstruction?: string | null;
  context: AgentLocalTurnContext;
  resolvedBehavior?: AgentResolvedBehavior | null;
  agentResolution?: AgentEffectiveCapabilityResolution | null;
  modelContextTokens?: number | null;
  maxOutputTokensRequested?: number | null;
};

function createPromptOverflowError(input: {
  prompt: string;
  systemPrompt: string | null;
  diagnostics: AgentLocalChatPromptDiagnostics;
}): ReturnType<typeof createNimiError> {
  return createNimiError({
    message: 'Agent request exceeds the available input budget after prompt reduction.',
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint: 'reduce_input',
    source: 'runtime',
    details: {
      contextWindowSource: input.diagnostics.contextWindowSource,
      promptOverflow: true,
      requestPrompt: input.prompt,
      requestSystemPrompt: input.systemPrompt || '',
      maxOutputTokensRequested: input.diagnostics.maxOutputTokensRequested ?? 0,
      totalInputTokens: input.diagnostics.estimate.totalInputTokens,
      promptBudgetTokens: input.diagnostics.budget.promptBudgetTokens,
      systemTokens: input.diagnostics.estimate.systemTokens,
      historyTokens: input.diagnostics.estimate.historyTokens,
      userTokens: input.diagnostics.estimate.userTokens,
    },
  });
}

export function buildAgentLocalChatExecutionTextRequest(
  input: BuildAgentLocalChatExecutionTextRequestInput,
): AgentLocalChatExecutionTextRequest {
  const modelContext = resolveModelContextTokens(input.modelContextTokens);
  const initialBudget = createInitialBudget(modelContext.value);
  const omitUserMessageFromMessages = input.omitUserMessageFromMessages === true;
  const userAttachments = (input.userAttachments || []).filter((attachment) => (
    attachment.kind === 'image' && normalizeText(attachment.url)
  ));
  const userMessage = omitUserMessageFromMessages
    ? null
    : (() => {
      const userContent = buildUserMessageContent(input.userText, userAttachments);
      return {
        role: 'user' as const,
        text: input.userText,
        ...(Array.isArray(userContent) ? { content: userContent } : {}),
      };
    })();
  const userTokens = userMessage ? estimateRuntimeMessageTokens(userMessage) : 0;
  const fullDigest = buildContinuityDigest(input.context);
  const reducedSystem = reduceSystemPrompt(input, fullDigest, initialBudget.systemBudgetTokens);
  const historyBudgetTokens = Math.max(
    0,
    initialBudget.promptBudgetTokens - reducedSystem.systemTokens - userTokens,
  );
  const normalizedHistory = normalizeHistoryForRuntime({
    history: input.history,
    currentUserMessageId: normalizeText(input.currentUserMessageId) || null,
    userText: input.userText,
    hasAttachments: userAttachments.length > 0,
    omitUserMessageFromMessages,
  });
  const packedHistory = packHistoryMessages({
    history: normalizedHistory,
    userMessage: userMessage || {
      role: 'assistant',
      text: '',
      name: null,
    },
    historyBudgetTokens,
  });
  const packedMessages = userMessage ? packedHistory.messages : packedHistory.messages.filter((message) => (
    message.role !== 'assistant' || normalizeText(message.text)
  ));
  const prompt = buildRuntimeRequestPreview(packedMessages);
  const budget: AgentLocalChatContextBudget = {
    ...initialBudget,
    historyBudgetTokens,
  };
  const estimate: AgentLocalChatPromptEstimate = {
    totalInputTokens: reducedSystem.systemTokens + packedHistory.historyTokens + userTokens,
    systemTokens: reducedSystem.systemTokens,
    historyTokens: packedHistory.historyTokens,
    userTokens,
    droppedHistoryMessages: packedHistory.droppedHistoryMessages,
    droppedMemoryEntries: reducedSystem.droppedMemoryEntries,
    droppedRecallEntries: reducedSystem.droppedRecallEntries,
    droppedArtifactFacts: reducedSystem.droppedArtifactFacts,
  };

  const request: AgentLocalChatExecutionTextRequest = {
    prompt,
    messages: packedMessages,
    systemPrompt: reducedSystem.systemPrompt,
    diagnostics: {
      engineId: AI_CHAT_EXECUTION_ENGINE_ID,
      diagnosticsVersion: AI_CHAT_EXECUTION_ENGINE_DIAGNOSTICS_VERSION,
      firstConsumerId: 'agent-local-chat-v1',
      contextWindowSource: modelContext.source,
      budget,
      estimate,
      continuity: {
        snapshotIncluded: reducedSystem.digest.snapshot !== null,
        retainedMemoryEntries: reducedSystem.digest.memory.length,
        retainedRecallEntries: reducedSystem.digest.recall.length,
        retainedArtifactFacts: reducedSystem.digest.artifactFacts.length,
        bioCharLimit: reducedSystem.bioCharLimit,
      },
      transcript: {
        retainedHistoryMessages: packedHistory.retainedHistoryMessages,
        emittedMessages: packedMessages.length,
        trimmedLeadingAssistantMessages: packedHistory.trimmedLeadingAssistantMessages,
      },
      maxOutputTokensRequested: Number.isFinite(Number(input.maxOutputTokensRequested))
        && Number(input.maxOutputTokensRequested) > 0
      ? Math.floor(Number(input.maxOutputTokensRequested))
      : null,
      promptOverflow: estimate.totalInputTokens > budget.promptBudgetTokens,
    },
  };

  if (request.diagnostics.promptOverflow) {
    throw createPromptOverflowError({
      prompt: request.prompt,
      systemPrompt: request.systemPrompt,
      diagnostics: request.diagnostics,
    });
  }

  return request;
}

export function inspectAgentLocalChatPromptDiagnostics(
  diagnostics: AgentLocalChatPromptDiagnostics,
): AgentLocalChatPromptDiagnosticsInspection {
  return {
    engineId: diagnostics.engineId,
    diagnosticsVersion: diagnostics.diagnosticsVersion,
    firstConsumerId: diagnostics.firstConsumerId,
    contextWindowSource: diagnostics.contextWindowSource,
    budget: { ...diagnostics.budget },
    estimate: { ...diagnostics.estimate },
    continuity: { ...diagnostics.continuity },
    transcript: { ...diagnostics.transcript },
    maxOutputTokensRequested: diagnostics.maxOutputTokensRequested,
    promptOverflow: diagnostics.promptOverflow,
  };
}

export function assessAiChatExecutionEngineReuseReadiness(
  input: AiChatExecutionEngineReuseAssessmentInput,
): AiChatExecutionEngineReuseAssessment {
  const reasons: AiChatExecutionEngineReuseAdmissionCode[] = [];

  if (input.modality === 'text-chat') {
    reasons.push('consumer_scope_text_chat');
  } else {
    reasons.push('voice_or_video_scope_not_admitted');
  }

  if (input.consumerOwnsSemantics) {
    reasons.push('consumer_owns_semantics');
  } else {
    reasons.push('shared_authority_change_required');
  }

  if (input.consumerSuppliesContinuityInputs) {
    reasons.push('consumer_supplies_continuity_inputs');
  } else {
    reasons.push('shared_authority_change_required');
  }

  if (input.acceptsStructuredMessages) {
    reasons.push('consumer_accepts_structured_messages');
  } else {
    reasons.push('shared_authority_change_required');
  }

  if (input.requiresSharedAuthorityChange) {
    reasons.push('shared_authority_change_required');
  }
  if (input.requiresBehaviorAuthorityChange) {
    reasons.push('behavior_authority_change_required');
  }
  if (input.requiresMemoryAuthorityChange) {
    reasons.push('memory_authority_change_required');
  }
  if (input.requiresPolicyAuthorityChange) {
    reasons.push('policy_authority_change_required');
  }
  if (input.requiresSettingsAuthorityChange) {
    reasons.push('settings_authority_change_required');
  }

  const admitted = !reasons.some((reason) => reason.endsWith('_required') || reason === 'voice_or_video_scope_not_admitted');
  return {
    engineId: AI_CHAT_EXECUTION_ENGINE_ID,
    status: admitted ? 'ready' : 'preflight_required',
    consumerId: normalizeText(input.consumerId) || 'unknown-consumer',
    admitted,
    reasons,
  };
}

export function buildAgentLocalChatPrompt(
  input: BuildAgentLocalChatExecutionTextRequestInput,
): string {
  return buildAgentLocalChatExecutionTextRequest(input).prompt;
}

export { buildContinuitySummary, estimateAgentLocalChatTokens };

export const __testOnly = {
  countOccurrences,
};
