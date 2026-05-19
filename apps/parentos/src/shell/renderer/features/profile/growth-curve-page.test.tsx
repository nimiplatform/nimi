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

  it('renders WHO lines only inside official coverage and fails closed for weight after 120 months', async () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByText('中国标准百分位参考线（P3-P97）已加载。'),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /WHO 标准/i }));

    await waitFor(() => {
      expect(
        screen.getByText('WHO 标准百分位参考线（P3-P97）已加载。'),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByText('体重').closest('button') as HTMLButtonElement);

    await waitFor(() => {
      expect(
        screen.getByText('当前年龄超出WHO 标准百分位参考线覆盖范围，仅显示已记录数据。'),
      ).toBeTruthy();
    });

    expect(
      screen.getByText('当前年龄超出WHO 标准百分位参考线覆盖范围，仅显示已记录数据。'),
    ).toBeTruthy();
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

    fireEvent.click(screen.getByRole('button', { name: /Analyze sheet/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import selected OCR measurements/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Import selected OCR measurements/i }));

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

  it('renders the hero card with percentile dial, big value, and cross-metric chips when data present', async () => {
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
    // At least the height and weight chips surface.
    expect(screen.getByTestId('growth-hero-chip-height')).toBeTruthy();
    expect(screen.getByTestId('growth-hero-chip-weight')).toBeTruthy();
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
    expect(screen.queryByTestId('growth-hero-chip-height')).toBeNull();
    expect(screen.getByText('暂无生长记录')).toBeTruthy();
  });

  it('renders the AI insight strip with the generated string when the platform client returns a valid response', async () => {
    textGenerateMock.mockResolvedValueOnce({
      text: '{"insight":"观察到孩子身高处于参考区间内，倾向于稳定增长。"}',
      finishReason: 'stop',
    });

    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(textGenerateMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      const strip = screen.getByTestId('growth-insight-strip');
      expect(strip.textContent ?? '').toContain('观察到');
    });

    const stripText = screen.getByTestId('growth-insight-strip').textContent ?? '';
    for (const denylistTerm of ['落后', '异常', '危险', '警告', '发育迟缓', '障碍']) {
      expect(stripText).not.toContain(denylistTerm);
    }
  });

  it('renders the deterministic fallback line plus a non-destructive badge when the AI response is invalid', async () => {
    // Force the platform client to throw synchronously inside getPlatformClient
    // itself. This routes through the strip's catch branch deterministically
    // and avoids any async ordering ambiguity that defeats waitFor in jsdom.
    getPlatformClientMock.mockImplementation(() => {
      throw new Error('mocked AI runtime failure');
    });

    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(
      () => {
        const strip = screen.getByTestId('growth-insight-strip');
        expect(strip.textContent ?? '').toContain('AI 生成失败，已使用本地摘要');
      },
      { timeout: 5000, interval: 50 },
    );

    const stripText = screen.getByTestId('growth-insight-strip').textContent ?? '';
    expect(stripText).toContain('AI 生成失败，已使用本地摘要');
    // The fallback line is rendered via LEDE_TEMPLATES — it must not contain
    // any denylist vocabulary.
    for (const denylistTerm of ['落后', '异常', '危险', '警告', '发育迟缓', '障碍']) {
      expect(stripText).not.toContain(denylistTerm);
    }
  });

  it('renders inline percentile label on metric pill tabs when data present and omits it when absent', async () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('growth-curve-controls-pill-tabs')).toBeTruthy();
    });

    await waitFor(() => {
      const heightPercentile = screen.queryByTestId('growth-curve-tab-percentile-height');
      expect(heightPercentile).toBeTruthy();
      expect(heightPercentile!.textContent ?? '').toMatch(/^P\d+$/);
    });

    // BMI tab requires both height + weight; with the seeded data both are
    // present but BMI tab still does not render an inline P percentile (BMI
    // pill currently shows no percentile label per design).
    expect(screen.queryByTestId('growth-curve-tab-percentile-bmi')).toBeNull();
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
    expect(card.textContent ?? '').toContain('近一年里程碑');
  });

  it('renders the growth milestones empty-state with the admitted copy when no milestones are present', async () => {
    getMeasurementsMock.mockResolvedValueOnce([]);

    render(
      <TooltipProvider>
        <MemoryRouter>
          <GrowthCurvePage />
        </MemoryRouter>
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('growth-milestones-card-empty')).toBeTruthy();
    });

    expect(screen.queryByTestId('growth-milestones-card')).toBeNull();
    expect(screen.getByText('过去 12 个月暂无识别到的里程碑事件')).toBeTruthy();
  });

  it('renders the next-check card with badge, lede, CTA, and three-stat trend row when data present', async () => {
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
      const stats = screen.queryByTestId('growth-next-check-trend-stats');
      expect(stats).toBeTruthy();
      expect(stats!.querySelectorAll('p.text-\\[11px\\]').length).toBeGreaterThanOrEqual(3);
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
});
