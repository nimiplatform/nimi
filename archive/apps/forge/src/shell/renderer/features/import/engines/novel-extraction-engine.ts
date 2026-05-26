/**
 * Novel Extraction Engine — Per-chapter LLM extraction
 *
 * Sends chapter text + accumulated context to the local LLM,
 * parses structured JSON output, and returns extraction artifacts.
 */

import type { WorldStudioRuntimeAiClient } from '@world-engine/runtime-ai-client.js';

import type {
  ChapterExtractionArtifact,
  LlmChapterExtractionResult,
  LocalWorldRuleDraft,
  LocalAgentRuleDraft,
  ConflictEntry,
  DiscoveredCharacter,
  NovelAccumulatorState,
} from '../types.js';
import {
  NOVEL_EXTRACTION_SYSTEM_PROMPT,
  buildChapterExtractionPrompt,
} from './novel-prompts.js';
import {
  canonicalizeAgentRuleKey,
  canonicalizeWorldRuleKey,
} from './rule-key-canonicalizer.js';

const MAX_RETRIES = 1;
const WORLD_RULE_DOMAIN_VALUES = [
  'AXIOM',
  'PHYSICS',
  'SOCIETY',
  'ECONOMY',
  'CHARACTER',
  'NARRATIVE',
  'META',
] as const;
const RULE_CATEGORY_VALUES = [
  'CONSTRAINT',
  'MECHANISM',
  'DEFINITION',
  'RELATION',
  'POLICY',
] as const;
const RULE_HARDNESS_VALUES = ['HARD', 'FIRM', 'SOFT', 'AESTHETIC'] as const;
const WORLD_RULE_SCOPE_VALUES = ['WORLD', 'REGION', 'FACTION', 'INDIVIDUAL', 'SCENE'] as const;
const AGENT_RULE_LAYER_VALUES = ['DNA', 'BEHAVIORAL', 'RELATIONAL', 'CONTEXTUAL'] as const;
const AGENT_RULE_SCOPE_VALUES = ['SELF', 'DYAD', 'GROUP', 'WORLD'] as const;
const CONFLICT_RULE_KIND_VALUES = ['WORLD', 'AGENT'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireStringField(raw: Record<string, unknown>, key: string): string | null {
  return asOptionalString(raw[key]) ?? null;
}

function parseEnum<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  valid: readonly T[],
): T | null {
  const value = asOptionalString(raw[key]);
  if (!value) {
    return null;
  }
  return valid.includes(value as T) ? (value as T) : null;
}

function parseLlmExtractionResponse(response: string): LlmChapterExtractionResult | null {
  // Strip markdown code fences if present
  const cleaned = response
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();

  const startIdx = cleaned.indexOf('{');
  const endIdx = cleaned.lastIndexOf('}');
  if (startIdx === -1 || endIdx === -1) return null;

  try {
    const parsed = JSON.parse(cleaned.slice(startIdx, endIdx + 1));
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      worldRules: Array.isArray(parsed.worldRules) ? parsed.worldRules : [],
      agentRules: Array.isArray(parsed.agentRules) ? parsed.agentRules : [],
      newCharacters: Array.isArray(parsed.newCharacters) ? parsed.newCharacters : [],
      contradictions: Array.isArray(parsed.contradictions) ? parsed.contradictions : [],
      chapterSummary: String(parsed.chapterSummary || ''),
    };
  } catch {
    return null;
  }
}

function toLWorldRuleDraft(
  raw: Record<string, unknown>,
  chapterIndex: number,
): LocalWorldRuleDraft | null {
  const title = requireStringField(raw, 'title');
  const statement = requireStringField(raw, 'statement');
  const domain = parseEnum(raw, 'domain', WORLD_RULE_DOMAIN_VALUES);
  const category = parseEnum(raw, 'category', RULE_CATEGORY_VALUES);
  const hardness = parseEnum(raw, 'hardness', RULE_HARDNESS_VALUES);
  const scope = parseEnum(raw, 'scope', WORLD_RULE_SCOPE_VALUES);
  if (!title || !statement || !domain || !category || !hardness || !scope) {
    return null;
  }

  return {
    ruleKey: canonicalizeWorldRuleKey({
      domain,
      suggestedRuleKey: asOptionalString(raw.ruleKey) ?? '',
      subjectKey: asOptionalString(raw.subjectKey) ?? '',
      semanticSlot: asOptionalString(raw.semanticSlot) ?? '',
      title,
    }),
    title,
    statement,
    domain,
    category,
    hardness,
    scope,
    provenance: 'WORLD_STUDIO',
    priority: 100,
    sourceRef: `novel:chapter_${chapterIndex}`,
    reasoning: `Extracted from novel chapter ${chapterIndex + 1}`,
  };
}

function toLAgentRuleDraft(
  raw: Record<string, unknown>,
  chapterIndex: number,
): { characterName: string; rule: LocalAgentRuleDraft } | null {
  const characterName = requireStringField(raw, 'characterName');
  const title = requireStringField(raw, 'title');
  const statement = requireStringField(raw, 'statement');
  const layer = parseEnum(raw, 'layer', AGENT_RULE_LAYER_VALUES);
  const category = parseEnum(raw, 'category', RULE_CATEGORY_VALUES);
  const hardness = parseEnum(raw, 'hardness', RULE_HARDNESS_VALUES);
  const scope = parseEnum(raw, 'scope', AGENT_RULE_SCOPE_VALUES);
  if (!characterName || !title || !statement || !layer || !category || !hardness || !scope) {
    return null;
  }

  return {
    characterName,
    rule: {
      ruleKey: canonicalizeAgentRuleKey({
        layer,
        suggestedRuleKey: asOptionalString(raw.ruleKey) ?? '',
        semanticSlot: asOptionalString(raw.semanticSlot) ?? '',
        title,
      }),
      title,
      statement,
      layer,
      category,
      hardness,
      scope,
      importance: clampImportance(raw.importance),
      provenance: 'CREATOR',
      priority: 100,
      sourceRef: `novel:chapter_${chapterIndex}`,
      reasoning: `Extracted from novel chapter ${chapterIndex + 1}`,
    },
  };
}

function clampImportance(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 50;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function toConflictEntry(
  raw: Record<string, unknown>,
  chapterIndex: number,
): ConflictEntry | null {
  const ruleKind = parseEnum(raw, 'ruleKind', CONFLICT_RULE_KIND_VALUES);
  const ruleKey = requireStringField(raw, 'ruleKey');
  const previousStatement = requireStringField(raw, 'previousStatement');
  const newStatement = requireStringField(raw, 'newStatement');
  const previousHardness = parseEnum(raw, 'previousHardness', RULE_HARDNESS_VALUES);
  const newHardness = parseEnum(raw, 'newHardness', RULE_HARDNESS_VALUES);
  if (
    !ruleKind ||
    !ruleKey ||
    !previousStatement ||
    !newStatement ||
    !previousHardness ||
    !newHardness
  ) {
    return null;
  }

  return {
    ruleKind,
    ruleKey,
    previousStatement,
    newStatement,
    previousHardness,
    newHardness,
    chapterIndex,
    resolution: 'UNRESOLVED',
  };
}

/**
 * Extract world/agent rules from a single chapter using the AI client.
 */
export async function extractChapter(
  aiClient: WorldStudioRuntimeAiClient,
  chapterIndex: number,
  chapterTitle: string,
  chapterText: string,
  accumulator: NovelAccumulatorState,
): Promise<ChapterExtractionArtifact> {
  const prompt = buildChapterExtractionPrompt(
    chapterIndex,
    chapterText,
    accumulator.worldRules,
    accumulator.characters,
  );

  let lastError: string | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await aiClient.generateText({
        systemPrompt: NOVEL_EXTRACTION_SYSTEM_PROMPT,
        prompt,
        maxTokens: 4096,
        temperature: 0.3,
      });

      const parsed = parseLlmExtractionResponse(result.text);
      if (!parsed) {
        lastError = 'LLM returned invalid JSON';
        continue;
      }

      // Convert raw LLM output to typed drafts
      const worldRules = parsed.worldRules
        .filter(isRecord)
        .map((r) => toLWorldRuleDraft(r, chapterIndex))
        .filter((rule): rule is LocalWorldRuleDraft => rule !== null);

      const agentRuleMap = new Map<string, LocalAgentRuleDraft[]>();
      for (const rawRule of parsed.agentRules) {
        if (!isRecord(rawRule)) continue;
        const mappedRule = toLAgentRuleDraft(rawRule, chapterIndex);
        if (!mappedRule) continue;
        const { characterName, rule } = mappedRule;
        const existing = agentRuleMap.get(characterName) ?? [];
        existing.push(rule);
        agentRuleMap.set(characterName, existing);
      }

      const agentRules = Array.from(agentRuleMap.entries()).map(
        ([characterName, rules]) => ({ characterName, rules }),
      );

      const newCharacters: DiscoveredCharacter[] = parsed.newCharacters
        .filter(isRecord)
        .map((c) => {
          const name = requireStringField(c, 'name');
          if (!name) {
            return null;
          }
          const aliases = Array.isArray(c.aliases)
            ? c.aliases
                .map((alias) => asOptionalString(alias))
                .filter((alias): alias is string => Boolean(alias))
            : [];
          return {
            name,
            aliases,
            firstAppearance: chapterIndex,
            description: typeof c.description === 'string' ? c.description : '',
          };
        })
        .filter((character): character is DiscoveredCharacter => character !== null);

      const contradictions = parsed.contradictions
        .filter(isRecord)
        .map((c) => toConflictEntry(c, chapterIndex))
        .filter((entry): entry is ConflictEntry => entry !== null);

      return {
        chapterIndex,
        chapterTitle,
        worldRules,
        agentRules,
        newCharacters,
        contradictions,
        chapterSummary: parsed.chapterSummary,
        status: 'COMPLETED',
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // All retries exhausted
  return {
    chapterIndex,
    chapterTitle,
    worldRules: [],
    agentRules: [],
    newCharacters: [],
    contradictions: [],
    chapterSummary: '',
    status: 'FAILED',
    error: lastError ?? 'Unknown extraction error',
  };
}
