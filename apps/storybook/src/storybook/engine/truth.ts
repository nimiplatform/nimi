// storybook-truth-package: the app-owned canonical project authority. Rule-of-truth
// first — Studio, Play, narrative-context, and render surfaces are projections of
// this, never a second source of truth. Modeled after the Forge/Realm posture
// (truth / derivation / projection / evidence / governance / compat) but scoped to
// app-local authoring. Realm alignment is structural reference only; Storybook runs
// never mutate Realm truth.

import { type TruthRef, type TruthFamily, isTruthRef, mintId } from './ids.js';
import { type ValidationFinding, type ValidationReport, validationReport } from './failure.js';
import {
  type ScenarioFrame,
  type AgentCast,
  type StorybookBible,
  type BranchTopology,
  type StateEndingMatrix,
  validateScenarioFrame,
  validateAgentCast,
  validateBranchTopology,
  validateStateEndingMatrix,
} from './foundation.js';
import { type PlayableChapter } from './run.js';
import { type AssetSpec, validateAssetSpec } from './assets.js';
import { validateDefaultProgression } from './choices.js';
import { validateEndingClosure } from './branching.js';
import {
  type AdaptationBrief,
  type DivergenceDecision,
  type VisualStyleGuide,
  validateAdaptationBrief,
  validateDivergenceDecision,
  validateVisualStyleGuide,
} from './adaptation.js';
import { type RealmWorldAgentImport, validateRealmImport } from './realm.js';

export type StorybookProjectMode = 'source-backed' | 'document-backed' | 'character-card' | 'original-scenario' | 'manual-setting' | 'structured-notes';

export type StorybookProject = {
  id: string;
  name: string;
  mode: StorybookProjectMode;
  truthPackageId: string;
  createdAt: string;
  updatedAt: string;
};

export type RuleHardness = 'hard' | 'soft';
export type RuleProvenance = 'creator' | 'world-inherited' | 'narrative-emerged' | 'system';

export type TruthRule = {
  ref: TruthRef;
  family: TruthFamily;
  domain: string;
  category: string;
  hardness: RuleHardness;
  scope: string;
  title: string;
  payload: Record<string, unknown>;
  provenance: RuleProvenance;
  evidenceRefs: string[];
};

export type EvidenceKind = 'source' | 'seed' | 'edit' | 'feedback' | 'run' | 'execution';

export type TruthEvidenceBinding = {
  id: string;
  truthRef: TruthRef;
  kind: EvidenceKind;
  sourceRef: string;
  note: string;
};

export type DerivationKind = 'source-to-rule' | 'seed-to-rule' | 'adaptation' | 'inheritance' | 'feedback';

export type TruthDerivation = {
  id: string;
  kind: DerivationKind;
  fromRefs: string[];
  toRef: TruthRef;
  note: string;
};

export type ProjectionType = 'studio' | 'play' | 'narrative-context' | 'render' | 'compat';
export type ProjectionValidationStatus = 'valid' | 'stale' | 'invalid';

export type ProjectionInput = {
  id: string;
  projectionType: ProjectionType;
  governingTruthRefs: TruthRef[];
  validationStatus: ProjectionValidationStatus;
};

export type AcceptedFeedbackRecord = {
  id: string;
  targetRef: TruthRef;
  note: string;
  precedence: number;
};

export type CompatEntry = {
  id: string;
  kind: 'lorebook' | 'node-graph' | 'prompt-pack' | 'bundle';
  note: string;
};

export type TruthGovernanceLifecycle = 'draft' | 'foundation-approved' | 'play-ready';

export type TruthGovernance = {
  lifecycle: TruthGovernanceLifecycle;
  reviewState: 'open' | 'reviewed';
  owner: string;
  buildScope: string;
  createdAt: string;
  updatedAt: string;
};

export type StorybookTruthPackage = {
  id: string;
  projectId: string;
  version: number;
  governance: TruthGovernance;
  // truth section
  rules: TruthRule[];
  scenarioFrame: ScenarioFrame | null;
  agentCast: AgentCast | null;
  bible: StorybookBible | null;
  adaptationBrief: AdaptationBrief | null;
  visualStyleGuide: VisualStyleGuide | null;
  divergences: DivergenceDecision[];
  branchTopology: BranchTopology | null;
  stateEndingMatrix: StateEndingMatrix | null;
  chapters: PlayableChapter[];
  assets: AssetSpec[];
  // supporting sections
  evidence: TruthEvidenceBinding[];
  derivations: TruthDerivation[];
  projectionInputs: ProjectionInput[];
  feedback: AcceptedFeedbackRecord[];
  compat: CompatEntry[];
  /** Realm structural references / forks owned by this project (wave-6). */
  realmImports: RealmWorldAgentImport[];
};

export function createEmptyTruthPackage(input: { projectId: string; owner: string; now: string }): StorybookTruthPackage {
  return {
    id: mintId('truthpkg'),
    projectId: input.projectId,
    version: 1,
    governance: {
      lifecycle: 'draft',
      reviewState: 'open',
      owner: input.owner,
      buildScope: 'app-local',
      createdAt: input.now,
      updatedAt: input.now,
    },
    rules: [],
    scenarioFrame: null,
    agentCast: null,
    bible: null,
    adaptationBrief: null,
    visualStyleGuide: null,
    divergences: [],
    branchTopology: null,
    stateEndingMatrix: null,
    chapters: [],
    assets: [],
    evidence: [],
    derivations: [],
    projectionInputs: [],
    feedback: [],
    compat: [],
    realmImports: [],
  };
}

/** Add a Realm import/fork to the project's authority bundle (app-owned). */
export function addRealmImport(pkg: StorybookTruthPackage, record: RealmWorldAgentImport, now: string): StorybookTruthPackage {
  return { ...pkg, realmImports: [...pkg.realmImports, record], governance: { ...pkg.governance, updatedAt: now } };
}

/** Every ref that can be legitimately pointed at by evidence / projections. */
export function collectKnownTruthRefs(pkg: StorybookTruthPackage): Set<string> {
  const refs = new Set<string>();
  for (const rule of pkg.rules) refs.add(rule.ref);
  for (const chapter of pkg.chapters) refs.add(chapter.ref);
  for (const asset of pkg.assets) refs.add(asset.ref);
  if (pkg.scenarioFrame) refs.add(pkg.scenarioFrame.ref);
  if (pkg.agentCast) {
    refs.add(pkg.agentCast.ref);
    for (const agent of pkg.agentCast.agents) refs.add(agent.ref);
  }
  if (pkg.bible) refs.add(pkg.bible.ref);
  if (pkg.adaptationBrief) refs.add(pkg.adaptationBrief.ref);
  if (pkg.visualStyleGuide) refs.add(pkg.visualStyleGuide.ref);
  if (pkg.branchTopology) refs.add(pkg.branchTopology.ref);
  if (pkg.stateEndingMatrix) refs.add(pkg.stateEndingMatrix.ref);
  return refs;
}

/** A claim is backed when it has evidence, a derivation, OR an approved divergence. */
function refHasBacking(pkg: StorybookTruthPackage, ref: TruthRef): boolean {
  return (
    pkg.evidence.some((e) => e.truthRef === ref) ||
    pkg.derivations.some((d) => d.toRef === ref) ||
    pkg.divergences.some((d) => d.targetRef === ref)
  );
}

/**
 * Fail-closed truth-package validator. Enforces section completeness for the
 * package lifecycle, ref/evidence resolvability, projection governance, and the
 * foundation/asset/progression validators. Missing prerequisites fail close —
 * they never produce pseudo-success.
 */
export function validateTruthPackage(pkg: StorybookTruthPackage): ValidationReport {
  const findings: ValidationFinding[] = [];
  const knownRefs = collectKnownTruthRefs(pkg);

  if (!pkg.governance.owner.trim()) {
    findings.push({ code: 'truth_package_section_incomplete', message: 'Governance owner is empty.', pointers: ['governance.owner'] });
  }

  // evidence bindings must resolve to a known truth ref
  for (const binding of pkg.evidence) {
    if (!isTruthRef(binding.truthRef) || !knownRefs.has(binding.truthRef)) {
      findings.push({ code: 'evidence_binding_unresolved', message: `Evidence binding ${binding.id} points at unresolved truth ref "${binding.truthRef}".`, pointers: [`evidence:${binding.id}`] });
    }
  }
  // derivations must resolve their target
  for (const derivation of pkg.derivations) {
    if (!knownRefs.has(derivation.toRef)) {
      findings.push({ code: 'truth_ref_unresolved', message: `Derivation ${derivation.id} produces unresolved truth ref "${derivation.toRef}".`, pointers: [`derivation:${derivation.id}`] });
    }
  }
  // projection inputs must point at governing truth refs that resolve
  for (const input of pkg.projectionInputs) {
    if (input.governingTruthRefs.length === 0) {
      findings.push({ code: 'projection_missing_governing_truth_ref', message: `Projection input ${input.id} (${input.projectionType}) has no governing truth refs.`, pointers: [`projection:${input.id}`] });
    }
    for (const ref of input.governingTruthRefs) {
      if (!knownRefs.has(ref)) {
        // A projection governed by a ref absent from authority would be the only
        // place that rule exists — semantic drift, not merely a missing pointer.
        findings.push({ code: 'projection_introduces_unbacked_rule', message: `Projection input ${input.id} governs unresolved truth ref "${ref}" (absent from authority).`, pointers: [`projection:${input.id}`] });
      }
    }
  }
  // rule evidence refs should resolve to declared evidence bindings or other refs
  for (const rule of pkg.rules) {
    for (const evidenceRef of rule.evidenceRefs) {
      const known = pkg.evidence.some((e) => e.id === evidenceRef) || knownRefs.has(evidenceRef);
      if (!known) {
        findings.push({ code: 'evidence_binding_unresolved', message: `Rule "${rule.title}" cites unknown evidence "${evidenceRef}".`, pointers: [rule.ref] });
      }
    }
  }

  // lifecycle-gated section completeness
  const needsFoundation = pkg.governance.lifecycle === 'foundation-approved' || pkg.governance.lifecycle === 'play-ready';
  if (needsFoundation) {
    if (!pkg.scenarioFrame) findings.push({ code: 'truth_package_section_incomplete', message: 'Foundation-approved package is missing a scenario frame.', pointers: ['scenarioFrame'] });
    if (!pkg.agentCast) findings.push({ code: 'truth_package_section_incomplete', message: 'Foundation-approved package is missing an agent cast.', pointers: ['agentCast'] });
    if (!pkg.bible) {
      findings.push({ code: 'truth_package_section_incomplete', message: 'Foundation-approved package is missing a Storybook Bible.', pointers: ['bible'] });
    } else if (!pkg.bible.approved) {
      findings.push({ code: 'truth_package_section_incomplete', message: 'Storybook Bible is not approved; chapter generation/play is gated on approval.', pointers: ['bible.approved'] });
    } else if (!refHasBacking(pkg, pkg.bible.ref)) {
      findings.push({ code: 'bible_validation_failed', message: 'Approved Storybook Bible has no evidence binding, derivation, or approved divergence (every claim needs backing).', pointers: [pkg.bible.ref] });
    }
  }

  if (pkg.governance.lifecycle === 'play-ready') {
    if (!pkg.branchTopology) findings.push({ code: 'truth_package_section_incomplete', message: 'Play-ready package is missing branch topology.', pointers: ['branchTopology'] });
    if (!pkg.stateEndingMatrix) findings.push({ code: 'truth_package_section_incomplete', message: 'Play-ready package is missing a state/ending matrix.', pointers: ['stateEndingMatrix'] });
    if (pkg.chapters.length === 0) findings.push({ code: 'truth_package_section_incomplete', message: 'Play-ready package has no playable chapters.', pointers: ['chapters'] });
    // every declared ending must have a closure node in the chapter graph
    if (pkg.stateEndingMatrix && pkg.chapters.length > 0) {
      findings.push(...validateEndingClosure(pkg.stateEndingMatrix, pkg.chapters));
    }
  }

  // foundation validators when present
  if (pkg.scenarioFrame) findings.push(...validateScenarioFrame(pkg.scenarioFrame));
  if (pkg.agentCast) findings.push(...validateAgentCast(pkg.agentCast));
  if (pkg.branchTopology) findings.push(...validateBranchTopology(pkg.branchTopology));
  if (pkg.branchTopology && pkg.stateEndingMatrix) findings.push(...validateStateEndingMatrix(pkg.stateEndingMatrix, pkg.branchTopology));
  for (const asset of pkg.assets) findings.push(...validateAssetSpec(asset));
  for (const chapter of pkg.chapters) findings.push(...validateDefaultProgression(chapter));

  // adaptation model (validated when present)
  if (pkg.adaptationBrief) findings.push(...validateAdaptationBrief(pkg.adaptationBrief));
  if (pkg.visualStyleGuide) findings.push(...validateVisualStyleGuide(pkg.visualStyleGuide));
  for (const divergence of pkg.divergences) findings.push(...validateDivergenceDecision(divergence));

  // realm imports participate in the package's own validity (and the doctor)
  for (const realmImport of pkg.realmImports) findings.push(...validateRealmImport(realmImport));

  return validationReport(findings);
}

// --- mutation helpers (all preserve provenance / refs) ---

export function addRule(pkg: StorybookTruthPackage, rule: TruthRule, now: string): StorybookTruthPackage {
  return { ...pkg, rules: [...pkg.rules, rule], governance: { ...pkg.governance, updatedAt: now } };
}

export function addEvidence(pkg: StorybookTruthPackage, binding: Omit<TruthEvidenceBinding, 'id'>, now: string): StorybookTruthPackage {
  const withId: TruthEvidenceBinding = { ...binding, id: mintId('evid') };
  return { ...pkg, evidence: [...pkg.evidence, withId], governance: { ...pkg.governance, updatedAt: now } };
}

export function addProjectionInput(pkg: StorybookTruthPackage, input: Omit<ProjectionInput, 'id'>): StorybookTruthPackage {
  return { ...pkg, projectionInputs: [...pkg.projectionInputs, { ...input, id: mintId('proj') }] };
}

/**
 * Mark every registered projection input fresh for the current package version.
 * Authoring edits call `bumpAndStale` (see authoring.ts) which flips inputs to
 * `stale`; a surface that has rebuilt its projections at the current version calls
 * this to record that the staleness was resolved. Staleness is always explicit —
 * this never silently treats a stale projection as fresh; it is an deliberate,
 * post-rebuild acknowledgement.
 */
export function refreshProjectionInputs(pkg: StorybookTruthPackage): StorybookTruthPackage {
  if (pkg.projectionInputs.every((input) => input.validationStatus === 'valid')) return pkg;
  return { ...pkg, projectionInputs: pkg.projectionInputs.map((input) => ({ ...input, validationStatus: 'valid' as const })) };
}

/**
 * Bump the package version and mark every projection input stale. Any authority
 * mutation (authoring, editor) routes through this so projections are never
 * silently treated as fresh after truth changed.
 */
export function bumpVersion(pkg: StorybookTruthPackage, now: string): StorybookTruthPackage {
  return {
    ...pkg,
    version: pkg.version + 1,
    governance: { ...pkg.governance, updatedAt: now },
    projectionInputs: pkg.projectionInputs.map((input) => ({ ...input, validationStatus: 'stale' as const })),
  };
}
