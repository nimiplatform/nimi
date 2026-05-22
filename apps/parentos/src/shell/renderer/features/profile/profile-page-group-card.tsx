import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, Award, ChevronDown, ChevronRight, Eye, Footprints, Moon, Plus, Smile, Stethoscope, Sun, Syringe } from 'lucide-react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import type { HealthGroupSnapshot, HealthMetricSnapshot } from '../../engine/health-record-domain.js';
import type { HealthMetricGroupId, HealthMetricId } from '../../knowledge-base/index.js';
import { formatDate, formatMetricSnapshotValue, formatMetricSnapshotValueParts, groupLabel, metricLabel } from './health-record-display.js';

interface GroupVisual {
  icon: typeof Activity;
  iconClassName: string;
}

const GROUP_VISUAL: Record<HealthMetricGroupId, GroupVisual> = {
  growth: { icon: Activity, iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)]' },
  vision: { icon: Eye, iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] text-[var(--nimi-status-info)]' },
  fitness: { icon: Footprints, iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]' },
  sleep: { icon: Moon, iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]' },
  outdoor: { icon: Sun, iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]' },
  vaccine: { icon: Syringe, iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] text-[var(--nimi-status-info)]' },
  dental: { icon: Smile, iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] text-[var(--nimi-status-info)]' },
  medical: { icon: Stethoscope, iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)] text-[var(--nimi-status-danger)]' },
  development: { icon: Award, iconClassName: 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]' },
};

function progressBarClassName(progress: number, review: ReviewStatusPiece[]): string {
  if (review.some((piece) => piece.key === 'review')) return 'bg-[var(--nimi-status-danger)]';
  if (review.some((piece) => piece.key === 'stale')) return 'bg-[var(--nimi-status-warning)]';
  if (progress >= 100) return 'bg-[var(--nimi-status-success)]';
  if (progress > 0) return 'bg-[var(--nimi-action-primary-bg)]';
  return 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_35%,transparent)]';
}

const PREVIEW_LIMIT = 3;

// Sport-activity metrics (category/duration/distance/intensity) are sub-fields
// of a single `fitness-sport-activity` log event, not individually tracked
// metrics. They collapse into one "日常运动" action row rather than rendering
// one bare row each.
const SPORT_ACTIVITY_PROTOCOL_ID = 'fitness-sport-activity';

function isSportActivityMetric(metric: HealthMetricSnapshot['metric']): boolean {
  return metric.captureProtocolIds.includes(SPORT_ACTIVITY_PROTOCOL_ID);
}

// Detail surfaces whose page carries an internal metric/chart tab. For these
// the card deep-links the clicked metric via ?metric=<metricId> so the page
// opens on that metric's tab instead of its default. routes.yaml admits the
// query param for both /profile/growth and /profile/vision.
const METRIC_DEEP_LINK_ROUTES = new Set(['/profile/growth', '/profile/vision']);

function metricDetailRoute(metric: HealthMetricSnapshot['metric']): string {
  const route = metric.detailRoute ?? '/profile';
  if (METRIC_DEEP_LINK_ROUTES.has(route)) {
    return `${route}?metric=${encodeURIComponent(metric.metricId)}`;
  }
  return route;
}

export interface ProfileGroupCardProps {
  group: HealthGroupSnapshot;
  onCapture?: (groupId: string, metricId?: HealthMetricId) => void;
}

export function ProfileGroupCard({ group, onCapture }: ProfileGroupCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleMetrics = group.metrics.filter(
    (snapshot) =>
      !isSportActivityMetric(snapshot.metric) &&
      (snapshot.metric.sourceSupport.includes('manual') || snapshot.latestValue),
  );
  const hasSportActivityRow = group.metrics.some((snapshot) => isSportActivityMetric(snapshot.metric));
  if (visibleMetrics.length === 0 && !hasSportActivityRow) return null;

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
  const groupRoute = visibleMetrics[0]?.metric.detailRoute ?? group.metrics[0]?.metric.detailRoute ?? '/profile';

  return (
    <Surface
      as="section"
      material="glass-regular"
      padding="none"
      tone="card"
      id={`profile-group-${group.group.groupId}`}
      className="overflow-hidden rounded-2xl shadow-[var(--nimi-elevation-base)] scroll-mt-4"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="block w-full px-5 py-5 text-left transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
        aria-expanded={expanded}
      >
        <div className="flex items-start gap-3">
          <div className={`grid h-10 w-10 place-items-center rounded-xl ${visual.iconClassName}`}>
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-normal text-[var(--nimi-text-primary)]">
                {groupLabel(group.group.groupId, group.group.displayName, t)}
              </h3>
              <span className="text-[12px] font-medium text-[var(--nimi-text-muted)]">
                {recordedCount}/{totalCount}
              </span>
            </div>
            <p className="mt-1 truncate text-[12px] text-[var(--nimi-text-muted)]">
              {subtitle}
              {reviewStatus.length > 0 ? (
                <>
                  {' · '}
                  {reviewStatus.map((piece, idx) => (
                    <span key={piece.key} className={`font-semibold ${piece.className}`}>
                      {idx > 0 ? ' · ' : ''}
                      {piece.text}
                    </span>
                  ))}
                </>
              ) : null}
            </p>
          </div>
          <div className="hidden h-10 w-[72px] items-center sm:flex">
            <div className="h-[6px] w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--nimi-border-subtle)_60%,transparent)]">
              <div className={`h-full rounded-full transition-colors ${progressBarClassName(progress, reviewStatus)}`} style={{ width: `${progress}%` }} />
            </div>
          </div>
          <Chevron size={18} className="text-[var(--nimi-text-muted)]" />
        </div>
      </button>
      {expanded ? (
        <ExpandedRows
          metrics={visibleMetrics}
          groupRoute={groupRoute}
          groupId={group.group.groupId}
          showSportActivityRow={hasSportActivityRow}
          onCapture={onCapture}
        />
      ) : previewMetrics.length > 0 ? (
        <div className="grid gap-2 px-5 pb-5 sm:grid-cols-3">
          {previewMetrics.map((snapshot) => (
            <PreviewTile key={snapshot.metric.metricId} snapshot={snapshot} />
          ))}
        </div>
      ) : (
        <div className="px-5 py-8 text-[12px] text-[var(--nimi-text-muted)]">
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
  showSportActivityRow,
  onCapture,
}: {
  metrics: readonly HealthMetricSnapshot[];
  groupRoute: string;
  groupId: string;
  showSportActivityRow?: boolean;
  onCapture?: (groupId: string, metricId?: HealthMetricId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-2 pb-3">
      <ul className="divide-y divide-[color-mix(in_srgb,var(--nimi-border-subtle)_70%,transparent)]">
        {metrics.map((snapshot) => (
          <ExpandedRow
            key={snapshot.metric.metricId}
            snapshot={snapshot}
            onCapture={onCapture ? () => onCapture(groupId, snapshot.metric.metricId) : undefined}
          />
        ))}
        {showSportActivityRow ? (
          <SportActivityRow onCapture={onCapture ? () => onCapture(groupId) : undefined} />
        ) : null}
      </ul>
      <div className="mt-3 flex items-center justify-end px-3">
        <Link
          to={groupRoute}
          className="inline-flex items-center gap-1 text-[12px] font-medium transition-colors hover:opacity-80 text-[var(--nimi-action-primary-bg)]"
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
  const route = metricDetailRoute(snapshot.metric);
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
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-[var(--nimi-action-ghost-hover)] sm:grid-cols-[minmax(160px,1fr)_minmax(120px,auto)_minmax(80px,auto)_auto]"
      >
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-[var(--nimi-text-primary)]">
            {metricLabel(snapshot.metric, t)}
          </p>
        </div>
        <div className={`text-right text-[14px] font-semibold sm:text-left ${hasValue ? 'text-[var(--nimi-text-primary)]' : 'text-[var(--nimi-text-muted)]'}`}>
          {parts.valueText}
          {parts.unitText ? (
            <span className="ml-1 text-[12px] font-normal text-[var(--nimi-text-muted)]">
              {parts.unitText}
            </span>
          ) : null}
        </div>
        <div className={`hidden text-[12px] sm:block ${reviewStatus ? 'text-[var(--nimi-status-danger)]' : 'text-[var(--nimi-text-muted)]'}`}>
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
              className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,transparent)] px-2.5 py-1 text-[12px] font-medium text-[var(--nimi-action-primary-bg)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,transparent)]"
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
              className="inline-flex items-center gap-1 rounded-full bg-[var(--nimi-action-primary-bg)] px-3 py-1 text-[12px] font-semibold text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)] transition-transform hover:brightness-110"
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

// Open-ended "log a sport activity" entry — opens the fitness capture modal on
// its 日常运动 tab. Unlike a national-standard metric it is not a checklist
// item, so it carries no value/date and stays out of the X/Y progress count.
function SportActivityRow({ onCapture }: { onCapture?: () => void }) {
  const { t } = useTranslation();
  return (
    <li>
      <button
        type="button"
        onClick={onCapture}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
      >
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium text-[var(--nimi-text-primary)]">
            {t('Profile.fitness.sportActivityLabel', { defaultValue: '日常运动' })}
          </p>
          <p className="truncate text-[12px] text-[var(--nimi-text-muted)]">
            {t('Profile.fitness.sportActivityHint', { defaultValue: '跑步、游泳、球类等运动量记录' })}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--nimi-action-primary-bg)] px-3 py-1 text-[12px] font-semibold text-[var(--nimi-action-primary-text)] shadow-[var(--nimi-elevation-base)]">
          <Plus size={12} />
          {t('Profile.group.record', { defaultValue: '记录' })}
        </span>
      </button>
    </li>
  );
}

function PreviewTile({ snapshot }: { snapshot: HealthMetricSnapshot }) {
  const { t } = useTranslation();
  const route = metricDetailRoute(snapshot.metric);
  const value = formatMetricSnapshotValue(snapshot, t);
  const date = formatDate(snapshot.latestEvent?.effectiveDate, t);
  return (
    <Link
      to={route}
      className="block rounded-xl bg-[color-mix(in_srgb,var(--nimi-surface-panel)_65%,transparent)] px-4 py-3 transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[13px] font-medium text-[var(--nimi-text-primary)]">{metricLabel(snapshot.metric, t)}</p>
        <span className="text-[11px] text-[var(--nimi-text-muted)]">{date}</span>
      </div>
      <p className="mt-1 text-[15px] font-semibold text-[var(--nimi-text-primary)]">{value}</p>
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
  className: string;
}

function computeReviewStatus(metrics: readonly HealthMetricSnapshot[]): ReviewStatusPiece[] {
  const reviewCount = metrics.filter((snapshot) => snapshot.evaluation.status === 'professional_review_prompt').length;
  const staleCount = metrics.filter((snapshot) => snapshot.freshness === 'stale').length;
  const missingCount = metrics.filter((snapshot) => snapshot.freshness === 'missing').length;
  const out: ReviewStatusPiece[] = [];
  if (reviewCount > 0) out.push({ key: 'review', text: `${reviewCount} 项需关注`, className: 'text-[var(--nimi-status-danger)]' });
  if (staleCount > 0) out.push({ key: 'stale', text: `${staleCount} 项已过期`, className: 'text-[var(--nimi-status-warning)]' });
  if (missingCount > 0) out.push({ key: 'missing', text: `${missingCount} 项待补`, className: 'text-[var(--nimi-text-secondary)]' });
  return out;
}
