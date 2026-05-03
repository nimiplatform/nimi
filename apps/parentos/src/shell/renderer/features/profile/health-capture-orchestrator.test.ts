import { describe, expect, it } from 'vitest';
import {
  buildHealthCaptureEventInput,
  createDefaultHealthCaptureIntent,
  getHealthCaptureProtocolOptions,
  type HealthCaptureDraftValue,
} from './health-capture-orchestrator.js';
import type { HealthMetricId } from '../../knowledge-base/index.js';

function ids() {
  let index = 0;
  return () => `id-${++index}`;
}

describe('health-capture-orchestrator', () => {
  it('builds a protocol-backed health record event and derived BMI value', () => {
    const intent = createDefaultHealthCaptureIntent('growth-child-quarterly', 'manual', '2026-05-02');
    const input = buildHealthCaptureEventInput({
      childId: 'child-1',
      ageMonths: 65,
      intent,
      draftValues: {
        'growth.height': { value: '118.2' },
        'growth.weight': { value: '22.4' },
      },
      nowIso: '2026-05-02T10:00:00.000Z',
      makeId: ids(),
    });

    expect(input.protocolId).toBe('growth-child-quarterly');
    expect(input.values.map((value) => value.metricId)).toEqual([
      'growth.height',
      'growth.weight',
      'growth.bmi',
    ]);
    expect(input.values.find((value) => value.metricId === 'growth.bmi')?.recordKind).toBe('derived');
    expect(input.values.find((value) => value.metricId === 'growth.bmi')?.sourceValueIds).toBe(
      JSON.stringify(['id-2', 'id-3']),
    );
  });

  it('rejects missing required metrics and user-authored derived metrics', () => {
    const intent = createDefaultHealthCaptureIntent('growth-child-quarterly', 'manual', '2026-05-02');

    expect(() =>
      buildHealthCaptureEventInput({
        childId: 'child-1',
        ageMonths: 65,
        intent,
        draftValues: { 'growth.height': { value: '118.2' } },
        nowIso: '2026-05-02T10:00:00.000Z',
        makeId: ids(),
      }),
    ).toThrow(/Missing required health metrics/);

    expect(() =>
      buildHealthCaptureEventInput({
        childId: 'child-1',
        ageMonths: 65,
        intent,
        draftValues: {
          'growth.height': { value: '118.2' },
          'growth.weight': { value: '22.4' },
          'growth.bmi': { value: '16.0' },
        },
        nowIso: '2026-05-02T10:00:00.000Z',
        makeId: ids(),
      }),
    ).toThrow(/Derived metric growth\.bmi cannot be authored/);
  });

  it('keeps reminder-launched capture linked without completing reminders', () => {
    const intent = createDefaultHealthCaptureIntent('outdoor-activity', 'reminder', '2026-05-02', {
      stateId: 'state-1',
      ruleId: 'PO-REM-OUTD-002',
      scheduledFor: '2026-05-01',
    });

    const input = buildHealthCaptureEventInput({
      childId: 'child-1',
      ageMonths: 65,
      intent,
      draftValues: { 'outdoor.activity_minutes': { value: '45' } },
      nowIso: '2026-05-02T10:00:00.000Z',
      makeId: ids(),
    });

    expect(input.recordKind).toBe('reminder_linked');
    expect(input.sourceSurface).toBe('reminder');
    expect(input.effectiveDate).toBe('2026-05-01');
    expect(input.linkedReminderStateId).toBe('state-1');
    expect(input.linkedReminderRuleId).toBe('PO-REM-OUTD-002');
  });

  it('offers grouped health-record-event protocols instead of retained table writers', () => {
    const protocolIds = getHealthCaptureProtocolOptions()
      .flatMap((option) => option.protocols)
      .map((protocol) => protocol.protocolId);
    expect(protocolIds).toContain('growth-child-quarterly');
    expect(protocolIds).toContain('medical-event');
    expect(protocolIds).not.toContain('vaccine-administration');
    expect(protocolIds).not.toContain('milestone-achievement');
  });

  it('rejects metrics outside the selected protocol', () => {
    const intent = createDefaultHealthCaptureIntent('vision-basic', 'manual', '2026-05-02');
    expect(() =>
      buildHealthCaptureEventInput({
        childId: 'child-1',
        ageMonths: 65,
        intent,
        draftValues: {
          'vision.left_visual_acuity': { value: '1.0' },
          'vision.right_visual_acuity': { value: '1.0' },
          ['growth.height' as HealthMetricId]: { value: '118.2' } as HealthCaptureDraftValue,
        },
        nowIso: '2026-05-02T10:00:00.000Z',
        makeId: ids(),
      }),
    ).toThrow(/not admitted by protocol/);
  });
});
