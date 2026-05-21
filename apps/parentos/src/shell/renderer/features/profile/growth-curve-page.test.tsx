// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@nimiplatform/nimi-kit/ui';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GrowthCurvePage from './growth-curve-page.js';
import { useAppStore } from '../../app-shell/app-store.js';
import { i18n } from '../../i18n/index.js';

// Sentinel that mirrors the current router location into the DOM so wave-C
// next-check CTA deep-link navigation can be asserted without mocking
// react-router-dom.
function LocationSentinel() {
  const location = useLocation();
  return (
    <div
      data-testid="location-sentinel"
      data-pathname={location.pathname}
      data-search={location.search}
    />
  );
}

const {
  getMeasurementsMock,
  insertMeasurementMock,
  updateMeasurementMock,
  deleteMeasurementMock,
  hasCheckupOCRRuntimeMock,
  analyzeCheckupSheetOCRMock,
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
  hasCheckupOCRRuntimeMock: vi.fn().mockResolvedValue(true),
  analyzeCheckupSheetOCRMock: vi.fn().mockResolvedValue({
    measurements: [
      {
        typeId: 'height',
        value: 100.2,
        measuredAt: '2026-03-01',
        notes: 'OCR row 1',
      },
      {
        typeId: 'weight',
        value: 16.1,
        measuredAt: '2026-03-01',
        notes: null,
      },
    ],
  }),
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

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Line: ({ name }: { name?: string }) => <div>{name ?? 'line'}</div>,
  Area: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

vi.mock('./checkup-ocr.js', () => ({
  hasCheckupOCRRuntime: hasCheckupOCRRuntimeMock,
  analyzeCheckupSheetOCR: analyzeCheckupSheetOCRMock,
  readImageFileAsDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
}));

describe('GrowthCurvePage', () => {
  beforeEach(() => {
    i18n.changeLanguage('zh');
    getMeasurementsMock.mockClear();
    insertMeasurementMock.mockClear();
    updateMeasurementMock.mockClear();
    deleteMeasurementMock.mockClear();
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
    hasCheckupOCRRuntimeMock.mockResolvedValue(true);
    analyzeCheckupSheetOCRMock.mockResolvedValue({
      measurements: [
        {
          typeId: 'height',
          value: 100.2,
          measuredAt: '2026-03-01',
          notes: 'OCR row 1',
        },
        {
          typeId: 'weight',
          value: 16.1,
          measuredAt: '2026-03-01',
          notes: null,
        },
      ],
    });

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

  it('imports OCR candidates only after parent confirmation and stores them as source=ocr', async () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /智能识别/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /智能识别/i }));
    fireEvent.change(screen.getByLabelText('checkup-sheet-file'), {
      target: {
        files: [new File(['fake-image'], 'checkup.png', { type: 'image/png' })],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('ocr-image-name')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /开始识别/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /导入选中数据/ })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /导入选中数据/ }));

    await waitFor(() => {
      expect(insertMeasurementMock).toHaveBeenCalledTimes(2);
    });

    expect(insertMeasurementMock).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'height',
      source: 'ocr',
      notes: 'OCR row 1',
    }));
    expect(insertMeasurementMock).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'weight',
      source: 'ocr',
      notes: null,
    }));
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
    expect(card.textContent ?? '').toContain('生长里程碑');
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

    expect(screen.getByText('暂无识别到的里程碑事件')).toBeTruthy();
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
      expect(scheduled.textContent ?? '').toContain('设为提醒');
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

  it('navigates to /timeline?focus=growth&metric=<id> when the next-check set-reminder CTA is clicked on the deep_link_only branch', async () => {
    render(
      <TooltipProvider>
        <MemoryRouter initialEntries={['/profile/growth']}>
          <GrowthCurvePage />
          <LocationSentinel />
        </MemoryRouter>
      </TooltipProvider>,
    );

    const cta = await screen.findByTestId('growth-next-check-cta-set-reminder');
    fireEvent.click(cta);

    await waitFor(() => {
      const sentinel = screen.getByTestId('location-sentinel');
      expect(sentinel.getAttribute('data-pathname')).toBe('/timeline');
      const search = sentinel.getAttribute('data-search') ?? '';
      expect(search).toContain('focus=growth');
      expect(search).toContain('metric=');
    });
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

  it('emits a CSV blob with the admitted column order on history export', async () => {
    const captured: Blob[] = [];
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    // Capture the blob handed to the download trigger; jsdom does not
    // simulate <a download> navigation, but URL.createObjectURL still
    // receives the constructed blob.
    URL.createObjectURL = vi.fn((blob: Blob) => {
      captured.push(blob);
      return 'blob:mock';
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();

    try {
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

      await waitFor(() => {
        expect(captured.length).toBe(1);
      });

      const text = await captured[0]!.text();
      const lines = text.split('\n');
      // First line is the header in the admitted order.
      expect(lines[0]).toBe('effective_date,age_label,value,unit,source,percentile');
      // Second line is the seeded row.
      expect(lines[1]).toContain('2025-12-10');
      expect(lines[1]).toContain('100.5');
      expect(lines[1]).toContain('手动');
      expect(lines[1]).toContain('P50');
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
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
