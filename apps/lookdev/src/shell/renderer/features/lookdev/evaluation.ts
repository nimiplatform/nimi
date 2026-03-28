import type { LookdevCheckKey, LookdevEvaluationCheck, LookdevEvaluationResult } from './types.js';

const HARD_GATES = new Set<LookdevCheckKey>(['fullBody', 'fixedFocalLength', 'subjectClarity']);
const SCORED_CHECKS = new Set<LookdevCheckKey>(['stablePose', 'backgroundSubordinate', 'lowOcclusion']);

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeChecks(value: unknown): LookdevEvaluationCheck[] {
  if (!Array.isArray(value)) {
    throw new Error('LOOKDEV_EVAL_CHECKS_INVALID');
  }

  return value.map((entry) => {
    const record = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : null;
    const key = String(record?.key || '').trim() as LookdevCheckKey;
    if (!HARD_GATES.has(key) && !SCORED_CHECKS.has(key)) {
      throw new Error('LOOKDEV_EVAL_CHECK_KEY_INVALID');
    }
    return {
      key,
      passed: normalizeBoolean(record?.passed),
      kind: HARD_GATES.has(key) ? 'hard_gate' : 'scored',
      note: String(record?.note || '').trim() || undefined,
    };
  });
}

export function parseEvaluationJson(raw: string): LookdevEvaluationResult {
  const trimmed = String(raw || '').trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/u, '')
    .replace(/^```\s*/u, '')
    .replace(/\s*```$/u, '');
  const parsed = JSON.parse(withoutFence) as Record<string, unknown>;

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('LOOKDEV_EVAL_JSON_INVALID');
  }

  const score = Number(parsed.score);
  if (!Number.isFinite(score)) {
    throw new Error('LOOKDEV_EVAL_SCORE_INVALID');
  }

  const checks = normalizeChecks(parsed.checks);
  const summary = String(parsed.summary || '').trim();
  if (!summary) {
    throw new Error('LOOKDEV_EVAL_SUMMARY_REQUIRED');
  }
  const failureReasons = Array.isArray(parsed.failureReasons)
    ? parsed.failureReasons.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  return {
    passed: normalizeBoolean(parsed.passed),
    score,
    checks,
    summary,
    failureReasons,
  };
}

export function validateEvaluation(result: LookdevEvaluationResult, threshold: number): LookdevEvaluationResult {
  const hardGateFailed = result.checks.some((check) => check.kind === 'hard_gate' && !check.passed);
  const passed = !hardGateFailed && result.score >= threshold && result.passed;
  return {
    ...result,
    passed,
  };
}

export function deriveCorrectionHints(result: LookdevEvaluationResult): string[] {
  const hints: string[] = [];
  for (const check of result.checks) {
    if (check.passed) {
      continue;
    }
    switch (check.key) {
      case 'fullBody':
        hints.push('Keep the entire character visible from head to toe with no cropped feet or hands.');
        break;
      case 'fixedFocalLength':
        hints.push('Use a standard character lens with no wide-angle perspective distortion.');
        break;
      case 'subjectClarity':
        hints.push('Clarify the character silhouette, identity, costume blocks, and facial read.');
        break;
      case 'stablePose':
        hints.push('Prefer a balanced neutral pose suitable for an anchor portrait.');
        break;
      case 'backgroundSubordinate':
        hints.push('Subdue the background so the character remains the clear focal subject.');
        break;
      case 'lowOcclusion':
        hints.push('Avoid props, framing, or hair covering major silhouette and outfit details.');
        break;
      default:
        break;
    }
  }
  for (const reason of result.failureReasons) {
    if (reason && !hints.includes(reason)) {
      hints.push(reason);
    }
  }
  return hints.slice(0, 4);
}
