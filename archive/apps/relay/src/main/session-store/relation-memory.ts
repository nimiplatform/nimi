import type { RelationMemorySlot } from '../chat-pipeline/types.js';
import { trimString } from './normalizers.js';

export function lexicalScore(haystack: string, query: string): number {
  const normalizedHaystack = haystack.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  if (!normalizedHaystack || !normalizedQuery) return 0;
  const tokens = normalizedQuery
    .split(/[\s,.;:!?/\\|()[\]{}"'`]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  if (tokens.length === 0) {
    return normalizedHaystack.includes(normalizedQuery) ? 1 : 0;
  }
  let hits = 0;
  for (const token of tokens) {
    if (normalizedHaystack.includes(token)) hits += 1;
  }
  return hits / tokens.length;
}

const RELATION_MEMORY_RESOLUTION_RE = /已经|好了|完成|提醒了|办好了|安排好了|处理好了|搞定|兑现|实现|做到了|结束了|记住了|resolved|done|finished|handled|reminded/u;

function normalizeMemoryText(value: string): string {
  return trimString(value).replace(/\s+/g, ' ').toLowerCase();
}

function toMemoryBigrams(text: string): Set<string> {
  const normalized = normalizeMemoryText(text).replace(/\s+/g, '');
  const output = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    output.add(normalized.slice(index, index + 2));
  }
  return output;
}

export function relationMemorySimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeMemoryText(left);
  const normalizedRight = normalizeMemoryText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return 1;
  }
  const leftBigrams = toMemoryBigrams(normalizedLeft);
  const rightBigrams = toMemoryBigrams(normalizedRight);
  if (leftBigrams.size === 0 || rightBigrams.size === 0) {
    const leftChars = new Set([...normalizedLeft]);
    const rightChars = new Set([...normalizedRight]);
    let overlap = 0;
    for (const char of leftChars) {
      if (rightChars.has(char)) overlap += 1;
    }
    const union = new Set([...leftChars, ...rightChars]).size;
    return union === 0 ? 0 : overlap / union;
  }
  let overlap = 0;
  for (const gram of leftBigrams) {
    if (rightBigrams.has(gram)) overlap += 1;
  }
  const union = new Set([...leftBigrams, ...rightBigrams]).size;
  return union === 0 ? 0 : overlap / union;
}

function stripTemporalLead(text: string): string {
  return trimString(text)
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

export function relationMemoryMatchThreshold(slotType: RelationMemorySlot['slotType']): number {
  if (slotType === 'promise' || slotType === 'recurringCue') return 0.22;
  if (slotType === 'boundary' || slotType === 'taboo') return 0.28;
  return 0.36;
}

export function relationMemoryCombinedText(slot: Pick<RelationMemorySlot, 'key' | 'value'>): string {
  return trimString(`${slot.key} ${slot.value}`);
}

export function relationMemoryPairScore(
  left: Pick<RelationMemorySlot, 'slotType' | 'key' | 'value'>,
  right: Pick<RelationMemorySlot, 'slotType' | 'key' | 'value'>,
): number {
  if (left.slotType !== right.slotType) return 0;
  const keyScore = relationMemorySimilarity(left.key, right.key);
  const valueScore = relationMemorySimilarity(left.value, right.value);
  const combinedScore = relationMemorySimilarity(
    relationMemoryCombinedText(left),
    relationMemoryCombinedText(right),
  );
  return Math.max(
    combinedScore,
    (keyScore * 0.6) + (valueScore * 0.4),
    lexicalScore(relationMemoryCombinedText(left), relationMemoryCombinedText(right)),
  );
}

export function findBestRelationMemoryMatch(
  existingSlots: RelationMemorySlot[],
  candidate: RelationMemorySlot,
): RelationMemorySlot | null {
  let bestMatch: RelationMemorySlot | null = null;
  let bestScore = 0;
  for (const slot of existingSlots) {
    if (slot.slotType !== candidate.slotType) continue;
    const score = relationMemoryPairScore(slot, candidate);
    const threshold = relationMemoryMatchThreshold(candidate.slotType);
    const focusedMatch = hasFocusedPhraseMatch(relationMemoryCombinedText(slot), relationMemoryCombinedText(candidate));
    if (score < threshold && !focusedMatch) continue;
    const effectiveScore = focusedMatch ? Math.max(score, threshold) : score;
    if (effectiveScore > bestScore) {
      bestScore = effectiveScore;
      bestMatch = slot;
    }
  }
  return bestMatch;
}

export function shouldResolveRelationMemorySlot(slot: RelationMemorySlot, resolutionTexts: string[]): boolean {
  if (slot.slotType !== 'promise' && slot.slotType !== 'recurringCue') {
    return false;
  }
  const slotText = relationMemoryCombinedText(slot);
  return resolutionTexts.some((text) => {
    const normalizedText = trimString(text);
    if (!normalizedText || !RELATION_MEMORY_RESOLUTION_RE.test(normalizedText)) {
      return false;
    }
    return (
      relationMemorySimilarity(slotText, normalizedText) >= relationMemoryMatchThreshold(slot.slotType)
      || hasFocusedPhraseMatch(slotText, normalizedText)
    );
  });
}

export function compareRelationMemoryRetention(left: RelationMemorySlot, right: RelationMemorySlot): number {
  const retentionRank = (slot: RelationMemorySlot): number => {
    if (slot.slotType === 'boundary' || slot.slotType === 'taboo') return 99;
    if (slot.slotType === 'promise') return 4;
    if (slot.slotType === 'preference') return 3;
    if (slot.slotType === 'recurringCue') return 2;
    if (slot.slotType === 'rapport') return 1;
    return 0;
  };
  return (
    retentionRank(left) - retentionRank(right)
    || left.confidence - right.confidence
    || left.updatedAt.localeCompare(right.updatedAt)
  );
}

export function pruneRelationMemorySlots(slots: RelationMemorySlot[], limit: number): {
  kept: RelationMemorySlot[];
  removed: RelationMemorySlot[];
} {
  if (slots.length <= limit) {
    return {
      kept: slots,
      removed: [],
    };
  }
  const ranked = [...slots].sort(compareRelationMemoryRetention);
  const removed: RelationMemorySlot[] = [];
  while (ranked.length > limit) {
    const removableIndex = ranked.findIndex((slot) => slot.slotType !== 'boundary' && slot.slotType !== 'taboo');
    if (removableIndex < 0) break;
    removed.push(...ranked.splice(removableIndex, 1));
  }
  return {
    kept: ranked,
    removed,
  };
}

export function withPreservedOverride(next: RelationMemorySlot, previous?: RelationMemorySlot): RelationMemorySlot {
  if (!previous) return next;
  if (next.userOverride !== 'inherit') return next;
  if (previous.userOverride === 'inherit') return next;
  return {
    ...next,
    userOverride: previous.userOverride,
  };
}
