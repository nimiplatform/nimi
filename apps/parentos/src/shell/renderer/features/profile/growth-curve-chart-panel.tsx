import { Surface } from '@nimiplatform/nimi-kit/ui';
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
  measurements,
  ageMonths,
}: GrowthCurveChartPanelProps) {
  const standardLabel = GROWTH_STANDARD_LABELS[growthStandard];
  const referenceNote = whoDataset
    ? (canShowWhoLines
        ? `${standardLabel}百分位参考线（P3-P97）已加载。`
        : `当前年龄超出${standardLabel}百分位参考线覆盖范围，仅显示已记录数据。`)
    : null;

  const colors = growthBandPalette(growthStandard);
  const userColor = growthMetricStroke(selectedType);

  return (
    <>
      <Surface tone="card" material="glass-regular" elevation="raised" padding="none" className="mb-6 rounded-3xl p-5">
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
                      <Area type="monotone" dataKey="p97" stroke="none" fill={colors.outer} isAnimationActive={false} connectNulls />
                      <Area type="monotone" dataKey="p3" stroke="none" fill={'var(--nimi-surface-card)'} isAnimationActive={false} connectNulls />
                      <Area type="monotone" dataKey="p90" stroke="none" fill={colors.inner} isAnimationActive={false} connectNulls />
                      <Area type="monotone" dataKey="p10" stroke="none" fill={'var(--nimi-surface-card)'} isAnimationActive={false} connectNulls />
                    </>
                  ) : null}

                  {[
                    { key: 'p97', label: '97%', width: 0.8, dash: '3 4', color: colors.far },
                    { key: 'p90', label: '90%', width: 0.8, dash: '3 4', color: colors.edge },
                    { key: 'p50', label: '50%', width: 1.5, dash: '5 4', color: colors.median },
                    { key: 'p10', label: '10%', width: 0.8, dash: '3 4', color: colors.edge },
                    { key: 'p3', label: '3%', width: 0.8, dash: '3 4', color: colors.far },
                  ].map((line) => (
                    <Line
                      key={line.key}
                      type="monotone"
                      dataKey={line.key}
                      stroke={line.color}
                      strokeWidth={line.width}
                      strokeDasharray={line.dash}
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                      connectNulls
                      label={({ x, y, index, value }: { x: number; y: number; index: number; value: unknown }) =>
                        value != null && index === merged.length - 1
                          ? <text x={x + 5} y={y} dy={3} fontSize={8} fill={line.color} fontWeight={line.key === 'p50' ? 600 : 400} opacity={0.85}>{line.label}</text>
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
                      const { cx, cy, value, index, payload } = props as {
                        cx: number;
                        cy: number;
                        value: unknown;
                        index: number;
                        payload: MergedPoint;
                      };
                      if (value == null || typeof cx !== 'number' || typeof cy !== 'number') return <g />;
                      const userPoints = merged.filter((point) => point.value != null);
                      const lastUserPoint = userPoints[userPoints.length - 1];
                      const isLastUserPoint = lastUserPoint != null && payload?.age === lastUserPoint.age;
                      const dot = (
                        <g>
                          <circle cx={cx} cy={cy} r={6} fill={userColor} opacity={0.12} />
                          <circle cx={cx} cy={cy} r={3.5} fill="var(--nimi-surface-card)" stroke={userColor} strokeWidth={2} />
                        </g>
                      );
                      if (!isLastUserPoint) return dot;
                      const pct = getPercentileHint(value as number, {
                        p3: payload?.p3,
                        p10: payload?.p10,
                        p25: payload?.p25,
                        p50: payload?.p50,
                        p75: payload?.p75,
                        p90: payload?.p90,
                        p97: payload?.p97,
                      });
                      const ageLabel = formatAgeLabel(payload?.age ?? 0);
                      const dateLabel = payload?.date ? ` · ${payload.date}` : '';
                      const lineOne = `${ageLabel}${dateLabel}`;
                      const lineTwo = `${value} ${typeInfo?.unit ?? ''}${pct ? ` · ${pct.text}` : ''}`;
                      // Auto-flip left/up to stay inside chart viewport.
                      const flipUp = cy < 60;
                      const flipLeft = cx > 220; // chart inner width ~ 320-360px
                      const calloutW = 168;
                      const calloutH = 44;
                      const padX = 10;
                      const padY = 14;
                      const calloutX = flipLeft ? cx - calloutW - padX : cx + padX;
                      const calloutY = flipUp ? cy + padY : cy - calloutH - padY;
                      const pointerX = flipLeft ? cx - padX + 2 : cx + padX - 2;
                      const pointerY = flipUp ? cy + padY : cy - padY;
                      void index; // referenced for prop-typing; logic uses payload identity
                      return (
                        <g>
                          {dot}
                          <g pointerEvents="none">
                            <line
                              x1={cx}
                              y1={cy}
                              x2={pointerX}
                              y2={pointerY}
                              stroke="var(--nimi-text-primary)"
                              strokeWidth={1}
                              opacity={0.55}
                            />
                            <rect
                              x={calloutX}
                              y={calloutY}
                              rx={8}
                              ry={8}
                              width={calloutW}
                              height={calloutH}
                              fill="var(--nimi-text-primary)"
                              opacity={0.92}
                            />
                            <text
                              x={calloutX + 10}
                              y={calloutY + 16}
                              fontSize={11}
                              fill="var(--nimi-surface-card)"
                              opacity={0.75}
                            >
                              {lineOne}
                            </text>
                            <text
                              x={calloutX + 10}
                              y={calloutY + 32}
                              fontSize={12}
                              fontWeight={600}
                              fill="var(--nimi-surface-card)"
                            >
                              {lineTwo}
                            </text>
                          </g>
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
      </Surface>

      {referenceNote ? (
        <div
          className="mb-4 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2 text-[13px] text-[var(--nimi-text-muted)]"
        >
          {referenceNote}
        </div>
      ) : null}

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

function growthMetricStroke(selectedType: string): string {
  if (selectedType === 'weight') return 'var(--nimi-status-success)';
  if (selectedType === 'head-circumference') return 'var(--nimi-status-warning)';
  if (selectedType === 'bmi') return 'var(--nimi-status-info)';
  return 'var(--nimi-action-primary-bg)';
}

function growthBandPalette(growthStandard: GrowthStandard): {
  outer: string;
  inner: string;
  median: string;
  edge: string;
  far: string;
} {
  if (growthStandard === 'china') {
    return {
      outer: 'color-mix(in_srgb,var(--nimi-status-warning)_8%,transparent)',
      inner: 'color-mix(in_srgb,var(--nimi-status-danger)_6%,transparent)',
      median: 'var(--nimi-status-danger)',
      edge: 'var(--nimi-status-warning)',
      far: 'color-mix(in_srgb,var(--nimi-status-warning)_68%,var(--nimi-text-muted))',
    };
  }
  return {
    outer: 'color-mix(in_srgb,var(--nimi-status-info)_8%,transparent)',
    inner: 'color-mix(in_srgb,var(--nimi-status-info)_6%,transparent)',
    median: 'var(--nimi-status-info)',
    edge: 'color-mix(in_srgb,var(--nimi-status-info)_72%,var(--nimi-action-primary-bg))',
    far: 'color-mix(in_srgb,var(--nimi-status-info)_52%,var(--nimi-text-muted))',
  };
}

function percentileHintClassName(text: string): string {
  if (text.includes('建议')) return 'text-[var(--nimi-status-danger)]';
  if (text.includes('偏低') || text.includes('偏高')) return 'text-[var(--nimi-status-warning)]';
  if (text.includes('平均')) return 'text-[var(--nimi-text-secondary)]';
  return 'text-[var(--nimi-status-success)]';
}
