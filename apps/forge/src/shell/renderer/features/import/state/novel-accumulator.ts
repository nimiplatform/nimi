/**
 * Novel Accumulator — Progressive rule accumulation across chapters
 *
 * Maintains a Map-keyed collection of world rules and agent rules,
 * merging new chapter extractions with conflict detection.
 */

import type {
  NovelAccumulatorState,
  ChapterExtractionArtifact,
  LocalWorldRuleDraft,
  LocalAgentRuleDraft,
  ConflictEntry,
  DiscoveredCharacter,
  RuleLineageEntry,
} from '../types.js';
import {
  resolveWorldRuleConflict,
  resolveAgentRuleConflict,
  applyConflictResolution,
} from '../engines/novel-conflict-resolver.js';

export function createAccumulator(sourceFile: string, totalChapters: number): NovelAccumulatorState {
  return {
    sourceFile,
    totalChapters,
    processedChapters: 0,
    worldRules: {},
    agentRulesByCharacter: {},
    worldRuleLineage: {},
    agentRuleLineageByCharacter: {},
    characters: {},
    conflicts: [],
    chapterArtifacts: [],
  };
}

function appendWorldLineage(
  next: NovelAccumulatorState,
  ruleKey: string,
  entry: RuleLineageEntry,
) {
  next.worldRuleLineage[ruleKey] = [
    ...(next.worldRuleLineage[ruleKey] ?? []),
    entry,
  ];
}

function appendAgentLineage(
  next: NovelAccumulatorState,
  characterName: string,
  ruleKey: string,
  entry: RuleLineageEntry,
) {
  if (!next.agentRuleLineageByCharacter[characterName]) {
    next.agentRuleLineageByCharacter[characterName] = {};
  }
  next.agentRuleLineageByCharacter[characterName][ruleKey] = [
    ...(next.agentRuleLineageByCharacter[characterName][ruleKey] ?? []),
    entry,
  ];
}

/**
 * Merge a chapter extraction artifact into the accumulator.
 * Returns the updated accumulator (new object, immutable pattern).
 */
export function mergeChapterIntoAccumulator(
  prev: NovelAccumulatorState,
  artifact: ChapterExtractionArtifact,
): NovelAccumulatorState {
  const next: NovelAccumulatorState = {
    ...prev,
    processedChapters: prev.processedChapters + 1,
    worldRules: { ...prev.worldRules },
    agentRulesByCharacter: { ...prev.agentRulesByCharacter },
    worldRuleLineage: Object.fromEntries(
      Object.entries(prev.worldRuleLineage).map(([ruleKey, entries]) => [ruleKey, [...entries]]),
    ),
    agentRuleLineageByCharacter: Object.fromEntries(
      Object.entries(prev.agentRuleLineageByCharacter).map(([characterName, lineages]) => [
        characterName,
        Object.fromEntries(
          Object.entries(lineages).map(([ruleKey, entries]) => [ruleKey, [...entries]]),
        ),
      ]),
    ),
    characters: { ...prev.characters },
    conflicts: [...prev.conflicts],
    chapterArtifacts: [...prev.chapterArtifacts, artifact],
  };

  if (artifact.status !== 'COMPLETED') return next;

  // Merge world rules
  for (const incomingRule of artifact.worldRules) {
    const existing = next.worldRules[incomingRule.ruleKey];
    if (existing) {
      // Conflict: same ruleKey already exists
      const conflict = resolveWorldRuleConflict({
        existingRule: existing,
        incomingRule,
        chapterIndex: artifact.chapterIndex,
      });
      next.conflicts.push(conflict);
      appendWorldLineage(next, incomingRule.ruleKey, {
        ruleKind: 'WORLD',
        ruleKey: incomingRule.ruleKey,
        chapterIndex: artifact.chapterIndex,
        chapterTitle: artifact.chapterTitle,
        action: 'CONFLICT_RECORDED',
        resolution: conflict.resolution,
        statement: incomingRule.statement,
        sourceRef: incomingRule.sourceRef || `novel:chapter_${artifact.chapterIndex}`,
      });

      const resolved = applyConflictResolution(conflict, existing, incomingRule);
      next.worldRules[incomingRule.ruleKey] = {
        ...incomingRule,
        statement: resolved.statement,
        hardness: resolved.hardness,
      };
      appendWorldLineage(next, incomingRule.ruleKey, {
        ruleKind: 'WORLD',
        ruleKey: incomingRule.ruleKey,
        chapterIndex: artifact.chapterIndex,
        chapterTitle: artifact.chapterTitle,
        action: 'AUTO_RESOLVED',
        resolution: conflict.resolution,
        statement: resolved.statement,
        sourceRef: incomingRule.sourceRef || `novel:chapter_${artifact.chapterIndex}`,
      });
    } else {
      // New rule — add directly
      next.worldRules[incomingRule.ruleKey] = incomingRule;
      appendWorldLineage(next, incomingRule.ruleKey, {
        ruleKind: 'WORLD',
        ruleKey: incomingRule.ruleKey,
        chapterIndex: artifact.chapterIndex,
        chapterTitle: artifact.chapterTitle,
        action: 'ADDED',
        resolution: 'USE_NEW',
        statement: incomingRule.statement,
        sourceRef: incomingRule.sourceRef || `novel:chapter_${artifact.chapterIndex}`,
      });
    }
  }

  // Merge agent rules
  for (const bundle of artifact.agentRules) {
    const charName = bundle.characterName;
    if (!next.agentRulesByCharacter[charName]) {
      next.agentRulesByCharacter[charName] = {};
    }
    const charRules = { ...next.agentRulesByCharacter[charName] };

    for (const incomingRule of bundle.rules) {
      const existing = charRules[incomingRule.ruleKey];
      if (existing) {
        const conflict = resolveAgentRuleConflict({
          existingRule: existing,
          incomingRule,
          characterName: charName,
          chapterIndex: artifact.chapterIndex,
        });
        next.conflicts.push(conflict);
        appendAgentLineage(next, charName, incomingRule.ruleKey, {
          ruleKind: 'AGENT',
          ruleKey: incomingRule.ruleKey,
          characterName: charName,
          chapterIndex: artifact.chapterIndex,
          chapterTitle: artifact.chapterTitle,
          action: 'CONFLICT_RECORDED',
          resolution: conflict.resolution,
          statement: incomingRule.statement,
          sourceRef: incomingRule.sourceRef || `novel:chapter_${artifact.chapterIndex}`,
        });

        const resolved = applyConflictResolution(conflict, existing, incomingRule);
        charRules[incomingRule.ruleKey] = {
          ...incomingRule,
          statement: resolved.statement,
          hardness: resolved.hardness,
        };
        appendAgentLineage(next, charName, incomingRule.ruleKey, {
          ruleKind: 'AGENT',
          ruleKey: incomingRule.ruleKey,
          characterName: charName,
          chapterIndex: artifact.chapterIndex,
          chapterTitle: artifact.chapterTitle,
          action: 'AUTO_RESOLVED',
          resolution: conflict.resolution,
          statement: resolved.statement,
          sourceRef: incomingRule.sourceRef || `novel:chapter_${artifact.chapterIndex}`,
        });
      } else {
        charRules[incomingRule.ruleKey] = incomingRule;
        appendAgentLineage(next, charName, incomingRule.ruleKey, {
          ruleKind: 'AGENT',
          ruleKey: incomingRule.ruleKey,
          characterName: charName,
          chapterIndex: artifact.chapterIndex,
          chapterTitle: artifact.chapterTitle,
          action: 'ADDED',
          resolution: 'USE_NEW',
          statement: incomingRule.statement,
          sourceRef: incomingRule.sourceRef || `novel:chapter_${artifact.chapterIndex}`,
        });
      }
    }

    next.agentRulesByCharacter[charName] = charRules;
  }

  // Merge new characters
  for (const newChar of artifact.newCharacters) {
    const existing = next.characters[newChar.name];
    if (existing) {
      // Update: merge aliases and extend description
      const mergedAliases = Array.from(new Set([...existing.aliases, ...newChar.aliases]));
      next.characters[newChar.name] = {
        ...existing,
        aliases: mergedAliases,
        description: newChar.description.length > existing.description.length
          ? newChar.description
          : existing.description,
      };
    } else {
      next.characters[newChar.name] = newChar;
    }
  }

  // Merge LLM-reported contradictions
  for (const contradiction of artifact.contradictions) {
    next.conflicts.push(contradiction);
  }

  return next;
}

/**
 * Get the final import result from the accumulator.
 */
export function accumulatorToImportResult(acc: NovelAccumulatorState): {
  worldRules: LocalWorldRuleDraft[];
  agentRules: Array<{ characterName: string; rules: LocalAgentRuleDraft[] }>;
} {
  const worldRules = Object.values(acc.worldRules);
  const agentRules = Object.entries(acc.agentRulesByCharacter).map(
    ([characterName, rulesMap]) => ({
      characterName,
      rules: Object.values(rulesMap),
    }),
  );
  return { worldRules, agentRules };
}

/**
 * Count unresolved conflicts in the accumulator.
 */
export function countUnresolvedConflicts(acc: NovelAccumulatorState): number {
  return acc.conflicts.filter((c) => c.resolution === 'UNRESOLVED').length;
}

/**
 * Update a specific conflict resolution in the accumulator.
 */
export function updateConflictResolution(
  acc: NovelAccumulatorState,
  conflictIndex: number,
  resolution: ConflictEntry['resolution'],
  mergedStatement?: string,
): NovelAccumulatorState {
  if (conflictIndex < 0 || conflictIndex >= acc.conflicts.length) return acc;

  const updatedConflicts = [...acc.conflicts];
  const current = updatedConflicts[conflictIndex];
  if (!current) {
    return acc;
  }
  updatedConflicts[conflictIndex] = {
    ...current,
    resolution,
    mergedStatement,
  };
  const next: NovelAccumulatorState = {
    ...acc,
    worldRules: { ...acc.worldRules },
    agentRulesByCharacter: Object.fromEntries(
      Object.entries(acc.agentRulesByCharacter).map(([characterName, rules]) => [
        characterName,
        { ...rules },
      ]),
    ),
    worldRuleLineage: Object.fromEntries(
      Object.entries(acc.worldRuleLineage).map(([ruleKey, entries]) => [ruleKey, [...entries]]),
    ),
    agentRuleLineageByCharacter: Object.fromEntries(
      Object.entries(acc.agentRuleLineageByCharacter).map(([characterName, lineages]) => [
        characterName,
        Object.fromEntries(
          Object.entries(lineages).map(([ruleKey, entries]) => [ruleKey, [...entries]]),
        ),
      ]),
    ),
    conflicts: updatedConflicts,
  };
  const updatedConflict = updatedConflicts[conflictIndex];

  if (!updatedConflict) {
    return next;
  }

  const nextStatement = resolution === 'MERGE'
    ? (mergedStatement || `${updatedConflict.previousStatement}\n\n${updatedConflict.newStatement}`)
    : resolution === 'USE_NEW'
      ? updatedConflict.newStatement
      : updatedConflict.previousStatement;
  const nextHardness = resolution === 'USE_NEW'
    ? updatedConflict.newHardness
    : updatedConflict.previousHardness;

  if (updatedConflict.ruleKind === 'WORLD') {
    const worldRule = next.worldRules[updatedConflict.ruleKey];
    if (worldRule) {
      next.worldRules[updatedConflict.ruleKey] = {
        ...worldRule,
        statement: nextStatement,
        hardness: nextHardness,
      };
      appendWorldLineage(next, updatedConflict.ruleKey, {
        ruleKind: 'WORLD',
        ruleKey: updatedConflict.ruleKey,
        chapterIndex: updatedConflict.chapterIndex,
        chapterTitle: `Conflict resolution`,
        action: 'USER_RESOLVED',
        resolution,
        statement: nextStatement,
        sourceRef: worldRule.sourceRef || `novel:chapter_${updatedConflict.chapterIndex}`,
      });
    }
    return next;
  }

  const characterName = updatedConflict.characterName;
  if (!characterName) {
    return next;
  }
  const agentRuleKey = updatedConflict.ruleKey.startsWith(`${characterName}:`)
    ? updatedConflict.ruleKey.slice(characterName.length + 1)
    : updatedConflict.ruleKey;
  const characterRules = next.agentRulesByCharacter[characterName];
  const agentRule = characterRules?.[agentRuleKey];
  if (!agentRule || !characterRules) {
    return next;
  }
  characterRules[agentRuleKey] = {
    ...agentRule,
    statement: nextStatement,
    hardness: nextHardness,
  };
  appendAgentLineage(next, characterName, agentRuleKey, {
    ruleKind: 'AGENT',
    ruleKey: agentRuleKey,
    characterName,
    chapterIndex: updatedConflict.chapterIndex,
    chapterTitle: 'Conflict resolution',
    action: 'USER_RESOLVED',
    resolution,
    statement: nextStatement,
    sourceRef: agentRule.sourceRef || `novel:chapter_${updatedConflict.chapterIndex}`,
  });

  return next;
}

/**
 * Serialize accumulator for localStorage persistence.
 */
export function serializeAccumulator(acc: NovelAccumulatorState): string {
  return JSON.stringify(acc);
}

/**
 * Deserialize accumulator from localStorage.
 */
export function deserializeAccumulator(json: string): NovelAccumulatorState | null {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.sourceFile !== 'string') return null;
    return parsed as NovelAccumulatorState;
  } catch {
    return null;
  }
}
