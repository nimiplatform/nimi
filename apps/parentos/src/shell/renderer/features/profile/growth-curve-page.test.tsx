// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@nimiplatform/kit/ui';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GrowthCurvePage from './growth-curve-page.js';
import { GrowthCurveChartPanel } from './growth-curve-chart-panel.js';
import type { WHOLMSDataset } from './who-lms-loader.js';
import { useAppStore } from '../../app-shell/app-store.js';
import { i18n } from '../../i18n/index.js';

const {
  getMeasurementsMock,
  insertMeasurementMock,
  updateMeasurementMock,
  deleteMeasurementMock,
  saveTextFileViaDialogMock,
  textGenerateMock,
  getPlatformClientMock,
  resolveParentosTextRuntimeConfigMock,
  ensureParentosLocalRuntimeReadyMock,
  buildParentosRuntimeMetadataMock,
} = vi.hoisted(() => ({
  getMeasurementsMock: vi.fn().mockResolvedValue([
    {
      measurementId: 'm-1',
      childId: 'child-1',
      typeId: 'height',
      value: 98,
      measuredAt: '2025-12-10T00:00:00.000Z',
      ageMonths: 143,
      percentile: null,
      source: 'manual',
      notes: null,
      createdAt: '2025-12-10T00:00:00.000Z',
    },
    {
      measurementId: 'm-2',
      childId: 'child-1',
      typeId: 'weight',
      value: 15,
      measuredAt: '2025-12-10T00:00:00.000Z',
      ageMonths: 143,
      percentile: null,
      source: 'manual',
      notes: null,
      createdAt: '2025-12-10T00:00:00.000Z',
    },
  ]),
  insertMeasurementMock: vi.fn().mockResolvedValue(undefined),
  updateMeasurementMock: vi.fn().mockResolvedValue(undefined),
  deleteMeasurementMock: vi.fn().mockResolvedValue(undefined),
  saveTextFileViaDialogMock: vi.fn().mockResolvedValue('/tmp/growth_history.csv'),
  textGenerateMock: vi.fn().mockResolvedValue({
    text: '{"insight":"观察到孩子身高处于参考区间内，倾向于稳定增长。"}',
    finishReason: 'stop',
  }),
  getPlatformClientMock: vi.fn(),
  resolveParentosTextRuntimeConfigMock: vi.fn().mockResolvedValue({
    model: 'test-model',
    route: 'local',
    temperature: 0.3,
    maxTokens: 256,
  }),
  ensureParentosLocalRuntimeReadyMock: vi.fn().mockResolvedValue(undefined),
  buildParentosRuntimeMetadataMock: vi.fn().mockReturnValue({
    callerKind: 'third-party-app',
    callerId: 'app.nimi.parentos',
    surfaceId: 'parentos.profile.summary.growth-insight-test',
  }),
}));

getPlatformClientMock.mockImplementation(() => ({
  runtime: { ai: { text: { generate: textGenerateMock } } },
}));

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  getMeasurements: getMeasurementsMock,
  insertMeasurement: insertMeasurementMock,
  updateMeasurement: updateMeasurementMock,
  deleteMeasurement: deleteMeasurementMock,
  // Next-check reschedule modal (PO-GROWTH-DETAIL-006) reads reminder state +
  // app-setting frequency overrides; default to an empty/clean slate.
  getReminderStates: vi.fn().mockResolvedValue([]),
  upsertReminderState: vi.fn().mockResolvedValue(undefined),
  getAppSetting: vi.fn().mockResolvedValue(null),
  setAppSetting: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: getPlatformClientMock,
}));

vi.mock('../settings/parentos-ai-runtime.js', () => ({
  resolveParentosTextRuntimeConfig: resolveParentosTextRuntimeConfigMock,
  ensureParentosLocalRuntimeReady: ensureParentosLocalRuntimeReadyMock,
  buildParentosRuntimeMetadata: buildParentosRuntimeMetadataMock,
  PARENTOS_LOCAL_RUNTIME_WARM_TIMEOUT_MS: 1000,
}));

vi.mock('../reports/report-export.js', () => ({
  saveTextFileViaDialog: saveTextFileViaDialogMock,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Line: ({
    dataKey,
    name,
    stroke,
    strokeDasharray,
  }: {
    dataKey?: string;
    name?: string;
    stroke?: string;
    strokeDasharray?: string;
  }) => (
    <div
      data-testid={dataKey ? `recharts-line-${dataKey}` : undefined}
      data-stroke={stroke}
      data-stroke-dasharray={strokeDasharray}
    >
      {name ?? 'line'}
    </div>
  ),
  Area: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

describe('GrowthCurvePage', () => {
  beforeEach(() => {
    i18n.changeLanguage('zh');
    getMeasurementsMock.mockClear();
    insertMeasurementMock.mockClear();
    updateMeasurementMock.mockClear();
    deleteMeasurementMock.mockClear();
    saveTextFileViaDialogMock.mockClear();
    textGenerateMock.mockReset();
    textGenerateMock.mockResolvedValue({
      text: '{"insight":"观察到孩子身高处于参考区间内，倾向于稳定增长。"}',
      finishReason: 'stop',
    });
    getPlatformClientMock.mockReset();
    getPlatformClientMock.mockImplementation(() => ({
      runtime: { ai: { text: { generate: textGenerateMock } } },
    }));
    resolveParentosTextRuntimeConfigMock.mockResolvedValue({
      model: 'test-model',
      route: 'local',
      temperature: 0.3,
      maxTokens: 256,
    });
    ensureParentosLocalRuntimeReadyMock.mockResolvedValue(undefined);

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
          birthDate: '2015-01-15',
          birthWeightKg: null,
          birthHeightCm: null,
          birthHeadCircCm: null,
          avatarPath: null,
          nurtureMode: 'balanced',
          nurtureModeOverrides: null,
          allergies: null,
          medicalNotes: null,
          recorderProfiles: null,
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

  it('fails closed for WHO weight beyond official coverage with an out-of-range note', async () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /WHO 标准/i }));
    fireEvent.click(screen.getByText('体重').closest('button') as HTMLButtonElement);

    await waitFor(() => {
      expect(
        screen.getByText('当前年龄超出WHO 标准百分位参考线覆盖范围，仅显示已记录数据。'),
      ).toBeTruthy();
    });
  });

  it('renders the outer percentile dashed reference lines with the active theme token', () => {
    const whoDataset: WHOLMSDataset = {
      typeId: 'height',
      gender: 'female',
      source: 'test',
      coverage: { startAgeMonths: 0, endAgeMonths: 216 },
      points: [],
      standard: 'china',
      lines: [3, 10, 25, 50, 75, 90, 97].map((percentile) => ({
        percentile,
        points: [120, 121, 122].map((ageMonths) => ({
          ageMonths,
          value: 90 + percentile * 0.4 + (ageMonths - 120),
        })),
      })),
    };

    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurveChartPanel
            chartData={[{ age: 121, value: 110, date: '2026-01-01' }]}
            selectedType="height"
            typeInfo={undefined}
            whoDataset={whoDataset}
            canShowWhoLines
            growthStandard="china"
            onSelectGrowthStandard={vi.fn()}
            measurements={[]}
            ageMonths={121}
          />
        </MemoryRouter>
      </TooltipProvider>,
    );

    for (const key of ['p3', 'p10', 'p90', 'p97']) {
      const line = screen.getByTestId(`recharts-line-${key}`);
      expect(line.getAttribute('data-stroke')).toBe('var(--nimi-color-indigo)');
      expect(line.getAttribute('data-stroke-dasharray')).toBe('5 4');
    }
  });

  it('renders the hero card with percentile dial, big value, and the trend-stat row when data present', async () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('growth-hero-card')).toBeTruthy();
    });

    const hero = screen.getByTestId('growth-hero-card');
    // Dial SVG renders with the labelled aria-label (P<n> or unknown).
    expect(hero.querySelector('svg[role="img"]')).toBeTruthy();
    // Big value text "98 cm" mirrors the seeded height measurement.
    expect(hero.textContent ?? '').toContain('98');
    // The hero footer renders two metric chips (距 P50 / 百分位变化).
    const chips = screen.getByTestId('growth-hero-chips');
    expect(chips).toBeTruthy();
    expect(chips.children.length).toBe(2);
  });

  it('opens the metric tab named by the ?metric= deep link instead of the height default', async () => {
    render(
      <TooltipProvider>
        <MemoryRouter initialEntries={['/profile/growth?metric=growth.weight']}>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('growth-hero-card')).toBeTruthy();
    });

    // ?metric=growth.weight selects the weight tab — the hero shows the seeded
    // weight measurement (15), not the height default (98).
    const hero = screen.getByTestId('growth-hero-card');
    expect(hero.textContent ?? '').toContain('15');
    expect(hero.textContent ?? '').not.toContain('98');
  });

  it('renders the hero empty state when there are no measurements', async () => {
    getMeasurementsMock.mockResolvedValueOnce([]);

    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('growth-hero-card-empty')).toBeTruthy();
    });

    expect(screen.queryByTestId('growth-hero-card')).toBeNull();
    expect(screen.queryByTestId('growth-hero-chips')).toBeNull();
    expect(screen.getByText('暂无生长记录')).toBeTruthy();
  });

  // -----------------------------------------------------------------
  // Wave-C tests
  // -----------------------------------------------------------------

  it('renders growth milestones card with rows when height measurements cross an admitted threshold', async () => {
    // Two height measurements within 12 months crossing the 100 cm
    // admitted threshold should fire growth-milestone-height-threshold-100cm.
    getMeasurementsMock.mockResolvedValueOnce([
      {
        measurementId: 'm-prior-height',
        childId: 'child-1',
        typeId: 'height',
        value: 95,
        measuredAt: '2025-06-10T00:00:00.000Z',
        ageMonths: 137,
        percentile: null,
        source: 'manual',
        notes: null,
        createdAt: '2025-06-10T00:00:00.000Z',
      },
      {
        measurementId: 'm-cross-height',
        childId: 'child-1',
        typeId: 'height',
        value: 102,
        measuredAt: '2025-12-10T00:00:00.000Z',
        ageMonths: 143,
        percentile: null,
        source: 'manual',
        notes: null,
        createdAt: '2025-12-10T00:00:00.000Z',
      },
    ]);

    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('growth-milestones-card')).toBeTruthy();
    });

    const card = screen.getByTestId('growth-milestones-card');
    const rows = card.querySelectorAll('[data-testid^="growth-milestone-row-"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(card.textContent ?? '').toContain('生长重要节点');
  });

  it('renders the milestone empty-state copy inside the timeline card when no milestones are present', async () => {
    getMeasurementsMock.mockResolvedValueOnce([]);

    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('growth-milestones-card')).toBeTruthy();
    });

    expect(screen.getByText('暂无识别到的重要节点')).toBeTruthy();
  });

  it('shows the milestone card "查看更多" affordance when more milestones exist than the hero preview', async () => {
    // 95cm → 135cm crosses the 100/110/120/130 thresholds — four milestones,
    // more than the hero's 3-row preview, so the "查看更多" affordance renders.
    getMeasurementsMock.mockResolvedValueOnce([
      {
        measurementId: 'm-low',
        childId: 'child-1',
        typeId: 'height',
        value: 95,
        measuredAt: '2025-01-10T00:00:00.000Z',
        ageMonths: 120,
        percentile: null,
        source: 'manual',
        notes: null,
        createdAt: '2025-01-10T00:00:00.000Z',
      },
      {
        measurementId: 'm-high',
        childId: 'child-1',
        typeId: 'height',
        value: 135,
        measuredAt: '2026-03-10T00:00:00.000Z',
        ageMonths: 134,
        percentile: null,
        source: 'manual',
        notes: null,
        createdAt: '2026-03-10T00:00:00.000Z',
      },
    ]);

    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('growth-milestones-view-more')).toBeTruthy();
    });
  });

  it('renders the next-check card with badge, lede, and CTA when data present', async () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    // The card mounts whenever the snapshot is non-null and the page has a
    // child. Depending on the freshness policy + seeded measurements, the
    // next-check state may be 'scheduled' or 'unscheduled'. We accept
    // either rendering but assert the appropriate one is present.
    await waitFor(() => {
      const scheduled = screen.queryByTestId('growth-next-check-card');
      const unscheduled = screen.queryByTestId('growth-next-check-card-unscheduled');
      expect(Boolean(scheduled) || Boolean(unscheduled)).toBe(true);
    });

    const scheduled = screen.queryByTestId('growth-next-check-card');
    if (scheduled) {
      // Scheduled-state assertions
      expect(screen.getByTestId('growth-next-check-badge')).toBeTruthy();
      expect(screen.getByTestId('growth-next-check-cta-set-reminder')).toBeTruthy();
      expect(scheduled.textContent ?? '').toContain('更改');
    } else {
      // Unscheduled-state fallback assertion (still validates wave-C mount)
      expect(screen.getByText('暂无下次测量安排')).toBeTruthy();
    }
  });

  it('renders the next-check unscheduled state with the admitted copy when no measurements are present', async () => {
    getMeasurementsMock.mockResolvedValueOnce([]);

    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('growth-next-check-card-unscheduled')).toBeTruthy();
    });

    expect(screen.queryByTestId('growth-next-check-card')).toBeNull();
    expect(screen.getByText('暂无下次测量安排')).toBeTruthy();
  });

  it('opens the next-check reschedule modal with date + cadence controls when the 更改 CTA is clicked', async () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    const cta = await screen.findByTestId('growth-next-check-cta-set-reminder');
    fireEvent.click(cta);

    // PO-GROWTH-DETAIL-006: the CTA opens the reschedule modal against the
    // child's age-active growth record_data reminder, exposing both the
    // next-occurrence date field and the cadence presets.
    await waitFor(() => {
      expect(screen.getByTestId('growth-next-check-modal')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByTestId('growth-next-check-date')).toBeTruthy();
    });
    expect(screen.getByText('复测频率')).toBeTruthy();
  });

  // ── Wave-D additions: history-table pagination/filter/export + Add CTA ──
  //
  // Per .nimi/topics/ongoing/2026-05-18-parentos-growth-curve-page-redesign/
  // packet-wave-d-history-and-capture-migration.md acceptance_invariants the
  // history table now exposes client-side pagination (10/page), time-range
  // filter (all/1y/6m/3m), CSV export with admitted column order, and the
  // Add CTA opens HealthCaptureModal with initialGroupId='growth'.

  it('renders history pagination controls when typeMeasurements has more than ten rows', async () => {
    const today = new Date();
    const dayMs = 86400000;
    const rows = Array.from({ length: 12 }, (_, index) => {
      const measuredAt = new Date(today.getTime() - (12 - index) * 14 * dayMs).toISOString();
      return {
        measurementId: `m-page-${index + 1}`,
        childId: 'child-1',
        typeId: 'height',
        value: 95 + index,
        measuredAt,
        ageMonths: 130 + index,
        percentile: null,
        source: 'manual',
        notes: null,
        createdAt: measuredAt,
      };
    });
    getMeasurementsMock.mockResolvedValueOnce(rows);

    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('next page')).toBeTruthy();
    });

    // First page renders exactly 10 rows; the 11th + 12th sit on page 2.
    const tbody = document.querySelector('table tbody');
    expect(tbody).toBeTruthy();
    expect(tbody!.querySelectorAll('tr').length).toBe(10);

    fireEvent.click(screen.getByLabelText('next page'));

    await waitFor(() => {
      const after = document.querySelector('table tbody')!.querySelectorAll('tr').length;
      expect(after).toBe(2);
    });
  });

  it('narrows visible history rows when the time-range filter switches to "近 3 月"', async () => {
    const todayMs = Date.now();
    const dayMs = 86400000;
    const recent = new Date(todayMs - 10 * dayMs).toISOString();
    const old = new Date(todayMs - 200 * dayMs).toISOString();
    getMeasurementsMock.mockResolvedValueOnce([
      {
        measurementId: 'm-recent',
        childId: 'child-1',
        typeId: 'height',
        value: 100,
        measuredAt: recent,
        ageMonths: 130,
        percentile: null,
        source: 'manual',
        notes: null,
        createdAt: recent,
      },
      {
        measurementId: 'm-old',
        childId: 'child-1',
        typeId: 'height',
        value: 92,
        measuredAt: old,
        ageMonths: 124,
        percentile: null,
        source: 'manual',
        notes: null,
        createdAt: old,
      },
    ]);

    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('time-range filter')).toBeTruthy();
    });

    // Both rows visible under the "all" default.
    expect(document.querySelector('table tbody')!.querySelectorAll('tr').length).toBe(2);

    fireEvent.change(screen.getByLabelText('time-range filter'), { target: { value: '3m' } });

    await waitFor(() => {
      const rows = document.querySelector('table tbody')!.querySelectorAll('tr').length;
      expect(rows).toBe(1);
    });
  });

  it('exports history as CSV with the admitted column order via the native save dialog', async () => {
    getMeasurementsMock.mockResolvedValueOnce([
      {
        measurementId: 'm-csv-1',
        childId: 'child-1',
        typeId: 'height',
        value: 100.5,
        measuredAt: '2025-12-10T00:00:00.000Z',
        ageMonths: 130,
        percentile: 50,
        source: 'manual',
        notes: null,
        createdAt: '2025-12-10T00:00:00.000Z',
      },
    ]);

    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('export csv')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('export csv'));

    // `<a download>` is inert in the Tauri WebView, so the export round-trips
    // through the native save-dialog pipeline (saveTextFileViaDialog).
    await waitFor(() => {
      expect(saveTextFileViaDialogMock).toHaveBeenCalledTimes(1);
    });

    const arg = saveTextFileViaDialogMock.mock.calls[0]![0] as {
      text: string;
      kind: string;
      defaultFilename: string;
    };
    expect(arg.kind).toBe('csv');
    // BOM stripped — the admitted header order, then the seeded row.
    const lines = arg.text.replace(String.fromCharCode(0xfeff), '').split('\n');
    expect(lines[0]).toBe('effective_date,age_label,value,unit,source,percentile');
    expect(lines[1]).toContain('2025-12-10');
    expect(lines[1]).toContain('100.5');
    expect(lines[1]).toContain('手动');
    expect(lines[1]).toContain('P50');
  });

  it('opens HealthCaptureModal with initialGroupId="growth" + initialMetricId from the selected metric when the Add CTA is clicked', async () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /添加记录/ })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /添加记录/ }));

    // HealthCaptureModal renders the growth group's form body when
    // initialGroupId='growth' — the form's own ModalHeader carries the
    // "添加生长记录" title (per growth-capture-content.tsx).
    await waitFor(() => {
      expect(screen.getByText('添加生长记录')).toBeTruthy();
    });
  });
});
