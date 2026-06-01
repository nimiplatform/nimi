// Adaptation model (wave-7). Sits in the truth package's `truth.storybook` section
// alongside the scenario frame, agent cast, and bible. Three additions over the
// baseline foundation:
//
//   adaptation-brief    — a SPOILER-SAFE direction proposal shown for user
//                         confirmation before heavy generation (Studio Stage 2 gate).
//   divergence-decision — an explicit record that a bible/rule claim diverges from
//                         source/seed evidence, so every claim is backed by evidence,
//                         derivation, OR an approved divergence (never unbacked).
//   visual-style-guide  — structured art-direction anchors for asset consistency.
//
// All carry a truth ref so evidence bindings and projections point back to them.

import { type TruthRef } from './ids.js';
import { type ValidationFinding } from './failure.js';

export type AdaptationApproval = 'pending' | 'approved' | 'auto-approved';

/**
 * Spoiler-safe direction proposal. It conveys premise, perspective, tension,
 * milestone, style, and an APPROXIMATE ending direction — it must never carry exact
 * ending ids, route conditions, flag thresholds, or private facts.
 */
export type AdaptationBrief = {
  ref: TruthRef;
  title: string;
  premiseSummary: string;
  playerPerspective: string;
  coreTension: string;
  targetMilestone: string;
  stylePlan: string;
  pacingPlan: string;
  /** Approximate ending/route direction WITHOUT exact conditions. */
  endingDirection: string;
  approval: AdaptationApproval;
};

export type DivergenceDecision = {
  id: string;
  /** The bible / rule / claim that intentionally diverges from source or seed. */
  targetRef: TruthRef;
  /** Evidence ref the claim diverges from, when applicable. */
  fromEvidenceRef?: string;
  reason: string;
  approvedBy: string;
  at: string;
};

export type VisualStyleGuide = {
  ref: TruthRef;
  artDirection: string;
  palette: string[];
  consistencyAnchors: string[];
};

// Tokens that would make a "spoiler-safe" brief leak exact resolution detail.
const SPOILER_TOKENS = ['endingId', 'end-', 'route condition', 'flag ==', 'flag>=', '当且仅当', '条件是', 'secret:', 'privateFact'];

/** Heuristic spoiler scan over the brief's free-text fields. */
export function detectBriefSpoilerLeak(brief: AdaptationBrief): string[] {
  const haystack = [brief.endingDirection, brief.premiseSummary, brief.coreTension, brief.stylePlan].join('\n').toLowerCase();
  return SPOILER_TOKENS.filter((token) => haystack.includes(token.toLowerCase()));
}

export function validateAdaptationBrief(brief: AdaptationBrief): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!brief.premiseSummary.trim()) {
    findings.push({ code: 'adaptation_brief_invalid', message: 'Adaptation brief has no premise summary.', pointers: ['premiseSummary'] });
  }
  if (!brief.playerPerspective.trim()) {
    findings.push({ code: 'adaptation_brief_invalid', message: 'Adaptation brief has no player perspective.', pointers: ['playerPerspective'] });
  }
  if (!brief.coreTension.trim()) {
    findings.push({ code: 'adaptation_brief_invalid', message: 'Adaptation brief has no core dramatic tension.', pointers: ['coreTension'] });
  }
  const leaks = detectBriefSpoilerLeak(brief);
  if (leaks.length > 0) {
    findings.push({ code: 'adaptation_spoiler_leak', message: `Adaptation brief leaks spoiler-bearing tokens: ${leaks.join(', ')}. The brief must stay spoiler-safe.`, pointers: ['endingDirection'] });
  }
  return findings;
}

/** Gate used before heavy generation: a pending brief blocks (adaptation_unconfirmed). */
export function isAdaptationConfirmed(brief: AdaptationBrief | null): boolean {
  return Boolean(brief && (brief.approval === 'approved' || brief.approval === 'auto-approved'));
}

export function validateDivergenceDecision(decision: DivergenceDecision): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!decision.reason.trim()) {
    findings.push({ code: 'divergence_decision_invalid', message: `Divergence decision ${decision.id} has no reason.`, pointers: [`divergence:${decision.id}`] });
  }
  if (!decision.approvedBy.trim()) {
    findings.push({ code: 'divergence_decision_invalid', message: `Divergence decision ${decision.id} has no approver.`, pointers: [`divergence:${decision.id}`] });
  }
  return findings;
}

export function validateVisualStyleGuide(guide: VisualStyleGuide): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (!guide.artDirection.trim()) {
    findings.push({ code: 'visual_style_guide_invalid', message: 'Visual style guide has no art direction.', pointers: ['artDirection'] });
  }
  return findings;
}
