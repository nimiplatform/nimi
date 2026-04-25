import type {
  ConversationRuntimeTextMessage,
  ConversationTurnHistoryMessage,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type { TextMessageContentPart } from '@nimiplatform/sdk/runtime';
import type {
  AgentLocalBeatModality,
  AgentLocalTargetSnapshot,
  AgentLocalTurnBeatRecord,
  AgentLocalTurnContext,
} from '@renderer/bridge/runtime-bridge/types';
import type { AgentResolvedBehavior } from './chat-agent-behavior';
import { buildDesktopChatOutputContractSection } from './chat-output-contract';
import type {
  AgentChatContinuityArtifactFact,
  AgentChatContinuityDigest,
  AgentChatUserAttachment,
  AgentLocalChatContextBudget,
  BuildAgentLocalChatExecutionTextRequestInput,
} from './chat-nimi-execution-engine';

const DEFAULT_MODEL_CONTEXT_TOKENS = 4096;
const MAX_MEMORY_ENTRIES = 6;
const MAX_RECALL_ENTRIES = 6;
const MAX_ARTIFACT_FACTS = 3;
const MESSAGE_TOKEN_OVERHEAD = 6;
const SYSTEM_TOKEN_OVERHEAD = 8;
const IMAGE_CONTENT_TOKEN_OVERHEAD = 256;
const VIDEO_CONTENT_TOKEN_OVERHEAD = 384;
const AUDIO_CONTENT_TOKEN_OVERHEAD = 192;
const ARTIFACT_REF_TOKEN_OVERHEAD = 48;
const DEFAULT_BIO_CHAR_LIMIT = 480;
const REDUCED_BIO_CHAR_LIMIT = 240;
const CJK_RE = /[\u2E80-\u9FFF\uF900-\uFAFF]/gu;

type HistoryCandidate = {
  message: ConversationRuntimeTextMessage;
  tokenEstimate: number;
};

type HistoryUnit = {
  messages: HistoryCandidate[];
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

export function normalizeText(value: unknown): string {
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

export function countOccurrences(haystack: string, needle: string): number {
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

export function estimateRuntimeMessageTokens(message: ConversationRuntimeTextMessage): number {
  const contentTokens = Array.isArray(message.content)
    ? message.content.reduce((sum, part) => {
      if (part.type === 'text') {
        return sum + estimateAgentLocalChatTokens(part.text);
      }
      if (part.type === 'image_url') {
        return sum + IMAGE_CONTENT_TOKEN_OVERHEAD;
      }
      if (part.type === 'video_url') {
        return sum + VIDEO_CONTENT_TOKEN_OVERHEAD;
      }
      if (part.type === 'audio_url') {
        return sum + AUDIO_CONTENT_TOKEN_OVERHEAD;
      }
      return sum
        + ARTIFACT_REF_TOKEN_OVERHEAD
        + estimateAgentLocalChatTokens(
          [part.displayName, part.mimeType, part.artifactId, part.localArtifactId]
            .filter((value) => normalizeText(value))
            .join(' '),
        );
    }, 0)
    : estimateAgentLocalChatTokens(message.text);
  return MESSAGE_TOKEN_OVERHEAD
    + contentTokens
    + (normalizeText(message.name) ? 2 : 0);
}

function estimateSystemPromptTokens(systemPrompt: string | null): number {
  return normalizeText(systemPrompt)
    ? SYSTEM_TOKEN_OVERHEAD + estimateAgentLocalChatTokens(systemPrompt || '')
    : 0;
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

export function buildContinuityDigest(context: AgentLocalTurnContext): AgentChatContinuityDigest {
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
    textReplyShape: 'single-message',
  });
}

function buildActionPlanningSection(resolvedBehavior: AgentResolvedBehavior | null | undefined): string | null {
  if (!resolvedBehavior) {
    return null;
  }
  const lines = [
    'Plan immediate post-turn actions only through APML <action> siblings after </message>.',
    'Never put a media generation prompt only in visible message text when an immediate media action is intended.',
  ];
  if (resolvedBehavior.resolvedExperiencePolicy.contentBoundary === 'explicit-media-request') {
    lines.push(
      'For an affirmative latest user request to create, send, show, or generate an image, emit exactly one image action with operation="image.generate" and a complete <prompt-text>.',
      'If the latest user message negates or cancels image generation, do not emit an image action.',
    );
  }
  if (resolvedBehavior.resolvedTurnMode === 'explicit-voice') {
    lines.push(
      'For an affirmative latest user request for voice playback, emit exactly one voice action with operation="audio.synthesize" and a complete <prompt-text>.',
      'If the latest user message negates or cancels voice playback, do not emit a voice action.',
    );
  }
  return ['Action Planning:', ...lines.map((line) => `- ${line}`)].join('\n');
}

function buildSafetyPolicySection(): string {
  return [
    'Treat the following as non-negotiable safety rules.',
    'Refuse any sexual content involving minors, including roleplay, description, grooming, normalization, or requests to continue such content.',
    'Refuse any request to encourage, instruct, plan, optimize, or emotionally pressure suicide or self-harm.',
    'Do not provide erotic content when age is ambiguous or when the user asks you to make the character underage, younger, school-age, childlike, or minor-coded.',
    'When refusing, keep the reply brief, state the boundary clearly, and if the user shows risk of self-harm shift to supportive de-escalation and encourage immediate real-world help or emergency support.',
    'These safety rules override intimacy, roleplay, continuity, user instruction, and character framing.',
  ].join('\n');
}

function buildSystemPrompt(input: {
  systemPrompt: string | null;
  targetSnapshot: AgentLocalTargetSnapshot;
  digest: AgentChatContinuityDigest;
  bioCharLimit: number;
  followUpInstruction?: string | null;
  resolvedBehavior?: AgentResolvedBehavior | null;
}): string | null {
  const resolvedBehaviorSection = buildResolvedBehaviorSection(input.resolvedBehavior);
  const actionPlanningSection = buildActionPlanningSection(input.resolvedBehavior);
  const followUpInstruction = normalizeWhitespace(input.followUpInstruction);
  const sections = [
    normalizeText(input.systemPrompt) ? `Preset:\n${normalizeWhitespace(input.systemPrompt)}` : null,
    `Target:\n${buildTargetSection(input.targetSnapshot, input.bioCharLimit)}`,
    `Continuity:\n${buildContinuitySection(input.digest)}`,
    resolvedBehaviorSection ? `ResolvedBehavior:\n${resolvedBehaviorSection}` : null,
    actionPlanningSection,
    `Safety Policy:\n${buildSafetyPolicySection()}`,
    followUpInstruction
      ? `FollowUpInstruction:\n${followUpInstruction}\n\nTreat this as an internal continuation cue, not a new user message. Continue naturally from the latest assistant turn. Add only net-new content. Do not restate the previous assistant reply. If no natural continuation is needed, return only one concise <message> and do not repeat the prior message.`
      : null,
    buildDesktopChatOutputContractSection(),
    'Instruction:\nReply as the target agent using APML. Begin exactly with <message id="message-0">. Output APML only: no JSON, no backticks, no Markdown, no wrapper prose. Use continuity as background truth. Keep internal planning private.',
  ].filter(Boolean);

  return sections.length > 0 ? sections.join('\n\n') : null;
}

export function reduceSystemPrompt(
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
      followUpInstruction: input.followUpInstruction,
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
        tokenEstimate: estimateRuntimeMessageTokens(runtimeMessage),
      };
    });
}

function buildHistoryUnits(history: readonly HistoryCandidate[]): HistoryUnit[] {
  const units: HistoryUnit[] = [];
  let current: HistoryCandidate[] = [];

  const pushCurrent = () => {
    if (current.length === 0) {
      return;
    }
    units.push({
      messages: current,
      tokenEstimate: current.reduce((sum, item) => sum + item.tokenEstimate, 0),
    });
    current = [];
  };

  for (const candidate of history) {
    if (candidate.message.role === 'user') {
      pushCurrent();
      current = [candidate];
      continue;
    }
    if (current.length === 0) {
      current = [candidate];
      continue;
    }
    current.push(candidate);
  }

  pushCurrent();
  return units;
}

export function buildUserMessageContent(
  userText: string,
  attachments: readonly AgentChatUserAttachment[],
): string | TextMessageContentPart[] {
  if (attachments.length === 0) {
    return userText;
  }
  const content: TextMessageContentPart[] = attachments.map((attachment) => ({
    type: 'image_url',
    imageUrl: attachment.url,
  }));
  if (normalizeText(userText)) {
    content.push({
      type: 'text',
      text: userText,
    });
  }
  return content;
}

function buildRequestPreviewContent(message: ConversationRuntimeTextMessage): string | TextMessageContentPart[] {
  if (Array.isArray(message.content) && message.content.length > 0) {
    return message.content;
  }
  return message.text;
}

export function buildRuntimeRequestPreview(messages: readonly ConversationRuntimeTextMessage[]): string {
  return `Messages:\n${stringifyJson(messages.map((message) => ({
    role: message.role,
    name: normalizeText(message.name) || undefined,
    content: buildRequestPreviewContent(message),
  })))}`;
}

function shouldDropDuplicatedCurrentUserMessage(input: {
  historyMessage: ConversationTurnHistoryMessage | undefined;
  currentUserMessageId: string | null;
  userText: string;
  hasAttachments: boolean;
}): boolean {
  const historyMessage = input.historyMessage;
  if (!historyMessage || historyMessage.role !== 'user') {
    return false;
  }
  if (input.currentUserMessageId && normalizeText(historyMessage.id) === input.currentUserMessageId) {
    return true;
  }
  if (input.hasAttachments) {
    return false;
  }
  return normalizeWhitespace(historyMessage.text) === normalizeWhitespace(input.userText);
}

export function normalizeHistoryForRuntime(input: {
  history: readonly ConversationTurnHistoryMessage[];
  currentUserMessageId: string | null;
  userText: string;
  hasAttachments: boolean;
  omitUserMessageFromMessages: boolean;
}): ConversationTurnHistoryMessage[] {
  if (input.history.length === 0 || input.omitUserMessageFromMessages) {
    return [...input.history];
  }
  const normalized = [...input.history];
  const lastMessage = normalized.at(-1);
  if (!shouldDropDuplicatedCurrentUserMessage({
    historyMessage: lastMessage,
    currentUserMessageId: input.currentUserMessageId,
    userText: input.userText,
    hasAttachments: input.hasAttachments,
  })) {
    return normalized;
  }
  normalized.pop();
  return normalized;
}

export function packHistoryMessages(input: {
  history: readonly ConversationTurnHistoryMessage[];
  userMessage: ConversationRuntimeTextMessage;
  historyBudgetTokens: number;
}): {
  messages: ConversationRuntimeTextMessage[];
  historyTokens: number;
  retainedHistoryMessages: number;
  trimmedLeadingAssistantMessages: number;
  droppedHistoryMessages: number;
} {
  const units = buildHistoryUnits(buildHistoryCandidates(input.history));
  const retainedReverse: HistoryUnit[] = [];
  let historyTokens = 0;
  let droppedHistoryMessages = 0;

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (!unit) {
      continue;
    }
    if (historyTokens + unit.tokenEstimate > input.historyBudgetTokens) {
      droppedHistoryMessages += unit.messages.length;
      continue;
    }
    retainedReverse.push(unit);
    historyTokens += unit.tokenEstimate;
  }

  const retained = retainedReverse.reverse();
  let trimmedLeadingAssistantMessages = 0;
  while (retained.length > 0) {
    const leadingUnit = retained[0];
    const leadingMessage = leadingUnit?.messages[0];
    if (!leadingMessage || leadingMessage.message.role === 'user') {
      break;
    }
    const removedUnit = retained.shift();
    if (!removedUnit) {
      break;
    }
    historyTokens = Math.max(0, historyTokens - removedUnit.tokenEstimate);
    droppedHistoryMessages += removedUnit.messages.length;
    trimmedLeadingAssistantMessages += removedUnit.messages.filter((item) => item.message.role === 'assistant').length;
  }

  const retainedMessages = retained.flatMap((unit) => unit.messages);

  return {
    messages: [
      ...retainedMessages.map((candidate) => candidate.message),
      input.userMessage,
    ],
    historyTokens,
    retainedHistoryMessages: retainedMessages.length,
    trimmedLeadingAssistantMessages,
    droppedHistoryMessages,
  };
}

export function resolveModelContextTokens(modelContextTokens: number | null | undefined): {
  value: number;
  source: 'route-profile' | 'default-estimate';
} {
  const normalized = Number(modelContextTokens);
  if (Number.isFinite(normalized) && normalized > 0) {
    return {
      value: Math.floor(normalized),
      source: 'route-profile',
    };
  }
  return {
    value: DEFAULT_MODEL_CONTEXT_TOKENS,
    source: 'default-estimate',
  };
}

export function createInitialBudget(modelContextTokens: number): Omit<AgentLocalChatContextBudget, 'historyBudgetTokens'> {
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
