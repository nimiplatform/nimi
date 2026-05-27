/**
 * knowledge-scaffolder.ts — SJ-KNOW-002
 * Reads knowledge tracker state and produces the knowledge state block for the prompt.
 * Also provides utilities for post-generation knowledge entry creation.
 */
import type { KnowledgeFlag, LoreEntry } from './types.js';

const MAX_NEW_CONCEPTS = 3; // SJ-KNOW-002:3

export type KnowledgeBlock = {
  alreadyKnown: string[];
  mayExplain: string[];
  newConceptLimit: number;
};

/**
 * buildKnowledgeBlock — compares current knowledge flags with matched lorebook
 * entries to produce the knowledge state block for the prompt builder.
 */
export function buildKnowledgeBlock(
  knowledgeFlags: KnowledgeFlag[],
  matchedLorebooks: LoreEntry[],
): KnowledgeBlock {
  const alreadyKnown = knowledgeFlags
    .filter((f) => f.depth >= 1)
    .map((f) => f.conceptKey);

  const matchedKeys = new Set(matchedLorebooks.map((l) => l.key));
  const mayExplain = knowledgeFlags
    .filter((f) => f.depth === 0 && matchedKeys.has(f.conceptKey))
    .map((f) => f.conceptKey);

  return { alreadyKnown, mayExplain, newConceptLimit: MAX_NEW_CONCEPTS };
}

/**
 * formatKnowledgeBlockForPrompt — renders the knowledge block as a prompt string.
 */
export function formatKnowledgeBlockForPrompt(block: KnowledgeBlock): string {
  const lines: string[] = [];

  if (block.alreadyKnown.length > 0) {
    lines.push(`Student already understands (do NOT re-explain): ${block.alreadyKnown.join(', ')}`);
  }
  if (block.mayExplain.length > 0) {
    lines.push(`May explain naturally if contextually relevant: ${block.mayExplain.join(', ')}`);
  }
  lines.push(`New concept limit this turn: introduce at most ${block.newConceptLimit} new concepts`);

  return lines.join('\n');
}
