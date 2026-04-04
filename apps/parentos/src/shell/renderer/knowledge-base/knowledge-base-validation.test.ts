import { describe, expect, it } from 'vitest';
import {
  validateKnowledgeSource,
  validateMilestoneThreshold,
  validateReminderRule,
  validateSensitivePeriod,
} from '../../../../scripts/parentos-knowledge-base-validation.js';

describe('knowledge-base validation helpers', () => {
  it('rejects personalized reminder rules without trigger conditions', () => {
    expect(
      validateReminderRule({
        ruleId: 'PO-REM-CUS-001',
        category: 'personalized',
        triggerAge: { startMonths: 3, endMonths: 6 },
      }),
    ).toContain('Rule PO-REM-CUS-001 is personalized but missing triggerCondition');
  });

  it('rejects milestone thresholds that do not exceed rangeEnd', () => {
    expect(
      validateMilestoneThreshold({
        milestoneId: 'PO-MS-LANG-004',
        typicalAge: { rangeEnd: 24 },
        alertIfNotBy: 24,
      }),
    ).toContain(
      'Milestone PO-MS-LANG-004 has alertIfNotBy <= typicalAge.rangeEnd (alertIfNotBy=24, rangeEnd=24)',
    );
  });

  it('rejects invalid sensitive period ordering', () => {
    expect(
      validateSensitivePeriod({
        periodId: 'PO-SP-LANG-001',
        ageRange: { startMonths: 8, peakMonths: 8, endMonths: 14 },
      }),
    ).toContain(
      'Sensitive period PO-SP-LANG-001 must satisfy startMonths < peakMonths < endMonths',
    );
  });

  it('requires reviewed domains to carry lastReviewedAt', () => {
    const seenDomains = new Set<string>();
    expect(
      validateKnowledgeSource(
        {
          domain: 'sleep',
          status: 'reviewed',
          lastReviewedAt: null,
        },
        seenDomains,
      ),
    ).toContain('Reviewed domain sleep must have a valid lastReviewedAt');
  });
});
