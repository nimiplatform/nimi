// Layer 2: projection. Turns the authority package into consumable surfaces with
// governing truth refs and explicit staleness. A projection may cache, summarize,
// or format truth; it must NEVER redefine truth or be the only place a semantic
// rule exists. Private agent facts are redacted out of any player-facing
// projection.

import { type TruthRef } from './ids.js';
import { type ValidationReport, type ValidationFinding } from './failure.js';
import { type StorybookTruthPackage, validateTruthPackage, collectKnownTruthRefs } from './truth.js';
import { type StoryRun, type NarrativeContextProjection, type NarrativeCoreOutput } from './run.js';
import { generateChoicesForNode } from './choices.js';
import { findNode } from './run.js';

export type ProjectionSurfaceType = 'studio' | 'play' | 'narrative-context' | 'render';
export type ProjectionStatus = 'valid' | 'stale';

export type ProjectionEnvelope<T> = {
  projectionType: ProjectionSurfaceType;
  packageVersion: number;
  sourceRefs: TruthRef[];
  governingTruthRefs: TruthRef[];
  status: ProjectionStatus;
  payload: T;
};

export function isProjectionStale<T>(projection: ProjectionEnvelope<T>, pkg: StorybookTruthPackage): boolean {
  return projection.packageVersion !== pkg.version;
}

// --- Studio projection ---

export type FoundationCard = {
  kind: string;
  ref: TruthRef | null;
  title: string;
  summary: string;
  complete: boolean;
};

export type StudioProjectionPayload = {
  foundationCards: FoundationCard[];
  validation: ValidationReport;
  generationScopes: string[];
  provenance: { ref: TruthRef; evidenceCount: number; derivationCount: number }[];
};

export function buildStudioProjection(pkg: StorybookTruthPackage): ProjectionEnvelope<StudioProjectionPayload> {
  const governing: TruthRef[] = [];
  const cards: FoundationCard[] = [];
  if (pkg.scenarioFrame) {
    governing.push(pkg.scenarioFrame.ref);
    cards.push({ kind: 'scenario-frame', ref: pkg.scenarioFrame.ref, title: '场景框架', summary: pkg.scenarioFrame.background.slice(0, 120), complete: pkg.scenarioFrame.roles.length > 0 });
  } else {
    cards.push({ kind: 'scenario-frame', ref: null, title: '场景框架', summary: '尚未建立', complete: false });
  }
  if (pkg.agentCast) {
    governing.push(pkg.agentCast.ref);
    cards.push({ kind: 'agent-cast', ref: pkg.agentCast.ref, title: '角色阵容', summary: `${pkg.agentCast.agents.length} 位角色`, complete: pkg.agentCast.agents.length > 0 });
  } else {
    cards.push({ kind: 'agent-cast', ref: null, title: '角色阵容', summary: '尚未建立', complete: false });
  }
  if (pkg.bible) {
    governing.push(pkg.bible.ref);
    cards.push({ kind: 'storybook-bible', ref: pkg.bible.ref, title: 'Storybook Bible', summary: pkg.bible.premise.slice(0, 120), complete: pkg.bible.approved });
  } else {
    cards.push({ kind: 'storybook-bible', ref: null, title: 'Storybook Bible', summary: '尚未建立', complete: false });
  }
  if (pkg.branchTopology) {
    governing.push(pkg.branchTopology.ref);
    cards.push({ kind: 'branch-topology', ref: pkg.branchTopology.ref, title: '分支拓扑', summary: `${pkg.branchTopology.chapterIds.length} 个章节`, complete: pkg.branchTopology.chapterIds.length > 0 });
  }
  if (pkg.stateEndingMatrix) {
    governing.push(pkg.stateEndingMatrix.ref);
    cards.push({ kind: 'state-ending-matrix', ref: pkg.stateEndingMatrix.ref, title: '状态/结局矩阵', summary: `${pkg.stateEndingMatrix.endings.length} 个结局`, complete: pkg.stateEndingMatrix.endings.length > 0 });
  }

  const provenance = [...collectProvenance(pkg)];
  const generationScopes = ['scenario-frame', 'agent-cast', 'storybook-bible', 'assets', 'chapters'].filter((scope) => isScopeGeneratable(pkg, scope));

  return {
    projectionType: 'studio',
    packageVersion: pkg.version,
    sourceRefs: governing,
    governingTruthRefs: governing,
    status: 'valid',
    payload: { foundationCards: cards, validation: validateTruthPackage(pkg), generationScopes, provenance },
  };
}

function collectProvenance(pkg: StorybookTruthPackage): { ref: TruthRef; evidenceCount: number; derivationCount: number }[] {
  const refs = new Set<TruthRef>();
  if (pkg.scenarioFrame) refs.add(pkg.scenarioFrame.ref);
  if (pkg.agentCast) refs.add(pkg.agentCast.ref);
  if (pkg.bible) refs.add(pkg.bible.ref);
  return [...refs].map((ref) => ({
    ref,
    evidenceCount: pkg.evidence.filter((e) => e.truthRef === ref).length,
    derivationCount: pkg.derivations.filter((d) => d.toRef === ref).length,
  }));
}

function isScopeGeneratable(pkg: StorybookTruthPackage, scope: string): boolean {
  switch (scope) {
    case 'scenario-frame': return Boolean(pkg.scenarioFrame);
    case 'agent-cast': return Boolean(pkg.agentCast);
    case 'storybook-bible': return Boolean(pkg.bible);
    case 'assets': return Boolean(pkg.bible?.approved);
    case 'chapters': return Boolean(pkg.bible?.approved);
    default: return false;
  }
}

// --- Play projection (player-facing; private facts redacted) ---

export type PublicCastMember = { name: string; voice: string; publicFacts: string[] };

export type PlayProjectionPayload = {
  storySummary: string;
  contentBoundaries: string[];
  publicCast: PublicCastMember[];
  startChapterId: string | null;
  startNodeId: string | null;
  initialVariables: Record<string, number>;
  initialFlags: Record<string, boolean>;
};

export function buildPlayProjection(pkg: StorybookTruthPackage): ProjectionEnvelope<PlayProjectionPayload> {
  const governing: TruthRef[] = [];
  if (pkg.bible) governing.push(pkg.bible.ref);
  if (pkg.scenarioFrame) governing.push(pkg.scenarioFrame.ref);
  if (pkg.agentCast) governing.push(pkg.agentCast.ref);
  if (pkg.branchTopology) governing.push(pkg.branchTopology.ref);

  // Redaction: never project private agent facts into the player surface.
  const publicCast: PublicCastMember[] = (pkg.agentCast?.agents ?? []).map((agent) => ({
    name: agent.name,
    voice: agent.voice,
    publicFacts: [...agent.publicFacts],
  }));

  const startChapterId = pkg.branchTopology?.startChapterId ?? pkg.chapters[0]?.id ?? null;
  const startChapter = pkg.chapters.find((c) => c.id === startChapterId) ?? null;

  const initialVariables: Record<string, number> = {};
  for (const v of pkg.stateEndingMatrix?.variables ?? []) initialVariables[v.id] = v.initial;
  const initialFlags: Record<string, boolean> = {};
  for (const f of pkg.stateEndingMatrix?.flags ?? []) initialFlags[f.id] = f.initial;

  return {
    projectionType: 'play',
    packageVersion: pkg.version,
    sourceRefs: governing,
    governingTruthRefs: governing,
    status: 'valid',
    payload: {
      storySummary: pkg.bible?.premise ?? pkg.scenarioFrame?.background ?? '',
      contentBoundaries: pkg.scenarioFrame?.contentBoundaries ?? [],
      publicCast,
      startChapterId,
      startNodeId: startChapter?.startNodeId ?? null,
      initialVariables,
      initialFlags,
    },
  };
}

// --- Narrative context projection (bounded CANON/STORY/SUBJECT/RELATION) ---

export function buildNarrativeContextProjection(pkg: StorybookTruthPackage, run: StoryRun, agentId: string, turnRef: string): NarrativeContextProjection {
  const governing: TruthRef[] = [];
  const canon: string[] = [];
  if (pkg.bible) {
    governing.push(pkg.bible.ref);
    canon.push(`风格: ${pkg.bible.styleFingerprint}`, `节奏: ${pkg.bible.rhythmProfile}`);
  }
  if (pkg.scenarioFrame) {
    governing.push(pkg.scenarioFrame.ref);
    for (const boundary of pkg.scenarioFrame.contentBoundaries) canon.push(`边界: ${boundary}`);
  }
  for (const rule of pkg.rules.filter((r) => r.family === 'world-rule' && r.hardness === 'hard')) {
    governing.push(rule.ref);
    canon.push(`硬规则: ${rule.title}`);
  }

  const story: string[] = [`章节: ${run.chapterId}`, `当前节点: ${run.currentNodeId}`];
  for (const [key, value] of Object.entries(run.variables)) story.push(`变量 ${key}=${value}`);
  for (const [key, value] of Object.entries(run.flags)) story.push(`标记 ${key}=${value}`);

  const subject: string[] = [];
  const agent = pkg.agentCast?.agents.find((a) => a.id === agentId) ?? null;
  if (agent) {
    governing.push(agent.ref);
    subject.push(`角色: ${agent.name}（语气: ${agent.voice}）`);
    for (const fact of agent.publicFacts) subject.push(`公开事实: ${fact}`);
    subject.push(`可用行动: ${agent.allowedActions.join('、')}`);
    // NOTE: private facts are intentionally NOT projected into the turn context by default.
  }

  const relation: string[] = agent ? [`玩家与 ${agent.name} 的当前关系：中立（运行内派生）`] : [];

  return { runId: run.id, turnRef, scopes: { canon, story, subject, relation }, governingTruthRefs: governing };
}

/**
 * Play-side narrative context (redacted). Built from a prepared package's public
 * projection — NOT from authority — so it can never carry private agent facts.
 * Play surfaces use this to run the guarded narrative engine without holding the
 * truth package. `governingTruthRefs` is empty because Play consumes a projection,
 * not authority directly.
 */
export function buildPlayNarrativeContext(input: {
  runId: string;
  turnRef: string;
  storySummary: string;
  contentBoundaries: string[];
  publicCast: PublicCastMember[];
  agentName?: string;
  run: StoryRun;
}): NarrativeContextProjection {
  const canon: string[] = [];
  if (input.storySummary.trim()) canon.push(`概要: ${input.storySummary}`);
  for (const boundary of input.contentBoundaries) canon.push(`边界: ${boundary}`);

  const story: string[] = [`章节: ${input.run.chapterId}`, `当前节点: ${input.run.currentNodeId}`];
  for (const [key, value] of Object.entries(input.run.variables)) story.push(`变量 ${key}=${value}`);
  for (const [key, value] of Object.entries(input.run.flags)) story.push(`标记 ${key}=${value}`);

  const subject: string[] = [];
  const agent = input.agentName ? input.publicCast.find((c) => c.name === input.agentName) ?? null : input.publicCast[0] ?? null;
  if (agent) {
    subject.push(`角色: ${agent.name}（语气: ${agent.voice}）`);
    for (const fact of agent.publicFacts) subject.push(`公开事实: ${fact}`); // public only — never private
  }
  const relation: string[] = agent ? [`玩家与 ${agent.name} 的当前关系：运行内派生`] : [];

  return { runId: input.run.id, turnRef: input.turnRef, scopes: { canon, story, subject, relation }, governingTruthRefs: [] };
}

// --- Render projection (renderer-facing; never writes spine) ---

export type RenderLine = { kind: string; text: string; agentId?: string };

export type RenderProjectionPayload = {
  lines: RenderLine[];
  assetRefs: string[];
};

export function buildRenderProjection(pkg: StorybookTruthPackage, run: StoryRun, coreOutput: NarrativeCoreOutput | null): RenderProjectionPayload {
  const lines: RenderLine[] = [];
  const chapter = pkg.chapters.find((c) => c.id === run.chapterId) ?? null;
  const node = chapter ? findNode(chapter, run.currentNodeId) : null;
  if (node) {
    lines.push({ kind: 'narration', text: node.text });
    for (const choice of generateChoicesForNode(chapter as NonNullable<typeof chapter>, node)) {
      lines.push({ kind: 'choice', text: choice.label });
    }
  }
  if (coreOutput) {
    for (const event of coreOutput.spineEvents) {
      lines.push({ kind: event.kind, text: event.text, agentId: event.agentId });
    }
  }
  const assetRefs = pkg.assets.filter((a) => a.artifactRef).map((a) => a.artifactRef as string);
  return { lines, assetRefs };
}

// --- projection governance validators (explicit staleness + semantic drift) ---

/**
 * Explicit projection-staleness check. A projection input may be stale; staleness
 * must be surfaced, never hidden. This is a diagnostic (used by the Studio
 * observability surface and the cross-product doctor) — it is intentionally NOT
 * part of the play-valid truth validator, because a prepared package rebuilds its
 * projection fresh and acknowledges staleness via `refreshProjectionInputs`.
 */
export function validateProjectionFreshness(pkg: StorybookTruthPackage): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const input of pkg.projectionInputs) {
    if (input.validationStatus === 'stale') {
      findings.push({
        code: 'projection_stale',
        message: `Projection input ${input.id} (${input.projectionType}) is stale against truth version ${pkg.version}; rebuild before shipping.`,
        pointers: [`projection:${input.id}`],
      });
    }
  }
  return findings;
}

/**
 * Semantic-drift check: a projection input must only govern truth refs that resolve
 * in authority. A projection that points at a ref absent from truth would be the
 * only place that rule exists — forbidden. Safe to include in the play-valid path.
 */
export function validateProjectionDrift(pkg: StorybookTruthPackage): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const known = collectKnownTruthRefs(pkg);
  for (const input of pkg.projectionInputs) {
    for (const ref of input.governingTruthRefs) {
      if (!known.has(ref)) {
        findings.push({
          code: 'projection_introduces_unbacked_rule',
          message: `Projection input ${input.id} (${input.projectionType}) governs ref "${ref}" that is absent from authority — a projection must not be the only place a rule exists.`,
          pointers: [`projection:${input.id}`],
        });
      }
    }
  }
  return findings;
}
