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
): LocalWorldRuleDraft {
  return {
    ruleKey: canonicalizeWorldRuleKey({
      domain: validateEnum(String(raw.domain || ''), ['AXIOM', 'PHYSICS', 'SOCIETY', 'ECONOMY', 'CHARACTER', 'NARRATIVE', 'META'] as const, 'SOCIETY'),
      suggestedRuleKey: String(raw.ruleKey || ''),
      subjectKey: String(raw.subjectKey || ''),
      semanticSlot: String(raw.semanticSlot || ''),
      title: String(raw.title || ''),
    }),
    title: String(raw.title || 'Untitled World Rule'),
    statement: String(raw.statement || ''),
    domain: validateEnum(String(raw.domain || ''), ['AXIOM', 'PHYSICS', 'SOCIETY', 'ECONOMY', 'CHARACTER', 'NARRATIVE', 'META'] as const, 'SOCIETY'),
    category: validateEnum(String(raw.category || ''), ['CONSTRAINT', 'MECHANISM', 'DEFINITION', 'RELATION', 'POLICY'] as const, 'DEFINITION'),
    hardness: validateEnum(String(raw.hardness || ''), ['HARD', 'FIRM', 'SOFT', 'AESTHETIC'] as const, 'FIRM'),
    scope: validateEnum(String(raw.scope || ''), ['WORLD', 'REGION', 'FACTION', 'INDIVIDUAL', 'SCENE'] as const, 'WORLD'),
    provenance: 'WORLD_STUDIO',
    priority: 100,
    sourceRef: `novel:chapter_${chapterIndex}`,
    reasoning: `Extracted from novel chapter ${chapterIndex + 1}`,
  };
}

function toLAgentRuleDraft(
  raw: Record<string, unknown>,
  chapterIndex: number,
): { characterName: string; rule: LocalAgentRuleDraft } {
  return {
    characterName: String(raw.characterName || 'Unknown'),
    rule: {
      ruleKey: canonicalizeAgentRuleKey({
        layer: validateEnum(String(raw.layer || ''), ['DNA', 'BEHAVIORAL', 'RELATIONAL', 'CONTEXTUAL'] as const, 'CONTEXTUAL'),
        suggestedRuleKey: String(raw.ruleKey || ''),
        semanticSlot: String(raw.semanticSlot || ''),
        title: String(raw.title || ''),
      }),
      title: String(raw.title || 'Untitled Agent Rule'),
      statement: String(raw.statement || ''),
      layer: validateEnum(String(raw.layer || ''), ['DNA', 'BEHAVIORAL', 'RELATIONAL', 'CONTEXTUAL'] as const, 'CONTEXTUAL'),
      category: validateEnum(String(raw.category || ''), ['CONSTRAINT', 'MECHANISM', 'DEFINITION', 'RELATION', 'POLICY'] as const, 'DEFINITION'),
      hardness: validateEnum(String(raw.hardness || ''), ['HARD', 'FIRM', 'SOFT', 'AESTHETIC'] as const, 'FIRM'),
      scope: validateEnum(String(raw.scope || ''), ['SELF', 'DYAD', 'GROUP', 'WORLD'] as const, 'SELF'),
      importance: clampImportance(raw.importance),
      provenance: 'CREATOR',
      priority: 100,
      sourceRef: `novel:chapter_${chapterIndex}`,
      reasoning: `Extracted from novel chapter ${chapterIndex + 1}`,
    },
  };
}

function validateEnum<T extends string>(value: string, valid: readonly T[], fallback: T): T {
  return valid.includes(value as T) ? (value as T) : fallback;
}

function clampImportance(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 50;
  return Math.max(0, Math.min(100, Math.round(num)));
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
        .filter((r) => r != null && typeof r === 'object')
        .map((r) => toLWorldRuleDraft(r as unknown as Record<string, unknown>, chapterIndex));

      const agentRuleMap = new Map<string, LocalAgentRuleDraft[]>();
      for (const rawRule of parsed.agentRules) {
        if (!rawRule || typeof rawRule !== 'object') continue;
        const { characterName, rule } = toLAgentRuleDraft(
          rawRule as Record<string, unknown>,
          chapterIndex,
        );
        const existing = agentRuleMap.get(characterName) ?? [];
        existing.push(rule);
        agentRuleMap.set(characterName, existing);
      }

      const agentRules = Array.from(agentRuleMap.entries()).map(
        ([characterName, rules]) => ({ characterName, rules }),
      );

      const newCharacters: DiscoveredCharacter[] = parsed.newCharacters
        .filter((c) => c != null && typeof c === 'object')
        .map((c) => ({
          name: String((c as Record<string, unknown>).name || 'Unknown'),
          aliases: Array.isArray((c as Record<string, unknown>).aliases) ? ((c as Record<string, unknown>).aliases as unknown[]).map((a) => String(a || '')) : [],
          firstAppearance: chapterIndex,
          description: String((c as Record<string, unknown>).description || ''),
        }));

      const contradictions = parsed.contradictions
        .filter((c) => c != null && typeof c === 'object')
        .map((c) => ({
          ruleKind: String((c as Record<string, unknown>).ruleKey || '').includes(':')
            ? 'WORLD' as const
            : 'WORLD' as const,
          ruleKey: String((c as Record<string, unknown>).ruleKey || ''),
          previousStatement: String((c as Record<string, unknown>).previousStatement || ''),
          newStatement: String((c as Record<string, unknown>).newStatement || ''),
          previousHardness: 'FIRM' as const,
          newHardness: 'FIRM' as const,
          chapterIndex,
          resolution: 'UNRESOLVED' as const,
        }));

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
