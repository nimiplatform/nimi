import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, Eye, Ruler, Scale, Target } from 'lucide-react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import type { HealthMetricSnapshot, HealthRecordSnapshot } from '../../engine/health-record-domain.js';
import type { HealthMetricId } from '../../knowledge-base/index.js';
import { formatMetricSnapshotValue, metricLabel } from './health-record-display.js';

// PO-PROF-025: deterministic ordered allowlist of highlighted metric ids.
// Cards are rendered only when a snapshot has latestValue; the row is hidden
// entirely when zero highlights have data. Pulls from existing HEALTH_METRICS
// only — no new bridge calls or aggregations.
const HIGHLIGHT_METRIC_IDS: readonly HealthMetricId[] = [
  'growth.height',
  'growth.weight',
  'growth.head_circumference',
  'growth.bmi',
  'vision.left_visual_acuity',
  'vision.right_visual_acuity',
];

const MAX_HIGHLIGHT_CARDS = 5;

const METRIC_ICON: Partial<Record<HealthMetricId, typeof Activity>> = {
  'growth.height': Ruler,
  'growth.weight': Scale,
  'growth.head_circumference': Target,
  'growth.bmi': Activity,
  'vision.left_visual_acuity': Eye,
  'vision.right_visual_acuity': Eye,
};

export interface ProfileGlanceProps {
  snapshot: HealthRecordSnapshot;
}

export function ProfileGlance({ snapshot }: ProfileGlanceProps) {
  const { t } = useTranslation();
  const highlights = pickHighlights(snapshot);
  if (highlights.length === 0) return null;

  return (
    <section className="mb-6">
      <SectionLabel
        title={t('Profile.glance.title', { defaultValue: '最近一次的关键数据' })}
      />
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${highlights.length}, minmax(0, 1fr))` }}
      >
        {highlights.map((entry) => (
          <GlanceCard key={entry.snapshot.metric.metricId} entry={entry} />
        ))}
      </div>
    </section>
  );
}

interface HighlightEntry {
  snapshot: HealthMetricSnapshot;
  freshnessDot: string;
}

function pickHighlights(snapshot: HealthRecordSnapshot): HighlightEntry[] {
  const byId = new Map<HealthMetricId, HealthMetricSnapshot>();
  for (const group of snapshot.groups) {
    for (const metric of group.metrics) {
      byId.set(metric.metric.metricId, metric);
    }
  }
  const picked: HighlightEntry[] = [];
  for (const id of HIGHLIGHT_METRIC_IDS) {
    if (picked.length >= MAX_HIGHLIGHT_CARDS) break;
    const ms = byId.get(id);
    if (!ms || !hasRecordedValue(ms)) continue;
    picked.push({ snapshot: ms, freshnessDot: freshnessDotColor(ms.freshness) });
  }
  return picked;
}

function hasRecordedValue(ms: HealthMetricSnapshot): boolean {
  const v = ms.latestValue;
  if (!v) return false;
  return v.valueNumber != null || (v.valueText != null && v.valueText.length > 0) || v.valueJson != null;
}

function freshnessDotColor(freshness: HealthMetricSnapshot['freshness']): string {
  switch (freshness) {
    case 'fresh':
      return 'bg-[var(--nimi-status-success)]';
    case 'stale':
      return 'bg-[var(--nimi-status-warning)]';
    case 'missing':
      return 'bg-[var(--nimi-text-muted)]';
    case 'unscheduled':
    default:
      return 'bg-[var(--nimi-text-muted)]';
  }
}

function GlanceCard({ entry }: { entry: HighlightEntry }) {
  const { t } = useTranslation();
  const ms = entry.snapshot;
  const Icon = METRIC_ICON[ms.metric.metricId] ?? Activity;
  const detailRoute = ms.metric.detailRoute ?? '/profile';
  const value = formatMetricSnapshotValue(ms, t);
  const recordedDate = ms.latestEvent?.effectiveDate ?? null;
  const daysAgo = recordedDate ? daysBetween(recordedDate, new Date().toISOString()) : null;

  return (
    <Link to={detailRoute} className="block">
      <Surface
        as="div"
        material="glass-regular"
        padding="none"
        tone="card"
        className="h-full rounded-2xl p-4 transition-transform hover:-translate-y-0.5"
      >
        <div className="flex items-start justify-between">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]">
            <Icon size={15} />
          </div>
          <span className={`h-2 w-2 rounded-full ${entry.freshnessDot}`} />
        </div>
        <p className="mt-3 text-[12px] text-[var(--nimi-text-muted)]">{metricLabel(ms.metric, t)}</p>
        <p className="mt-1 text-[20px] font-semibold leading-tight text-[var(--nimi-text-primary)]">{value}</p>
        {daysAgo !== null ? (
          <p className="mt-2 text-[11px] text-[var(--nimi-text-muted)]">
            {daysAgo === 0
              ? t('Profile.glance.today', { defaultValue: '今天' })
              : t('Profile.glance.daysAgo', { count: daysAgo, defaultValue: '{{count}} 天前' })}
          </p>
        ) : null}
      </Surface>
    </Link>
  );
}

function SectionLabel({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-3">
      {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--nimi-text-muted)]">{eyebrow}</p> : null}
      <h2 className={`${eyebrow ? 'mt-1' : ''} text-[18px] font-semibold tracking-normal text-[var(--nimi-text-primary)]`}>{title}</h2>
      {subtitle ? <p className="mt-1 text-[12px] text-[var(--nimi-text-muted)]">{subtitle}</p> : null}
    </div>
  );
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / (24 * 60 * 60 * 1000)));
}
