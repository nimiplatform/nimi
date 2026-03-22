/**
 * Novel Import — LLM Prompt Templates
 *
 * Provides system prompt and per-chapter context construction
 * for the novel extraction engine.
 */

import type {
  LocalWorldRuleDraft,
  DiscoveredCharacter,
} from '../types.js';

export const NOVEL_EXTRACTION_SYSTEM_PROMPT = `You are a world-building extraction engine. Read a novel chapter and extract:
1. World Rules — facts about the world (laws, geography, factions, history, magic systems)
2. Agent Rules — character traits, abilities, relationships, behavioral patterns

For each rule, assign structured metadata:
- ruleKey: optional suggested identifier if obvious
- title: short descriptive name
- statement: the factual content
- domain (world rules only): AXIOM | PHYSICS | SOCIETY | ECONOMY | CHARACTER | NARRATIVE | META
- layer (agent rules only): DNA | BEHAVIORAL | RELATIONAL | CONTEXTUAL
- category: CONSTRAINT | MECHANISM | DEFINITION | RELATION | POLICY
- hardness: HARD (immutable law) | FIRM (strong convention) | SOFT (tendency) | AESTHETIC (style)
- scope: world rules = WORLD | REGION | FACTION | INDIVIDUAL | SCENE; agent rules = SELF | DYAD | GROUP | WORLD
- importance (agent rules only): 0-100
- subjectKey (world rules only): compact subject anchor like "magic", "empire", "capital-city"
- semanticSlot: compact stable slot like "core-law", "greeting-style", "relationship-status", "appearance", "political-structure"

Domain guide:
- AXIOM: fundamental laws (time, space, causality, magic systems)
- PHYSICS: natural laws of the world
- SOCIETY: social structures, languages, customs, organizations, factions
- ECONOMY: resources, trade, currency, commerce
- CHARACTER: species, races, existence types
- NARRATIVE: plot hooks, narrative elements, prophecies
- META: visual style, terminology

Layer guide:
- DNA: immutable identity (name, core description, personality)
- BEHAVIORAL: interaction patterns (greetings, dialogue style, habits)
- RELATIONAL: relationships to other characters and the world
- CONTEXTUAL: situational knowledge, lore awareness

Output ONLY valid JSON with this exact structure:
{
  "worldRules": [{ "ruleKey": "", "title": "", "statement": "", "domain": "", "category": "", "hardness": "", "scope": "", "subjectKey": "", "semanticSlot": "" }],
  "agentRules": [{ "characterName": "", "ruleKey": "", "title": "", "statement": "", "layer": "", "category": "", "hardness": "", "scope": "", "importance": 50, "semanticSlot": "" }],
  "newCharacters": [{ "name": "", "aliases": [], "description": "" }],
  "contradictions": [{ "ruleKind": "", "ruleKey": "", "previousStatement": "", "newStatement": "", "previousHardness": "", "newHardness": "", "reason": "" }],
  "chapterSummary": ""
}

IMPORTANT:
- Only extract facts explicitly stated or strongly implied in the text
- Do NOT hallucinate characters or facts not present in the chapter
- Use the canonical name (full name at first appearance) for characters; put aliases/nicknames in the aliases array
- If a new fact contradicts a previously known fact, include it in contradictions
- Do not repeat rules already known from previous chapters unless they are being updated or contradicted
- Keep subjectKey and semanticSlot stable across chapters for the same underlying fact`;

export function buildChapterExtractionPrompt(
  chapterIndex: number,
  chapterText: string,
  knownWorldRules: Record<string, LocalWorldRuleDraft>,
  knownCharacters: Record<string, DiscoveredCharacter>,
): string {
  const parts: string[] = [];

  // Known world rules summary (budget: ~2000 chars)
  const ruleEntries = Object.values(knownWorldRules);
  if (ruleEntries.length > 0) {
    parts.push('## Known World Rules (accumulated from previous chapters)');
    let budget = 2000;
    for (const rule of ruleEntries) {
      const line = `- [${rule.domain}/${rule.ruleKey}] ${rule.title}: ${rule.statement.slice(0, 120)}`;
      if (budget - line.length < 0) {
        parts.push(`... and ${ruleEntries.length - parts.length + 1} more rules`);
        break;
      }
      parts.push(line);
      budget -= line.length;
    }
    parts.push('');
  }

  // Known characters
  const charEntries = Object.values(knownCharacters);
  if (charEntries.length > 0) {
    parts.push('## Known Characters');
    for (const char of charEntries) {
      const aliases = char.aliases.length > 0 ? ` (aliases: ${char.aliases.join(', ')})` : '';
      parts.push(`- ${char.name}${aliases}: ${char.description.slice(0, 100)}`);
    }
    parts.push('');
  }

  // Chapter content
  parts.push(`## Chapter ${chapterIndex + 1}`);
  parts.push(chapterText);
  parts.push('');

  // Instructions
  parts.push('## Instructions');
  parts.push('- Only extract NEW facts not already listed in Known World Rules above');
  parts.push('- If a fact contradicts a known rule, report it in contradictions with the ruleKey');
  parts.push('- Use canonical character names (full name at first appearance)');
  parts.push('- Put aliases and nicknames in the aliases array');

  return parts.join('\n');
}
