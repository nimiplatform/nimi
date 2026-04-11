// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReportsPage from './reports-page.js';
import { useAppStore } from '../../app-shell/app-store.js';

const reportStore: Array<{
  reportId: string;
  childId: string;
  reportType: string;
  periodStart: string;
  periodEnd: string;
  ageMonthsStart: number;
  ageMonthsEnd: number;
  content: string;
  generatedAt: string;
  createdAt: string;
}> = [];

const {
  getGrowthReportsMock,
  insertGrowthReportMock,
  getMeasurementsMock,
  getMilestoneRecordsMock,
  getVaccineRecordsMock,
  getJournalEntriesMock,
  getReminderStatesMock,
} = vi.hoisted(() => ({
  getGrowthReportsMock: vi.fn(async () => [...reportStore].sort((left, right) => right.periodStart.localeCompare(left.periodStart))),
  insertGrowthReportMock: vi.fn(async (params: {
    reportId: string;
    childId: string;
    reportType: string;
    periodStart: string;
    periodEnd: string;
    ageMonthsStart: number;
    ageMonthsEnd: number;
    content: string;
    generatedAt: string;
    now: string;
  }) => {
    reportStore.unshift({
      reportId: params.reportId,
      childId: params.childId,
      reportType: params.reportType,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      ageMonthsStart: params.ageMonthsStart,
      ageMonthsEnd: params.ageMonthsEnd,
      content: params.content,
      generatedAt: params.generatedAt,
      createdAt: params.now,
    });
  }),
  getMeasurementsMock: vi.fn().mockResolvedValue([
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
  ]),
  getMilestoneRecordsMock: vi.fn().mockResolvedValue([]),
  getVaccineRecordsMock: vi.fn().mockResolvedValue([]),
  getJournalEntriesMock: vi.fn().mockResolvedValue([
    {
      entryId: 'j-1',
      childId: 'child-1',
      contentType: 'voice',
      textContent: null,
      voicePath: 'C:/voice/entry.webm',
      photoPaths: null,
      recordedAt: '2026-04-02T00:00:00.000Z',
      ageMonths: 26,
      observationMode: 'five-minute',
      dimensionId: null,
      selectedTags: null,
      guidedAnswers: null,
      observationDuration: 5,
      keepsake: 0,
      recorderId: 'mom',
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
    },
  ]),
  getReminderStatesMock: vi.fn().mockResolvedValue([
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
  ]),
}));

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  getGrowthReports: getGrowthReportsMock,
  insertGrowthReport: insertGrowthReportMock,
  getMeasurements: getMeasurementsMock,
  getMilestoneRecords: getMilestoneRecordsMock,
  getVaccineRecords: getVaccineRecordsMock,
  getJournalEntries: getJournalEntriesMock,
  getReminderStates: getReminderStatesMock,
}));

describe('ReportsPage', () => {
  beforeEach(() => {
    reportStore.length = 0;
    insertGrowthReportMock.mockClear();
    getGrowthReportsMock.mockClear();
    useAppStore.setState({
      bootstrapReady: true,
      familyId: 'family-1',
      activeChildId: 'child-1',
      children: [
        {
          childId: 'child-1',
          familyId: 'family-1',
          displayName: 'Mimi',
          gender: 'female',
          birthDate: '2024-01-15',
          birthWeightKg: null,
          birthHeightCm: null,
          birthHeadCircCm: null,
          avatarPath: null,
          nurtureMode: 'balanced',
          nurtureModeOverrides: null,
          allergies: null,
          medicalNotes: null,
          recorderProfiles: [{ id: 'mom', name: 'Mom' }],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
  });

  afterEach(() => {
    useAppStore.setState({
      bootstrapReady: false,
      familyId: null,
      activeChildId: null,
      children: [],
    });
  });

  it('generates and persists a structured local report', async () => {
    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByText(/还没有成长报告/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /高级选项/i }));
    fireEvent.click(screen.getByRole('button', { name: /生成综合报告/i }));

    await waitFor(() => {
      expect(insertGrowthReportMock).toHaveBeenCalledTimes(1);
    });

    const firstCall = insertGrowthReportMock.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    const storedPayload = JSON.parse((firstCall as { content: string }).content) as { format: string; reportType: string };
    expect(storedPayload.format).toBe('structured-local');
    expect(storedPayload.reportType).toBe('quarterly-letter');

    await waitFor(() => {
      expect(screen.queryByText(/还没有成长报告/i)).toBeNull();
    });
  });

  it('renders persisted narrative-ai reports from the unified reports store', async () => {
    reportStore.unshift({
      reportId: 'report-1',
      childId: 'child-1',
      reportType: 'monthly',
      periodStart: '2026-04-01T00:00:00.000Z',
      periodEnd: '2026-04-30T23:59:59.999Z',
      ageMonthsStart: 26,
      ageMonthsEnd: 27,
      content: JSON.stringify({
        version: 2,
        format: 'narrative-ai',
        reportType: 'monthly',
        title: 'Mimi 的四月成长报告',
        subtitle: '2026-04-01 至 2026-04-30',
        teaser: '',
        opening: '这个月继续稳步成长。',
        generatedAt: '2026-04-30T23:59:59.999Z',
        narrativeSections: [
          { id: 'growth', title: '生长发育', narrative: '本月继续稳步成长。' },
        ],
        actionItems: [],
        trendSignals: [],
        metrics: [],
        sources: ['local measurements'],
        safetyNote: '如需详细解读，建议咨询专业人士。',
      }),
      generatedAt: '2026-04-30T23:59:59.999Z',
      createdAt: '2026-04-30T23:59:59.999Z',
    });

    render(<ReportsPage />);

    await waitFor(() => {
      expect(screen.getByText('Mimi 的四月成长报告')).toBeTruthy();
      expect(screen.getByText('AI 撰写')).toBeTruthy();
      expect(screen.getByText('本月继续稳步成长。')).toBeTruthy();
    });
  });
});
