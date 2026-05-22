import { describe, expect, it } from 'vitest';

import {
  buildHealthRecordSnapshot,
  calculateBmi,
  recomputeDerivedHealthRecordValues,
  type HealthRecordEvent,
  type HealthRecordValue,
} from './health-record-domain.js';
import { HEALTH_METRICS } from '../knowledge-base/index.js';

const event: HealthRecordEvent = {
  eventId: 'evt-1',
  childId: 'child-1',
  protocolId: 'growth-child-quarterly',
  groupId: 'growth',
  recordKind: 'manual',
  sourceSurface: 'profile_detail',
  recordedAt: '2026-01-01T09:00:00.000Z',
  effectiveDate: '2026-01-01',
  ageMonths: 24,
  createdAt: '2026-01-01T09:00:00.000Z',
  updatedAt: '2026-01-01T09:00:00.000Z',
};

function value(overrides: Partial<HealthRecordValue> & Pick<HealthRecordValue, 'valueId' | 'metricId'>): HealthRecordValue {
  return {
    eventId: 'evt-1',
    childId: 'child-1',
    recordKind: 'measured',
    createdAt: '2026-01-01T09:00:00.000Z',
    ...overrides,
  };
}

describe('health-record-domain', () => {
  it('derives BMI from height and weight and removes it when a source disappears', () => {
    const height = value({
      valueId: 'height-1',
      metricId: 'growth.height',
      valueNumber: 100,
      unit: 'cm',
    });
    const weight = value({
      valueId: 'weight-1',
      metricId: 'growth.weight',
      valueNumber: 16,
      unit: 'kg',
    });

    const withDerived = recomputeDerivedHealthRecordValues([event], [height, weight], {
      nowIso: '2026-01-01T09:01:00.000Z',
      makeValueId: (_event, metricId, sourceValueIds) => `${metricId}:${sourceValueIds.join('+')}`,
    });
    const bmi = withDerived.find((item) => item.metricId === 'growth.bmi');
    expect(bmi?.valueNumber).toBe(16);
    expect(bmi?.recordKind).toBe('derived');
    expect(bmi?.sourceValueIds).toBe(JSON.stringify(['height-1', 'weight-1']));

    const withoutWeight = recomputeDerivedHealthRecordValues([event], [height], {
      nowIso: '2026-01-01T09:02:00.000Z',
      makeValueId: (_event, metricId, sourceValueIds) => `${metricId}:${sourceValueIds.join('+')}`,
    });
    expect(withoutWeight.some((item) => item.metricId === 'growth.bmi')).toBe(false);
  });

  it('recomputes BMI when a source value changes', () => {
    expect(calculateBmi(120, 20)).toBe(13.9);
    expect(calculateBmi(120, 24)).toBe(16.7);
  });

  it('builds a snapshot with generated metric authority and freshness', () => {
    const snapshot = buildHealthRecordSnapshot({
      childId: 'child-1',
      ageMonths: 24,
      events: [event],
      values: [
        value({
          valueId: 'height-1',
          metricId: 'growth.height',
          valueNumber: 100,
          unit: 'cm',
        }),
        value({
          valueId: 'weight-1',
          metricId: 'growth.weight',
          valueNumber: 16,
          unit: 'kg',
        }),
      ],
      nowIso: '2026-01-20T00:00:00.000Z',
    });

    const growth = snapshot.groups.find((group) => group.group.groupId === 'growth');
    const height = growth?.metrics.find((item) => item.metric.metricId === 'growth.height');
    const bmi = growth?.metrics.find((item) => item.metric.metricId === 'growth.bmi');
    // growth.age-cadence is a uniform monthly cadence: 2026-01-01 + 1 month.
    expect(height?.nextRecordAt).toBe('2026-02-01');
    expect(height?.freshness).toBe('fresh');
    expect(bmi?.latestValue?.valueNumber).toBe(16);
    expect(bmi?.latestValue?.recordKind).toBe('derived');
  });

  it('uses effective date rather than insert time when selecting the latest metric value', () => {
    const olderEventInsertedLater: HealthRecordEvent = {
      ...event,
      eventId: 'evt-older',
      effectiveDate: '2026-01-01',
      createdAt: '2026-04-01T09:00:00.000Z',
      updatedAt: '2026-04-01T09:00:00.000Z',
    };
    const newerEventInsertedEarlier: HealthRecordEvent = {
      ...event,
      eventId: 'evt-newer',
      effectiveDate: '2026-03-01',
      createdAt: '2026-03-01T09:00:00.000Z',
      updatedAt: '2026-03-01T09:00:00.000Z',
    };

    const snapshot = buildHealthRecordSnapshot({
      childId: 'child-1',
      ageMonths: 24,
      events: [olderEventInsertedLater, newerEventInsertedEarlier],
      values: [
        value({
          valueId: 'height-older',
          eventId: 'evt-older',
          metricId: 'growth.height',
          valueNumber: 100,
          createdAt: '2026-04-01T09:00:00.000Z',
        }),
        value({
          valueId: 'height-newer',
          eventId: 'evt-newer',
          metricId: 'growth.height',
          valueNumber: 105,
          createdAt: '2026-03-01T09:00:00.000Z',
        }),
      ],
      nowIso: '2026-04-15T00:00:00.000Z',
    });

    const height = snapshot.groups
      .find((group) => group.group.groupId === 'growth')
      ?.metrics.find((item) => item.metric.metricId === 'growth.height');
    expect(height?.latestValue?.valueId).toBe('height-newer');
    expect(height?.latestEvent?.effectiveDate).toBe('2026-03-01');
  });

  it('marks growth metrics within the P3-P97 percentile band as on_track when sex is provided', () => {
    const snapshot = buildHealthRecordSnapshot({
      childId: 'child-1',
      ageMonths: 24,
      events: [event],
      values: [
        value({
          valueId: 'height-1',
          metricId: 'growth.height',
          valueNumber: 88,
          unit: 'cm',
        }),
      ],
      nowIso: '2026-01-20T00:00:00.000Z',
      sex: 'male',
    });
    const height = snapshot.groups
      .find((group) => group.group.groupId === 'growth')
      ?.metrics.find((item) => item.metric.metricId === 'growth.height');
    expect(height?.evaluation.status).toBe('on_track');
    expect(height?.evaluation.statusReasonCode).toBe('within_percentile_band');
    expect(height?.evaluation.colorAlias).toBe('green');
    expect(height?.evaluation.inputs).toMatchObject({ sex: 'male', value: 88 });
  });

  it('marks growth metrics outside P3-P97 as professional_review_prompt', () => {
    const snapshot = buildHealthRecordSnapshot({
      childId: 'child-1',
      ageMonths: 24,
      events: [event],
      values: [
        value({
          valueId: 'height-1',
          metricId: 'growth.height',
          valueNumber: 70,
          unit: 'cm',
        }),
      ],
      nowIso: '2026-01-20T00:00:00.000Z',
      sex: 'male',
    });
    const height = snapshot.groups
      .find((group) => group.group.groupId === 'growth')
      ?.metrics.find((item) => item.metric.metricId === 'growth.height');
    expect(height?.evaluation.status).toBe('professional_review_prompt');
    expect(height?.evaluation.statusReasonCode).toBe('outside_percentile_band');
    expect(height?.evaluation.colorAlias).toBe('red');
    expect(height?.evaluation.safetyBoundary).toBe('professional_review_prompt');
  });

  it('returns unrated for growth metrics when sex is not provided', () => {
    const snapshot = buildHealthRecordSnapshot({
      childId: 'child-1',
      ageMonths: 24,
      events: [event],
      values: [
        value({
          valueId: 'height-1',
          metricId: 'growth.height',
          valueNumber: 88,
          unit: 'cm',
        }),
      ],
      nowIso: '2026-01-20T00:00:00.000Z',
    });
    const height = snapshot.groups
      .find((group) => group.group.groupId === 'growth')
      ?.metrics.find((item) => item.metric.metricId === 'growth.height');
    expect(height?.evaluation.status).toBe('unrated');
    expect(height?.evaluation.statusReasonCode).toBe('sex_required');
  });

  it('returns unrated for growth metrics when age is outside reference coverage', () => {
    const oldEvent: HealthRecordEvent = { ...event, eventId: 'evt-old', ageMonths: 240 };
    const snapshot = buildHealthRecordSnapshot({
      childId: 'child-1',
      ageMonths: 240,
      events: [oldEvent],
      values: [
        {
          valueId: 'height-old',
          eventId: 'evt-old',
          childId: 'child-1',
          metricId: 'growth.height',
          valueNumber: 175,
          unit: 'cm',
          recordKind: 'measured',
          createdAt: '2026-01-01T09:00:00.000Z',
        },
      ],
      nowIso: '2026-01-20T00:00:00.000Z',
      sex: 'male',
    });
    const height = snapshot.groups
      .find((group) => group.group.groupId === 'growth')
      ?.metrics.find((item) => item.metric.metricId === 'growth.height');
    expect(height?.evaluation.status).toBe('unrated');
    expect(height?.evaluation.statusReasonCode).toBe('reference_data_unavailable_for_age');
  });

  it('fails closed when a metric references an unresolved evaluation policy', () => {
    const heightMetric = HEALTH_METRICS.find((metric) => metric.metricId === 'growth.height') as
      | (typeof HEALTH_METRICS)[number]
      | undefined;
    expect(heightMetric).toBeTruthy();
    const mutableMetric = heightMetric as { evaluationPolicyRef?: string };
    const originalPolicyRef = mutableMetric.evaluationPolicyRef;
    mutableMetric.evaluationPolicyRef = 'missing.policy';
    try {
      const snapshot = buildHealthRecordSnapshot({
        childId: 'child-1',
        ageMonths: 24,
        events: [event],
        values: [
          value({
            valueId: 'height-1',
            metricId: 'growth.height',
            valueNumber: 88,
            unit: 'cm',
          }),
        ],
        nowIso: '2026-01-20T00:00:00.000Z',
        sex: 'male',
      });
      const height = snapshot.groups
        .find((group) => group.group.groupId === 'growth')
        ?.metrics.find((item) => item.metric.metricId === 'growth.height');
      expect(height?.evaluation.status).toBe('error');
      expect(height?.evaluation.statusReasonCode).toBe('unresolved_evaluation_policy');
    } finally {
      mutableMetric.evaluationPolicyRef = originalPolicyRef;
    }
  });

  it('fails closed when a metric references an unresolved freshness policy', () => {
    const heightMetric = HEALTH_METRICS.find((metric) => metric.metricId === 'growth.height') as
      | (typeof HEALTH_METRICS)[number]
      | undefined;
    expect(heightMetric).toBeTruthy();
    const mutableMetric = heightMetric as { freshnessPolicyRef?: string };
    const originalFreshnessRef = mutableMetric.freshnessPolicyRef;
    mutableMetric.freshnessPolicyRef = 'missing.freshness-policy';
    try {
      const snapshot = buildHealthRecordSnapshot({
        childId: 'child-1',
        ageMonths: 24,
        events: [event],
        values: [
          value({
            valueId: 'height-1',
            metricId: 'growth.height',
            valueNumber: 88,
            unit: 'cm',
          }),
        ],
        nowIso: '2026-01-20T00:00:00.000Z',
        sex: 'male',
      });
      const height = snapshot.groups
        .find((group) => group.group.groupId === 'growth')
        ?.metrics.find((item) => item.metric.metricId === 'growth.height');
      expect(height?.freshness).toBe('error');
      expect(height?.nextRecordAt).toBeNull();
      expect(height?.evaluation.status).toBe('error');
      expect(height?.evaluation.statusReasonCode).toBe('unresolved_freshness_policy');
    } finally {
      mutableMetric.freshnessPolicyRef = originalFreshnessRef;
    }
  });

  it('evaluates derived BMI against the bmi percentile band', () => {
    const snapshot = buildHealthRecordSnapshot({
      childId: 'child-1',
      ageMonths: 24,
      events: [event],
      values: [
        value({ valueId: 'height-1', metricId: 'growth.height', valueNumber: 88, unit: 'cm' }),
        value({ valueId: 'weight-1', metricId: 'growth.weight', valueNumber: 13, unit: 'kg' }),
      ],
      nowIso: '2026-01-20T00:00:00.000Z',
      sex: 'male',
    });
    const bmi = snapshot.groups
      .find((group) => group.group.groupId === 'growth')
      ?.metrics.find((item) => item.metric.metricId === 'growth.bmi');
    expect(bmi?.evaluation.status).toBe('on_track');
    expect(bmi?.evaluation.statusReasonCode).toBe('within_percentile_band');
  });

  it('evaluates metrics with machine-readable reference ranges from data assets', () => {
    const visionEvent: HealthRecordEvent = {
      ...event,
      eventId: 'evt-vision',
      protocolId: 'vision-basic',
      groupId: 'vision',
      effectiveDate: '2026-01-01',
      ageMonths: 72,
    };
    const snapshot = buildHealthRecordSnapshot({
      childId: 'child-1',
      ageMonths: 72,
      events: [visionEvent],
      values: [
        {
          valueId: 'vision-left-1',
          eventId: 'evt-vision',
          childId: 'child-1',
          metricId: 'vision.left_visual_acuity',
          valueNumber: 0.5,
          unit: 'decimal',
          recordKind: 'measured',
          createdAt: '2026-01-01T09:00:00.000Z',
        },
      ],
      nowIso: '2026-02-01T00:00:00.000Z',
    });

    const vision = snapshot.groups.find((group) => group.group.groupId === 'vision');
    const left = vision?.metrics.find((item) => item.metric.metricId === 'vision.left_visual_acuity');
    expect(left?.evaluation.status).toBe('watch');
    expect(left?.evaluation.statusReasonCode).toBe('outside_reference_range');
    expect(left?.evaluation.inputs).toMatchObject({ normalMin: 1, normalMax: 1.5 });
  });

  it('evaluates dental and medical event payload review markers', () => {
    const dentalEvent: HealthRecordEvent = {
      ...event,
      eventId: 'evt-dental',
      protocolId: 'dental-event',
      groupId: 'dental',
      effectiveDate: '2026-01-02',
    };
    const medicalEvent: HealthRecordEvent = {
      ...event,
      eventId: 'evt-medical',
      protocolId: 'medical-event',
      groupId: 'medical',
      effectiveDate: '2026-01-03',
    };
    const snapshot = buildHealthRecordSnapshot({
      childId: 'child-1',
      ageMonths: 24,
      events: [dentalEvent, medicalEvent],
      values: [
        {
          valueId: 'dental-1',
          eventId: 'evt-dental',
          childId: 'child-1',
          metricId: 'dental.event',
          valueJson: JSON.stringify({ eventType: 'ortho-issue', severity: 'severe' }),
          recordKind: 'measured',
          createdAt: '2026-01-02T09:00:00.000Z',
        },
        {
          valueId: 'medical-1',
          eventId: 'evt-medical',
          childId: 'child-1',
          metricId: 'medical.event',
          valueJson: JSON.stringify({ eventType: 'checkup', result: 'refer' }),
          recordKind: 'measured',
          createdAt: '2026-01-03T09:00:00.000Z',
        },
      ],
      nowIso: '2026-02-01T00:00:00.000Z',
    });

    const dental = snapshot.groups
      .find((group) => group.group.groupId === 'dental')
      ?.metrics.find((item) => item.metric.metricId === 'dental.event');
    const medical = snapshot.groups
      .find((group) => group.group.groupId === 'medical')
      ?.metrics.find((item) => item.metric.metricId === 'medical.event');
    expect(dental?.evaluation.status).toBe('professional_review_prompt');
    expect(dental?.evaluation.statusReasonCode).toBe('dental_payload_review_marker');
    expect(medical?.evaluation.status).toBe('professional_review_prompt');
    expect(medical?.evaluation.statusReasonCode).toBe('medical_payload_review_marker');
  });
});
