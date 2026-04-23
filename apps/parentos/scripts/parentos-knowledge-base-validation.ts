export interface ReminderRuleValidationShape {
  ruleId: string;
  category: string;
  kind?: string;
  actionType?: string;
  triggerAge: {
    startMonths: number;
    endMonths: number;
  };
  triggerCondition?: unknown;
  explain?: unknown;
  source?: unknown;
}

export type ReminderKindLiteral = 'task' | 'guide' | 'practice' | 'consult';

export const ACTION_TYPE_TO_KIND: Record<string, ReminderKindLiteral> = {
  go_hospital: 'task',
  record_data: 'task',
  start_training: 'task',
  read_guide: 'guide',
  observe: 'practice',
  ai_consult: 'consult',
};

const REMINDER_KIND_VALUES: readonly ReminderKindLiteral[] = [
  'task',
  'guide',
  'practice',
  'consult',
];

export interface MilestoneValidationShape {
  milestoneId: string;
  typicalAge: {
    rangeEnd: number;
  };
  alertIfNotBy?: number;
}

export interface SensitivePeriodValidationShape {
  periodId: string;
  ageRange: {
    startMonths: number;
    peakMonths: number;
    endMonths: number;
  };
}

export interface KnowledgeSourceValidationShape {
  domain: string;
  status: string;
  lastReviewedAt: string | null;
}

export function isIsoDate(value: string | null | undefined) {
  return Boolean(value) && !Number.isNaN(Date.parse(value as string));
}

export function validateReminderRule(rule: ReminderRuleValidationShape) {
  const issues: string[] = [];
  const { startMonths, endMonths } = rule.triggerAge ?? {};

  if (!Number.isFinite(startMonths) || !Number.isFinite(endMonths)) {
    issues.push(`Rule ${rule.ruleId} has invalid triggerAge`);
    return issues;
  }

  if (startMonths < 0) {
    issues.push(`Rule ${rule.ruleId} has negative triggerAge.startMonths`);
  }

  if (endMonths !== -1 && endMonths < startMonths) {
    issues.push(`Rule ${rule.ruleId} has triggerAge.endMonths < startMonths`);
  }

  if (rule.category === 'personalized' && !rule.triggerCondition) {
    issues.push(`Rule ${rule.ruleId} is personalized but missing triggerCondition`);
  }

  return issues;
}

/**
 * PO-REMI-001 / PO-REMI-002: every rule must declare `kind` and the value
 * must match the authoritative actionType ↔ kind mapping.
 */
export function validateReminderKind(rule: ReminderRuleValidationShape) {
  const issues: string[] = [];

  if (typeof rule.kind !== 'string' || !REMINDER_KIND_VALUES.includes(rule.kind as ReminderKindLiteral)) {
    issues.push(
      `Rule ${rule.ruleId} must declare kind ∈ {${REMINDER_KIND_VALUES.join(', ')}} (PO-REMI-001); got ${JSON.stringify(rule.kind)}`,
    );
    return issues;
  }

  if (typeof rule.actionType !== 'string') {
    issues.push(`Rule ${rule.ruleId} missing actionType; cannot validate kind mapping`);
    return issues;
  }

  const expected = ACTION_TYPE_TO_KIND[rule.actionType];
  if (!expected) {
    issues.push(`Rule ${rule.ruleId} has unknown actionType '${rule.actionType}'`);
    return issues;
  }

  if (rule.kind !== expected) {
    issues.push(
      `Rule ${rule.ruleId} kind '${rule.kind}' does not match PO-REMI-002 mapping for actionType '${rule.actionType}' (expected '${expected}')`,
    );
  }

  return issues;
}

interface ExplainShape {
  whyNow?: unknown;
  howTo?: unknown;
  doneWhen?: unknown;
  ifNotNow?: unknown;
  pitfalls?: unknown;
  sources?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * PO-REMI-006: kind ∈ {guide, practice, consult} requires a fully-populated
 * explain object. kind = task may omit explain entirely, but if explain is
 * present on a task rule it must still satisfy the shape.
 */
export function validateReminderExplain(rule: ReminderRuleValidationShape) {
  const issues: string[] = [];
  const kind = rule.kind as ReminderKindLiteral | undefined;
  const explain = rule.explain as ExplainShape | undefined;
  const nonTaskKinds: readonly ReminderKindLiteral[] = ['guide', 'practice', 'consult'];
  const requiresExplain = kind ? nonTaskKinds.includes(kind) : false;

  if (requiresExplain && (explain == null || typeof explain !== 'object')) {
    issues.push(
      `Rule ${rule.ruleId} is kind '${kind}' and must carry an explain object (PO-REMI-006)`,
    );
    return issues;
  }

  if (explain == null) {
    return issues;
  }

  if (typeof explain !== 'object') {
    issues.push(`Rule ${rule.ruleId} explain must be an object`);
    return issues;
  }

  if (!isNonEmptyString(explain.whyNow)) {
    issues.push(`Rule ${rule.ruleId} explain.whyNow must be a non-empty string (PO-REMI-006)`);
  }

  if (!Array.isArray(explain.howTo)) {
    issues.push(`Rule ${rule.ruleId} explain.howTo must be an array of 3-6 strings (PO-REMI-006)`);
  } else {
    const howTo = explain.howTo;
    if (howTo.length < 3 || howTo.length > 6) {
      issues.push(
        `Rule ${rule.ruleId} explain.howTo must contain 3-6 items; got ${howTo.length}`,
      );
    }
    howTo.forEach((step, index) => {
      if (!isNonEmptyString(step)) {
        issues.push(`Rule ${rule.ruleId} explain.howTo[${index}] must be a non-empty string`);
      }
    });
  }

  if (!isNonEmptyString(explain.doneWhen)) {
    issues.push(`Rule ${rule.ruleId} explain.doneWhen must be a non-empty string (PO-REMI-006)`);
  }

  if (explain.ifNotNow !== undefined && !isNonEmptyString(explain.ifNotNow)) {
    issues.push(`Rule ${rule.ruleId} explain.ifNotNow must be a non-empty string when present`);
  }

  if (explain.pitfalls !== undefined) {
    if (!Array.isArray(explain.pitfalls)) {
      issues.push(`Rule ${rule.ruleId} explain.pitfalls must be an array when present`);
    } else {
      explain.pitfalls.forEach((item, index) => {
        if (!isNonEmptyString(item)) {
          issues.push(`Rule ${rule.ruleId} explain.pitfalls[${index}] must be a non-empty string`);
        }
      });
    }
  }

  if (!Array.isArray(explain.sources) || explain.sources.length === 0) {
    issues.push(`Rule ${rule.ruleId} explain.sources must be a non-empty array (PO-REMI-006)`);
  } else {
    explain.sources.forEach((raw, index) => {
      if (typeof raw !== 'object' || raw == null) {
        issues.push(`Rule ${rule.ruleId} explain.sources[${index}] must be an object`);
        return;
      }
      const source = raw as { citation?: unknown; url?: unknown };
      if (!isNonEmptyString(source.citation)) {
        issues.push(
          `Rule ${rule.ruleId} explain.sources[${index}].citation must be a non-empty string`,
        );
      }
      if (source.url !== undefined && !isNonEmptyString(source.url)) {
        issues.push(`Rule ${rule.ruleId} explain.sources[${index}].url must be a non-empty string when present`);
      }
    });
  }

  return issues;
}

/**
 * PO-REMI-006: the legacy top-level `source` field is retired. All citations
 * must live in `explain.sources[]`. Presence of a flat `source` on any rule is
 * a failed-migration signal.
 */
export function validateReminderSourceRetired(rule: ReminderRuleValidationShape) {
  if (rule.source !== undefined) {
    return [
      `Rule ${rule.ruleId} carries a retired top-level 'source' field; move citation metadata into explain.sources[] (PO-REMI-006)`,
    ];
  }
  return [];
}

export function validateMilestoneThreshold(milestone: MilestoneValidationShape) {
  if (milestone.alertIfNotBy != null && milestone.alertIfNotBy <= milestone.typicalAge.rangeEnd) {
    return [
      `Milestone ${milestone.milestoneId} has alertIfNotBy <= typicalAge.rangeEnd (alertIfNotBy=${milestone.alertIfNotBy}, rangeEnd=${milestone.typicalAge.rangeEnd})`,
    ];
  }

  return [];
}

export function validateSensitivePeriod(period: SensitivePeriodValidationShape) {
  const { startMonths, peakMonths, endMonths } = period.ageRange;
  if (!(startMonths < peakMonths && peakMonths < endMonths)) {
    return [
      `Sensitive period ${period.periodId} must satisfy startMonths < peakMonths < endMonths`,
    ];
  }

  return [];
}

export function validateKnowledgeSource(
  source: KnowledgeSourceValidationShape,
  seenDomains: Set<string>,
) {
  const issues: string[] = [];

  if (seenDomains.has(source.domain)) {
    issues.push(`Duplicate knowledge-source domain: ${source.domain}`);
  }

  if (source.status === 'reviewed' && !isIsoDate(source.lastReviewedAt)) {
    issues.push(`Reviewed domain ${source.domain} must have a valid lastReviewedAt`);
  }

  seenDomains.add(source.domain);
  return issues;
}
