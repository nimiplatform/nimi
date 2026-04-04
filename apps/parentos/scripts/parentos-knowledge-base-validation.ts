export interface ReminderRuleValidationShape {
  ruleId: string;
  category: string;
  triggerAge: {
    startMonths: number;
    endMonths: number;
  };
  triggerCondition?: unknown;
}

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
