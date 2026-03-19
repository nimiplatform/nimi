/**
 * Novel Conflict Resolver — Cross-chapter conflict detection and resolution
 *
 * Detects when new extractions contradict previously accumulated rules,
 * applies automatic resolution where safe, and flags ambiguous cases
 * for human review.
 */

import type {
  LocalWorldRuleDraft,
  LocalAgentRuleDraft,
  ConflictEntry,
} from '../types.js';

/**
 * Check if `newStatement` is a superset of `oldStatement` (more detailed).
 * Simple heuristic: new contains all significant words of old + is longer.
 */
function isSuperset(oldStatement: string, newStatement: string): boolean {
  if (newStatement.length <= oldStatement.length) return false;
  const oldWords = new Set(
    oldStatement
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  const newLower = newStatement.toLowerCase();
  let matchCount = 0;
  for (const word of oldWords) {
    if (newLower.includes(word)) matchCount++;
  }
  // 80% of significant words from old are in new → superset
  return oldWords.size > 0 && matchCount / oldWords.size >= 0.8;
}

/**
 * Check if two statements are complementary (non-contradictory).
 * Heuristic: they don't share negation patterns and have distinct content.
 */
function areComplementary(a: string, b: string): boolean {
  const negationPatterns = [
    /\bnot\b/i, /\bno\b/i, /\bnever\b/i, /\bwithout\b/i,
    /不/g, /没有/g, /无/g, /非/g,
  ];

  const aNeg = negationPatterns.some((p) => p.test(a));
  const bNeg = negationPatterns.some((p) => p.test(b));

  // If one has negation and the other doesn't about the same topic,
  // they're contradictory
  if (aNeg !== bNeg) return false;

  return true;
}

export type WorldRuleConflictCheck = {
  existingRule: LocalWorldRuleDraft;
  incomingRule: LocalWorldRuleDraft;
  chapterIndex: number;
};

export type AgentRuleConflictCheck = {
  existingRule: LocalAgentRuleDraft;
  incomingRule: LocalAgentRuleDraft;
  characterName: string;
  chapterIndex: number;
};

/**
 * Detect and resolve a conflict between an existing and incoming world rule.
 * Returns the conflict entry with auto-resolution applied where safe.
 */
export function resolveWorldRuleConflict(
  check: WorldRuleConflictCheck,
): ConflictEntry {
  const { existingRule, incomingRule, chapterIndex } = check;

  const conflict: ConflictEntry = {
    ruleKind: 'WORLD',
    ruleKey: existingRule.ruleKey,
    previousStatement: existingRule.statement,
    newStatement: incomingRule.statement,
    previousHardness: existingRule.hardness,
    newHardness: incomingRule.hardness,
    chapterIndex,
    resolution: 'UNRESOLVED',
  };

  // Auto-resolve: incoming is a superset (more detailed)
  if (isSuperset(existingRule.statement, incomingRule.statement)) {
    conflict.resolution = 'USE_NEW';
    return conflict;
  }

  // Auto-resolve: complementary statements can be merged
  if (areComplementary(existingRule.statement, incomingRule.statement)) {
    conflict.resolution = 'MERGE';
    conflict.mergedStatement = `${existingRule.statement}\n\n${incomingRule.statement}`;
    return conflict;
  }

  // Auto-resolve: existing is SOFT, incoming is FIRM/HARD → adopt incoming
  if (existingRule.hardness === 'SOFT' && (incomingRule.hardness === 'FIRM' || incomingRule.hardness === 'HARD')) {
    conflict.resolution = 'USE_NEW';
    return conflict;
  }

  // Ambiguous → leave UNRESOLVED for human review
  return conflict;
}

/**
 * Detect and resolve a conflict between existing and incoming agent rules.
 */
export function resolveAgentRuleConflict(
  check: AgentRuleConflictCheck,
): ConflictEntry {
  const { existingRule, incomingRule, chapterIndex } = check;

  const conflict: ConflictEntry = {
    ruleKind: 'AGENT',
    ruleKey: `${check.characterName}:${existingRule.ruleKey}`,
    characterName: check.characterName,
    previousStatement: existingRule.statement,
    newStatement: incomingRule.statement,
    previousHardness: existingRule.hardness,
    newHardness: incomingRule.hardness,
    chapterIndex,
    resolution: 'UNRESOLVED',
  };

  // Auto-resolve: superset
  if (isSuperset(existingRule.statement, incomingRule.statement)) {
    conflict.resolution = 'USE_NEW';
    return conflict;
  }

  // Auto-resolve: complementary
  if (areComplementary(existingRule.statement, incomingRule.statement)) {
    conflict.resolution = 'MERGE';
    conflict.mergedStatement = `${existingRule.statement}\n\n${incomingRule.statement}`;
    return conflict;
  }

  // Auto-resolve: hardness escalation
  if (existingRule.hardness === 'SOFT' && (incomingRule.hardness === 'FIRM' || incomingRule.hardness === 'HARD')) {
    conflict.resolution = 'USE_NEW';
    return conflict;
  }

  return conflict;
}

/**
 * Apply a resolved conflict to produce the final rule statement and hardness.
 */
export function applyConflictResolution(
  conflict: ConflictEntry,
  existingRule: LocalWorldRuleDraft | LocalAgentRuleDraft,
  incomingRule: LocalWorldRuleDraft | LocalAgentRuleDraft,
): { statement: string; hardness: typeof existingRule.hardness } {
  switch (conflict.resolution) {
    case 'KEEP_PREVIOUS':
      return { statement: existingRule.statement, hardness: existingRule.hardness };
    case 'USE_NEW':
      return { statement: incomingRule.statement, hardness: incomingRule.hardness };
    case 'MERGE':
      return {
        statement: conflict.mergedStatement ?? `${existingRule.statement}\n\n${incomingRule.statement}`,
        hardness: incomingRule.hardness,
      };
    case 'UNRESOLVED':
    default:
      // Keep existing until resolved
      return { statement: existingRule.statement, hardness: existingRule.hardness };
  }
}
