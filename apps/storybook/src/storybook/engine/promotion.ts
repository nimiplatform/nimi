// Promotion model. Run-emerged content does not become project truth automatically
// and does not require a human decision on every turn. The Engine defines promotion
// standards; an LLM-assisted assessor (see ai/**) supplies risk/confidence inputs,
// and this module enforces the canonical decision policy. Human correction always
// takes precedence after the fact.

import { type TruthRef, mintId } from './ids.js';
import { type Result, ok, fail } from './failure.js';

/** Canonical promotion enum values. Hyphenated forms are UI labels only. */
export type PromotionEnum = 'auto_accept' | 'needs_review' | 'reject' | 'session_only';

const CANONICAL_PROMOTION_ENUM: ReadonlySet<string> = new Set<PromotionEnum>(['auto_accept', 'needs_review', 'reject', 'session_only']);

export type MutationType = 'create' | 'update' | 'supersede' | 'delete' | 'attach-evidence' | 'add-feedback';
export type RiskClass = 'low' | 'medium' | 'high';
export type ImpactClass = 'local' | 'scoped' | 'durable';

/** Classes for which auto_accept is forbidden. */
export type ProtectedClass =
  | 'realm-imported'
  | 'hard-world-rule'
  | 'durable-agent-identity'
  | 'private-fact'
  | 'content-boundary'
  | 'route-topology'
  | 'ending'
  | 'safety-policy'
  | 'hard-truth-deletion'
  | 'publish-export-authority';

export type PromotionCandidate = {
  id: string;
  /** turn / transcript / render / projection refs the content emerged from. */
  sourceRefs: string[];
  evidenceRefs: string[];
  targetTruthRef: TruthRef | null;
  targetObjectFamily: string;
  mutationType: MutationType;
  protectedClasses: ProtectedClass[];
  proposedChange: Record<string, unknown>;
};

export type PromotionAssessment = {
  candidateId: string;
  riskClass: RiskClass;
  impactClass: ImpactClass;
  confidence: number;
  contradictionCheck: boolean;
  visibilityCheck: boolean;
  policyCheck: boolean;
  scopeCheck: boolean;
  assessor: { identity: string; modelProviderRef?: string };
  rationale: string;
  /** The assessor's recommended outcome (advisory; policy still enforced separately). */
  recommendedOutcome?: PromotionEnum;
};

export type PromotionDecision = {
  id: string;
  candidateId: string;
  decision: PromotionEnum;
  reason: string;
  decidedAt: string;
  auditRecordRef: string;
  humanCorrectionPrecedence: boolean;
  supersedes?: string;
};

export type HumanCorrection = {
  id: string;
  decisionId: string;
  action: 'override' | 'repair' | 'confirm';
  newDecision?: PromotionEnum;
  note: string;
  at: string;
};

export type PromotionAuditRecord = {
  id: string;
  candidateId: string;
  assessment: PromotionAssessment;
  decision: PromotionEnum;
  at: string;
};

export function isCanonicalPromotionEnum(value: string): value is PromotionEnum {
  return CANONICAL_PROMOTION_ENUM.has(value);
}

export function createPromotionCandidate(input: Omit<PromotionCandidate, 'id'>): PromotionCandidate {
  return { ...input, id: mintId('promcand') };
}

const AUTO_ACCEPT_CONFIDENCE_FLOOR = 0.8;

/**
 * Enforce the promotion policy on a proposed decision. Fails closed when a
 * protected class is auto-accepted, or when an unknown enum value is supplied.
 * Returns the committed decision plus an audit record.
 */
export function enforcePromotionPolicy(input: {
  candidate: PromotionCandidate;
  assessment: PromotionAssessment;
  proposedDecision: string;
  now: string;
}): Result<{ decision: PromotionDecision; audit: PromotionAuditRecord }> {
  const { candidate, assessment, proposedDecision, now } = input;

  if (!isCanonicalPromotionEnum(proposedDecision)) {
    return fail('promotion_enum_invalid', `Promotion decision "${proposedDecision}" is not a canonical enum value.`);
  }

  const touchesProtected = candidate.protectedClasses.length > 0;
  if (proposedDecision === 'auto_accept' && touchesProtected) {
    return fail(
      'promotion_auto_accept_forbidden_class',
      `auto_accept is forbidden for protected classes: ${candidate.protectedClasses.join(', ')}.`,
    );
  }

  // auto_accept additionally requires low risk, all checks pass, and high confidence.
  if (proposedDecision === 'auto_accept') {
    const eligible = assessment.riskClass === 'low'
      && assessment.contradictionCheck
      && assessment.visibilityCheck
      && assessment.policyCheck
      && assessment.scopeCheck
      && assessment.confidence >= AUTO_ACCEPT_CONFIDENCE_FLOOR;
    if (!eligible) {
      return fail('promotion_enum_invalid', 'auto_accept requires low risk, passing contradiction/visibility/policy/scope checks, and high confidence.');
    }
  }

  const auditRef = mintId('promaudit');
  const decision: PromotionDecision = {
    id: mintId('promdec'),
    candidateId: candidate.id,
    decision: proposedDecision,
    reason: assessment.rationale,
    decidedAt: now,
    auditRecordRef: auditRef,
    humanCorrectionPrecedence: true,
  };
  const audit: PromotionAuditRecord = { id: auditRef, candidateId: candidate.id, assessment, decision: proposedDecision, at: now };
  return ok({ decision, audit });
}

// --- candidate derivation + the assessor boundary (wave-11) ---

export type PromotionSignals = {
  targetObjectFamily: string;
  mutationType: MutationType;
  touchesPrivateFact?: boolean;
  touchesContentBoundary?: boolean;
  touchesRouteTopology?: boolean;
  touchesEnding?: boolean;
  touchesHardWorldRule?: boolean;
  touchesDurableAgentIdentity?: boolean;
  touchesSafetyPolicy?: boolean;
  realmImported?: boolean;
  requiresPublishAuthority?: boolean;
};

/**
 * Map signals to the protected classes for which auto_accept is forbidden. Combines
 * explicit flags with object-family heuristics so a run-emerged change to, say, an
 * ending or a hard world rule is correctly fenced as needs_review/reject/session_only.
 */
export function detectProtectedClasses(signals: PromotionSignals): ProtectedClass[] {
  const classes = new Set<ProtectedClass>();
  if (signals.realmImported) classes.add('realm-imported');
  if (signals.touchesPrivateFact) classes.add('private-fact');
  if (signals.touchesContentBoundary) classes.add('content-boundary');
  if (signals.touchesRouteTopology || signals.targetObjectFamily === 'branch-topology') classes.add('route-topology');
  if (signals.touchesEnding || signals.targetObjectFamily === 'state-ending-matrix') classes.add('ending');
  if (signals.touchesHardWorldRule) classes.add('hard-world-rule');
  if (signals.touchesDurableAgentIdentity) classes.add('durable-agent-identity');
  if (signals.touchesSafetyPolicy) classes.add('safety-policy');
  if (signals.requiresPublishAuthority) classes.add('publish-export-authority');
  if (signals.mutationType === 'delete') classes.add('hard-truth-deletion');
  return [...classes];
}

/**
 * Build a promotion candidate from a run-emerged source (a narrative turn, a
 * transcript entry, a render, or a free-text steer). The source ref is marked
 * `turn:` so it can never be promoted into Realm world truth (see realm.ts).
 */
export function deriveCandidateFromTurn(input: {
  turnId: string;
  evidenceRefs?: string[];
  targetTruthRef: TruthRef | null;
  targetObjectFamily: string;
  mutationType: MutationType;
  proposedChange: Record<string, unknown>;
  signals?: Partial<Omit<PromotionSignals, 'targetObjectFamily' | 'mutationType'>>;
}): PromotionCandidate {
  const protectedClasses = detectProtectedClasses({
    targetObjectFamily: input.targetObjectFamily,
    mutationType: input.mutationType,
    ...input.signals,
  });
  return createPromotionCandidate({
    sourceRefs: [`turn:${input.turnId}`],
    evidenceRefs: input.evidenceRefs ?? [],
    targetTruthRef: input.targetTruthRef,
    targetObjectFamily: input.targetObjectFamily,
    mutationType: input.mutationType,
    protectedClasses,
    proposedChange: input.proposedChange,
  });
}

/**
 * App-local deterministic promotion assessor. This is the BOUNDARY where an
 * LLM-assisted assessor (routed through admitted Runtime/SDK surfaces in ai/**)
 * would attach: it would supply richer contradiction/quality judgement and a
 * confidence score. Until then this baseline is honest about being heuristic — it
 * never fabricates a high-confidence pass for protected classes, and it recommends
 * conservatively. `inputs` carries any check results an external assessor produced.
 */
export function assessPromotionCandidateLocally(
  candidate: PromotionCandidate,
  inputs: {
    confidence?: number;
    contradictionCheck?: boolean;
    visibilityCheck?: boolean;
    policyCheck?: boolean;
    scopeCheck?: boolean;
    assessorIdentity?: string;
    modelProviderRef?: string;
  } = {},
): PromotionAssessment {
  const protectedTouch = candidate.protectedClasses.length > 0;
  const contradictionCheck = inputs.contradictionCheck ?? true;
  const visibilityCheck = inputs.visibilityCheck ?? !candidate.protectedClasses.includes('private-fact');
  const policyCheck = inputs.policyCheck ?? !candidate.protectedClasses.includes('safety-policy');
  const scopeCheck = inputs.scopeCheck ?? true;
  const checksPass = contradictionCheck && visibilityCheck && policyCheck && scopeCheck;

  const lowRiskMutation = candidate.mutationType === 'add-feedback' || candidate.mutationType === 'attach-evidence';
  const riskClass: RiskClass = protectedTouch ? 'high' : lowRiskMutation ? 'low' : 'medium';
  const impactClass: ImpactClass = protectedTouch ? 'durable' : lowRiskMutation ? 'local' : 'scoped';
  // Conservative confidence default: never high for protected classes.
  const confidence = inputs.confidence ?? (protectedTouch ? 0.4 : lowRiskMutation ? 0.85 : 0.6);

  let recommendedOutcome: PromotionEnum;
  if (protectedTouch) {
    recommendedOutcome = checksPass ? 'needs_review' : 'reject';
  } else if (riskClass === 'low' && checksPass && confidence >= 0.8) {
    recommendedOutcome = 'auto_accept';
  } else {
    recommendedOutcome = 'needs_review';
  }

  const rationale = protectedTouch
    ? `Protected classes [${candidate.protectedClasses.join(', ')}] forbid auto_accept; routed to ${recommendedOutcome}.`
    : `Unprotected ${candidate.mutationType}; risk=${riskClass}, confidence=${confidence.toFixed(2)} -> ${recommendedOutcome}.`;

  return {
    candidateId: candidate.id,
    riskClass,
    impactClass,
    confidence,
    contradictionCheck,
    visibilityCheck,
    policyCheck,
    scopeCheck,
    assessor: { identity: inputs.assessorIdentity ?? 'storybook-local-assessor', modelProviderRef: inputs.modelProviderRef },
    rationale,
    recommendedOutcome,
  };
}

/** Apply a human correction; the human decision supersedes the assessor decision. */
export function applyHumanCorrection(prior: PromotionDecision, correction: Omit<HumanCorrection, 'id'>): Result<{ decision: PromotionDecision; correction: HumanCorrection }> {
  if (correction.newDecision && !isCanonicalPromotionEnum(correction.newDecision)) {
    return fail('promotion_enum_invalid', `Human correction proposes non-canonical decision "${correction.newDecision}".`);
  }
  const correctionRecord: HumanCorrection = { ...correction, id: mintId('humcorr') };
  const nextDecision: PromotionDecision = correction.newDecision
    ? { ...prior, id: mintId('promdec'), decision: correction.newDecision, reason: `human ${correction.action}: ${correction.note}`, supersedes: prior.id }
    : prior;
  return ok({ decision: nextDecision, correction: correctionRecord });
}
