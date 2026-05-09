import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, Award, ChevronDown, ChevronRight, Eye, Footprints, Moon, Plus, Smile, Stethoscope, Sun, Syringe } from 'lucide-react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import { S } from '../../app-shell/page-style.js';
import type { HealthGroupSnapshot, HealthMetricSnapshot } from '../../engine/health-record-domain.js';
import type { HealthMetricGroupId, HealthMetricId } from '../../knowledge-base/index.js';
import { formatDate, formatMetricSnapshotValue, formatMetricSnapshotValueParts, groupLabel, metricLabel } from './health-record-display.js';

interface GroupVisual {
  icon: typeof Activity;
  iconBg: string;
  iconFg: string;
  bar: string;
}

const GROUP_VISUAL: Record<HealthMetricGroupId, GroupVisual> = {
  growth: { icon: Activity, iconBg: 'rgba(34,197,94,0.12)', iconFg: '#15803d', bar: 'linear-gradient(90deg, #4ECCA3 0%, #22c55e 100%)' },
  vision: { icon: Eye, iconBg: 'rgba(99,102,241,0.12)', iconFg: '#4338ca', bar: 'linear-gradient(90deg, #818CF8 0%, #6366f1 100%)' },
  fitness: { icon: Footprints, iconBg: 'rgba(249,115,22,0.12)', iconFg: '#c2410c', bar: 'linear-gradient(90deg, #fb923c 0%, #f97316 100%)' },
  sleep: { icon: Moon, iconBg: 'rgba(139,92,246,0.12)', iconFg: '#6d28d9', bar: 'linear-gradient(90deg, #a78bfa 0%, #8b5cf6 100%)' },
  outdoor: { icon: Sun, iconBg: 'rgba(234,179,8,0.14)', iconFg: '#a16207', bar: 'linear-gradient(90deg, #facc15 0%, #eab308 100%)' },
  vaccine: { icon: Syringe, iconBg: 'rgba(59,130,246,0.12)', iconFg: '#1d4ed8', bar: 'linear-gradient(90deg, #60a5fa 0%, #3b82f6 100%)' },
  dental: { icon: Smile, iconBg: 'rgba(14,165,233,0.12)', iconFg: '#0369a1', bar: 'linear-gradient(90deg, #38bdf8 0%, #0ea5e9 100%)' },
  medical: { icon: Stethoscope, iconBg: 'rgba(239,68,68,0.10)', iconFg: '#b91c1c', bar: 'linear-gradient(90deg, #f87171 0%, #ef4444 100%)' },
  development: { icon: Award, iconBg: 'rgba(168,85,247,0.12)', iconFg: '#7e22ce', bar: 'linear-gradient(90deg, #c084fc 0%, #a855f7 100%)' },
};

const PREVIEW_LIMIT = 3;

export interface ProfileGroupCardProps {
  group: HealthGroupSnapshot;
  onCapture?: (groupId: string, metricId?: HealthMetricId) => void;
}

export function ProfileGroupCard({ group, onCapture }: ProfileGroupCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleMetrics = group.metrics.filter(
    (snapshot) => snapshot.metric.sourceSupport.includes('manual') || snapshot.latestValue,
  );
  if (visibleMetrics.length === 0) return null;

  const recordedMetrics = visibleMetrics.filter((snapshot) => snapshot.latestValue != null);
  const recordedCount = recordedMetrics.length;
  const totalCount = visibleMetrics.length;
  const visual = GROUP_VISUAL[group.group.groupId] ?? GROUP_VISUAL.growth;
  const Icon = visual.icon;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const progress = totalCount === 0 ? 0 : Math.round((recordedCount / totalCount) * 100);
  const previewMetrics = sortByRecency(recordedMetrics).slice(0, PREVIEW_LIMIT);
  const subtitle = visibleMetrics
    .slice(0, 5)
    .map((snapshot) => metricLabel(snapshot.metric, t))
    .join(t('Profile.group.metricSeparator', { defaultValue: '、' }));
  const reviewStatus = computeReviewStatus(visibleMetrics);
  const groupRoute = visibleMetrics[0]?.metric.detailRoute ?? '/profile';

  return (
    <Surface
      as="section"
      material="glass-regular"
      padding="none"
      tone="card"
      className="overflow-hidden rounded-[20px] shadow-[0_8px_32px_rgba(31,38,135,0.04)]"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="block w-full px-5 pt-5 text-left transition-colors hover:bg-white/40"
        aria-expanded={expanded}
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-[12px]" style={{ background: visual.iconBg, color: visual.iconFg }}>
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-normal" style={{ color: S.text, letterSpacing: 0 }}>
                {groupLabel(group.group.groupId, group.group.displayName, t)}
              </h3>
              <span className="text-[12px] font-medium" style={{ color: S.sub }}>
                {recordedCount}/{totalCount}
              </span>
            </div>
            <p className="mt-1 truncate text-[12px]" style={{ color: S.sub }}>
              {subtitle}
              {reviewStatus.length > 0 ? (
                <>
                  {' · '}
                  {reviewStatus.map((piece, idx) => (
                    <span key={piece.key} style={{ color: piece.color, fontWeight: 600 }}>
                      {idx > 0 ? ' · ' : ''}
                      {piece.text}
                    </span>
                  ))}
                </>
              ) : null}
            </p>
          </div>
          <div className="hidden h-10 w-[72px] items-center sm:flex">
            <div className="h-[6px] w-full overflow-hidden rounded-full" style={{ background: 'rgba(226,232,240,0.6)' }}>
              <div className="h-full rounded-full" style={{ width: `${progress}%`, background: visual.bar }} />
            </div>
          </div>
          <Chevron size={18} style={{ color: S.sub }} />
        </div>
      </button>
      {expanded ? (
        <ExpandedRows
          metrics={visibleMetrics}
          groupRoute={groupRoute}
          groupId={group.group.groupId}
          onCapture={onCapture}
        />
      ) : previewMetrics.length > 0 ? (
        <div className="mt-4 grid gap-2 px-5 pb-5 sm:grid-cols-3">
          {previewMetrics.map((snapshot) => (
            <PreviewTile key={snapshot.metric.metricId} snapshot={snapshot} />
          ))}
        </div>
      ) : (
        <div className="px-5 pb-5 pt-3 text-[12px]" style={{ color: S.sub }}>
          {t('Profile.group.emptyHint', { defaultValue: '还没有任何记录，点击右侧记录按钮开始记录。' })}
        </div>
      )}
    </Surface>
  );
}

function ExpandedRows({
  metrics,
  groupRoute,
  groupId,
  onCapture,
}: {
  metrics: readonly HealthMetricSnapshot[];
  groupRoute: string;
  groupId: string;
  onCapture?: (groupId: string, metricId?: HealthMetricId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 px-2 pb-3">
      <ul className="divide-y divide-[rgba(15,23,42,0.05)]">
        {metrics.map((snapshot) => (
          <ExpandedRow
            key={snapshot.metric.metricId}
            snapshot={snapshot}
            onCapture={onCapture ? () => onCapture(groupId, snapshot.metric.metricId) : undefined}
          />
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-end px-3">
        <Link
          to={groupRoute}
          className="inline-flex items-center gap-1 text-[12px] font-medium transition-colors hover:opacity-80"
          style={{ color: S.accent }}
        >
          {t('Profile.group.viewAll', { defaultValue: '查看全部' })}
          <span aria-hidden>→</span>
        </Link>
      </div>
    </div>
  );
}

function ExpandedRow({ snapshot, onCapture }: { snapshot: HealthMetricSnapshot; onCapture?: () => void }) {
  const { t } = useTranslation();
  const route = snapshot.metric.detailRoute ?? '/profile';
  const hasValue = snapshot.latestValue != null;
  const parts = hasValue
    ? formatMetricSnapshotValueParts(snapshot, t)
    : { valueText: t('Profile.group.notRecordedDash', { defaultValue: '—' }), unitText: '' };
  const dateText = hasValue
    ? formatDate(snapshot.latestEvent?.effectiveDate, t)
    : t('Profile.group.notRecorded', { defaultValue: '未记录' });
  const reviewStatus = snapshot.evaluation.status === 'professional_review_prompt';

  return (
    <li>
      <Link
        to={route}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] px-3 py-3 transition-colors hover:bg-white/55 sm:grid-cols-[minmax(160px,1fr)_minmax(120px,auto)_minmax(80px,auto)_auto]"
      >
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium" style={{ color: S.text }}>
            {metricLabel(snapshot.metric, t)}
          </p>
        </div>
        <div className="text-right text-[14px] font-semibold sm:text-left" style={{ color: hasValue ? S.text : S.sub }}>
          {parts.valueText}
          {parts.unitText ? (
            <span className="ml-1 text-[12px] font-normal" style={{ color: S.sub }}>
              {parts.unitText}
            </span>
          ) : null}
        </div>
        <div className="hidden text-[12px] sm:block" style={{ color: reviewStatus ? '#b91c1c' : S.sub }}>
          {dateText}
        </div>
        <div className="hidden justify-end sm:flex">
          {hasValue ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onCapture?.();
              }}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-[rgba(78,204,163,0.18)]"
              style={{ color: S.accent, background: 'rgba(78,204,163,0.10)' }}
            >
              <Plus size={12} />
              {t('Profile.group.update', { defaultValue: '更新' })}
            </button>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onCapture?.();
              }}
              className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-semibold text-white transition-transform hover:brightness-110"
              style={{ background: S.accent, boxShadow: '0 2px 8px rgba(78,204,163,0.25)' }}
            >
              <Plus size={12} />
              {t('Profile.group.record', { defaultValue: '记录' })}
            </button>
          )}
        </div>
      </Link>
    </li>
  );
}

function PreviewTile({ snapshot }: { snapshot: HealthMetricSnapshot }) {
  const { t } = useTranslation();
  const route = snapshot.metric.detailRoute ?? '/profile';
  const value = formatMetricSnapshotValue(snapshot, t);
  const date = formatDate(snapshot.latestEvent?.effectiveDate, t);
  return (
    <Link
      to={route}
      className="block rounded-[14px] px-4 py-3 transition-colors hover:bg-white/65"
      style={{ background: 'rgba(248,250,252,0.65)' }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[13px] font-medium" style={{ color: S.text }}>{metricLabel(snapshot.metric, t)}</p>
        <span className="text-[11px]" style={{ color: S.sub }}>{date}</span>
      </div>
      <p className="mt-1 text-[15px] font-semibold" style={{ color: S.text }}>{value}</p>
    </Link>
  );
}

function sortByRecency(metrics: readonly HealthMetricSnapshot[]): HealthMetricSnapshot[] {
  return [...metrics].sort((a, b) => {
    const dateA = a.latestEvent?.effectiveDate ?? '';
    const dateB = b.latestEvent?.effectiveDate ?? '';
    if (dateA === dateB) return 0;
    return dateA < dateB ? 1 : -1;
  });
}

interface ReviewStatusPiece {
  key: string;
  text: string;
  color: string;
}

function computeReviewStatus(metrics: readonly HealthMetricSnapshot[]): ReviewStatusPiece[] {
  const reviewCount = metrics.filter((snapshot) => snapshot.evaluation.status === 'professional_review_prompt').length;
  const staleCount = metrics.filter((snapshot) => snapshot.freshness === 'stale').length;
  const missingCount = metrics.filter((snapshot) => snapshot.freshness === 'missing').length;
  const out: ReviewStatusPiece[] = [];
  if (reviewCount > 0) out.push({ key: 'review', text: `${reviewCount} 项需关注`, color: '#b91c1c' });
  if (staleCount > 0) out.push({ key: 'stale', text: `${staleCount} 项已过期`, color: '#a16207' });
  if (missingCount > 0) out.push({ key: 'missing', text: `${missingCount} 项待补`, color: '#475569' });
  return out;
}
