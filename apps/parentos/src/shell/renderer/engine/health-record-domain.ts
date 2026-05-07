import {
  HEALTH_CAPTURE_PROTOCOLS,
  HEALTH_EVALUATION_POLICIES,
  HEALTH_METRICS,
  HEALTH_METRIC_GROUPS,
  HEALTH_STATUS_TAXONOMY,
  REFERENCE_RANGES,
  type HealthCaptureProtocol,
  type HealthEvaluationPolicy,
  type HealthEvaluationStatus,
  type HealthMetricDefinition,
  type HealthMetricGroup,
  type HealthMetricId,
  type HealthStatusColorAlias,
} from '../knowledge-base/index.js';
import {
  getGrowthPercentileBand,
  type GrowthPercentileSex,
  type GrowthPercentileStandard,
  type GrowthPercentileTypeId,
} from './growth-percentile-band.js';

export type HealthRecordEventKind = 'manual' | 'imported' | 'ocr_confirmed' | 'reminder_linked' | 'derived';
export type HealthRecordValueKind = 'measured' | 'derived' | 'parent_confirmed_import';

export interface HealthRecordEvent {
  eventId: string;
  childId: string;
  protocolId: string;
  groupId: string;
  recordKind: HealthRecordEventKind;
  sourceSurface: 'profile_console' | 'profile_detail' | 'reminder' | 'ocr_tool' | 'import';
  recordedAt: string;
  effectiveDate: string;
  ageMonths: number;
  recorderId?: string | null;
  linkedReminderStateId?: string | null;
  linkedReminderRuleId?: string | null;
  notes?: string | null;
  metadataJson?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HealthRecordValue {
  valueId: string;
  eventId: string;
  childId: string;
  metricId: HealthMetricId;
  valueNumber?: number | null;
  valueText?: string | null;
  valueJson?: string | null;
  unit?: string | null;
  qualifier?: string | null;
  recordKind: HealthRecordValueKind;
  sourceValueIds?: string | null;
  createdAt: string;
}

export interface HealthEvaluation {
  status: HealthEvaluationStatus;
  colorAlias: HealthStatusColorAlias;
  statusReasonCode: string;
  shortLabel: string;
  explanation: string;
  sourceRefs: readonly string[];
  computedAt: string;
  inputs: Record<string, unknown>;
  safetyBoundary: 'descriptive_only' | 'professional_review_prompt' | 'not_evaluated';
}

export interface HealthMetricSnapshot {
  metric: HealthMetricDefinition;
  latestValue: HealthRecordValue | null;
  latestEvent: HealthRecordEvent | null;
  nextRecordAt: string | null;
  freshness: 'missing' | 'fresh' | 'stale' | 'unscheduled';
  evaluation: HealthEvaluation;
}

export interface HealthGroupSnapshot {
  group: HealthMetricGroup;
  metrics: readonly HealthMetricSnapshot[];
}

export interface HealthRecordSnapshot {
  childId: string;
  ageMonths: number;
  computedAt: string;
  groups: readonly HealthGroupSnapshot[];
}

export interface RecomputeDerivedValuesOptions {
  nowIso: string;
  makeValueId: (event: HealthRecordEvent, metricId: HealthMetricId, sourceValueIds: readonly string[]) => string;
}

const metricById = new Map(HEALTH_METRICS.map((metric) => [metric.metricId, metric]));
const protocolById = new Map<string, HealthCaptureProtocol>(
  HEALTH_CAPTURE_PROTOCOLS.map((protocol) => [protocol.protocolId, protocol]),
);
const policyById = new Map(HEALTH_EVALUATION_POLICIES.map((policy) => [policy.policyId, policy]));
const statusColorByStatus = new Map(
  HEALTH_STATUS_TAXONOMY.map((entry) => [entry.status, entry.colorAlias]),
);

export function getHealthMetricDefinition(metricId: HealthMetricId): HealthMetricDefinition {
  const metric = metricById.get(metricId);
  if (!metric) {
    throw new Error(`Unknown health metric id: ${metricId}`);
  }
  return metric;
}

export function getHealthCaptureProtocol(protocolId: string): HealthCaptureProtocol {
  const protocol = protocolById.get(protocolId);
  if (!protocol) {
    throw new Error(`Unknown health capture protocol id: ${protocolId}`);
  }
  return protocol;
}

export function recomputeDerivedHealthRecordValues(
  events: readonly HealthRecordEvent[],
  values: readonly HealthRecordValue[],
  options: RecomputeDerivedValuesOptions,
): HealthRecordValue[] {
  const nonDerived = values.filter((value) => value.recordKind !== 'derived');
  const existingDerivedByEventMetric = new Map(
    values
      .filter((value) => value.recordKind === 'derived')
      .map((value) => [`${value.eventId}:${value.metricId}`, value]),
  );
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  const valuesByEvent = groupValuesByEvent(nonDerived);
  const derived: HealthRecordValue[] = [];

  for (const event of events) {
    const protocol = protocolById.get(event.protocolId);
    if (!protocol?.derivedMetricIds?.includes('growth.bmi')) {
      continue;
    }

    const eventValues = valuesByEvent.get(event.eventId) ?? [];
    const height = latestNumberForMetric(eventValues, 'growth.height');
    const weight = latestNumberForMetric(eventValues, 'growth.weight');
    if (!height || !weight || height.valueNumber == null || weight.valueNumber == null) {
      continue;
    }

    const bmi = calculateBmi(height.valueNumber, weight.valueNumber);
    const sourceValueIds = [height.valueId, weight.valueId].sort();
    const sourceValueIdsJson = JSON.stringify(sourceValueIds);
    const existing = existingDerivedByEventMetric.get(`${event.eventId}:growth.bmi`);
    const bmiMetric = getHealthMetricDefinition('growth.bmi');
    derived.push({
      valueId:
        existing?.sourceValueIds === sourceValueIdsJson
          ? existing.valueId
          : options.makeValueId(event, 'growth.bmi', sourceValueIds),
      eventId: event.eventId,
      childId: event.childId,
      metricId: 'growth.bmi',
      valueNumber: bmi,
      unit: bmiMetric.unit ?? null,
      recordKind: 'derived',
      sourceValueIds: sourceValueIdsJson,
      createdAt: existing?.sourceValueIds === sourceValueIdsJson ? existing.createdAt : options.nowIso,
    });
  }

  for (const value of nonDerived) {
    if (!eventById.has(value.eventId)) {
      throw new Error(`Health record value ${value.valueId} references unknown event ${value.eventId}`);
    }
  }

  return [...nonDerived, ...derived].sort(compareValuesForProjection);
}

export function buildHealthRecordSnapshot(input: {
  childId: string;
  ageMonths: number;
  events: readonly HealthRecordEvent[];
  values: readonly HealthRecordValue[];
  nowIso: string;
  sex?: GrowthPercentileSex;
  growthStandard?: GrowthPercentileStandard;
}): HealthRecordSnapshot {
  const events = input.events.filter((event) => event.childId === input.childId);
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  const values = recomputeDerivedHealthRecordValues(
    events,
    input.values.filter((value) => value.childId === input.childId),
    {
      nowIso: input.nowIso,
      makeValueId: (event, metricId, sourceValueIds) =>
        `${event.eventId}:${metricId}:${sourceValueIds.join('+')}`,
    },
  );

  const latestByMetric = new Map<HealthMetricId, HealthRecordValue>();
  for (const value of values) {
    const current = latestByMetric.get(value.metricId);
    if (!current || compareValuesByEventRecency(value, current, eventById) > 0) {
      latestByMetric.set(value.metricId, value);
    }
  }

  const groups = [...HEALTH_METRIC_GROUPS]
    .sort((left, right) => left.rank - right.rank)
    .map((group) => ({
      group,
      metrics: HEALTH_METRICS
        .filter((metric) => metric.groupId === group.groupId)
        .filter((metric) => metricAppliesToChild(metric, input.ageMonths, input.sex))
        .map((metric) => {
        const latestValue = latestByMetric.get(metric.metricId) ?? null;
        const latestEvent = latestValue ? eventById.get(latestValue.eventId) ?? null : null;
        const nextRecordAt = latestEvent
          ? computeNextRecordAt(metric.freshnessPolicyRef, latestEvent.effectiveDate, input.ageMonths)
          : null;
        const freshness = computeFreshness(latestValue, nextRecordAt, metric.freshnessPolicyRef, input.nowIso);
        const policy = metric.evaluationPolicyRef ? policyById.get(metric.evaluationPolicyRef) : undefined;
        const evaluation = evaluateMetric({
          metric,
          policy,
          latestValue,
          latestEvent,
          freshness,
          nowIso: input.nowIso,
          sex: input.sex,
          growthStandard: input.growthStandard,
        });
        return { metric, latestValue, latestEvent, nextRecordAt, freshness, evaluation };
      }),
    }));

  return {
    childId: input.childId,
    ageMonths: input.ageMonths,
    computedAt: input.nowIso,
    groups,
  };
}

export function calculateBmi(heightCm: number, weightKg: number): number {
  if (heightCm <= 0 || weightKg <= 0) {
    throw new Error('BMI derivation requires positive height and weight source values');
  }
  const meters = heightCm / 100;
  return roundTo(weightKg / (meters * meters), 1);
}

function metricAppliesToChild(
  metric: HealthMetricDefinition,
  ageMonths: number,
  sex: GrowthPercentileSex | undefined,
): boolean {
  const range = metric.applicableAgeRange;
  if (range && (ageMonths < range.startMonths || ageMonths > range.endMonths)) {
    return false;
  }
  const applicableSex = metric.applicableSex;
  if (applicableSex && applicableSex !== 'both' && sex && applicableSex !== sex) {
    return false;
  }
  return true;
}

function groupValuesByEvent(values: readonly HealthRecordValue[]) {
  const grouped = new Map<string, HealthRecordValue[]>();
  for (const value of values) {
    const bucket = grouped.get(value.eventId) ?? [];
    bucket.push(value);
    grouped.set(value.eventId, bucket);
  }
  return grouped;
}

function latestNumberForMetric(values: readonly HealthRecordValue[], metricId: HealthMetricId) {
  return values
    .filter((value) => value.metricId === metricId && typeof value.valueNumber === 'number')
    .sort(compareValuesForProjection)
    .at(-1);
}

function compareValuesForProjection(left: HealthRecordValue, right: HealthRecordValue) {
  const created = left.createdAt.localeCompare(right.createdAt);
  if (created !== 0) return created;
  return left.valueId.localeCompare(right.valueId);
}

function compareValuesByEventRecency(
  left: HealthRecordValue,
  right: HealthRecordValue,
  eventById: ReadonlyMap<string, HealthRecordEvent>,
) {
  const leftEvent = eventById.get(left.eventId);
  const rightEvent = eventById.get(right.eventId);
  const effectiveDate = (leftEvent?.effectiveDate ?? '').localeCompare(rightEvent?.effectiveDate ?? '');
  if (effectiveDate !== 0) return effectiveDate;
  return compareValuesForProjection(left, right);
}

function evaluateMetric(input: {
  metric: HealthMetricDefinition;
  policy?: HealthEvaluationPolicy;
  latestValue: HealthRecordValue | null;
  latestEvent: HealthRecordEvent | null;
  freshness: HealthMetricSnapshot['freshness'];
  nowIso: string;
  sex?: GrowthPercentileSex;
  growthStandard?: GrowthPercentileStandard;
}): HealthEvaluation {
  if (!input.latestValue || !input.latestEvent) {
    return evaluation({
      status: 'missing',
      reason: 'missing_latest_record',
      label: 'Missing',
      explanation: 'No admitted latest record exists for this metric.',
      policy: input.policy,
      metric: input.metric,
      nowIso: input.nowIso,
      inputs: {},
    });
  }
  const latestValue = input.latestValue;
  const latestEvent = input.latestEvent;

  if (input.freshness === 'stale') {
    return evaluation({
      status: 'watch',
      reason: 'latest_record_stale',
      label: 'Update due',
      explanation: 'The latest record is older than the admitted freshness cadence.',
      policy: input.policy,
      metric: input.metric,
      nowIso: input.nowIso,
      inputs: { valueId: latestValue.valueId, eventId: latestEvent.eventId },
    });
  }

  if (!input.policy) {
    return evaluation({
      status: 'unrated',
      reason: 'no_evaluation_policy',
      label: 'Recorded',
      explanation: 'The metric has a latest record but no admitted evaluation policy.',
      policy: input.policy,
      metric: input.metric,
      nowIso: input.nowIso,
      inputs: { valueId: latestValue.valueId, eventId: latestEvent.eventId },
    });
  }

  const policy = input.policy;
  const percentileEvaluation = evaluateGrowthPercentilePolicy({
    metric: input.metric,
    policy,
    latestValue,
    latestEvent,
    nowIso: input.nowIso,
    sex: input.sex,
    growthStandard: input.growthStandard,
  });
  if (percentileEvaluation) {
    return percentileEvaluation;
  }
  const referenceRangeEvaluation = evaluateReferenceRangePolicy({
    metric: input.metric,
    policy,
    latestValue,
    latestEvent,
    nowIso: input.nowIso,
  });
  if (referenceRangeEvaluation) {
    return referenceRangeEvaluation;
  }

  const eventPayloadEvaluation = evaluateEventPayloadPolicy({
    metric: input.metric,
    policy,
    latestValue,
    latestEvent,
    nowIso: input.nowIso,
  });
  if (eventPayloadEvaluation) {
    return eventPayloadEvaluation;
  }

  if (isPresencePolicy(policy.policyId)) {
    return evaluation({
      status: 'on_track',
      reason: 'record_presence_satisfies_policy',
      label: 'Recorded',
      explanation: 'A latest admitted record exists for this presence/completion policy.',
      policy,
      metric: input.metric,
      nowIso: input.nowIso,
      inputs: { valueId: latestValue.valueId, eventId: latestEvent.eventId },
    });
  }

  return evaluation({
    status: 'unrated',
    reason: 'reference_evaluator_not_available',
    label: 'Recorded',
    explanation:
      'A latest record exists, but this policy requires a reference evaluator before status can be scored.',
    policy,
    metric: input.metric,
    nowIso: input.nowIso,
    inputs: { valueId: latestValue.valueId, eventId: latestEvent.eventId },
  });
}

const PERCENTILE_TYPE_ID_BY_METRIC: Partial<Record<HealthMetricId, GrowthPercentileTypeId>> = {
  'growth.height': 'height',
  'growth.weight': 'weight',
  'growth.head_circumference': 'head-circumference',
  'growth.bmi': 'bmi',
};

function isPercentilePolicy(policyId: string) {
  return policyId === 'growth.percentile-band' || policyId === 'growth.bmi-percentile-band';
}

function evaluateGrowthPercentilePolicy(input: {
  metric: HealthMetricDefinition;
  policy: HealthEvaluationPolicy;
  latestValue: HealthRecordValue;
  latestEvent: HealthRecordEvent;
  nowIso: string;
  sex?: GrowthPercentileSex;
  growthStandard?: GrowthPercentileStandard;
}): HealthEvaluation | null {
  if (!isPercentilePolicy(input.policy.policyId)) {
    return null;
  }
  const typeId = PERCENTILE_TYPE_ID_BY_METRIC[input.metric.metricId];
  if (!typeId) return null;

  const baseInputs = {
    valueId: input.latestValue.valueId,
    eventId: input.latestEvent.eventId,
    ageMonths: input.latestEvent.ageMonths,
  };

  if (typeof input.latestValue.valueNumber !== 'number') {
    return evaluation({
      status: 'unrated',
      reason: 'numeric_value_required',
      label: 'Recorded',
      explanation: 'This evaluation policy requires a numeric value.',
      policy: input.policy,
      metric: input.metric,
      nowIso: input.nowIso,
      inputs: baseInputs,
    });
  }
  if (!input.sex) {
    return evaluation({
      status: 'unrated',
      reason: 'sex_required',
      label: 'Recorded',
      explanation: 'Percentile evaluation requires the child sex to select the reference dataset.',
      policy: input.policy,
      metric: input.metric,
      nowIso: input.nowIso,
      inputs: baseInputs,
    });
  }

  const band = getGrowthPercentileBand({
    typeId,
    sex: input.sex,
    ageMonths: input.latestEvent.ageMonths,
    standard: input.growthStandard,
  });
  if (!band) {
    return evaluation({
      status: 'unrated',
      reason: 'reference_data_unavailable_for_age',
      label: 'Recorded',
      explanation: 'No admitted percentile reference is available for this age and sex.',
      policy: input.policy,
      metric: input.metric,
      nowIso: input.nowIso,
      inputs: { ...baseInputs, sex: input.sex },
    });
  }

  const value = input.latestValue.valueNumber;
  const outside = value < band.p3 || value > band.p97;
  const status: HealthEvaluationStatus = outside ? 'professional_review_prompt' : 'on_track';
  return evaluation({
    status,
    reason: outside ? 'outside_percentile_band' : 'within_percentile_band',
    label: outside ? 'Review' : 'On track',
    explanation: outside
      ? 'The latest value is outside the admitted P3-P97 reference band for this age and sex.'
      : 'The latest value is within the admitted P3-P97 reference band for this age and sex.',
    policy: input.policy,
    metric: input.metric,
    nowIso: input.nowIso,
    inputs: {
      ...baseInputs,
      sex: input.sex,
      value,
      p3: band.p3,
      p97: band.p97,
      standard: band.standard,
    },
  });
}

function evaluateReferenceRangePolicy(input: {
  metric: HealthMetricDefinition;
  policy: HealthEvaluationPolicy;
  latestValue: HealthRecordValue;
  latestEvent: HealthRecordEvent;
  nowIso: string;
}): HealthEvaluation | null {
  const range = rangeForPolicy(input.policy.policyId, input.latestEvent.ageMonths);
  if (!range) {
    return null;
  }

  if (typeof input.latestValue.valueNumber !== 'number') {
    return evaluation({
      status: 'unrated',
      reason: 'numeric_value_required',
      label: 'Recorded',
      explanation: 'This evaluation policy requires a numeric value.',
      policy: input.policy,
      metric: input.metric,
      nowIso: input.nowIso,
      inputs: { valueId: input.latestValue.valueId, eventId: input.latestEvent.eventId },
    });
  }

  const value = input.latestValue.valueNumber;
  const outside = value < range.normalMin || value > range.normalMax;
  const status: HealthEvaluationStatus =
    outside && input.metric.safetyClass === 'professional_review_prompt'
      ? 'professional_review_prompt'
      : outside
        ? 'watch'
        : 'on_track';
  return evaluation({
    status,
    reason: outside ? 'outside_reference_range' : 'within_reference_range',
    label: outside ? 'Review' : 'On track',
    explanation: outside
      ? 'The latest value is outside the admitted reference range for this age band.'
      : 'The latest value is within the admitted reference range for this age band.',
    policy: input.policy,
    metric: input.metric,
    nowIso: input.nowIso,
    inputs: {
      valueId: input.latestValue.valueId,
      eventId: input.latestEvent.eventId,
      ageMonths: input.latestEvent.ageMonths,
      value,
      normalMin: range.normalMin,
      normalMax: range.normalMax,
    },
  });
}

function evaluateEventPayloadPolicy(input: {
  metric: HealthMetricDefinition;
  policy: HealthEvaluationPolicy;
  latestValue: HealthRecordValue;
  latestEvent: HealthRecordEvent;
  nowIso: string;
}): HealthEvaluation | null {
  if (input.policy.policyId === 'dental.event-severity') {
    const payload = parseValueJson(input.latestValue.valueJson);
    if (!payload) {
      return eventPayloadUnrated(input, 'event_payload_required');
    }
    const eventType = stringField(payload, 'eventType');
    const severity = stringField(payload, 'severity');
    const requiresReview =
      severity === 'severe' ||
      eventType === 'ortho-issue' ||
      booleanField(payload, 'professionalFollowUp') ||
      booleanField(payload, 'referralRequired');
    return evaluation({
      status: requiresReview ? 'professional_review_prompt' : 'on_track',
      reason: requiresReview ? 'dental_payload_review_marker' : 'dental_payload_routine',
      label: requiresReview ? 'Review' : 'On track',
      explanation: requiresReview
        ? 'The dental event payload includes an admitted professional-review marker.'
        : 'The latest dental event payload is routine or informational.',
      policy: input.policy,
      metric: input.metric,
      nowIso: input.nowIso,
      inputs: { valueId: input.latestValue.valueId, eventId: input.latestEvent.eventId, eventType, severity },
    });
  }

  if (input.policy.policyId === 'medical.result-projection') {
    const payload = parseValueJson(input.latestValue.valueJson);
    if (!payload) {
      return eventPayloadUnrated(input, 'event_payload_required');
    }
    const result = stringField(payload, 'result')?.toLowerCase();
    const severity = stringField(payload, 'severity')?.toLowerCase();
    const requiresReview =
      result === 'refer' ||
      result === 'fail' ||
      severity === 'severe' ||
      booleanField(payload, 'professionalFollowUp') ||
      booleanField(payload, 'referralRequired');
    return evaluation({
      status: requiresReview ? 'professional_review_prompt' : 'on_track',
      reason: requiresReview ? 'medical_payload_review_marker' : 'medical_payload_routine',
      label: requiresReview ? 'Review' : 'On track',
      explanation: requiresReview
        ? 'The medical event payload includes an admitted professional-review marker.'
        : 'The latest medical event payload is routine and has no admitted follow-up marker.',
      policy: input.policy,
      metric: input.metric,
      nowIso: input.nowIso,
      inputs: { valueId: input.latestValue.valueId, eventId: input.latestEvent.eventId, result, severity },
    });
  }

  return null;
}

function eventPayloadUnrated(
  input: {
    metric: HealthMetricDefinition;
    policy: HealthEvaluationPolicy;
    latestValue: HealthRecordValue;
    latestEvent: HealthRecordEvent;
    nowIso: string;
  },
  reason: string,
) {
  return evaluation({
    status: 'unrated',
    reason,
    label: 'Recorded',
    explanation: 'This event metric requires an admitted JSON payload before it can be evaluated.',
    policy: input.policy,
    metric: input.metric,
    nowIso: input.nowIso,
    inputs: { valueId: input.latestValue.valueId, eventId: input.latestEvent.eventId },
  });
}

function parseValueJson(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringField(payload: Record<string, unknown>, fieldName: string) {
  const value = payload[fieldName];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function booleanField(payload: Record<string, unknown>, fieldName: string) {
  return payload[fieldName] === true;
}

function evaluation(input: {
  status: HealthEvaluationStatus;
  reason: string;
  label: string;
  explanation: string;
  policy?: HealthEvaluationPolicy;
  metric: HealthMetricDefinition;
  nowIso: string;
  inputs: Record<string, unknown>;
}): HealthEvaluation {
  return {
    status: input.status,
    colorAlias: statusColorByStatus.get(input.status) ?? 'error',
    statusReasonCode: input.reason,
    shortLabel: input.label,
    explanation: input.explanation,
    sourceRefs: input.policy?.sourceRefs ?? [],
    computedAt: input.nowIso,
    inputs: input.inputs,
    safetyBoundary:
      input.status === 'professional_review_prompt'
        ? 'professional_review_prompt'
        : input.metric.safetyClass === 'no_evaluation'
          ? 'not_evaluated'
          : 'descriptive_only',
  };
}

function isPresencePolicy(policyId: string) {
  return new Set([
    'outdoor.goal-presence',
    'vaccine.rule-completion',
    'development.catalog-window',
  ]).has(policyId);
}

function rangeForPolicy(policyId: string, ageMonths: number) {
  const referenceRanges = REFERENCE_RANGES as Record<
    string,
    { ranges?: Array<{ ageMonths: number; normalMin: number; normalMax: number }> }
  >;
  const key =
    policyId === 'vision.age-reference-band'
      ? 'vision'
      : policyId === 'vision.axial-reference-band'
        ? 'axialLength'
        : null;
  if (!key) return null;
  const ranges = referenceRanges[key]?.ranges;
  if (!ranges?.length) return null;
  return [...ranges].sort((left, right) => Math.abs(left.ageMonths - ageMonths) - Math.abs(right.ageMonths - ageMonths))[0] ?? null;
}

function computeFreshness(
  latestValue: HealthRecordValue | null,
  nextRecordAt: string | null,
  freshnessPolicyRef: string | undefined,
  nowIso: string,
): HealthMetricSnapshot['freshness'] {
  if (!latestValue) return 'missing';
  if (!freshnessPolicyRef || !nextRecordAt) return 'unscheduled';
  return Date.parse(nextRecordAt) < Date.parse(nowIso) ? 'stale' : 'fresh';
}

function computeNextRecordAt(
  freshnessPolicyRef: string | undefined,
  effectiveDate: string,
  ageMonths: number,
) {
  if (!freshnessPolicyRef) return null;
  if (freshnessPolicyRef === 'sleep.daily-optional') return addDays(effectiveDate, 1);
  if (freshnessPolicyRef === 'outdoor.weekly-cadence') return addDays(effectiveDate, 7);
  if (freshnessPolicyRef === 'medical.event-only') return null;
  if (freshnessPolicyRef === 'vaccine.rule-schedule') return null;
  if (freshnessPolicyRef === 'development.stage-window') return null;
  if (freshnessPolicyRef === 'outdoor.goal-configured') return null;

  const months = freshnessMonthsForPolicy(freshnessPolicyRef, ageMonths);
  return months == null ? null : addMonths(effectiveDate, months);
}

function freshnessMonthsForPolicy(freshnessPolicyRef: string, ageMonths: number) {
  switch (freshnessPolicyRef) {
    case 'growth.age-cadence':
    case 'growth.derived-from-height-weight':
      if (ageMonths < 12) return 1;
      if (ageMonths < 36) return 3;
      return 6;
    case 'growth.infant-cadence':
      return 1;
    case 'vision.six-month-cadence':
    case 'vision.exam-cadence':
    case 'development.puberty-six-month-cadence':
    case 'dental.age-cadence':
      return 6;
    case 'fitness.school-year-cadence':
      return 12;
    default:
      return null;
  }
}

function addDays(dateIso: string, days: number) {
  const date = dateOnly(dateIso);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

function addMonths(dateIso: string, months: number) {
  const date = dateOnly(dateIso);
  date.setUTCMonth(date.getUTCMonth() + months);
  return toDateString(date);
}

function dateOnly(dateIso: string) {
  const date = new Date(`${dateIso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO date: ${dateIso}`);
  }
  return date;
}

function toDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function roundTo(value: number, precision: number) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
