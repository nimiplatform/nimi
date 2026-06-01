// Lite rule builder. Converts every admitted input shape into structured
// Storybook records BEFORE generation/preview. It is Forge-inspired but does not
// run full long-novel extraction/refine/adjudicate/merge. Inputs that exceed the
// lite path fail closed with typed reasons.
//
// Wave-5 concrete limits (set here for v1):
//   - concise source excerpt: <= 20000 chars (over => source_too_large_for_app_lite_builder)
//   - structured notes: <= 200 entries
//   - character card: must carry a name + at least one descriptive field
//   - original scenario: must carry a premise + (cast or rules)

import { makeTruthRef, mintId } from './ids.js';
import { type Result, ok, fail } from './failure.js';
import { type ScenarioFrame, type AgentCast, type AgentSheet, type StorybookBible, type Role } from './foundation.js';
import {
  type StorybookProject,
  type StorybookTruthPackage,
  type TruthEvidenceBinding,
  createEmptyTruthPackage,
  addProjectionInput,
} from './truth.js';

export const MAX_SOURCE_CHARS = 20000;
export const MAX_NOTE_COUNT = 200;

export type IntakeKind = 'manual-setting' | 'original-scenario' | 'character-card' | 'short-fiction' | 'document-text' | 'structured-notes';

export type IntakeInput =
  | { kind: 'manual-setting'; projectId: string; background: string; roles: Role[]; rules: string[]; playerPosition: string; contentBoundaries: string[] }
  | { kind: 'original-scenario'; projectId: string; premise: string; cast: { name: string; summary: string }[]; rules: string[]; playerPosition?: string; contentBoundaries?: string[] }
  | { kind: 'character-card'; projectId: string; card: { name: string; persona?: string; voice?: string; publicFacts?: string[]; privateFacts?: string[]; goals?: string[]; appearance?: string } }
  | { kind: 'short-fiction'; projectId: string; title?: string; text: string; contentBoundaries?: string[] }
  | { kind: 'document-text'; projectId: string; title?: string; text: string; contentBoundaries?: string[] }
  | { kind: 'structured-notes'; projectId: string; notes: { label: string; value: string }[]; contentBoundaries?: string[] };

export type ProjectSeed = {
  id: string;
  projectId: string;
  intakeKind: IntakeKind;
  createdAt: string;
};

export type SeedIndexKind = 'source' | 'scenario';

export type SeedIndexEntity = { name: string; kind: 'character' | 'place' | 'concept' };

/** source-memory-index / scenario-seed-index — compact structured understanding. */
export type SeedIndex = {
  ref: string;
  kind: SeedIndexKind;
  summary: string;
  facts: string[];
  entities: SeedIndexEntity[];
  excerptCount: number;
};

export type IntakeConversion = {
  seed: ProjectSeed;
  index: SeedIndex;
  scenarioFrame: ScenarioFrame | null;
  agentCast: AgentCast | null;
  bible: StorybookBible;
  evidenceSeeds: Omit<TruthEvidenceBinding, 'id'>[];
};

function naiveFacts(text: string): string[] {
  return text
    .split(/(?<=[。．.!?！？\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
    .slice(0, 24);
}

function naiveEntities(text: string): SeedIndexEntity[] {
  const tokens = text.match(/[A-Z][a-zA-Z]{2,}|[一-龥]{2,4}(?=[，。、])/g) ?? [];
  const seen = new Set<string>();
  const entities: SeedIndexEntity[] = [];
  for (const token of tokens) {
    const key = token.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entities.push({ name: key, kind: 'character' });
    if (entities.length >= 12) break;
  }
  return entities;
}

/**
 * Convert one admitted input into structured records. Fail-closed: malformed or
 * over-limit inputs return a typed StorybookFailure instead of partial output.
 */
export function convertIntake(input: IntakeInput, now: string): Result<IntakeConversion> {
  const { projectId } = input;
  const seed: ProjectSeed = { id: mintId('seed'), projectId, intakeKind: input.kind, createdAt: now };

  const sceneRef = makeTruthRef(projectId, 'scenario-frame', 'frame');
  const castRef = makeTruthRef(projectId, 'agent-cast', 'cast');
  const bibleRef = makeTruthRef(projectId, 'storybook-bible', 'bible');

  switch (input.kind) {
    case 'manual-setting': {
      if (!input.background.trim()) return fail('manual_setting_invalid', 'Manual setting requires a background.', ['background']);
      if (input.roles.length === 0) return fail('manual_setting_invalid', 'Manual setting requires at least one role.', ['roles']);
      if (!input.playerPosition.trim()) return fail('manual_setting_invalid', 'Manual setting requires a player position.', ['playerPosition']);
      const index: SeedIndex = {
        ref: makeTruthRef(projectId, 'scenario-seed-index', 'index'),
        kind: 'scenario',
        summary: input.background,
        facts: [...input.rules],
        entities: input.roles.map((r) => ({ name: r.name, kind: 'character' as const })),
        excerptCount: 0,
      };
      const scenarioFrame: ScenarioFrame = {
        ref: sceneRef,
        background: input.background,
        roles: input.roles,
        rules: input.rules,
        playerPosition: input.playerPosition,
        contentBoundaries: input.contentBoundaries.length ? input.contentBoundaries : ['默认内容边界：尊重用户设定的题材与分级。'],
      };
      const bible: StorybookBible = {
        ref: bibleRef,
        premise: input.background,
        styleFingerprint: '由手动设定生成的初始风格基线，待 Studio 调整。',
        rhythmProfile: '中速、以选择推进为主。',
        worldSummary: input.background,
        themes: [],
        approved: false,
      };
      return ok({
        seed,
        index,
        scenarioFrame,
        agentCast: null,
        bible,
        evidenceSeeds: [
          { truthRef: sceneRef, kind: 'edit', sourceRef: seed.id, note: '手动设定直接录入为场景框架。' },
          { truthRef: bibleRef, kind: 'edit', sourceRef: seed.id, note: '由手动设定派生 Bible 草案。' },
        ],
      });
    }

    case 'original-scenario': {
      if (!input.premise.trim()) return fail('scenario_seed_invalid', 'Original scenario requires a premise.', ['premise']);
      if (input.cast.length === 0 && input.rules.length === 0) {
        return fail('scenario_seed_invalid', 'Original scenario requires at least a cast or a rule set.', ['cast', 'rules']);
      }
      const index: SeedIndex = {
        ref: makeTruthRef(projectId, 'scenario-seed-index', 'index'),
        kind: 'scenario',
        summary: input.premise,
        facts: [...input.rules],
        entities: input.cast.map((c) => ({ name: c.name, kind: 'character' as const })),
        excerptCount: 0,
      };
      const scenarioFrame: ScenarioFrame = {
        ref: sceneRef,
        background: input.premise,
        roles: input.cast.map((c, i) => ({ id: `role-${i}`, name: c.name, summary: c.summary })),
        rules: input.rules,
        playerPosition: input.playerPosition?.trim() || '主角视角参与者',
        contentBoundaries: input.contentBoundaries?.length ? input.contentBoundaries : ['默认内容边界：尊重用户设定的题材与分级。'],
      };
      const agentCast: AgentCast = {
        ref: castRef,
        agents: input.cast.map((c, i): AgentSheet => ({
          id: `agent-${i}`,
          ref: makeTruthRef(projectId, 'agent-rule', `agent-${i}`),
          name: c.name,
          voice: '默认语气',
          publicFacts: c.summary ? [c.summary] : [],
          privateFacts: [],
          goals: [],
          allowedActions: ['对话', '行动描述'],
          provenance: 'creator',
        })),
      };
      const bible: StorybookBible = {
        ref: bibleRef,
        premise: input.premise,
        styleFingerprint: '原创情景的初始风格基线。',
        rhythmProfile: '中速、以选择推进为主。',
        worldSummary: input.premise,
        themes: [],
        approved: false,
      };
      return ok({
        seed,
        index,
        scenarioFrame,
        agentCast,
        bible,
        evidenceSeeds: [
          { truthRef: sceneRef, kind: 'seed', sourceRef: seed.id, note: '原创情景种子派生场景框架。' },
          { truthRef: castRef, kind: 'seed', sourceRef: seed.id, note: '原创情景 cast 派生 agent 候选。' },
          { truthRef: bibleRef, kind: 'seed', sourceRef: seed.id, note: '原创情景种子派生 Bible 草案。' },
        ],
      });
    }

    case 'character-card': {
      const card = input.card;
      const descriptive = [card.persona, card.appearance, ...(card.publicFacts ?? []), ...(card.goals ?? [])].filter((v) => v && v.trim());
      if (!card.name.trim()) return fail('character_card_invalid', 'Character card requires a name.', ['card.name']);
      if (descriptive.length === 0) return fail('character_card_invalid', 'Character card needs at least one descriptive field (persona/appearance/publicFacts/goals).', ['card']);
      const agentRef = makeTruthRef(projectId, 'agent-rule', 'card-agent');
      const agentCast: AgentCast = {
        ref: castRef,
        agents: [{
          id: 'agent-card',
          ref: agentRef,
          name: card.name,
          voice: card.voice?.trim() || '默认语气',
          publicFacts: card.publicFacts ?? (card.persona ? [card.persona] : []),
          privateFacts: card.privateFacts ?? [],
          goals: card.goals ?? [],
          allowedActions: ['对话', '行动描述'],
          appearance: card.appearance,
          provenance: 'creator',
        }],
      };
      const index: SeedIndex = {
        ref: makeTruthRef(projectId, 'scenario-seed-index', 'index'),
        kind: 'scenario',
        summary: `角色卡：${card.name}`,
        facts: descriptive as string[],
        entities: [{ name: card.name, kind: 'character' }],
        excerptCount: 0,
      };
      const bible: StorybookBible = {
        ref: bibleRef,
        premise: `围绕角色 ${card.name} 的互动叙事。`,
        styleFingerprint: '以角色驱动的对话风格。',
        rhythmProfile: '对话密度较高。',
        worldSummary: card.persona ?? '',
        themes: [],
        approved: false,
      };
      return ok({
        seed,
        index,
        scenarioFrame: null,
        agentCast,
        bible,
        evidenceSeeds: [
          { truthRef: agentRef, kind: 'source', sourceRef: seed.id, note: '角色卡转换为 agent 真值候选。' },
          { truthRef: bibleRef, kind: 'source', sourceRef: seed.id, note: '角色卡派生 Bible 草案。' },
        ],
      });
    }

    case 'short-fiction':
    case 'document-text': {
      const text = input.text ?? '';
      if (!text.trim()) return fail(input.kind === 'short-fiction' ? 'source_corpus_invalid' : 'document_text_invalid', 'Source text is empty.', ['text']);
      if (text.length > MAX_SOURCE_CHARS) {
        return fail('source_too_large_for_app_lite_builder', `Source is ${text.length} chars; the lite builder accepts at most ${MAX_SOURCE_CHARS}. Long-novel extraction is out of scope.`, ['text']);
      }
      const summary = text.slice(0, 280).trim();
      const index: SeedIndex = {
        ref: makeTruthRef(projectId, 'source-memory-index', 'index'),
        kind: 'source',
        summary,
        facts: naiveFacts(text),
        entities: naiveEntities(text),
        excerptCount: 1,
      };
      const scenarioFrame: ScenarioFrame = {
        ref: sceneRef,
        background: summary,
        roles: index.entities.slice(0, 4).map((e, i) => ({ id: `role-${i}`, name: e.name, summary: '源文本中出现的角色。' })),
        rules: [],
        playerPosition: '参与者视角',
        contentBoundaries: input.contentBoundaries?.length ? input.contentBoundaries : ['默认内容边界：遵循源材料的题材与分级。'],
      };
      const bible: StorybookBible = {
        ref: bibleRef,
        premise: summary,
        styleFingerprint: '从源文本提取的初始风格基线，待 Studio 校准。',
        rhythmProfile: '中速。',
        worldSummary: summary,
        themes: [],
        approved: false,
      };
      return ok({
        seed,
        index,
        scenarioFrame,
        agentCast: null,
        bible,
        evidenceSeeds: [
          { truthRef: sceneRef, kind: 'source', sourceRef: index.ref, note: '源文本摘要派生场景框架。' },
          { truthRef: bibleRef, kind: 'source', sourceRef: index.ref, note: '源文本派生 Bible 草案。' },
        ],
      });
    }

    case 'structured-notes': {
      if (input.notes.length === 0) return fail('structured_notes_invalid', 'Structured notes are empty.', ['notes']);
      if (input.notes.length > MAX_NOTE_COUNT) return fail('source_too_large_for_app_lite_builder', `Structured notes exceed ${MAX_NOTE_COUNT} entries.`, ['notes']);
      const facts = input.notes.map((n) => `${n.label}: ${n.value}`.trim()).filter(Boolean);
      const index: SeedIndex = {
        ref: makeTruthRef(projectId, 'source-memory-index', 'index'),
        kind: 'source',
        summary: facts.slice(0, 3).join(' / '),
        facts,
        entities: [],
        excerptCount: input.notes.length,
      };
      const scenarioFrame: ScenarioFrame = {
        ref: sceneRef,
        background: facts[0] ?? '结构化笔记派生的背景。',
        roles: [{ id: 'role-0', name: '主角', summary: '由结构化笔记定义的参与者。' }],
        rules: facts,
        playerPosition: '参与者视角',
        contentBoundaries: input.contentBoundaries?.length ? input.contentBoundaries : ['默认内容边界。'],
      };
      const bible: StorybookBible = {
        ref: bibleRef,
        premise: facts[0] ?? '',
        styleFingerprint: '结构化笔记派生的风格基线。',
        rhythmProfile: '中速。',
        worldSummary: facts.join('；'),
        themes: [],
        approved: false,
      };
      return ok({
        seed,
        index,
        scenarioFrame,
        agentCast: null,
        bible,
        evidenceSeeds: [
          { truthRef: sceneRef, kind: 'source', sourceRef: index.ref, note: '结构化笔记派生场景框架。' },
          { truthRef: bibleRef, kind: 'source', sourceRef: index.ref, note: '结构化笔记派生 Bible 草案。' },
        ],
      });
    }

    default: {
      const exhaustive: never = input;
      return fail('intake_kind_unsupported', `Unsupported intake input: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Assemble a draft truth package from an intake conversion. All admitted inputs
 * have already become structured Storybook records before this point, satisfying
 * the "structure before generation" rule. The package starts in `draft` lifecycle
 * and registers Studio/Play projection inputs governed by the seeded truth refs.
 */
export function seedTruthPackage(project: StorybookProject, conversion: IntakeConversion, now: string): StorybookTruthPackage {
  let pkg = createEmptyTruthPackage({ projectId: project.id, owner: project.id, now });
  pkg = {
    ...pkg,
    id: project.truthPackageId,
    scenarioFrame: conversion.scenarioFrame,
    agentCast: conversion.agentCast,
    bible: conversion.bible,
    evidence: conversion.evidenceSeeds.map((seedEvidence) => ({ ...seedEvidence, id: mintId('evid') })),
    derivations: conversion.evidenceSeeds.map((seedEvidence) => ({
      id: mintId('deriv'),
      kind: conversion.index.kind === 'source' ? 'source-to-rule' : 'seed-to-rule',
      fromRefs: [conversion.index.ref],
      toRef: seedEvidence.truthRef,
      note: seedEvidence.note,
    })),
  };
  // Register a governing Studio projection input over the seeded foundation refs.
  const refs = [conversion.scenarioFrame?.ref, conversion.agentCast?.ref, conversion.bible.ref].filter((r): r is NonNullable<typeof r> => Boolean(r));
  pkg = addProjectionInput(pkg, { projectionType: 'studio', governingTruthRefs: refs, validationStatus: 'valid' });
  return pkg;
}
