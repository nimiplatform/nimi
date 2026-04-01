/**
 * explanation-detector.ts — SJ-KNOW-003
 * Conservative post-process detection of concept explanations in AI output.
 * False negatives acceptable; false positives are not (SJ-KNOW-003:5).
 */
import type { LoreEntry, KnowledgeFlag } from './types.js';

// Chinese explanation indicators per SJ-KNOW-003:3
const EXPLANATION_INDICATORS = [
  '你知道', '所谓', '说白了', '简单说', '其实就是', '换句话说',
  '是指', '意思是', '讲的是', '就是说', '你明白', '什么叫',
  '我来给你说说', '这便是', '这就是', '你可知道',
];

const SUBSTANTIVE_WINDOW = 200; // chars around the keyword to check for indicators

export type DetectedExplanation = {
  conceptKey: string;
  newDepth: 1;
};

/**
 * detectExplanations — scans AI output for concepts at depth 0 that were
 * substantively explained this turn. Returns upgrade instructions.
 */
export function detectExplanations(
  assistantText: string,
  lorebooks: LoreEntry[],
  knowledgeFlags: KnowledgeFlag[],
): DetectedExplanation[] {
  const depth0Keys = new Set(
    knowledgeFlags.filter((f) => f.depth === 0).map((f) => f.conceptKey),
  );
  if (depth0Keys.size === 0) return [];

  const textLower = assistantText.toLowerCase();
  const detected: DetectedExplanation[] = [];

  for (const entry of lorebooks) {
    if (!depth0Keys.has(entry.key)) continue;

    const keyLower = entry.key.toLowerCase();
    const keyIndex = textLower.indexOf(keyLower);
    if (keyIndex === -1) continue;

    // Look for explanation indicators in a window around the keyword
    const windowStart = Math.max(0, keyIndex - SUBSTANTIVE_WINDOW);
    const windowEnd = Math.min(textLower.length, keyIndex + SUBSTANTIVE_WINDOW);
    const window = textLower.slice(windowStart, windowEnd);

    const hasIndicator = EXPLANATION_INDICATORS.some((ind) => window.includes(ind));

    // Also count occurrences: 3+ mentions suggests substantive discussion
    const keyOccurrences = (textLower.match(new RegExp(keyLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;

    if (hasIndicator || keyOccurrences >= 3) {
      detected.push({ conceptKey: entry.key, newDepth: 1 });
    }
  }

  return detected;
}
