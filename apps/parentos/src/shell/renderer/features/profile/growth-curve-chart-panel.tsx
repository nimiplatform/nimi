import { Link } from 'react-router-dom';
import {
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

  return (
    <>
      <div className={`${S.radius} p-4 mb-6`} style={{ background: S.card, boxShadow: S.shadow }}>
        {chartData.length === 0 ? (
          <div className="p-8 text-center">
            <span className="text-[28px]">📏</span>
            <p className="text-[13px] mt-2 font-medium" style={{ color: S.text }}>
              还没有{typeInfo?.displayName ?? selectedType}记录
            </p>
            <p className="text-[11px] mt-1" style={{ color: S.sub }}>点击右上角添加第一条记录</p>
          </div>
        ) : (
          (() => {
            const merged = buildMergedChartData(chartData, canShowWhoLines ? whoDataset : null);
            const ages = merged.map((item) => item.age);
            const span = Math.max(...ages) - Math.min(...ages);
            const unit = typeInfo?.unit ?? '';
            const yDomain = computeChartYDomain(merged, selectedType);
            return (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={merged} margin={{ top: 5, right: 36, bottom: 20, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0ec" />
                  <XAxis
                    dataKey="age"
                    tickFormatter={(age: number) => {
                      if (span > 48) return age % 12 === 0 ? `${age / 12}岁` : '';
                      if (span > 24) return age % 6 === 0 ? `${Math.floor(age / 12)}岁${age % 12 > 0 ? `${age % 12}月` : ''}` : '';
                      return `${age}月`;
                    }}
                    label={{ value: span > 24 ? '年龄' : '月龄', position: 'insideBottom', offset: -10, style: { fontSize: 11, fill: '#475569' } }}
                    tick={{ fontSize: 10, fill: '#475569' }}
                  />
                  <YAxis
                    domain={yDomain}
                    label={{ value: unit, angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#475569' } }}
                    tick={{ fontSize: 10, fill: '#475569' }}
                  />
                  <Tooltip
                    cursor={false}
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
                          className="rounded-xl p-3 shadow-lg pointer-events-none"
                          style={{ background: '#fff', border: '1px solid #f1f5f9', minWidth: 160 }}
                        >
                          <p className="text-[11px] font-medium" style={{ color: '#475569' }}>
                            {formatAgeLabel(age)}
                            {point?.date ? ` (${point.date})` : ''}
                          </p>
                          <p className="text-[18px] font-bold mt-1" style={{ color: '#1e293b' }}>{value} {unit}</p>
                          {hint ? <p className="text-[11px] mt-1.5" style={{ color: hint.color }}>{hint.text}</p> : null}
                        </div>
                      );
                    }}
                  />

                  {[
                    { key: 'p97', label: '97%', width: 1, dash: '4 3', color: growthStandard === 'china' ? '#c4a882' : '#9bb0cc' },
                    { key: 'p90', label: '90%', width: 1.2, dash: '6 3', color: growthStandard === 'china' ? '#d4956a' : '#6a9fd8' },
                    { key: 'p50', label: '50%', width: 1.8, dash: '6 3', color: growthStandard === 'china' ? '#d94040' : '#3a7fd6' },
                    { key: 'p10', label: '10%', width: 1.2, dash: '6 3', color: growthStandard === 'china' ? '#d4956a' : '#6a9fd8' },
                    { key: 'p3', label: '3%', width: 1, dash: '4 3', color: growthStandard === 'china' ? '#c4a882' : '#9bb0cc' },
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
                          ? <text x={x + 4} y={y} dy={4} fontSize={9} fill={line.color} fontWeight={line.key === 'p50' ? 600 : 400}>{line.label}</text>
                          : <g />}
                    />
                  ))}
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={TYPE_COLORS[selectedType] ?? '#6366f1'}
                    strokeWidth={2.5}
                    dot={(props: Record<string, unknown>) => {
                      const { cx, cy, value } = props as { cx: number; cy: number; value: unknown };
                      if (value == null || typeof cx !== 'number' || typeof cy !== 'number') return <g />;
                      return <circle cx={cx} cy={cy} r={4} fill="#fff" stroke={TYPE_COLORS[selectedType] ?? '#6366f1'} strokeWidth={2} />;
                    }}
                    activeDot={{ r: 6, strokeWidth: 2.5, fill: '#fff', stroke: TYPE_COLORS[selectedType] ?? '#6366f1' }}
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
          className={`${S.radiusSm} px-3 py-2 mb-4 text-[11px]`}
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
                  <span className="text-[14px] font-semibold" style={{ color: S.text }}>骨龄 {boneAgeYears} 岁</span>
                  <span className="text-[11px]" style={{ color: S.sub }}>（实际 {actualAgeStr}）</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: status.color }} />
                  <span className="text-[12px]" style={{ color: status.color }}>{status.label}</span>
                  {absDiff > 1 ? <span className="text-[11px]" style={{ color: S.sub }}> — 建议关注身高增长趋势</span> : null}
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-[10px]" style={{ color: S.sub }}>评估日期：{latest.measuredAt.split('T')[0]}</span>
                  <Link to="/profile/tanner" className="text-[10px] hover:underline" style={{ color: S.accent }}>
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
