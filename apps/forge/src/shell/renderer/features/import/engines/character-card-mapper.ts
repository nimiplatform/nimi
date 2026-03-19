/**
 * Character Card V2 → AgentRule[] / WorldRule[] Mapper
 *
 * Maps V2 fields to the 4-layer AgentRule structure:
 * DNA → BEHAVIORAL → RELATIONAL → CONTEXTUAL
 */

import type {
  TavernCardV2,
  LocalAgentRuleDraft,
  LocalWorldRuleDraft,
} from '../types.js';

function buildReasoning(card: TavernCardV2): string {
  const creator = card.data.creator.trim();
  const version = card.data.character_version.trim();
  const parts = ['Imported from Character Card V2'];
  if (creator) parts.push(creator);
  if (version) parts.push(version);
  return parts.join(' / ');
}

export function mapCharacterCardToAgentRules(
  card: TavernCardV2,
  sourceFilename: string,
): LocalAgentRuleDraft[] {
  const { data } = card;
  const name = data.name.trim();
  const sourceRef = `chara_card_v2:${sourceFilename}`;
  const reasoning = buildReasoning(card);
  const rules: LocalAgentRuleDraft[] = [];

  // ── DNA Layer (identity core) ───────────────────────────────

  if (name) {
    rules.push({
      ruleKey: 'identity:self:name',
      title: `${name} Name Identity`,
      statement: name,
      layer: 'DNA',
      category: 'DEFINITION',
      hardness: 'HARD',
      scope: 'SELF',
      importance: 95,
      provenance: 'CREATOR',
      sourceRef,
      reasoning,
      priority: 100,
      structured: { originalField: 'name', value: name },
    });
  }

  if (data.description.trim()) {
    rules.push({
      ruleKey: 'identity:self:core',
      title: `${name} Core Identity`,
      statement: data.description.trim(),
      layer: 'DNA',
      category: 'DEFINITION',
      hardness: 'FIRM',
      scope: 'SELF',
      importance: 90,
      provenance: 'CREATOR',
      sourceRef,
      reasoning,
      priority: 100,
      structured: { originalField: 'description', value: data.description.trim() },
    });
  }

  if (data.personality.trim()) {
    rules.push({
      ruleKey: 'identity:self:personality',
      title: `${name} Personality`,
      statement: data.personality.trim(),
      layer: 'DNA',
      category: 'DEFINITION',
      hardness: 'FIRM',
      scope: 'SELF',
      importance: 85,
      provenance: 'CREATOR',
      sourceRef,
      reasoning,
      priority: 100,
      structured: { originalField: 'personality', value: data.personality.trim() },
    });
  }

  if (data.system_prompt.trim()) {
    rules.push({
      ruleKey: 'identity:self:system_directive',
      title: `${name} System Directive`,
      statement: data.system_prompt.trim(),
      layer: 'DNA',
      category: 'CONSTRAINT',
      hardness: 'HARD',
      scope: 'SELF',
      importance: 100,
      provenance: 'CREATOR',
      sourceRef,
      reasoning,
      priority: 100,
      structured: { originalField: 'system_prompt', value: data.system_prompt.trim() },
    });
  }

  // ── BEHAVIORAL Layer (interaction patterns) ─────────────────

  if (data.first_mes.trim()) {
    rules.push({
      ruleKey: 'behavior:greeting:primary',
      title: `${name} Primary Greeting`,
      statement: data.first_mes.trim(),
      layer: 'BEHAVIORAL',
      category: 'MECHANISM',
      hardness: 'FIRM',
      scope: 'DYAD',
      importance: 75,
      provenance: 'CREATOR',
      sourceRef,
      reasoning,
      priority: 100,
      structured: { originalField: 'first_mes', value: data.first_mes.trim() },
    });
  }

  if (Array.isArray(data.alternate_greetings)) {
    for (let i = 0; i < data.alternate_greetings.length; i++) {
      const greeting = String(data.alternate_greetings[i] || '').trim();
      if (!greeting) continue;
      rules.push({
        ruleKey: `behavior:greeting:alt_${i}`,
        title: `${name} Alt Greeting ${i + 1}`,
        statement: greeting,
        layer: 'BEHAVIORAL',
        category: 'MECHANISM',
        hardness: 'SOFT',
        scope: 'DYAD',
        importance: 60,
        provenance: 'CREATOR',
        sourceRef,
        reasoning,
        priority: 100,
        structured: { originalField: `alternate_greetings[${i}]`, value: greeting },
      });
    }
  }

  if (data.mes_example.trim()) {
    rules.push({
      ruleKey: 'behavior:dialogue:examples',
      title: `${name} Dialogue Examples`,
      statement: data.mes_example.trim(),
      layer: 'BEHAVIORAL',
      category: 'POLICY',
      hardness: 'SOFT',
      scope: 'DYAD',
      importance: 70,
      provenance: 'CREATOR',
      sourceRef,
      reasoning,
      priority: 100,
      structured: { originalField: 'mes_example', value: data.mes_example.trim() },
    });
  }

  if (data.post_history_instructions.trim()) {
    rules.push({
      ruleKey: 'behavior:directive:post_history',
      title: `${name} Post-History`,
      statement: data.post_history_instructions.trim(),
      layer: 'BEHAVIORAL',
      category: 'CONSTRAINT',
      hardness: 'FIRM',
      scope: 'DYAD',
      importance: 80,
      provenance: 'CREATOR',
      sourceRef,
      reasoning,
      priority: 100,
      structured: { originalField: 'post_history_instructions', value: data.post_history_instructions.trim() },
    });
  }

  return rules;
}

export function mapCharacterCardToWorldRules(
  card: TavernCardV2,
  sourceFilename: string,
): LocalWorldRuleDraft[] {
  const { data } = card;
  const sourceRef = `chara_card_v2:${sourceFilename}`;
  const reasoning = buildReasoning(card);
  const worldRules: LocalWorldRuleDraft[] = [];

  if (data.scenario.trim()) {
    worldRules.push({
      ruleKey: 'narrative:seed:scenario',
      title: `${data.name.trim() || 'Imported'} Scenario Seed`,
      statement: data.scenario.trim(),
      domain: 'NARRATIVE',
      category: 'DEFINITION',
      hardness: 'SOFT',
      scope: 'WORLD',
      provenance: 'SEED',
      priority: 40,
      sourceRef,
      reasoning,
      structured: {
        originalField: 'scenario',
        weakWorldSeed: true,
      },
    });
  }

  if (data.tags.length > 0) {
    worldRules.push({
      ruleKey: 'meta:seed:source-tags',
      title: `${data.name.trim() || 'Imported'} Source Tags`,
      statement: data.tags.join(', '),
      domain: 'META',
      category: 'DEFINITION',
      hardness: 'AESTHETIC',
      scope: 'WORLD',
      provenance: 'SEED',
      priority: 20,
      sourceRef,
      reasoning: `${reasoning} / Imported source tags preserved as weak world labels.`,
      structured: {
        originalField: 'tags',
        tags: data.tags,
        weakWorldSeed: true,
      },
    });
  }

  return worldRules;
}
