import type {
  InteractionBeat,
  InteractionRecallDoc,
  InteractionSnapshot,
  LocalChatMediaArtifactRecord,
  LocalChatSession,
  RelationMemorySlot,
} from './types.js';
import { createUlid } from './ulid.js';

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function dedupeLatest(values: string[], limit: number): string[] {
  return dedupe(values).slice(0, limit);
}

const OPEN_LOOP_RE = /之后|待会|回头|下次|记得|稍后|再来|改天|晚点|别忘|说好了|有空|等你/u;
const USER_PREF_RE = /喜欢|偏好|讨厌|不想|想要|习惯|更喜欢|爱吃|不爱|希望|最好|只想|受不了/u;
const COMMITMENT_RE = /我会|答应你|等我|给你|帮你|我来|我陪你|算我|记着|说定了|我带你|交给我/u;
const RESOLUTION_CUE_RE = /已经|好了|完成|提醒了|办好了|安排好了|处理好了|搞定|兑现|实现|做到了|结束了|记住了|resolved|done|finished|handled|reminded/u;

const RELATIONSHIP_RANK: Record<InteractionSnapshot['relationshipState'], number> = {
  new: 0,
  friendly: 1,
  warm: 2,
  intimate: 3,
};

const EMOTIONAL_RANK: Record<InteractionSnapshot['emotionalTemperature'], number> = {
  low: 0,
  steady: 1,
  warm: 2,
  heated: 3,
};

function createStableSlotId(input: {
  targetId: string;
  viewerId: string;
  slotType: RelationMemorySlot['slotType'];
  key: string;
}): string {
  const seed = `${input.targetId}|${input.viewerId}|${input.slotType}|${normalizeText(input.key).toLowerCase()}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return `slot_${Math.abs(hash).toString(36)}`;
}

export function inferConversationMomentum(
  recentTurns: Array<{ role: string; textLength: number; timestamp?: string }>,
): 'accelerating' | 'steady' | 'cooling' {
  const userTurns = recentTurns.filter((turn) => turn.role === 'user').slice(-5);
  if (userTurns.length < 2) return 'steady';

  const last3 = userTurns.slice(-3);
  const firstTurn = last3[0]!;
  const lastTurn = last3[last3.length - 1]!;

  // Check for cooling: long intervals or shrinking messages
  if (last3.length >= 2) {
    const lengthsDecreasing = last3.every((turn, i) =>
      i === 0 || turn.textLength <= last3[i - 1]!.textLength,
    ) && lastTurn.textLength < firstTurn.textLength;

    if (firstTurn.timestamp && lastTurn.timestamp) {
      const firstMs = new Date(firstTurn.timestamp).getTime();
      const lastMs = new Date(lastTurn.timestamp).getTime();
      const avgInterval = (lastMs - firstMs) / (last3.length - 1);
      if (avgInterval > 5 * 60 * 1000) return 'cooling';
      if (avgInterval < 90 * 1000 && lastTurn.textLength >= firstTurn.textLength && lastTurn.textLength >= 8) {
        return 'accelerating';
      }
    }

    if (lengthsDecreasing) return 'cooling';
    if (lastTurn.textLength <= 4 && firstTurn.textLength >= 10) return 'cooling';
  }

  // Check for accelerating: recent 3 turns have increasing message lengths
  if (last3.length >= 3) {
    const lengthsIncreasing = last3.every((turn, i) =>
      i === 0 || turn.textLength >= last3[i - 1]!.textLength,
    ) && lastTurn.textLength > firstTurn.textLength;
    if (lengthsIncreasing) return 'accelerating';
  }

  return 'steady';
}

function inferRelationshipState(beats: InteractionBeat[]): InteractionSnapshot['relationshipState'] {
  const joined = beats.map((beat) => beat.relationMove).join(' ');
  if (/kiss|hug|closer|暧昧|亲密|依赖|撒娇/u.test(joined)) return 'intimate';
  if (/warm|comfort|陪伴|温柔|抱抱/u.test(joined)) return 'warm';
  if (/friend|轻松|闲聊|日常/u.test(joined)) return 'friendly';
  return 'new';
}

function inferTurnEmotionalTemperature(relationMoves: string[]): InteractionSnapshot['emotionalTemperature'] {
  if (relationMoves.some((move) => /intimate|tease|closer/u.test(move))) {
    return 'heated';
  }
  if (relationMoves.some((move) => /comfort|warm|陪伴|温柔/u.test(move))) {
    return 'warm';
  }
  return 'steady';
}

function mergeRelationshipState(
  previous: InteractionSnapshot['relationshipState'] | undefined,
  current: InteractionSnapshot['relationshipState'],
): InteractionSnapshot['relationshipState'] {
  if (!previous) {
    return current;
  }
  return RELATIONSHIP_RANK[current] >= RELATIONSHIP_RANK[previous]
    ? current
    : previous;
}

function decayEmotionalTemperature(
  value: InteractionSnapshot['emotionalTemperature'] | undefined,
): InteractionSnapshot['emotionalTemperature'] {
  if (value === 'heated') return 'warm';
  if (value === 'warm') return 'steady';
  return value || 'steady';
}

function mergeEmotionalTemperature(input: {
  previous?: InteractionSnapshot['emotionalTemperature'];
  current: InteractionSnapshot['emotionalTemperature'];
}): InteractionSnapshot['emotionalTemperature'] {
  const decayed = decayEmotionalTemperature(input.previous);
  return EMOTIONAL_RANK[input.current] >= EMOTIONAL_RANK[decayed]
    ? input.current
    : decayed;
}

function toBigrams(text: string): Set<string> {
  const normalized = normalizeText(text).replace(/\s+/g, '');
  const output = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    output.add(normalized.slice(index, index + 2));
  }
  return output;
}

function similarityScore(left: string, right: string): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  const normalizedA = a.toLowerCase();
  const normalizedB = b.toLowerCase();
  if (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA)) {
    return 1;
  }
  const bigramsA = toBigrams(normalizedA);
  const bigramsB = toBigrams(normalizedB);
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let overlap = 0;
  for (const gram of bigramsA) {
    if (bigramsB.has(gram)) overlap += 1;
  }
  const union = new Set([...bigramsA, ...bigramsB]).size;
  return union === 0 ? 0 : overlap / union;
}

function stripTemporalLead(text: string): string {
  return normalizeText(text)
    .replace(/^(?:之后|待会|回头|下次|稍后|再来|改天|晚点|别忘|说好了|有空|等你)\s*/u, '')
    .trim();
}

function hasFocusedPhraseMatch(left: string, right: string): boolean {
  const a = stripTemporalLead(left);
  const b = stripTemporalLead(right);
  if (!a || !b) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  for (let length = Math.min(4, shorter.length); length >= 3; length -= 1) {
    for (let index = 0; index <= shorter.length - length; index += 1) {
      const fragment = shorter.slice(index, index + length).trim();
      if (fragment.length >= 3 && longer.includes(fragment)) {
        return true;
      }
    }
  }
  return false;
}

function resolveOutstandingItems(input: {
  previous: string[];
  additions: string[];
  resolutionTexts: string[];
  limit: number;
}): string[] {
  const unresolvedPrevious = input.previous.filter((item) => {
    const normalizedItem = normalizeText(item);
    if (!normalizedItem) return false;
    return !input.resolutionTexts.some((text) => (
      RESOLUTION_CUE_RE.test(text)
      && (
        similarityScore(normalizedItem, text) >= 0.18
        || hasFocusedPhraseMatch(normalizedItem, text)
      )
    ));
  });
  return dedupeLatest([
    ...input.additions,
    ...unresolvedPrevious,
  ], input.limit);
}

export function compileInteractionState(input: {
  conversationId: string;
  targetId: string;
  viewerId: string;
  session: LocalChatSession | null;
  deliveredBeats: InteractionBeat[];
  mediaArtifacts?: LocalChatMediaArtifactRecord[];
  conversationDirective?: string | null;
  previousSnapshot?: InteractionSnapshot | null;
}): {
  snapshot: InteractionSnapshot;
  relationMemorySlots: RelationMemorySlot[];
  recallDocs: InteractionRecallDoc[];
} {
  const deliveredBeats = input.deliveredBeats || [];
  const mediaArtifacts = input.mediaArtifacts || [];
  const previousSnapshot = input.previousSnapshot || null;
  const texts = deliveredBeats.map((beat) => normalizeText(beat.text)).filter(Boolean);
  const mediaTexts = mediaArtifacts
    .map((artifact) => normalizeText(`${artifact.kind} ${artifact.model || ''} ${artifact.renderUri}`))
    .filter(Boolean);
  const sceneMoves = dedupe(deliveredBeats.map((beat) => beat.sceneMove));
  const relationMoves = dedupe(deliveredBeats.map((beat) => beat.relationMove));
  const lastTurnId = deliveredBeats[deliveredBeats.length - 1]?.turnId || null;
  const sessionTurns = input.session?.turns || [];
  const recentTurns = sessionTurns.slice(-16);
  const historyTexts = recentTurns
    .map((turn) => normalizeText(turn.contextText || turn.content))
    .filter(Boolean);
  const recentUserTexts = recentTurns
    .filter((turn) => turn.role === 'user')
    .reverse()
    .map((turn) => normalizeText(turn.contextText || turn.content))
    .filter(Boolean);
  const recentAllTexts = [...historyTexts].reverse();
  const freshOpenLoops = dedupeLatest([
    ...texts.filter((text) => OPEN_LOOP_RE.test(text)),
    ...recentAllTexts.filter((text) => OPEN_LOOP_RE.test(text)),
  ], 8);
  const freshUserPrefs = dedupeLatest(recentUserTexts.filter((text) => USER_PREF_RE.test(text)), 8);
  const freshCommitments = dedupeLatest(texts.filter((text) => COMMITMENT_RE.test(text)), 8);
  const resolutionTexts = dedupeLatest([
    ...texts,
    ...recentAllTexts.slice(0, 6),
    ...mediaTexts,
  ], 12);
  const openLoops = resolveOutstandingItems({
    previous: previousSnapshot?.openLoops || [],
    additions: freshOpenLoops,
    resolutionTexts,
    limit: 8,
  });
  const userPrefs = dedupeLatest([
    ...freshUserPrefs,
    ...(previousSnapshot?.userPrefs || []),
  ], 8);
  const commitments = resolveOutstandingItems({
    previous: previousSnapshot?.assistantCommitments || [],
    additions: freshCommitments,
    resolutionTexts,
    limit: 8,
  });
  const emotionalTemperature = mergeEmotionalTemperature({
    previous: previousSnapshot?.emotionalTemperature,
    current: inferTurnEmotionalTemperature(relationMoves),
  });

  // Derive conversation momentum from recent session turns
  const turnMomentumInput = sessionTurns.slice(-10).map((turn) => ({
    role: turn.role,
    textLength: (turn.content || '').length,
    timestamp: turn.timestamp,
  }));
  const conversationMomentum = inferConversationMomentum(turnMomentumInput);

  const snapshot: InteractionSnapshot = {
    conversationId: input.conversationId,
    relationshipState: mergeRelationshipState(
      previousSnapshot?.relationshipState,
      inferRelationshipState(deliveredBeats),
    ),
    activeScene: dedupeLatest([
      ...sceneMoves,
      ...mediaArtifacts.map((artifact) => artifact.kind),
      ...(previousSnapshot?.activeScene || []),
    ], 8),
    emotionalTemperature,
    assistantCommitments: commitments,
    userPrefs,
    openLoops,
    topicThreads: dedupeLatest([
      ...texts,
      ...mediaTexts,
      ...recentAllTexts,
      ...(previousSnapshot?.topicThreads || []),
    ], 8),
    lastResolvedTurnId: lastTurnId,
    conversationDirective: input.conversationDirective ?? null,
    conversationMomentum,
    updatedAt: new Date().toISOString(),
  };

  const relationMemorySlots: RelationMemorySlot[] = [
    ...userPrefs.map((value) => ({
      id: createStableSlotId({
        targetId: input.targetId,
        viewerId: input.viewerId,
        slotType: 'preference',
        key: value.slice(0, 48),
      }),
      targetId: input.targetId,
      viewerId: input.viewerId,
      slotType: 'preference' as const,
      key: value.slice(0, 48),
      value,
      confidence: 0.72,
      portability: 'portable' as const,
      sensitivity: 'safe' as const,
      userOverride: 'inherit' as const,
      updatedAt: snapshot.updatedAt,
    })),
    ...openLoops.map((value) => ({
      id: createStableSlotId({
        targetId: input.targetId,
        viewerId: input.viewerId,
        slotType: 'promise',
        key: value.slice(0, 48),
      }),
      targetId: input.targetId,
      viewerId: input.viewerId,
      slotType: 'promise' as const,
      key: value.slice(0, 48),
      value,
      confidence: 0.66,
      portability: 'local-only' as const,
      sensitivity: 'personal' as const,
      userOverride: 'inherit' as const,
      updatedAt: snapshot.updatedAt,
    })),
    ...relationMoves.map((value) => ({
      id: createStableSlotId({
        targetId: input.targetId,
        viewerId: input.viewerId,
        slotType: 'rapport',
        key: value.slice(0, 48),
      }),
      targetId: input.targetId,
      viewerId: input.viewerId,
      slotType: 'rapport' as const,
      key: value.slice(0, 48),
      value,
      confidence: 0.58,
      portability: 'local-only' as const,
      sensitivity: 'personal' as const,
      userOverride: 'inherit' as const,
      updatedAt: snapshot.updatedAt,
    })),
  ].slice(0, 12);

  const recallDocs: InteractionRecallDoc[] = dedupe([...historyTexts, ...texts, ...mediaTexts])
    .slice(-12)
    .map((value, index) => ({
      id: `recall_${createUlid()}`,
      conversationId: input.conversationId,
      sourceTurnId: index === dedupe([...historyTexts, ...texts]).slice(-12).length - 1 ? lastTurnId : null,
      text: value,
      createdAt: snapshot.updatedAt,
      updatedAt: snapshot.updatedAt,
    }));

  return {
    snapshot,
    relationMemorySlots,
    recallDocs,
  };
}
