import { describe, expect, it } from 'vitest';
import { buildStructuredGrowthReport, parseReportContent, parseStructuredGrowthReportContent } from './structured-report.js';

describe('structured-report', () => {
  const child = {
    childId: 'child-1',
    familyId: 'family-1',
    displayName: 'Mimi',
    gender: 'female' as const,
    birthDate: '2024-01-15',
    birthWeightKg: null,
    birthHeightCm: null,
    birthHeadCircCm: null,
    avatarPath: null,
    nurtureMode: 'balanced' as const,
    nurtureModeOverrides: null,
    allergies: null,
    medicalNotes: null,
    recorderProfiles: [{ id: 'mom', name: 'Mom' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('builds a structured local report without free-form AI content', () => {
    const report = buildStructuredGrowthReport({
      child,
      reportType: 'quarterly-letter',
      now: '2026-04-03T00:00:00.000Z',
      measurements: [
        {
          measurementId: 'm-0',
          childId: 'child-1',
          typeId: 'height',
          value: 96.8,
          measuredAt: '2026-03-20T00:00:00.000Z',
          ageMonths: 26,
          percentile: null,
          source: 'manual',
          notes: null,
          createdAt: '2026-03-20T00:00:00.000Z',
        },
        {
          measurementId: 'm-1',
          childId: 'child-1',
          typeId: 'height',
          value: 98.4,
          measuredAt: '2026-04-01T00:00:00.000Z',
          ageMonths: 26,
          percentile: null,
          source: 'manual',
          notes: null,
          createdAt: '2026-04-01T00:00:00.000Z',
        },
      ],
      milestones: [
        {
          recordId: 'ms-1',
          childId: 'child-1',
          milestoneId: 'PO-MS-LANG-001',
          achievedAt: '2026-03-15T00:00:00.000Z',
          ageMonthsWhenAchieved: 25,
          notes: null,
          photoPath: null,
          createdAt: '2026-03-15T00:00:00.000Z',
          updatedAt: '2026-03-15T00:00:00.000Z',
        },
      ],
      vaccines: [],
      journalEntries: [
        {
          entryId: 'j-1',
          childId: 'child-1',
          contentType: 'mixed',
          textContent: 'Observed block play.',
          voicePath: 'C:/voice/entry.webm',
          photoPaths: null,
          recordedAt: '2026-04-02T00:00:00.000Z',
          ageMonths: 25,
          observationMode: 'five-minute',
          dimensionId: 'PO-OBS-CONC-001',
          selectedTags: '["focus"]',
          guidedAnswers: null,
          observationDuration: 5,
          keepsake: 1,
          moodTag: null,
          recorderId: 'mom',
          createdAt: '2026-03-10T00:00:00.000Z',
          updatedAt: '2026-03-10T00:00:00.000Z',
        },
      ],
      reminderStates: [
        {
          stateId: 'r-1',
          childId: 'child-1',
          ruleId: 'PO-REM-VAC-001',
          status: 'pending',
          activatedAt: null,
          completedAt: null,
          dismissedAt: null,
          dismissReason: null,
          repeatIndex: 0,
          nextTriggerAt: null,
          snoozedUntil: null,
          scheduledDate: null,
          notApplicable: 0,
          plannedForDate: null,
          surfaceRank: null,
          lastSurfacedAt: null,
          surfaceCount: 0,
          notes: null,
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        },
      ],
    });

    expect(report.content.version).toBe(1);
    expect(report.content.format).toBe('structured-local');
    expect(report.content.reportType).toBe('quarterly-letter');
    expect(report.content.trendSignals.length).toBeGreaterThan(0);
    const v1 = report.content as { sections: Array<{ id: string }> };
    expect(v1.sections.some((section) => section.id === 'journal')).toBe(true);
    expect(report.content.safetyNote).toMatch(/structured facts only/i);
  });

  it('rejects malformed stored payloads', () => {
    expect(() => parseStructuredGrowthReportContent('{"format":"invalid"}')).toThrow(/invalid structured growth report/i);
  });

  it('rejects unsupported reportType values', () => {
    expect(() => parseStructuredGrowthReportContent(JSON.stringify({
      version: 1,
      format: 'structured-local',
      reportType: 'weekly',
      title: 'Bad payload',
      subtitle: '',
      generatedAt: '2026-04-03T00:00:00.000Z',
      overview: [],
      metrics: [],
      trendSignals: [],
      sections: [],
      sources: [],
      safetyNote: 'facts only',
    }))).toThrow(/invalid structured growth report/i);
  });

  it('parseReportContent dispatches v1 and v2 correctly', () => {
    const v1 = JSON.stringify({ version: 1, format: 'structured-local', reportType: 'monthly', title: 'T', subtitle: '', generatedAt: '', overview: [], metrics: [], trendSignals: [], sections: [], sources: [], safetyNote: 'test' });
    expect(parseReportContent(v1).version).toBe(1);
    const v2 = JSON.stringify({ version: 2, format: 'narrative', reportType: 'monthly', title: 'T', subtitle: '', teaser: '', generatedAt: '', narrativeSections: [], actionItems: [], trendSignals: [], metrics: [], sources: [], safetyNote: 'test' });
    expect(parseReportContent(v2).version).toBe(2);
  });
});
