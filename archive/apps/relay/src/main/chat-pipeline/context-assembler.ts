// Relay context assembler — adapted from local-chat context-assembler.ts.
// All data is passed in via parameters (no mod hook fetching).
// Uses relay types from ./types.js and prompt locale from ../prompt/prompt-locale.js.

import type { PromptLocale } from '../prompt/prompt-locale.js';
import { pt } from '../prompt/prompt-locale.js';
import type {
  DerivedInteractionProfile,
  InteractionRecallDoc,
  InteractionSnapshot,
  LocalChatContextPacket,
  LocalChatContextRecentTurn,
  LocalChatPlatformWarmStartMemory,
  LocalChatReplyPacingPlan,
  LocalChatTarget,
  LocalChatTurn,
  LocalChatTurnMode,
  RelationMemorySlot,
  VoiceConversationMode,
} from './types.js';
import { deriveInteractionProfile } from './interaction-profile.js';
import { asRecord } from '../../shared/json.js';
import { derivePacingPlan } from './context-pacing.js';
export { derivePacingPlan } from './context-pacing.js';

function asString(value: unknown): string {
  return String(value || '').trim();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

// ── Scoring helpers ─────────────────────────────────────────────────

function lexicalScore(haystack: string, query: string): number {
  const normalizedHaystack = haystack.toLowerCase();
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedHaystack || !normalizedQuery) return 0;
  if (
    normalizedHaystack.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedHaystack)
  ) {
    return 1;
  }
  const tokens = query
    .toLowerCase()
    .split(/[\s,.;:!?/\\|()[\]{}"'`]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  if (!tokens.length) {
    return normalizedHaystack.includes(query.toLowerCase()) ? 1 : 0;
  }
  let hits = 0;
  for (const token of tokens) {
    if (normalizedHaystack.includes(token)) hits += 1;
  }
  return hits / tokens.length;
}

function referenceScore(haystack: string, query: string): number {
  const score = lexicalScore(haystack, query);
  return score > 0 ? score : 0;
}

function recencyScore(updatedAt: string): number {
  const updatedMs = new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedMs)) return 0;
  const diffDays = Math.max(0, (Date.now() - updatedMs) / 86400000);
  if (diffDays <= 1) return 0.22;
  if (diffDays <= 7) return 0.14;
  if (diffDays <= 30) return 0.07;
  return 0;
}

function relationSlotTypeBoost(slotType: string, query: string): number {
  const normalized = query.toLowerCase();
  const emotionalQuery =
    /累|难过|委屈|安慰|抱抱|想你|孤单|害怕|烦|关系|暧昧|亲密|边界|promise|comfort|miss you/u.test(
      normalized,
    );
  const relationalQuery =
    /一起|继续|陪|等零点|今晚|约定|记得|我们|还要|下次|回来|再聊|再见面|陪我|陪你/u.test(
      normalized,
    );
  const preferenceQuery =
    /喜欢|偏好|讨厌|不想|想要|习惯|风格|爱吃|不爱|希望|最好|what|which|prefer/u.test(
      normalized,
    );

  if (emotionalQuery) {
    if (slotType === 'rapport') return 0.32;
    if (slotType === 'promise') return 0.24;
    if (slotType === 'taboo') return 0.18;
    if (slotType === 'boundary') return 0.16;
    return 0.04;
  }
  if (relationalQuery) {
    if (slotType === 'rapport') return 0.3;
    if (slotType === 'promise') return 0.24;
    if (slotType === 'recurringCue') return 0.12;
    if (slotType === 'preference') return 0.06;
    return 0.03;
  }
  if (preferenceQuery) {
    if (slotType === 'preference') return 0.3;
    if (slotType === 'recurringCue') return 0.2;
    if (slotType === 'promise') return 0.08;
    return 0.03;
  }
  if (slotType === 'preference' || slotType === 'rapport') return 0.08;
  return 0;
}

// ── Regex patterns ──────────────────────────────────────────────────

const CONTINUATION_RE =
  /继续|还记得|刚才|说好的|上次|之前那个|那件事|remember|continue|we said|earlier|last time/iu;
const PREFERENCE_QUERY_RE =
  /喜欢|偏好|风格|节奏|语气|短句|交流|怎么聊|prefer|style|pace|tone|voice|image/iu;
// ── World summary ───────────────────────────────────────────────────

function summarizeWorldFromTarget(target: LocalChatTarget): string[] {
  // In relay, world data is passed externally; target has minimal world info.
  // Return empty lines — the caller populates world from fetchWorldTruthSummary.
  return [];
}

// ── Identity summary ────────────────────────────────────────────────

function summarizeIdentity(
  target: LocalChatTarget,
  interactionProfile: DerivedInteractionProfile,
  locale: PromptLocale,
): {
  identityLines: string[];
  rulesLines: string[];
  replyStyleLines: string[];
  interactionProfileLines: string[];
} {
  const metadata = asRecord(target.metadata);
  const dna = target.dna;
  const persona = asString(
    metadata.persona ||
      asRecord(metadata.dna).persona ||
      asRecord(asRecord(metadata.dna).personality).summary,
  );
  const systemPromptBase = asString(
    metadata.systemPromptBase || asRecord(metadata.agentProfile).systemPromptBase,
  );

  return {
    identityLines: [
      `Display Name: ${target.displayName}`,
      `Handle: ${target.handle}`,
      target.bio ? `Bio: ${target.bio}` : '',
      persona ? `Persona: ${persona}` : '',
      systemPromptBase ? `System Base: ${systemPromptBase}` : '',
      ...dna.identityLines,
    ].filter(Boolean),
    rulesLines: [...dna.rulesLines].slice(0, 8),
    replyStyleLines: [
      ...dna.replyStyleLines,
      pt(locale, 'assembler.style.distance', {
        distance: interactionProfile.relationship.defaultDistance,
        warmth: interactionProfile.relationship.warmth,
      }),
      pt(locale, 'assembler.style.firstBeat', {
        firstBeatStyle: interactionProfile.expression.firstBeatStyle,
        infoAnswerStyle: interactionProfile.expression.infoAnswerStyle,
      }),
      pt(locale, 'assembler.style.naturalChat'),
    ],
    interactionProfileLines: [
      `expression=${interactionProfile.expression.responseLength}/${interactionProfile.expression.formality}/${interactionProfile.expression.sentiment}/${interactionProfile.expression.pacingBias}`,
      `relationship=${interactionProfile.relationship.defaultDistance}/${interactionProfile.relationship.warmth}/${interactionProfile.relationship.flirtAffinity}`,
      `voice=${interactionProfile.voice.voiceAffinity}/${interactionProfile.voice.genderGuard}/${interactionProfile.voice.language || 'auto'}`,
      `visual=${interactionProfile.visual.imageAffinity}/${interactionProfile.visual.videoAffinity}/${interactionProfile.visual.nsfwLevel || 'safe'}`,
    ],
  };
}

// ── Recent turns ────────────────────────────────────────────────────

function buildRecentTurns(turns: LocalChatTurn[]): LocalChatContextRecentTurn[] {
  const grouped = new Map<string, LocalChatContextRecentTurn>();
  for (const turn of turns) {
    const key = `${turn.turnId}:${turn.turnSeq}`;
    const lineSource = String(turn.semanticSummary || '').trim();
    const contextText = String(turn.contextText || '').trim();
    const line =
      lineSource && lineSource !== contextText
        ? `${contextText} (${lineSource})`
        : contextText;
    const existing = grouped.get(key);
    if (existing) {
      if (line) existing.lines.push(line);
      continue;
    }
    grouped.set(key, {
      id: turn.turnId,
      seq: turn.turnSeq,
      role: turn.role,
      lines: line ? [line] : [],
    });
  }
  return [...grouped.values()].sort((left, right) => left.seq - right.seq);
}

function normalizeComparableTurnText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimEchoedCurrentUserTurn(input: {
  recentTurns: LocalChatContextRecentTurn[];
  userInput: string;
}): LocalChatContextRecentTurn[] {
  const turns = [...input.recentTurns];
  if (!turns.length) return turns;
  const lastTurn = turns[turns.length - 1];
  if (!lastTurn || lastTurn.role !== 'user') return turns;
  const userInput = normalizeComparableTurnText(input.userInput);
  if (!userInput) return turns;
  const lastTurnText = normalizeComparableTurnText(lastTurn.lines.join(' '));
  if (lastTurnText && lastTurnText === userInput) {
    turns.pop();
  }
  return turns;
}

function toFirstBeatRecentTurns(
  turns: LocalChatContextRecentTurn[],
): LocalChatContextRecentTurn[] {
  return turns.slice(-4);
}

function toFirstBeatSnapshot(
  snapshot: LocalChatContextPacket['interactionSnapshot'],
): LocalChatContextPacket['interactionSnapshot'] {
  if (!snapshot) return snapshot;
  return {
    ...snapshot,
    activeScene: snapshot.activeScene.slice(0, 1),
    assistantCommitments: snapshot.assistantCommitments.slice(0, 1),
    userPrefs: snapshot.userPrefs.slice(0, 1),
    openLoops: snapshot.openLoops.slice(0, 1),
    topicThreads: snapshot.topicThreads.slice(0, 2),
  };
}

// ── Continuity / recall selection ───────────────────────────────────

function continuityReferenceBoost(input: {
  text: string;
  snapshot: LocalChatContextPacket['interactionSnapshot'];
  continuationLike: boolean;
}): number {
  if (!input.snapshot) return 0;
  const openLoopScore = Math.max(
    0,
    ...input.snapshot.openLoops.map((value) => referenceScore(input.text, value)),
  );
  const commitmentScore = Math.max(
    0,
    ...input.snapshot.assistantCommitments.map((value) =>
      referenceScore(input.text, value),
    ),
  );
  const topicScore = Math.max(
    0,
    ...input.snapshot.topicThreads.map((value) =>
      referenceScore(input.text, value),
    ),
  );
  const strongBoost = input.continuationLike ? 0.52 : 0.2;
  const topicBoost = input.continuationLike ? 0.18 : 0.08;
  return (
    Math.max(openLoopScore, commitmentScore) * strongBoost +
    topicScore * topicBoost
  );
}

function pushUniqueById<T extends { id: string }>(
  target: T[],
  item: T | null | undefined,
): void {
  if (!item) return;
  if (target.some((entry) => entry.id === item.id)) return;
  target.push(item);
}

function selectSessionRecall(
  docs: LocalChatContextPacket['recallIndex'],
  query: string,
  snapshot: LocalChatContextPacket['interactionSnapshot'],
): LocalChatContextPacket['sessionRecall'] {
  const entries = docs || [];
  if (entries.length === 0) return [];
  const continuationLike = CONTINUATION_RE.test(query);
  const strongReferences = [
    ...(snapshot?.openLoops || []),
    ...(snapshot?.assistantCommitments || []),
  ];
  const mustCarry = continuationLike
    ? [...entries]
        .map((doc, index) => ({
          doc,
          score:
            Math.max(
              ...strongReferences.map((value) => referenceScore(doc.text, value)),
              0,
            ) +
            (snapshot?.lastResolvedTurnId &&
            doc.sourceTurnId === snapshot.lastResolvedTurnId
              ? 0.25
              : 0),
          index,
        }))
        .filter((item) => item.score > 0.12)
        .sort(
          (left, right) =>
            right.score - left.score || right.index - left.index,
        )
        .slice(0, 2)
        .map((item) => item.doc)
    : [];
  const selected: typeof mustCarry = [];
  mustCarry.forEach((doc) => pushUniqueById(selected, doc));
  [...entries]
    .map((doc, index) => ({
      doc,
      score:
        lexicalScore(doc.text, query) * 1.45 +
        continuityReferenceBoost({
          text: doc.text,
          snapshot,
          continuationLike,
        }) +
        (snapshot?.lastResolvedTurnId &&
        doc.sourceTurnId === snapshot.lastResolvedTurnId
          ? 0.28
          : 0) +
        ((entries.length - index) / Math.max(1, entries.length)) * 0.18,
      index,
    }))
    .sort(
      (left, right) => right.score - left.score || right.index - left.index,
    )
    .forEach((item) => {
      if (selected.length >= 6) return;
      pushUniqueById(selected, item.doc);
    });
  return selected.slice(0, 6).map((doc) => ({
    id: doc.id,
    text: doc.text,
    sourceKind: doc.sourceTurnId ? ('turn' as const) : ('recall-index' as const),
    sourceTurnId: doc.sourceTurnId,
  }));
}

function selectRelationMemorySlots(
  slots: LocalChatContextPacket['relationMemorySlots'],
  query: string,
  snapshot: LocalChatContextPacket['interactionSnapshot'],
): LocalChatContextPacket['relationMemorySlots'] {
  const entries = slots || [];
  const continuationLike = CONTINUATION_RE.test(query);
  const preferenceLike = PREFERENCE_QUERY_RE.test(query);
  const mustCarry: RelationMemorySlot[] = [];

  if (continuationLike && snapshot) {
    [...entries]
      .filter(
        (entry) =>
          entry.slotType === 'promise' ||
          entry.slotType === 'rapport' ||
          entry.slotType === 'preference',
      )
      .map((entry) => ({
        entry,
        score: Math.max(
          ...[
            ...snapshot.openLoops,
            ...snapshot.assistantCommitments,
          ].map((value) =>
            referenceScore(`${entry.key} ${entry.value}`, value),
          ),
          0,
        ),
      }))
      .filter((item) => item.score > 0.12)
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.entry.updatedAt.localeCompare(left.entry.updatedAt),
      )
      .slice(0, 2)
      .forEach((item) => pushUniqueById(mustCarry, item.entry));
  }

  if (preferenceLike) {
    [...entries]
      .filter((entry) => entry.slotType === 'preference')
      .map((entry) => ({
        entry,
        score:
          lexicalScore(`${entry.key} ${entry.value}`, query) * 1.4 +
          entry.confidence +
          relationSlotTypeBoost(entry.slotType, query),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.entry.updatedAt.localeCompare(left.entry.updatedAt),
      )
      .slice(0, 1)
      .forEach((item) => pushUniqueById(mustCarry, item.entry));
  }

  const ranked = [...entries]
    .map((entry) => ({
      entry,
      score:
        lexicalScore(`${entry.key} ${entry.value}`, query) * 1.35 +
        entry.confidence +
        recencyScore(entry.updatedAt) +
        relationSlotTypeBoost(entry.slotType, query) +
        continuityReferenceBoost({
          text: `${entry.key} ${entry.value}`,
          snapshot,
          continuationLike,
        }),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.entry.updatedAt.localeCompare(left.entry.updatedAt),
    )
    .map((item) => item.entry);

  const selected: RelationMemorySlot[] = [];
  mustCarry.forEach((entry) => pushUniqueById(selected, entry));
  ranked.forEach((entry) => {
    if (selected.length >= 8) return;
    pushUniqueById(selected, entry);
  });
  return selected.slice(0, 8);
}

// ── Warm start conversion ───────────────────────────────────────────

function toWarmStartMemory(
  result: LocalChatPlatformWarmStartMemory | null,
): LocalChatContextPacket['platformWarmStart'] {
  if (!result) return null;
  if (result.core.length === 0 && result.e2e.length === 0) return null;
  return {
    core: [...result.core],
    e2e: [...result.e2e],
    recallSource: result.recallSource,
    entityId: result.entityId,
  };
}

// ── Input types ─────────────────────────────────────────────────────

export type AssembleFirstBeatContextInput = {
  text: string;
  viewerId: string;
  viewerDisplayName: string;
  selectedTarget: LocalChatTarget;
  selectedSessionId: string;
  allowMultiReply?: boolean;
  turnMode?: LocalChatTurnMode;
  voiceConversationMode?: VoiceConversationMode;
  promptLocale?: PromptLocale;
  // Pre-fetched data
  recentTurns: LocalChatTurn[];
  interactionSnapshot: InteractionSnapshot | null;
  worldLines?: string[];
};

export type AssembleFullTurnContextInput = {
  text: string;
  viewerId: string;
  viewerDisplayName: string;
  selectedTarget: LocalChatTarget;
  selectedSessionId: string;
  allowMultiReply?: boolean;
  turnMode?: LocalChatTurnMode;
  voiceConversationMode?: VoiceConversationMode;
  promptLocale?: PromptLocale;
  // Pre-fetched data
  recentTurns: LocalChatTurn[];
  interactionSnapshot: InteractionSnapshot | null;
  relationMemorySlots: RelationMemorySlot[];
  recallIndex: InteractionRecallDoc[];
  platformWarmStart: LocalChatPlatformWarmStartMemory | null;
  worldLines?: string[];
};

// ── First-beat context (lightweight) ────────────────────────────────

/**
 * Assembles a lightweight context packet for the first-beat (fast response).
 * Uses only recent turns + trimmed snapshot — no memory, no recall, no world fetch.
 */
export function assembleFirstBeatContext(
  input: AssembleFirstBeatContextInput,
): LocalChatContextPacket {
  const promptLocale: PromptLocale = input.promptLocale || 'en';
  const interactionProfile = deriveInteractionProfile(input.selectedTarget);

  const recentTurns = trimEchoedCurrentUserTurn({
    recentTurns: buildRecentTurns(input.recentTurns),
    userInput: input.text,
  });
  const interactionSnapshot = toFirstBeatSnapshot(input.interactionSnapshot);
  const selectedRecentTurns = toFirstBeatRecentTurns(recentTurns);
  const identity = summarizeIdentity(
    input.selectedTarget,
    interactionProfile,
    promptLocale,
  );
  const pacingPlan = derivePacingPlan({
    text: input.text,
    interactionProfile,
    allowMultiReply: Boolean(input.allowMultiReply),
    turnMode: input.turnMode,
  });

  return {
    conversationId: input.selectedSessionId,
    viewer: {
      id: input.viewerId,
      displayName: input.viewerDisplayName,
    },
    target: {
      id: input.selectedTarget.id,
      handle: input.selectedTarget.handle,
      displayName: input.selectedTarget.displayName,
      bio: input.selectedTarget.bio,
      identityLines: identity.identityLines,
      rulesLines: identity.rulesLines,
      replyStyleLines: identity.replyStyleLines,
      interactionProfileLines: identity.interactionProfileLines,
      interactionProfile,
    },
    world: {
      worldId: input.selectedTarget.worldId,
      lines: input.worldLines || [],
    },
    platformWarmStart: null,
    sessionRecall: [],
    recentTurns: selectedRecentTurns,
    interactionSnapshot,
    relationMemorySlots: [],
    recallIndex: [],
    turnMode: input.turnMode,
    voiceConversationMode: input.voiceConversationMode,
    pacingPlan,
    promptLocale,
    userInput: input.text,
    diagnostics: {
      selectedTurnSeqs: selectedRecentTurns.map((turn) => turn.seq),
      sessionRecallCount: 0,
    },
  };
}

// ── Full-turn context (complete) ────────────────────────────────────

/**
 * Assembles a complete context packet for full-turn prompt compilation.
 * Includes memory recall, relation memory, session recall, world context.
 */
export function assembleFullTurnContext(
  input: AssembleFullTurnContextInput,
): LocalChatContextPacket {
  const promptLocale: PromptLocale = input.promptLocale || 'en';
  const interactionProfile = deriveInteractionProfile(input.selectedTarget);

  const recentTurns = trimEchoedCurrentUserTurn({
    recentTurns: buildRecentTurns(input.recentTurns),
    userInput: input.text,
  });
  const interactionSnapshot = input.interactionSnapshot;
  const identity = summarizeIdentity(
    input.selectedTarget,
    interactionProfile,
    promptLocale,
  );

  // Warm start: only when no snapshot and conversation is very new
  const warmStart =
    !interactionSnapshot && recentTurns.length <= 1
      ? input.platformWarmStart
      : null;

  const pacingPlan = derivePacingPlan({
    text: input.text,
    interactionProfile,
    allowMultiReply: Boolean(input.allowMultiReply),
    turnMode: input.turnMode,
  });

  const selectedRelationMemory = selectRelationMemorySlots(
    input.relationMemorySlots,
    input.text,
    interactionSnapshot,
  );
  const selectedSessionRecall = selectSessionRecall(
    input.recallIndex,
    input.text,
    interactionSnapshot,
  );

  return {
    conversationId: input.selectedSessionId,
    viewer: {
      id: input.viewerId,
      displayName: input.viewerDisplayName,
    },
    target: {
      id: input.selectedTarget.id,
      handle: input.selectedTarget.handle,
      displayName: input.selectedTarget.displayName,
      bio: input.selectedTarget.bio,
      identityLines: identity.identityLines,
      rulesLines: identity.rulesLines,
      replyStyleLines: identity.replyStyleLines,
      interactionProfileLines: identity.interactionProfileLines,
      interactionProfile,
    },
    world: {
      worldId: input.selectedTarget.worldId,
      lines: input.worldLines || [],
    },
    platformWarmStart: toWarmStartMemory(warmStart),
    sessionRecall: selectedSessionRecall,
    recentTurns,
    interactionSnapshot,
    relationMemorySlots: selectedRelationMemory,
    recallIndex: input.recallIndex,
    turnMode: input.turnMode,
    voiceConversationMode: input.voiceConversationMode,
    pacingPlan,
    promptLocale,
    userInput: input.text,
    diagnostics: {
      selectedTurnSeqs: recentTurns.map((turn) => turn.seq),
      sessionRecallCount: selectedSessionRecall.length,
    },
  };
}
