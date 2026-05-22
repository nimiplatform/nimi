// Vision archive — data helpers used by the timeline-document page.
import { describe, expect, it } from 'vitest';
import type { MeasurementRow, MedicalEventRow } from '../../bridge/sqlite-bridge.js';
import {
  buildExamViews,
  buildReferenceBand,
  computeGlanceMetrics,
  deriveMeasurementExamKind,
  describeReferenceStatus,
  findLatestFullRecord,
  groupByDate,
  parseExamMeta,
  parseScreeningEvent,
} from './vision-data.js';

const m = (typeId: string, value: number, measuredAt: string, notes: string | null = null): MeasurementRow => ({
  measurementId: `m-${typeId}-${measuredAt}`,
  childId: 'c1',
  typeId,
  value,
  measuredAt,
  ageMonths: 64,
  percentile: null,
  source: 'manual',
  notes,
  createdAt: '2026-04-12T08:00:00.000Z',
});

const screeningEvent = (overrides: Partial<MedicalEventRow> = {}): MedicalEventRow => ({
  eventId: 'e-1',
  childId: 'c1',
  eventType: 'checkup',
  title: '红光反射检查',
  eventDate: '2024-04-01',
  endDate: null,
  ageMonths: 12,
  severity: null,
  result: 'pass',
  hospital: '社区卫生中心',
  medication: null,
  dosage: null,
  notes: 'vision:red-reflex\n双眼通过',
  photoPath: null,
  createdAt: '2024-04-01T08:00:00.000Z',
  updatedAt: '2024-04-01T08:00:00.000Z',
  ...overrides,
});

describe('parseExamMeta', () => {
  it('extracts hospital, doctor, pupil, and free-form notes from token-prefixed measurement notes', () => {
    const records = groupByDate([
      m('axial-length-right', 22.84, '2026-04-06', '医院: 上海市儿童医院 | 医生: 李医生 | 瞳孔: 散瞳 | 当日复查'),
      m('axial-length-left', 22.79, '2026-04-06', '医院: 上海市儿童医院 | 医生: 李医生 | 瞳孔: 散瞳 | 当日复查'),
    ]);
    const meta = parseExamMeta(records[0]!);
    expect(meta).toEqual({
      hospital: '上海市儿童医院',
      doctor: '李医生',
      pupil: '散瞳',
      notes: '当日复查',
    });
  });

  it('returns null fields when notes are absent', () => {
    const records = groupByDate([m('axial-length-right', 22.84, '2026-04-06', null)]);
    expect(parseExamMeta(records[0]!)).toEqual({ hospital: null, doctor: null, pupil: null, notes: null });
  });
});

describe('deriveMeasurementExamKind', () => {
  it('returns "full" when refraction or vision data is present', () => {
    const records = groupByDate([
      m('refraction-sph-right', 1.25, '2026-01-10'),
      m('axial-length-right', 22.79, '2026-01-10'),
    ]);
    expect(deriveMeasurementExamKind(records[0]!)).toBe('full');
  });

  it('returns "biometric" when only axial-length-style data is present', () => {
    const records = groupByDate([m('axial-length-right', 22.84, '2026-04-06')]);
    expect(deriveMeasurementExamKind(records[0]!)).toBe('biometric');
  });
});

describe('parseScreeningEvent', () => {
  it('returns the screening key and trailing free-form notes', () => {
    expect(parseScreeningEvent(screeningEvent())).toEqual({
      screeningKey: 'red-reflex',
      userNotes: '双眼通过',
    });
  });

  it('treats non-vision events as having no screening key', () => {
    const e = screeningEvent({ notes: '一般门诊' });
    expect(parseScreeningEvent(e)).toEqual({ screeningKey: null, userNotes: '一般门诊' });
  });
});

describe('buildExamViews', () => {
  it('merges quantitative exam records and screening events into a newest-first timeline', () => {
    const today = new Date('2026-04-29T00:00:00Z');
    const records = groupByDate([
      m('axial-length-right', 22.84, '2026-04-06', '医院: A医院'),
      m('axial-length-left', 22.79, '2026-04-06', '医院: A医院'),
      m('vision-right', 1.0, '2026-01-10', '医院: A医院'),
    ]);
    const events = [screeningEvent({ eventDate: '2024-04-01' })];

    const views = buildExamViews(records, events, today);
    expect(views.map((v) => ({ id: v.id, kind: v.kind, source: v.source }))).toEqual([
      { id: 'measurement-2026-04-06', kind: 'biometric', source: 'measurement' },
      { id: 'measurement-2026-01-10', kind: 'full', source: 'measurement' },
      { id: 'event-e-1', kind: 'screen', source: 'screening' },
    ]);
    // First view is 23 days ago vs 2026-04-29.
    expect(views[0]!.daysAgo).toBe(23);
  });

  it('skips medical events that are not vision-flagged', () => {
    const today = new Date('2026-04-29T00:00:00Z');
    const events = [screeningEvent({ notes: '一般门诊' })];
    expect(buildExamViews([], events, today)).toEqual([]);
  });
});

describe('computeGlanceMetrics', () => {
  it('produces three chips with status tags driven by SE / vision thresholds', () => {
    const records = groupByDate([
      m('refraction-sph-right', 1.25, '2026-01-10'),
      m('refraction-cyl-right', -0.25, '2026-01-10'),
      m('refraction-sph-left', 1.50, '2026-01-10'),
      m('refraction-cyl-left', -0.25, '2026-01-10'),
      m('axial-length-right', 22.79, '2026-01-10'),
      m('axial-length-left', 22.77, '2026-01-10'),
      m('vision-right', 1.0, '2026-01-10'),
      m('vision-left', 1.0, '2026-01-10'),
    ]);
    const latestFull = findLatestFullRecord(records);
    const chips = computeGlanceMetrics(latestFull);
    expect(chips.map((c) => ({ label: c.label, od: c.od, os: c.os, status: c.status, tag: c.tag }))).toEqual([
      { label: '远视储备 SE', od: 1.13, os: 1.38, status: 'ok', tag: '充足' },
      { label: '眼轴', od: 22.79, os: 22.77, status: 'ok', tag: '已记录' },
      { label: '裸眼视力', od: 1.0, os: 1.0, status: 'ok', tag: '达标' },
    ]);
  });

  it('returns placeholder chips when there are no records', () => {
    const chips = computeGlanceMetrics(null);
    expect(chips.every((c) => c.od == null && c.os == null)).toBe(true);
  });
});

describe('buildReferenceBand', () => {
  it('builds an interpolated normal-range band for vision metrics', () => {
    // 54 months sits halfway between the 48mo {0.6,1.2} and 60mo {0.8,1.5} bands.
    const ref = buildReferenceBand('vision-left', 'male', [54]);
    expect(ref?.kind).toBe('band');
    expect(ref?.points).toEqual([{ age: 54, bandLow: 0.7, bandHigh: 1.35 }]);
    expect(ref?.caption).toContain('0.7~1.35');
  });

  it('builds gender-specific P50/P75 lines for axial length', () => {
    // 72 months → 6 years → AL_MALE[6] = { p50: 22.97, p75: 23.45 }.
    const ref = buildReferenceBand('axial-length-right', 'male', [72]);
    expect(ref?.kind).toBe('percentile');
    expect(ref?.points).toEqual([{ age: 72, median: 22.97, critical: 23.45 }]);
  });

  it('returns null for metrics without an admitted age reference', () => {
    expect(buildReferenceBand('refraction-sph-right', 'male', [72])).toBeNull();
    expect(buildReferenceBand('iop-left', 'male', [72])).toBeNull();
  });

  it('returns null when there are no measurement ages', () => {
    expect(buildReferenceBand('vision-left', 'male', [])).toBeNull();
  });
});

describe('describeReferenceStatus', () => {
  it('locates a value inside / above / below a normal-range band', () => {
    const ref = buildReferenceBand('vision-left', 'male', [60])!;
    expect(describeReferenceStatus(ref, 1.0)).toBe('当前处于同龄参考范围内');
    expect(describeReferenceStatus(ref, 0.5)).toBe('当前低于同龄参考范围');
    expect(describeReferenceStatus(ref, 1.8)).toBe('当前高于同龄参考范围');
  });

  it('locates a value against axial-length P50/P75 lines', () => {
    const ref = buildReferenceBand('axial-length-right', 'male', [72])!;
    expect(describeReferenceStatus(ref, 22.5)).toBe('当前低于同龄中位');
    expect(describeReferenceStatus(ref, 23.2)).toBe('当前处于同龄中位与临界值之间');
    expect(describeReferenceStatus(ref, 24.0)).toBe('当前高于同龄临界值');
  });
});
