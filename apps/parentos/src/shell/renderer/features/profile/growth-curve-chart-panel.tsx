import { Surface, Tooltip as KitTooltip, cn } from '@nimiplatform/nimi-kit/ui';
import { Link } from 'react-router-dom';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import {
  GROWTH_STANDARD_LABELS,
  type GrowthStandard,
  type WHOLMSDataset,
} from './who-lms-loader.js';
import {
  buildMergedChartData,
  computeChartYDomain,
  formatAgeLabel,
  getGrowthStandardTooltip,
  getPercentileHint,
  type GrowthMetricDefinition,
  type MergedPoint,
} from './growth-curve-page-shared.js';

type GrowthCurveChartPanelProps = {
  chartData: Array<{ age: number; value: number; date?: string }>;
  selectedType: string;
  typeInfo: GrowthMetricDefinition | undefined;
  whoDataset: WHOLMSDataset | null;
  canShowWhoLines: boolean;
  growthStandard: GrowthStandard;
  onSelectGrowthStandard: (standard: GrowthStandard) => void;
  measurements: MeasurementRow[];
  ageMonths: number;
};

function computeXTicks(minAge: number, maxAge: number, span: number): number[] {
  const ticks: number[] = [];
  if (span > 48) {
    const startYear = Math.ceil(minAge / 12);
    const endYear = Math.floor(maxAge / 12);
    for (let y = startYear; y <= endYear; y++) ticks.push(y * 12);
  } else if (span > 24) {
    const start = Math.ceil(minAge / 6) * 6;
    for (let m = start; m <= maxAge; m += 6) ticks.push(m);
  } else {
    const start = Math.ceil(minAge / 3) * 3;
    for (let m = start; m <= maxAge; m += 3) ticks.push(m);
  }
  return ticks;
}

function formatXTick(age: number, span: number): string {
  if (span > 48) return `${age / 12}岁`;
  if (span > 24) {
    const years = Math.floor(age / 12);
    const months = age % 12;
    return months > 0 ? `${years}岁${months}月` : `${years}岁`;
  }
  return `${age}月`;
}

export function GrowthCurveChartPanel({
  chartData,
  selectedType,
  typeInfo,
  whoDataset,
  canShowWhoLines,
  growthStandard,
  onSelectGrowthStandard,
  measurements,
  ageMonths,
}: GrowthCurveChartPanelProps) {
  const standardLabel = GROWTH_STANDARD_LABELS[growthStandard];
  const referenceNote = whoDataset && !canShowWhoLines
    ? `当前年龄超出${standardLabel}百分位参考线覆盖范围，仅显示已记录数据。`
    : null;

  const colors = growthBandPalette();
  const userColor = growthMetricStroke();

  const chartAges = chartData.map((point) => point.age);
  const spanYears = chartAges.length >= 2
    ? (Math.max(...chartAges) - Math.min(...chartAges)) / 12
    : 0;

  return (
    <>
      <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="mb-6 rounded-3xl p-5">
        <div className="mb-4 flex items-center" data-testid="growth-curve-standard-toggle">
          <Surface
            tone="panel"
            elevation="base"
            padding="none"
            className="relative flex rounded-full p-0.5"
          >
            {/* Sliding active-segment indicator. Equal-width segments let the
                thumb translate exactly one segment (translate-x-full). */}
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-y-0.5 left-0.5 z-0 w-[calc(50%-0.125rem)] rounded-full',
                'bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)]',
                'transition-transform duration-[var(--nimi-motion-slow)] ease-out',
                growthStandard === 'who' ? 'translate-x-full' : 'translate-x-0',
              )}
            />
            {(['china', 'who'] as const).map((standard) => {
              const isActive = growthStandard === standard;
              return (
                <KitTooltip
                  key={standard}
                  className="relative z-10 flex-1"
                  content={<span className="whitespace-pre-line">{getGrowthStandardTooltip(standard)}</span>}
                  contentClassName="w-[280px] p-3 text-[13px] leading-relaxed"
                >
                  <button
                    type="button"
                    onClick={() => onSelectGrowthStandard(standard)}
                    className={cn(
                      'flex w-full min-h-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-[13px]',
                      'transition-colors duration-[var(--nimi-motion-fast)]',
                      isActive
                        ? 'font-medium text-[var(--nimi-text-primary)]'
                        : 'text-[var(--nimi-text-secondary)]',
                    )}
                  >
                    {GROWTH_STANDARD_LABELS[standard]}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-50">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                  </button>
                </KitTooltip>
              );
            })}
          </Surface>
        </div>
        {chartData.length === 0 ? (
          <div className="p-8 text-center">
            <span className="text-[24px]">📏</span>
            <p className="text-[14px] mt-2 font-medium text-[var(--nimi-text-primary)]">
              还没有{typeInfo?.displayName ?? selectedType}记录
            </p>
            <p className="text-[13px] mt-1 text-[var(--nimi-text-muted)]">点击右上角添加第一条记录</p>
          </div>
        ) : (
          (() => {
            const merged = buildMergedChartData(chartData, canShowWhoLines ? whoDataset : null);
            const ages = merged.map((item) => item.age);
            const minAge = Math.min(...ages);
            const maxAge = Math.max(...ages);
            const span = maxAge - minAge;
            const unit = typeInfo?.unit ?? '';
            const yDomain = computeChartYDomain(merged, selectedType);
            const xTicks = computeXTicks(minAge, maxAge, span);
            const hasBands = canShowWhoLines && whoDataset;
            return (
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={merged} margin={{ top: 10, right: 64, bottom: 28, left: 2 }}>
                  <defs>
                    <linearGradient id="gc-user-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={userColor} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={userColor} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--nimi-border-subtle)" vertical={false} />
                  <XAxis
                    dataKey="age"
                    type="number"
                    domain={[minAge, maxAge]}
                    ticks={xTicks}
                    tickFormatter={(age: number) => formatXTick(age, span)}
                    tick={{ fontSize: 10, fill: 'var(--nimi-text-muted)' }}
                    axisLine={{ stroke: 'var(--nimi-border-subtle)' }}
                    tickLine={{ stroke: 'var(--nimi-border-subtle)', strokeWidth: 0.5 }}
                    label={{ value: span > 24 ? '年龄' : '月龄', position: 'insideBottom', offset: -16, style: { fontSize: 10, fill: 'var(--nimi-text-muted)', fontWeight: 500 } }}
                  />
                  <YAxis
                    domain={yDomain}
                    tick={{ fontSize: 10, fill: 'var(--nimi-text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: unit, angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'var(--nimi-text-muted)' } }}
                    width={36}
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--nimi-border-strong)', strokeWidth: 1, strokeDasharray: '4 3' }}
                    isAnimationActive={false}
                    offset={12}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const userPoint = payload.find((item) => item.dataKey === 'value');
                      if (!userPoint || userPoint.value == null) return null;
                      const age = label as number;
                      const value = userPoint.value as number;
                      const point = payload[0]?.payload as MergedPoint | undefined;
                      const hint = point ? getPercentileHint(value, {
                        p3: point.p3,
                        p10: point.p10,
                        p25: point.p25,
                        p50: point.p50,
                        p75: point.p75,
                        p90: point.p90,
                        p97: point.p97,
                      }) : null;
                      return (
                        <div
                          className="pointer-events-none rounded-2xl border border-[var(--nimi-material-glass-thick-border)] bg-[var(--nimi-material-glass-thick-bg)] px-4 py-3 shadow-[var(--nimi-elevation-floating)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] nimi-material-glass-thick"
                          style={{
                            minWidth: 160,
                          }}
                        >
                          <p className="text-[13px] font-medium text-[var(--nimi-text-muted)]">
                            {formatAgeLabel(age)}
                            {point?.date ? ` · ${point.date}` : ''}
                          </p>
                          <p className="text-[20px] font-bold mt-1 tracking-tight text-[var(--nimi-text-primary)]">
                            {value}<span className="text-[14px] font-medium ml-1 text-[var(--nimi-text-muted)]">{unit}</span>
                          </p>
                          {hint ? <p className={`mt-1.5 text-[13px] font-medium ${percentileHintClassName(hint.text)}`}>{hint.text}</p> : null}
                        </div>
                      );
                    }}
                  />

                  {hasBands ? (
                    <>
                      <Area type="monotone" dataKey="p97" stroke="none" fill={colors.band} fillOpacity={0.09} isAnimationActive={false} connectNulls />
                      <Area type="monotone" dataKey="p3" stroke="none" fill={'var(--nimi-surface-card)'} isAnimationActive={false} connectNulls />
                      <Area type="monotone" dataKey="p90" stroke="none" fill={colors.band} fillOpacity={0.09} isAnimationActive={false} connectNulls />
                      <Area type="monotone" dataKey="p10" stroke="none" fill={'var(--nimi-surface-card)'} isAnimationActive={false} connectNulls />
                    </>
                  ) : null}

                  {[
                    { key: 'p97', label: '97%', width: 1.5, dash: '5 4', opacity: 0.5 },
                    { key: 'p90', label: '90%', width: 1.5, dash: '5 4', opacity: 0.78 },
                    { key: 'p50', label: '50%', width: 2, dash: '6 4', opacity: 1 },
                    { key: 'p10', label: '10%', width: 1.5, dash: '5 4', opacity: 0.78 },
                    { key: 'p3', label: '3%', width: 1.5, dash: '5 4', opacity: 0.5 },
                  ].map((line) => (
                    <Line
                      key={line.key}
                      type="monotone"
                      dataKey={line.key}
                      stroke={colors.line}
                      strokeWidth={line.width}
                      strokeDasharray={line.dash}
                      strokeOpacity={line.opacity}
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                      connectNulls
                      label={({ x, y, index, value }: { x: number; y: number; index: number; value: unknown }) =>
                        value != null && index === merged.length - 1
                          ? <text x={x + 5} y={y} dy={3} fontSize={8} fill={colors.line} fontWeight={line.key === 'p50' ? 600 : 400} opacity={0.85}>{line.label}</text>
                          : <g />}
                    />
                  ))}

                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="none"
                    fill="url(#gc-user-grad)"
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={userColor}
                    strokeWidth={2.5}
                    dot={(props: unknown) => {
                      const { cx, cy, value } = props as {
                        cx: number;
                        cy: number;
                        value: unknown;
                      };
                      if (value == null || typeof cx !== 'number' || typeof cy !== 'number') return <g />;
                      return (
                        <g>
                          <circle cx={cx} cy={cy} r={6} fill={userColor} opacity={0.12} />
                          <circle cx={cx} cy={cy} r={3.5} fill="var(--nimi-surface-card)" stroke={userColor} strokeWidth={2} />
                        </g>
                      );
                    }}
                    activeDot={(props: unknown) => {
                      const { cx, cy } = props as { cx: number; cy: number };
                      if (typeof cx !== 'number' || typeof cy !== 'number') return <g />;
                      return (
                        <g>
                          <circle cx={cx} cy={cy} r={10} fill={userColor} opacity={0.1} />
                          <circle cx={cx} cy={cy} r={5} fill="var(--nimi-surface-card)" stroke={userColor} strokeWidth={2.5} />
                        </g>
                      );
                    }}
                    connectNulls
                  />
                </ComposedChart>
              </ResponsiveContainer>
            );
          })()
        )}

        {referenceNote || chartData.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {referenceNote ? (
              <span className="text-[13px] text-[var(--nimi-text-muted)]">{referenceNote}</span>
            ) : null}
            {chartData.length > 0 ? (
              <span
                className="ml-auto text-[13px] text-[var(--nimi-text-muted)]"
                data-testid="growth-curve-sample-span"
              >
                样本 {chartData.length} 条 · 时间跨度 {spanYears.toFixed(1)} 年
              </span>
            ) : null}
          </div>
        ) : null}
      </Surface>

      {selectedType === 'height' ? (
        (() => {
          const boneAgeRecords = measurements
            .filter((measurement) => measurement.typeId === 'bone-age')
            .sort((left, right) => right.measuredAt.localeCompare(left.measuredAt));
          const latest = boneAgeRecords[0];
          if (!latest) return null;
          const boneAgeYears = latest.value;
          const actualAgeYears = ageMonths / 12;
          const diff = boneAgeYears - actualAgeYears;
          const absDiff = Math.abs(diff);
          const status = absDiff <= 1
            ? { label: '正常范围', className: 'border-[color-mix(in_srgb,var(--nimi-status-success)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-success)]', dot: 'bg-[var(--nimi-status-success)]' }
            : diff > 1
              ? { label: `偏早 ${absDiff.toFixed(1)} 年`, className: 'border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]', dot: 'bg-[var(--nimi-status-warning)]' }
              : { label: `偏晚 ${absDiff.toFixed(1)} 年`, className: 'border-[color-mix(in_srgb,var(--nimi-status-info)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-info)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-info)]', dot: 'bg-[var(--nimi-status-info)]' };
          const actualAgeStr = `${Math.floor(ageMonths / 12)} 岁 ${ageMonths % 12} 月`;
          return (
            <div className={`mb-4 flex items-start gap-3 rounded-3xl border p-4 ${status.className}`}>
              <span className="text-[20px] mt-0.5">🦴</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">骨龄 {boneAgeYears} 岁</span>
                  <span className="text-[13px] text-[var(--nimi-text-muted)]">（实际 {actualAgeStr}）</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`inline-block h-2 w-2 rounded-full ${status.dot}`} />
                  <span className="text-[14px]">{status.label}</span>
                  {absDiff > 1 ? <span className="text-[13px] text-[var(--nimi-text-muted)]"> — 建议关注身高增长趋势</span> : null}
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-[12px] text-[var(--nimi-text-muted)]">评估日期：{latest.measuredAt.split('T')[0]}</span>
            <Link to="/profile" className="text-[12px] hover:underline text-[var(--nimi-action-primary-bg)]">
                    详细记录 → 青春期发育
                  </Link>
                </div>
              </div>
            </div>
          );
        })()
      ) : null}
    </>
  );
}

// The child's own measured series is the page's green "life line". It reads
// the same life-energy green for every metric so the growth signal stays
// consistent regardless of which tab is active.
function growthMetricStroke(): string {
  return 'var(--nimi-action-primary-bg)';
}

// Percentile reference bands + lines are the analytical layer behind the green
// life line — the blue-violet analysis accent. These strings are consumed as
// raw SVG `fill` / `stroke` attributes: only plain `var()` tokens are used
// (`color-mix()` does not resolve as a raw SVG paint value in the WebView).
// The P50 / P10–P90 / P3–P97 visual hierarchy comes from stroke width +
// opacity, applied on the chart elements — not from hue.
function growthBandPalette(): { band: string; line: string } {
  const accent = 'var(--nimi-color-indigo)';
  return { band: accent, line: accent };
}

function percentileHintClassName(text: string): string {
  if (text.includes('建议')) return 'text-[var(--nimi-status-danger)]';
  if (text.includes('偏低') || text.includes('偏高')) return 'text-[var(--nimi-status-warning)]';
  if (text.includes('平均')) return 'text-[var(--nimi-text-secondary)]';
  return 'text-[var(--nimi-status-success)]';
}
