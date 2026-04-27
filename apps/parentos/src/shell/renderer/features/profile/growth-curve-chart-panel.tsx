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
import { S } from '../../app-shell/page-style.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import {
  GROWTH_STANDARD_LABELS,
  type GrowthStandard,
  type WHOLMSDataset,
} from './who-lms-loader.js';
import {
  TYPE_COLORS,
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

const BAND_COLORS = {
  china: { outer: 'rgba(212,149,106,0.08)', inner: 'rgba(217,64,64,0.06)', median: '#d94040', edge: '#d4956a', far: '#c4a882' },
  who: { outer: 'rgba(154,176,204,0.08)', inner: 'rgba(58,127,214,0.06)', median: '#3a7fd6', edge: '#6a9fd8', far: '#9bb0cc' },
} as const;

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

  const colors = BAND_COLORS[growthStandard];
  const userColor = TYPE_COLORS[selectedType] ?? '#6366f1';

  return (
    <>
      <div className={`${S.radius} p-5 mb-6`} style={{ background: S.card, boxShadow: S.shadow }}>
        {chartData.length === 0 ? (
          <div className="p-8 text-center">
            <span className="text-[24px]">📏</span>
            <p className="text-[14px] mt-2 font-medium" style={{ color: S.text }}>
              还没有{typeInfo?.displayName ?? selectedType}记录
            </p>
            <p className="text-[13px] mt-1" style={{ color: S.sub }}>点击右上角添加第一条记录</p>
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
                <ComposedChart data={merged} margin={{ top: 10, right: 38, bottom: 28, left: 2 }}>
                  <defs>
                    <linearGradient id="gc-user-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={userColor} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={userColor} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f0ed" vertical={false} />
                  <XAxis
                    dataKey="age"
                    type="number"
                    domain={[minAge, maxAge]}
                    ticks={xTicks}
                    tickFormatter={(age: number) => formatXTick(age, span)}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={{ stroke: '#e2e8f0' }}
                    tickLine={{ stroke: '#e2e8f0', strokeWidth: 0.5 }}
                    label={{ value: span > 24 ? '年龄' : '月龄', position: 'insideBottom', offset: -16, style: { fontSize: 10, fill: '#94a3b8', fontWeight: 500 } }}
                  />
                  <YAxis
                    domain={yDomain}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    label={{ value: unit, angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }}
                    width={36}
                  />
                  <Tooltip
                    cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 3' }}
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
                          className="rounded-2xl px-4 py-3 pointer-events-none nimi-material-glass-thick bg-[var(--nimi-material-glass-thick-bg)] border border-[var(--nimi-material-glass-thick-border)] backdrop-blur-[var(--nimi-backdrop-blur-strong)] shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
                          style={{
                            minWidth: 160,
                          }}
                        >
                          <p className="text-[13px] font-medium" style={{ color: '#94a3b8' }}>
                            {formatAgeLabel(age)}
                            {point?.date ? ` · ${point.date}` : ''}
                          </p>
                          <p className="text-[20px] font-bold mt-1 tracking-tight" style={{ color: '#1e293b' }}>
                            {value}<span className="text-[14px] font-medium ml-1" style={{ color: '#94a3b8' }}>{unit}</span>
                          </p>
                          {hint ? <p className="text-[13px] mt-1.5 font-medium" style={{ color: hint.color }}>{hint.text}</p> : null}
                        </div>
                      );
                    }}
                  />

                  {hasBands ? (
                    <>
                      <Area type="monotone" dataKey="p97" stroke="none" fill={colors.outer} isAnimationActive={false} connectNulls />
                      <Area type="monotone" dataKey="p3" stroke="none" fill={S.card} isAnimationActive={false} connectNulls />
                      <Area type="monotone" dataKey="p90" stroke="none" fill={colors.inner} isAnimationActive={false} connectNulls />
                      <Area type="monotone" dataKey="p10" stroke="none" fill={S.card} isAnimationActive={false} connectNulls />
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
                      const { cx, cy, value } = props as { cx: number; cy: number; value: unknown };
                      if (value == null || typeof cx !== 'number' || typeof cy !== 'number') return <g />;
                      return (
                        <g>
                          <circle cx={cx} cy={cy} r={6} fill={userColor} opacity={0.12} />
                          <circle cx={cx} cy={cy} r={3.5} fill="#fff" stroke={userColor} strokeWidth={2} />
                        </g>
                      );
                    }}
                    activeDot={(props: unknown) => {
                      const { cx, cy } = props as { cx: number; cy: number };
                      if (typeof cx !== 'number' || typeof cy !== 'number') return <g />;
                      return (
                        <g>
                          <circle cx={cx} cy={cy} r={10} fill={userColor} opacity={0.1} />
                          <circle cx={cx} cy={cy} r={5} fill="#fff" stroke={userColor} strokeWidth={2.5} />
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
      </div>

      {referenceNote ? (
        <div
          className={`${S.radiusSm} px-3 py-2 mb-4 text-[13px]`}
          style={{ background: '#f7f6f2', border: `1px solid ${S.border}`, color: S.sub }}
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
            ? { label: '正常范围', color: '#22c55e', bg: '#f0fdf4' }
            : diff > 1
              ? { label: `偏早 ${absDiff.toFixed(1)} 年`, color: '#f59e0b', bg: '#fffbeb' }
              : { label: `偏晚 ${absDiff.toFixed(1)} 年`, color: '#3b82f6', bg: '#eff6ff' };
          const actualAgeStr = `${Math.floor(ageMonths / 12)} 岁 ${ageMonths % 12} 月`;
          return (
            <div className={`${S.radius} p-4 mb-4 flex items-start gap-3`} style={{ background: status.bg, border: `1px solid ${status.color}30` }}>
              <span className="text-[20px] mt-0.5">🦴</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[16px] font-semibold" style={{ color: S.text }}>骨龄 {boneAgeYears} 岁</span>
                  <span className="text-[13px]" style={{ color: S.sub }}>（实际 {actualAgeStr}）</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: status.color }} />
                  <span className="text-[14px]" style={{ color: status.color }}>{status.label}</span>
                  {absDiff > 1 ? <span className="text-[13px]" style={{ color: S.sub }}> — 建议关注身高增长趋势</span> : null}
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-[12px]" style={{ color: S.sub }}>评估日期：{latest.measuredAt.split('T')[0]}</span>
                  <Link to="/profile/tanner" className="text-[12px] hover:underline" style={{ color: S.accent }}>
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
