import { Surface } from '@nimiplatform/kit/ui';
import type {
  GrowthChip,
  GrowthHeadline,
  GrowthTrendKind,
  GrowthTrendStat,
} from './growth-detail-projection.js';

// growth-hero-card.tsx — PO-GROWTH-DETAIL-002 hero composition.
// Pure render of `GrowthHeadline` + `GrowthTrendStat[]` projected by wave-A.
// No useState/useEffect for projection data, no AI, no bridge, no Date.now().

/** One bar of the hero year-over-year growth chart. */
export interface GrowthYearlyRate {
  year: number;
  growth: number;
}

export interface GrowthHeroCardProps {
  headline: GrowthHeadline;
  trendStats: GrowthTrendStat[];
  selectedMetricDisplayName: string;
  selectedMetricUnit: string;
  /** Per-year growth rate for the selected metric, ascending by year. */
  yearlyGrowth: GrowthYearlyRate[];
}

const CHIP_TONE_CLASSNAMES: Record<GrowthChip['tone'], string> = {
  // `success` carries the growth/life signal — green, matching the milestone
  // timeline and the chart's measured line.
  success:
    'border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)]',
  warn:
    'border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]',
  info:
    'border-[color-mix(in_srgb,var(--nimi-color-indigo)_28%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-color-indigo)_8%,var(--nimi-surface-card))] text-[var(--nimi-color-indigo)]',
  neutral:
    'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)]',
};

// Status pill reflects the growth trend (steady / accelerating / …), which is
// derived from the child's own measurement series and needs no reference data.
const TREND_PILL: Record<GrowthTrendKind, { label: string; tone: GrowthChip['tone'] }> = {
  steady: { label: '生长稳定', tone: 'success' },
  accelerating: { label: '生长加速', tone: 'success' },
  decelerating: { label: '生长放缓', tone: 'warn' },
  plateau: { label: '生长平台期', tone: 'warn' },
};

function statusPillForHeadline(headline: GrowthHeadline): { label: string; tone: GrowthChip['tone'] } {
  if (headline.state === 'no_data') return { label: '暂无数据', tone: 'neutral' };
  return TREND_PILL[headline.trend];
}

function clampPercentile(percentile: number | null | undefined): number | null {
  if (percentile == null || Number.isNaN(percentile)) return null;
  if (percentile < 0) return 0;
  if (percentile > 100) return 100;
  return percentile;
}

// ---------------------------------------------------------------------------
// SemiCircleGauge — 180° arc gauge showing the percentile.
// ---------------------------------------------------------------------------

function SemiCircleGauge({ percentile }: { percentile: number | null }) {
  const width = 128;
  const stroke = 10;
  const radius = width / 2 - stroke / 2;
  const cx = width / 2;
  const cy = width / 2;
  const height = cy + stroke / 2;
  const total = Math.PI * radius;
  const pct = percentile == null ? 0 : Math.max(0, Math.min(100, percentile));
  const filled = (pct / 100) * total;
  const arcPath = `M ${stroke / 2} ${cy} A ${radius} ${radius} 0 0 1 ${width - stroke / 2} ${cy}`;
  const theta = Math.PI * (1 - pct / 100);
  const knobX = cx + radius * Math.cos(theta);
  const knobY = cy - radius * Math.sin(theta);
  return (
    <div className="relative inline-flex shrink-0">
      <svg
        role="img"
        aria-label={percentile == null ? '百分位未知' : `百分位 P${percentile}`}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id="growth-gauge-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--nimi-action-primary-bg)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--nimi-action-primary-bg)" stopOpacity={0.95} />
          </linearGradient>
        </defs>
        <path
          d={arcPath}
          fill="none"
          stroke="var(--nimi-border-subtle)"
          strokeWidth={stroke}
          strokeLinecap="round"
          opacity={0.6}
        />
        {percentile != null ? (
          <path
            d={arcPath}
            fill="none"
            stroke="url(#growth-gauge-grad)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${total - filled}`}
          />
        ) : null}
        {percentile != null ? (
          <circle
            cx={knobX}
            cy={knobY}
            r={stroke / 2 + 1}
            fill="var(--nimi-surface-card)"
            stroke="var(--nimi-action-primary-bg)"
            strokeWidth={2.5}
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex items-end justify-center pb-2.5 text-center">
        <span className="font-bold leading-none text-[var(--nimi-text-primary)]">
          {percentile == null ? (
            <span className="text-[32px]">—</span>
          ) : (
            <>
              <span className="text-[17px]">P</span>
              <span className="text-[36px]">{percentile}</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// YearlyGrowthBars — per-year growth-rate column chart with a zero baseline.
// Positive growth rises above the baseline in life-energy green; negative
// growth — weight or BMI can drop — extends below it in warning orange.
// ---------------------------------------------------------------------------

const YGB_HALF_HEIGHT = 52;
const YGB_BAR_MAX = 36;

function YearlyGrowthBars({
  yearlyGrowth,
  selectedMetricUnit,
}: {
  yearlyGrowth: GrowthYearlyRate[];
  selectedMetricUnit: string;
}) {
  const maxAbs = Math.max(...yearlyGrowth.map((item) => Math.abs(item.growth)), 0);
  return (
    <div data-testid="growth-hero-growth-bars">
      <div className="flex items-stretch">
        {yearlyGrowth.map((item) => {
          const positive = item.growth >= 0;
          const barHeight = maxAbs > 0 ? Math.max((Math.abs(item.growth) / maxAbs) * YGB_BAR_MAX, 3) : 3;
          const valueLabel = `${item.growth > 0 ? '+' : ''}${item.growth.toFixed(1)} ${selectedMetricUnit}`.trim();
          return (
            <div key={item.year} className="flex flex-1 flex-col items-center">
              <div
                className="flex w-full flex-col items-center justify-end border-b border-[var(--nimi-border-strong)]"
                style={{ height: YGB_HALF_HEIGHT }}
              >
                {positive ? (
                  <>
                    <span className="mb-1 text-[10px] font-medium text-[var(--nimi-action-primary-bg)]">
                      {valueLabel}
                    </span>
                    <div
                      className="w-7 rounded-t-md bg-[var(--nimi-action-primary-bg)]"
                      style={{ height: barHeight }}
                    />
                  </>
                ) : null}
              </div>
              <div
                className="flex w-full flex-col items-center justify-start"
                style={{ height: YGB_HALF_HEIGHT }}
              >
                {!positive ? (
                  <>
                    <div
                      className="w-7 rounded-b-md bg-[var(--nimi-status-warning)]"
                      style={{ height: barHeight }}
                    />
                    <span className="mt-1 text-[10px] font-medium text-[var(--nimi-status-warning)]">
                      {valueLabel}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex">
        {yearlyGrowth.map((item) => (
          <span
            key={item.year}
            className="flex-1 text-center text-[10px] font-medium text-[var(--nimi-text-muted)]"
          >
            {item.year}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HeroChip — bordered label/value pill used in the hero footer row.
// ---------------------------------------------------------------------------

function HeroChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-1.5 text-[12px]">
      <span className="text-[var(--nimi-text-muted)]">{label}</span>
      <span className="font-semibold text-[var(--nimi-text-primary)]">{value}</span>
    </span>
  );
}

export function GrowthHeroCard(props: GrowthHeroCardProps) {
  const { headline, trendStats, selectedMetricDisplayName, selectedMetricUnit, yearlyGrowth } = props;

  if (headline.state === 'no_data') {
    return (
      <Surface
        tone="card"
        material="glass-regular"
        elevation="raised"
        padding="lg"
        className="rounded-3xl"
        data-testid="growth-hero-card-empty"
      >
        <div className="flex items-center gap-3">
          <span className="text-[24px]">📏</span>
          <div>
            <p className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">暂无生长记录</p>
            <p className="mt-1 text-[13px] text-[var(--nimi-text-muted)]">
              添加首次{selectedMetricDisplayName}测量后即可生成趋势描述。
            </p>
          </div>
        </div>
      </Surface>
    );
  }

  const percentile = clampPercentile(headline.currentPercentile);
  const statusPill = statusPillForHeadline(headline);

  // `currentValueDisplay` is "<number> <unit>" (e.g. "144 cm"); split it so the
  // number renders large and the unit small.
  const valueText = headline.currentValueDisplay;
  const numberPart = selectedMetricUnit && valueText.endsWith(selectedMetricUnit)
    ? valueText.slice(0, -selectedMetricUnit.length).trim()
    : valueText;
  const hasUnit = numberPart !== valueText;

  const findStat = (label: string) => trendStats.find((stat) => stat.label === label);
  const yoyStat = findStat('年增速');
  const distP50Stat = findStat('距 P50');
  const pctStat = findStat('百分位');

  // 6-month percentile change, surfaced as a hero footer chip. The projection
  // builds `pctStat.caption` as "近 6 月 <↑n|↓n|持平|—>"; strip the window
  // prefix and append "%" only to the numeric arrow forms.
  const pctChange = pctStat?.caption?.replace('近 6 月 ', '').trim() ?? '—';
  const pctChangeDisplay = pctChange === '—' || pctChange === '持平' ? pctChange : `${pctChange}%`;

  return (
    <Surface
      tone="card"
      material="glass-regular"
      elevation="raised"
      padding="lg"
      className="flex h-full flex-col rounded-3xl"
      data-testid="growth-hero-card"
    >
      <div className="flex flex-1 flex-col justify-between gap-6">
        <div className="flex items-start gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${CHIP_TONE_CLASSNAMES[statusPill.tone]}`}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {statusPill.label}
          </span>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <p className="text-[42px] font-bold leading-none tracking-tight text-[var(--nimi-text-primary)]">
                {numberPart}
              </p>
              {hasUnit ? (
                <span className="text-[16px] font-medium text-[var(--nimi-text-secondary)]">
                  {selectedMetricUnit}
                </span>
              ) : null}
            </div>
            {yoyStat?.caption ? (
              <p className="mt-2 text-[13px] text-[var(--nimi-text-muted)]">{yoyStat.caption}</p>
            ) : null}
          </div>
          <SemiCircleGauge percentile={percentile} />
        </div>

        {yearlyGrowth.length > 0 ? (
          <YearlyGrowthBars yearlyGrowth={yearlyGrowth} selectedMetricUnit={selectedMetricUnit} />
        ) : null}
      </div>

      <div
        className="mt-6 flex flex-wrap gap-2 border-t border-[var(--nimi-border-subtle)] pt-4"
        data-testid="growth-hero-chips"
      >
        <HeroChip label="距 P50" value={distP50Stat ? `${distP50Stat.value} ${distP50Stat.unit}`.trim() : '—'} />
        <HeroChip label="近 6 个月" value={pctChangeDisplay} />
      </div>
    </Surface>
  );
}
