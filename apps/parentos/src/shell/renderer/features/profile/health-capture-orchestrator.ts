import {
  HEALTH_CAPTURE_PROTOCOLS,
  HEALTH_METRIC_GROUPS,
  HEALTH_METRICS,
  type HealthCaptureProtocol,
  type HealthCaptureProtocolId,
  type HealthMetricDefinition,
  type HealthMetricGroup,
  type HealthMetricId,
} from '../../knowledge-base/index.js';
import {
  getHealthCaptureProtocol,
  getHealthMetricDefinition,
  recomputeDerivedHealthRecordValues,
  type HealthRecordEvent,
  type HealthRecordEventKind,
  type HealthRecordValue,
} from '../../engine/health-record-domain.js';

export type HealthCaptureLaunchMode = 'manual' | 'prefilled' | 'guided' | 'reminder' | 'ocr_confirm';

export interface LinkedHealthRecordReminder {
  stateId?: string | null;
  ruleId: string;
  scheduledFor?: string | null;
  dueDate?: string | null;
}

export interface HealthCaptureIntent {
  protocolId: HealthCaptureProtocolId;
  mode: HealthCaptureLaunchMode;
  effectiveDate: string;
  recorderId?: string | null;
  notes?: string | null;
  linkedReminder?: LinkedHealthRecordReminder | null;
  prefillValues?: Partial<Record<HealthMetricId, HealthCaptureDraftValue>>;
}

export interface HealthCaptureDraftValue {
  value: string;
  qualifier?: string | null;
}

export interface HealthCaptureBuildInput {
  childId: string;
  ageMonths: number;
  intent: HealthCaptureIntent;
  draftValues: Partial<Record<HealthMetricId, HealthCaptureDraftValue>>;
  nowIso: string;
  makeId: () => string;
}

export interface HealthCaptureEventInput {
  eventId: string;
  childId: string;
  protocolId: HealthCaptureProtocolId;
  groupId: HealthMetricGroup['groupId'];
  recordKind: HealthRecordEventKind;
  sourceSurface: HealthRecordEvent['sourceSurface'];
  recordedAt: string;
  effectiveDate: string;
  ageMonths: number;
  recorderId: string | null;
  linkedReminderStateId: string | null;
  linkedReminderRuleId: string | null;
  notes: string | null;
  metadataJson: string | null;
  now: string;
  values: HealthCaptureValueInput[];
}

export interface HealthCaptureValueInput {
  valueId: string;
  metricId: HealthMetricId;
  valueNumber: number | null;
  valueText: string | null;
  valueJson: string | null;
  unit: string | null;
  qualifier: string | null;
  recordKind: 'measured' | 'derived' | 'parent_confirmed_import';
  sourceValueIds: string | null;
}

export interface HealthCaptureProtocolOption {
  group: HealthMetricGroup;
  protocols: readonly HealthCaptureProtocol[];
}

const metricById = new Map(HEALTH_METRICS.map((metric) => [metric.metricId, metric]));

export function getHealthCaptureProtocolOptions(): HealthCaptureProtocolOption[] {
  return getHealthCaptureProtocolOptionsFor(() => true);
}

export function getHealthRecordEventCaptureProtocolOptions(): HealthCaptureProtocolOption[] {
  return getHealthCaptureProtocolOptionsFor((protocol) => protocol.storageTarget === 'health_record_event');
}

function getHealthCaptureProtocolOptionsFor(
  includeProtocol: (protocol: HealthCaptureProtocol) => boolean,
): HealthCaptureProtocolOption[] {
  return [...HEALTH_METRIC_GROUPS]
    .sort((left, right) => left.rank - right.rank)
    .map((group) => ({
      group,
      protocols: HEALTH_CAPTURE_PROTOCOLS.filter((protocol) => (
        protocol.groupId === group.groupId && includeProtocol(protocol)
      )),
    }))
    .filter((option) => option.protocols.length > 0);
}

export function getCaptureMetrics(protocol: HealthCaptureProtocol): {
  required: readonly HealthMetricDefinition[];
  optional: readonly HealthMetricDefinition[];
} {
  const derived = new Set(protocol.derivedMetricIds ?? []);
  const required = protocol.requiredMetricIds
    .filter((metricId) => !derived.has(metricId))
    .map((metricId) => getHealthMetricDefinition(metricId));
  const optional = (protocol.optionalMetricIds ?? [])
    .filter((metricId) => !derived.has(metricId))
    .map((metricId) => getHealthMetricDefinition(metricId));
  return { required, optional };
}

export function createDefaultHealthCaptureIntent(
  protocolId: HealthCaptureProtocolId,
  mode: HealthCaptureLaunchMode,
  todayIso: string,
  linkedReminder?: LinkedHealthRecordReminder | null,
): HealthCaptureIntent {
  return {
    protocolId,
    mode,
    effectiveDate: defaultEffectiveDate(todayIso, linkedReminder),
    linkedReminder: linkedReminder ?? null,
  };
}

export function buildHealthCaptureEventInput(input: HealthCaptureBuildInput): HealthCaptureEventInput {
  const protocol = getHealthCaptureProtocol(input.intent.protocolId);
  if (protocol.storageTarget !== 'health_record_event') {
    throw new Error(
      `Capture protocol ${protocol.protocolId} requires retained_table storage and must not be saved as a health_record_event`,
    );
  }

  const childId = requireNonBlank(input.childId, 'Capture intent childId');
  const effectiveDate = requireIsoDate(input.intent.effectiveDate, 'Capture intent effectiveDate');
  const linkedReminder = validateLinkedReminder(input.intent.mode, input.intent.linkedReminder);
  const eventId = input.makeId();
  const event: HealthRecordEvent = {
    eventId,
    childId,
    protocolId: protocol.protocolId,
    groupId: protocol.groupId,
    recordKind: eventKindForMode(input.intent.mode),
    sourceSurface: sourceSurfaceForMode(input.intent.mode),
    recordedAt: input.nowIso,
    effectiveDate,
    ageMonths: input.ageMonths,
    recorderId: input.intent.recorderId ?? null,
    linkedReminderStateId: linkedReminder?.stateId ?? null,
    linkedReminderRuleId: linkedReminder?.ruleId ?? null,
    notes: blankToNull(input.intent.notes),
    metadataJson: JSON.stringify({
      mode: input.intent.mode,
      protocolId: protocol.protocolId,
      linkedReminderRuleId: linkedReminder?.ruleId ?? null,
    }),
    createdAt: input.nowIso,
    updatedAt: input.nowIso,
  };

  const protocolMetricIds = new Set<HealthMetricId>(protocol.metricIds);
  const derivedMetricIds = new Set<HealthMetricId>(protocol.derivedMetricIds ?? []);
  const baseValues: HealthRecordValue[] = [];

  for (const [metricId, draft] of Object.entries(input.draftValues) as Array<[HealthMetricId, HealthCaptureDraftValue | undefined]>) {
    if (!draft || blankToNull(draft.value) == null) continue;
    if (!protocolMetricIds.has(metricId)) {
      throw new Error(`Metric ${metricId} is not admitted by protocol ${protocol.protocolId}`);
    }
    if (derivedMetricIds.has(metricId)) {
      throw new Error(`Derived metric ${metricId} cannot be authored by capture input`);
    }
    const metric = metricById.get(metricId);
    if (!metric) {
      throw new Error(`Unknown health metric id: ${metricId}`);
    }
    baseValues.push(buildValueFromDraft({
      event,
      metric,
      draft,
      nowIso: input.nowIso,
      valueId: input.makeId(),
      mode: input.intent.mode,
    }));
  }

  const baseMetricIds = new Set(baseValues.map((value) => value.metricId));
  const missingRequired = protocol.requiredMetricIds.filter(
    (metricId) => !derivedMetricIds.has(metricId) && !baseMetricIds.has(metricId),
  );
  if (missingRequired.length > 0) {
    throw new Error(`Missing required health metrics: ${missingRequired.join(', ')}`);
  }
  if (baseValues.length === 0) {
    throw new Error(`Capture protocol ${protocol.protocolId} requires at least one value`);
  }

  const withDerived = recomputeDerivedHealthRecordValues([event], baseValues, {
    nowIso: input.nowIso,
    makeValueId: () => input.makeId(),
  });

  return {
    eventId: event.eventId,
    childId: event.childId,
    protocolId: protocol.protocolId,
    groupId: protocol.groupId,
    recordKind: event.recordKind,
    sourceSurface: event.sourceSurface,
    recordedAt: event.recordedAt,
    effectiveDate: event.effectiveDate,
    ageMonths: event.ageMonths,
    recorderId: event.recorderId ?? null,
    linkedReminderStateId: event.linkedReminderStateId ?? null,
    linkedReminderRuleId: event.linkedReminderRuleId ?? null,
    notes: event.notes ?? null,
    metadataJson: event.metadataJson ?? null,
    now: input.nowIso,
    values: withDerived.map(toCaptureValueInput),
  };
}

function buildValueFromDraft(input: {
  event: HealthRecordEvent;
  metric: HealthMetricDefinition;
  draft: HealthCaptureDraftValue;
  nowIso: string;
  valueId: string;
  mode: HealthCaptureLaunchMode;
}): HealthRecordValue {
  const rawValue = input.draft.value.trim();
  const parsed = parseMetricDraft(input.metric, rawValue);
  return {
    valueId: input.valueId,
    eventId: input.event.eventId,
    childId: input.event.childId,
    metricId: input.metric.metricId,
    valueNumber: parsed.valueNumber,
    valueText: parsed.valueText,
    valueJson: parsed.valueJson,
    unit: input.metric.unit ?? null,
    qualifier: input.draft.qualifier ?? null,
    recordKind: input.mode === 'ocr_confirm' ? 'parent_confirmed_import' : 'measured',
    createdAt: input.nowIso,
  };
}

function parseMetricDraft(metric: HealthMetricDefinition, rawValue: string) {
  if (metric.valueShape === 'number' || metric.valueShape === 'duration') {
    const valueNumber = Number(rawValue);
    if (!Number.isFinite(valueNumber)) {
      throw new Error(`${metric.metricId} requires a numeric value`);
    }
    return { valueNumber, valueText: null, valueJson: null };
  }
  if (metric.valueShape === 'composite') {
    JSON.parse(rawValue);
    return { valueNumber: null, valueText: null, valueJson: rawValue };
  }
  return { valueNumber: null, valueText: rawValue, valueJson: null };
}

function toCaptureValueInput(value: HealthRecordValue): HealthCaptureValueInput {
  return {
    valueId: value.valueId,
    metricId: value.metricId,
    valueNumber: value.valueNumber ?? null,
    valueText: value.valueText ?? null,
    valueJson: value.valueJson ?? null,
    unit: value.unit ?? null,
    qualifier: value.qualifier ?? null,
    recordKind: value.recordKind,
    sourceValueIds: value.sourceValueIds ?? null,
  };
}

function defaultEffectiveDate(todayIso: string, linkedReminder?: LinkedHealthRecordReminder | null) {
  return (linkedReminder?.scheduledFor ?? linkedReminder?.dueDate ?? todayIso).slice(0, 10);
}

function eventKindForMode(mode: HealthCaptureLaunchMode): HealthRecordEventKind {
  if (mode === 'reminder') return 'reminder_linked';
  if (mode === 'ocr_confirm') return 'ocr_confirmed';
  return 'manual';
}

function sourceSurfaceForMode(mode: HealthCaptureLaunchMode): HealthRecordEvent['sourceSurface'] {
  if (mode === 'reminder') return 'reminder';
  if (mode === 'ocr_confirm') return 'ocr_tool';
  return 'profile_console';
}

function validateLinkedReminder(
  mode: HealthCaptureLaunchMode,
  linkedReminder: LinkedHealthRecordReminder | null | undefined,
): LinkedHealthRecordReminder | null {
  if (mode !== 'reminder') {
    return linkedReminder ?? null;
  }
  if (!linkedReminder) {
    throw new Error('Reminder capture requires linkedReminder');
  }
  const ruleId = requireNonBlank(linkedReminder.ruleId, 'Reminder capture linkedReminder.ruleId');
  return {
    ...linkedReminder,
    ruleId,
    stateId: blankToNull(linkedReminder.stateId),
  };
}

function requireNonBlank(value: string | null | undefined, label: string) {
  const trimmed = blankToNull(value);
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function requireIsoDate(value: string | null | undefined, label: string) {
  const trimmed = requireNonBlank(value, label);
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) {
    throw new Error(`${label} must be an ISO 8601 date`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} must be a valid ISO 8601 date`);
  }
  return trimmed;
}

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
