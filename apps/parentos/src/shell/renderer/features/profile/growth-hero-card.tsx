import { Surface } from '@nimiplatform/nimi-kit/ui';
import { LEDE_TEMPLATES, type LedeTemplateInputs } from './growth-curve-page-shared.js';
import type { GrowthChip, GrowthHeadline } from './growth-detail-projection.js';

// growth-hero-card.tsx — PO-GROWTH-DETAIL-002 hero composition (wave-B).
// Pure render of `GrowthHeadline` + `GrowthChip[]` projected by wave-A.
// No useState/useEffect for projection data, no AI, no bridge, no Date.now().
// No predicted-adult-height chip (excluded per design.md §10).

export interface GrowthHeroCardProps {
  headline: GrowthHeadline;
  crossMetric: GrowthChip[];
  selectedMetricDisplayName: string;
  selectedMetricUnit: string;
  childDisplayName: string;
  ageLabel: string;
}

const CHIP_LABELS: Record<GrowthChip['kind'], string> = {
  height: '身高',
  weight: '体重',
  bmi: 'BMI',
  head: '头围',
  bone_age: '骨龄',
};

const CHIP_ICONS: Record<GrowthChip['kind'], string> = {
  height: '📏',
  weight: '⚖️',
  bmi: '🏃',
  head: '📐',
  bone_age: '🦴',
};

const CHIP_TONE_CLASSNAMES: Record<GrowthChip['tone'], string> = {
  success:
    'border-[color-mix(in_srgb,var(--nimi-status-success)_28%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-success)]',
  warn:
    'border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]',
  info:
    'border-[color-mix(in_srgb,var(--nimi-status-info)_28%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-info)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-info)]',
  neutral:
    'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)]',
};

function clampPercentile(percentile: number | null | undefined): number | null {
  if (percentile == null || Number.isNaN(percentile)) return null;
  if (percentile < 0) return 0;
  if (percentile > 100) return 100;
  return percentile;
}

function statusPillForHeadline(headline: GrowthHeadline): { label: string; tone: GrowthChip['tone'] } {
  if (headline.state === 'no_data') return { label: '暂无数据', tone: 'neutral' };
  if (headline.state === 'out_of_reference') return { label: '参考数据未覆盖', tone: 'info' };
  const p = clampPercentile(headline.currentPercentile);
  if (p == null) return { label: '参考数据未加载', tone: 'info' };
  if (p >= 90 || p <= 10) return { label: '建议关注', tone: 'warn' };
  if (p >= 25 && p <= 75) return { label: '稳定区间', tone: 'success' };
  return { label: '观察中', tone: 'info' };
}

function renderLede(headline: GrowthHeadline, fallbackUnit: string): string {
  if (headline.state === 'no_data') return LEDE_TEMPLATES.no_data({} as LedeTemplateInputs);
  const inputs: LedeTemplateInputs = {
    ...headline.ledeTemplateInputs,
    unit: headline.ledeTemplateInputs.unit || fallbackUnit,
  };
  return LEDE_TEMPLATES[headline.ledeTemplate](inputs);
}

function PercentileDial({ percentile }: { percentile: number | null }) {
  // Inline SVG donut. Stroke = var(--nimi-status-success); track =
  // var(--nimi-border-subtle); empty state collapses to a track-only ring.
  const radius = 52;
  const stroke = 10;
  const normalizedRadius = radius - stroke / 2;
  const circumference = 2 * Math.PI * normalizedRadius;
  const pct = percentile == null ? 0 : percentile;
  const filled = (pct / 100) * circumference;
  const dasharray = `${filled} ${circumference - filled}`;
  const center = radius + stroke / 2;
  const size = (radius + stroke / 2) * 2;
  return (
    <svg
      role="img"
      aria-label={percentile == null ? '百分位未知' : `百分位 P${percentile}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
    >
      <defs>
        <linearGradient id="growth-hero-dial-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--nimi-status-success)" stopOpacity={0.95} />
          <stop offset="100%" stopColor="var(--nimi-status-success)" stopOpacity={0.65} />
        </linearGradient>
      </defs>
      <circle
        cx={center}
        cy={center}
        r={normalizedRadius}
        fill="none"
        stroke="var(--nimi-border-subtle)"
        strokeWidth={stroke}
        opacity={0.6}
      />
      {percentile != null ? (
        <circle
          cx={center}
          cy={center}
          r={normalizedRadius}
          fill="none"
          stroke="url(#growth-hero-dial-grad)"
          strokeWidth={stroke}
          strokeDasharray={dasharray}
          strokeDashoffset={circumference / 4}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      ) : null}
      <text
        x={center}
        y={center - 4}
        textAnchor="middle"
        fontSize={percentile == null ? 14 : 22}
        fontWeight={700}
        fill="var(--nimi-text-primary)"
      >
        {percentile == null ? '—' : `P${percentile}`}
      </text>
      <text
        x={center}
        y={center + 14}
        textAnchor="middle"
        fontSize={10}
        fill="var(--nimi-text-muted)"
      >
        百分位
      </text>
    </svg>
  );
}

export function GrowthHeroCard(props: GrowthHeroCardProps) {
  const { headline, crossMetric, selectedMetricDisplayName, selectedMetricUnit, childDisplayName, ageLabel } = props;

  if (headline.state === 'no_data') {
    return (
      <Surface
        tone="card"
        material="solid"
        elevation="raised"
        padding="lg"
        className="mb-5"
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
  const lede = renderLede(headline, selectedMetricUnit);
  const visibleChips = crossMetric.filter((chip) => chip.visible);

  return (
    <Surface
      tone="card"
      material="solid"
      elevation="raised"
      padding="lg"
      className="mb-5"
      data-testid="growth-hero-card"
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        <div className="flex shrink-0 items-center justify-center">
          <PercentileDial percentile={percentile} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${CHIP_TONE_CLASSNAMES[statusPill.tone]}`}
            >
              {statusPill.label}
            </span>
            <span className="text-[12px] text-[var(--nimi-text-muted)]">
              {childDisplayName} · {ageLabel}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="text-[32px] font-bold leading-none tracking-tight text-[var(--nimi-text-primary)]">
              {headline.currentValueDisplay}
            </p>
            <span className="text-[14px] font-medium text-[var(--nimi-text-secondary)]">
              {selectedMetricDisplayName}
            </span>
          </div>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--nimi-text-primary)]">{lede}</p>
        </div>
      </div>
      {visibleChips.length > 0 ? (
        <div
          className="mt-4 flex flex-wrap gap-2 border-t border-[var(--nimi-border-subtle)] pt-4"
          data-testid="growth-hero-cross-metric"
        >
          {visibleChips.map((chip) => (
            <span
              key={chip.kind}
              data-testid={`growth-hero-chip-${chip.kind}`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] ${CHIP_TONE_CLASSNAMES[chip.tone]}`}
            >
              <span className="text-[14px]" aria-hidden="true">{CHIP_ICONS[chip.kind]}</span>
              <span className="font-medium text-[var(--nimi-text-primary)]">
                {`${CHIP_LABELS[chip.kind]} ${chip.primary}${chip.secondary ? ` · ${chip.secondary}` : ''}`}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </Surface>
  );
}
