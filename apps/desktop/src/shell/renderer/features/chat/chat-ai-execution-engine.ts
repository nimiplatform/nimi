import type {
  ConversationRuntimeTextMessage,
  ConversationTurnHistoryMessage,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type {
  AgentLocalBeatModality,
  AgentLocalTargetSnapshot,
  AgentLocalTurnBeatRecord,
  AgentLocalTurnContext,
} from '@renderer/bridge/runtime-bridge/types';
import type { AgentResolvedBehavior } from './chat-agent-behavior';
import { buildDesktopChatOutputContractSection } from './chat-output-contract';

const DEFAULT_MODEL_CONTEXT_TOKENS = 4096;
const MAX_MEMORY_ENTRIES = 6;
const MAX_RECALL_ENTRIES = 6;
const MAX_ARTIFACT_FACTS = 3;
const MESSAGE_TOKEN_OVERHEAD = 6;
const SYSTEM_TOKEN_OVERHEAD = 8;
const DEFAULT_BIO_CHAR_LIMIT = 480;
const REDUCED_BIO_CHAR_LIMIT = 240;
const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF]/gu;
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
  contextWindowSource: 'explicit' | 'default';
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
  prompt: string;
  messages: readonly ConversationRuntimeTextMessage[];
  systemPrompt: string | null;
  diagnostics: AgentLocalChatPromptDiagnostics;
};

export type BuildAgentLocalChatExecutionTextRequestInput = {
  systemPrompt: string | null;
  targetSnapshot: AgentLocalTargetSnapshot;
  history: readonly ConversationTurnHistoryMessage[];
  userText: string;
  context: AgentLocalTurnContext;
  resolvedBehavior?: AgentResolvedBehavior | null;
  modelContextTokens?: number | null;
};

type HistoryCandidate = {
  message: ConversationRuntimeTextMessage;
  transcriptLine: string;
  tokenEstimate: number;
};

type ContinuityReductionPlan = {
  memoryCount: number;
  recallCount: number;
  artifactCount: number;
  bioCharLimit: number;
};

type ReducedSystemResult = {
  systemPrompt: string | null;
  systemTokens: number;
  digest: AgentChatContinuityDigest;
  bioCharLimit: number;
  droppedMemoryEntries: number;
  droppedRecallEntries: number;
  droppedArtifactFacts: number;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeWhitespace(value: unknown): string {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  return haystack.split(needle).length - 1;
}

function clipText(value: string | null | undefined, limit: number): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

export function estimateAgentLocalChatTokens(text: string): number {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return 0;
  }
  const cjkCount = (normalized.match(CJK_RE) || []).length;
  const otherCount = normalized.length - cjkCount;
  const base = otherCount / 3.5 + cjkCount / 1.8;
  return Math.ceil(base * 1.1);
}

function estimateRuntimeMessageTokens(message: ConversationRuntimeTextMessage): number {
  return MESSAGE_TOKEN_OVERHEAD
    + estimateAgentLocalChatTokens(message.text)
    + (normalizeText(message.name) ? 2 : 0);
}

function estimateSystemPromptTokens(systemPrompt: string | null): number {
  return normalizeText(systemPrompt)
    ? SYSTEM_TOKEN_OVERHEAD + estimateAgentLocalChatTokens(systemPrompt || '')
    : 0;
}

function formatHistoryLine(message: ConversationTurnHistoryMessage | ConversationRuntimeTextMessage): string {
  const speaker = message.role === 'assistant'
    ? 'Assistant'
    : message.role === 'user'
      ? 'User'
      : message.role === 'system'
        ? 'Preset'
        : 'Tool';
  return `${speaker}: ${message.text}`;
}

function normalizeSummaryKey(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function dedupeSummaries(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (!normalized) {
      continue;
    }
    const key = normalizeSummaryKey(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

function buildArtifactFact(beat: AgentLocalTurnBeatRecord): AgentChatContinuityArtifactFact {
  const noteParts = [
    normalizeText(beat.mimeType) ? `mime=${beat.mimeType}` : null,
    normalizeText(beat.artifactId) ? `artifact=${beat.artifactId}` : null,
    normalizeText(beat.projectionMessageId) ? `projection=${beat.projectionMessageId}` : null,
  ].filter(Boolean);

  return {
    modality: beat.modality as Exclude<AgentLocalBeatModality, 'text'>,
    status: beat.status,
    ...(noteParts.length > 0 ? { note: noteParts.join(', ') } : {}),
  };
}

function buildContinuityDigest(context: AgentLocalTurnContext): AgentChatContinuityDigest {
  const memory = dedupeSummaries(
    [...context.relationMemorySlots]
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return right.updatedAtMs - left.updatedAtMs;
      })
      .map((slot) => slot.summary),
  );

  const recall = dedupeSummaries(
    [...context.recallEntries]
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
      .map((entry) => entry.summary),
  );

  const artifactFacts = [...context.recentBeats]
    .filter((beat) => beat.modality !== 'text')
    .sort((left, right) => {
      const leftTime = left.deliveredAtMs ?? left.createdAtMs;
      const rightTime = right.deliveredAtMs ?? right.createdAtMs;
      return rightTime - leftTime;
    })
    .slice(0, MAX_ARTIFACT_FACTS)
    .map((beat) => buildArtifactFact(beat));

  return {
    snapshot: context.interactionSnapshot
      ? {
        relationshipState: normalizeText(context.interactionSnapshot.relationshipState),
        emotionalTemperature: context.interactionSnapshot.emotionalTemperature,
        commitments: context.interactionSnapshot.assistantCommitmentsJson,
        userPrefs: context.interactionSnapshot.userPrefsJson,
        openLoops: context.interactionSnapshot.openLoopsJson,
      }
      : null,
    memory,
    recall,
    artifactFacts,
  };
}

function buildTargetSection(targetSnapshot: AgentLocalTargetSnapshot, bioCharLimit: number): string {
  const targetRecord = {
    agentId: normalizeText(targetSnapshot.agentId) || undefined,
    displayName: normalizeText(targetSnapshot.displayName) || undefined,
    handle: normalizeText(targetSnapshot.handle) || undefined,
    worldId: normalizeText(targetSnapshot.worldId) || undefined,
    worldName: normalizeText(targetSnapshot.worldName) || undefined,
    ownershipType: normalizeText(targetSnapshot.ownershipType) || undefined,
    bio: clipText(targetSnapshot.bio, bioCharLimit) || undefined,
  };
  return stringifyJson(targetRecord);
}

function buildContinuitySection(digest: AgentChatContinuityDigest): string {
  return stringifyJson({
    snapshot: digest.snapshot,
    memory: digest.memory,
    recall: digest.recall,
    artifactFacts: digest.artifactFacts,
  });
}

function buildResolvedBehaviorSection(resolvedBehavior: AgentResolvedBehavior | null | undefined): string | null {
  if (!resolvedBehavior) {
    return null;
  }
  return stringifyJson({
    resolvedTurnMode: resolvedBehavior.resolvedTurnMode,
    resolvedExperiencePolicy: resolvedBehavior.resolvedExperiencePolicy,
    resolvedBeatPlan: resolvedBehavior.resolvedBeatPlan,
  });
}

function buildSystemPrompt(input: {
  systemPrompt: string | null;
  targetSnapshot: AgentLocalTargetSnapshot;
  digest: AgentChatContinuityDigest;
  bioCharLimit: number;
  resolvedBehavior?: AgentResolvedBehavior | null;
}): string | null {
  const resolvedBehaviorSection = buildResolvedBehaviorSection(input.resolvedBehavior);
  const sections = [
    normalizeText(input.systemPrompt) ? `Preset:\n${normalizeWhitespace(input.systemPrompt)}` : null,
    `Target:\n${buildTargetSection(input.targetSnapshot, input.bioCharLimit)}`,
    `Continuity:\n${buildContinuitySection(input.digest)}`,
    resolvedBehaviorSection ? `ResolvedBehavior:\n${resolvedBehaviorSection}` : null,
    buildDesktopChatOutputContractSection(),
    'Instruction:\nReply as the target agent through the beat-action envelope. Use continuity as background truth. Keep internal planning private.',
  ].filter(Boolean);

  return sections.length > 0 ? sections.join('\n\n') : null;
}

function reduceSystemPrompt(
  input: BuildAgentLocalChatExecutionTextRequestInput,
  fullDigest: AgentChatContinuityDigest,
  targetSystemBudgetTokens: number,
): ReducedSystemResult {
  const fullMemory = fullDigest.memory.slice(0, MAX_MEMORY_ENTRIES);
  const fullRecall = fullDigest.recall.slice(0, MAX_RECALL_ENTRIES);
  const fullArtifactFacts = fullDigest.artifactFacts.slice(0, MAX_ARTIFACT_FACTS);
  let plan: ContinuityReductionPlan = {
    memoryCount: fullMemory.length,
    recallCount: fullRecall.length,
    artifactCount: fullArtifactFacts.length,
    bioCharLimit: DEFAULT_BIO_CHAR_LIMIT,
  };

  while (true) {
    const digest: AgentChatContinuityDigest = {
      snapshot: fullDigest.snapshot,
      memory: fullMemory.slice(0, plan.memoryCount),
      recall: fullRecall.slice(0, plan.recallCount),
      artifactFacts: fullArtifactFacts.slice(0, plan.artifactCount),
    };
    const systemPrompt = buildSystemPrompt({
      systemPrompt: input.systemPrompt,
      targetSnapshot: input.targetSnapshot,
      digest,
      bioCharLimit: plan.bioCharLimit,
      resolvedBehavior: input.resolvedBehavior,
    });
    const systemTokens = estimateSystemPromptTokens(systemPrompt);

    const canReduceMore = plan.recallCount > 0
      || plan.memoryCount > 0
      || plan.artifactCount > 0
      || plan.bioCharLimit > 0;
    if (systemTokens <= targetSystemBudgetTokens || !canReduceMore) {
      return {
        systemPrompt,
        systemTokens,
        digest,
        bioCharLimit: plan.bioCharLimit,
        droppedMemoryEntries: Math.max(0, fullMemory.length - digest.memory.length),
        droppedRecallEntries: Math.max(0, fullRecall.length - digest.recall.length),
        droppedArtifactFacts: Math.max(0, fullArtifactFacts.length - digest.artifactFacts.length),
      };
    }

    if (plan.recallCount > 0) {
      plan = { ...plan, recallCount: plan.recallCount - 1 };
      continue;
    }
    if (plan.memoryCount > 0) {
      plan = { ...plan, memoryCount: plan.memoryCount - 1 };
      continue;
    }
    if (plan.artifactCount > 0) {
      plan = { ...plan, artifactCount: plan.artifactCount - 1 };
      continue;
    }
    plan = {
      ...plan,
      bioCharLimit: plan.bioCharLimit > REDUCED_BIO_CHAR_LIMIT ? REDUCED_BIO_CHAR_LIMIT : 0,
    };
  }
}

export function buildContinuitySummary(context: AgentLocalTurnContext): string {
  return buildContinuitySection(buildContinuityDigest(context));
}

function buildHistoryCandidates(history: readonly ConversationTurnHistoryMessage[]): HistoryCandidate[] {
  return history
    .filter((message) => message.role !== 'system' && normalizeText(message.text))
    .map((message) => {
      const runtimeMessage: ConversationRuntimeTextMessage = {
        role: message.role,
        text: message.text,
        name: normalizeText(message.name) || null,
      };
      return {
        message: runtimeMessage,
        transcriptLine: formatHistoryLine(message),
        tokenEstimate: estimateRuntimeMessageTokens(runtimeMessage),
      };
    });
}

function packHistoryMessages(input: {
  history: readonly ConversationTurnHistoryMessage[];
  userText: string;
  historyBudgetTokens: number;
}): {
  messages: ConversationRuntimeTextMessage[];
  transcriptLines: string[];
  historyTokens: number;
  retainedHistoryMessages: number;
  trimmedLeadingAssistantMessages: number;
  droppedHistoryMessages: number;
} {
  const candidates = buildHistoryCandidates(input.history);
  const retainedReverse: HistoryCandidate[] = [];
  let historyTokens = 0;
  let droppedHistoryMessages = 0;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (!candidate) {
      continue;
    }
    if (historyTokens + candidate.tokenEstimate > input.historyBudgetTokens) {
      droppedHistoryMessages += 1;
      continue;
    }
    retainedReverse.push(candidate);
    historyTokens += candidate.tokenEstimate;
  }

  const retained = retainedReverse.reverse();
  let trimmedLeadingAssistantMessages = 0;
  while (retained.length > 0) {
    const leadingMessage = retained[0];
    if (!leadingMessage || leadingMessage.message.role !== 'assistant') {
      break;
    }
    const removed = retained.shift();
    if (!removed) {
      break;
    }
    historyTokens = Math.max(0, historyTokens - removed.tokenEstimate);
    droppedHistoryMessages += 1;
    trimmedLeadingAssistantMessages += 1;
  }

  return {
    messages: [
      ...retained.map((candidate) => candidate.message),
      {
        role: 'user',
        text: input.userText,
      },
    ],
    transcriptLines: retained.map((candidate) => candidate.transcriptLine),
    historyTokens,
    retainedHistoryMessages: retained.length,
    trimmedLeadingAssistantMessages,
    droppedHistoryMessages,
  };
}

function resolveModelContextTokens(modelContextTokens: number | null | undefined): {
  value: number;
  source: 'explicit' | 'default';
} {
  const normalized = Number(modelContextTokens);
  if (Number.isFinite(normalized) && normalized > 0) {
    return {
      value: Math.floor(normalized),
      source: 'explicit',
    };
  }
  return {
    value: DEFAULT_MODEL_CONTEXT_TOKENS,
    source: 'default',
  };
}

function createInitialBudget(modelContextTokens: number): Omit<AgentLocalChatContextBudget, 'historyBudgetTokens'> {
  const outputReserveTokens = clamp(Math.round(modelContextTokens * 0.2), 256, 2048);
  const paddingTokens = clamp(Math.round(modelContextTokens * 0.05), 64, 512);
  const promptBudgetTokens = Math.max(0, modelContextTokens - outputReserveTokens - paddingTokens);
  const systemBudgetTokens = Math.min(
    1536,
    promptBudgetTokens <= 512
      ? promptBudgetTokens
      : Math.max(512, Math.round(promptBudgetTokens * 0.3)),
  );

  return {
    modelContextTokens,
    outputReserveTokens,
    paddingTokens,
    promptBudgetTokens,
    systemBudgetTokens,
  };
}

export function buildAgentLocalChatExecutionTextRequest(
  input: BuildAgentLocalChatExecutionTextRequestInput,
): AgentLocalChatExecutionTextRequest {
  const modelContext = resolveModelContextTokens(input.modelContextTokens);
  const initialBudget = createInitialBudget(modelContext.value);
  const userMessage: ConversationRuntimeTextMessage = {
    role: 'user',
    text: input.userText,
  };
  const userTokens = estimateRuntimeMessageTokens(userMessage);
  const fullDigest = buildContinuityDigest(input.context);
  const reducedSystem = reduceSystemPrompt(input, fullDigest, initialBudget.systemBudgetTokens);
  const historyBudgetTokens = Math.max(
    0,
    initialBudget.promptBudgetTokens - reducedSystem.systemTokens - userTokens,
  );
  const packedHistory = packHistoryMessages({
    history: input.history,
    userText: input.userText,
    historyBudgetTokens,
  });
  const promptSections = [
    reducedSystem.systemPrompt,
    packedHistory.transcriptLines.length > 0
      ? `Transcript:\n${packedHistory.transcriptLines.join('\n')}`
      : null,
    `UserMessage:\nUser: ${input.userText}`,
  ].filter(Boolean);
  const prompt = promptSections.join('\n\n');
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

  return {
    prompt,
    messages: packedHistory.messages,
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
        emittedMessages: packedHistory.messages.length,
        trimmedLeadingAssistantMessages: packedHistory.trimmedLeadingAssistantMessages,
      },
      promptOverflow: estimate.totalInputTokens > budget.promptBudgetTokens,
    },
  };
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

export const __testOnly = {
  countOccurrences,
};
