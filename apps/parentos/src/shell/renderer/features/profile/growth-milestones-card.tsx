import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { type ReactNode } from 'react';
import type { GrowthMilestone } from './growth-milestone-rules.js';
import type {
  GrowthHeadline,
  GrowthNextCheck,
  GrowthNextCheckScheduled,
} from './growth-detail-projection.js';

// growth-milestones-card.tsx — PO-GROWTH-DETAIL-002 / -006 growth timeline
// composition. Renders the wave-A projection's milestones, the current
// measurement, and the next-check reminder as a single vertical timeline.
// A flex-grow spacer keeps the next-check node pinned to the foot of the card
// so this card can share a row height with the hero card.
// Pure render of typed projection rows + a reschedule CTA (PO-GROWTH-DETAIL-006).
// No useState/useEffect for projection data, no AI, no bridge, no Date.now().

const EMPTY_STATE_COPY = '暂无识别到的重要节点';
// The next-check date is a system-default reminder time; the CTA opens the
// timeline where the parent adjusts it, so the label reads "更改" not "设为提醒".
const NEXT_CHECK_CTA_LABEL = '更改';

// Positive nodes (height thresholds, weight rises) sit on the calm grey
// rail; negative nodes (e.g. a >=10% weight drop) are marked in caution
// orange so the parent notices them. The live "current measurement" node
// is the key node and renders separately in the brand green.
const MILESTONE_DOT_TONE: Record<GrowthMilestone['polarity'], string> = {
  positive: 'border-[var(--nimi-border-strong)]',
  negative: 'border-[var(--nimi-status-warning)]',
};

const MILESTONE_BADGE_TONE: Record<GrowthMilestone['polarity'], string> = {
  positive:
    'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,var(--nimi-surface-card))] text-[var(--nimi-status-success)]',
  negative:
    'bg-[color-mix(in_srgb,var(--nimi-status-warning)_16%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]',
};

function formatNextCheckDate(iso: string): string {
  // "2026-06-03" → "6 月 3 日". The accompanying days-away label carries the
  // distance, so dropping the year keeps the headline compact.
  const datePart = iso.split('T')[0] ?? iso;
  const [, month, day] = datePart.split('-');
  if (!month || !day) return datePart;
  return `${Number(month)} 月 ${Number(day)} 日`;
}

function formatDaysFromNow(daysFromNow: number): string {
  if (daysFromNow < 0) return `已逾期 ${Math.abs(daysFromNow)} 天`;
  if (daysFromNow === 0) return '今天';
  if (daysFromNow === 1) return '明天';
  return `还有 ${daysFromNow} 天`;
}

// Plain-language band label derived from the percentile number — descriptive
// only, never alarming.
function percentileBand(percentile: number): string {
  if (percentile >= 90) return '偏高';
  if (percentile >= 75) return '中等偏上';
  if (percentile >= 25) return '中等';
  if (percentile >= 10) return '中等偏下';
  return '偏低';
}

function milestoneBadgeText(milestone: GrowthMilestone): string {
  const unitShort = milestone.deltaUnitLabel.split(' ')[0] ?? '';
  return `${milestone.deltaMagnitudeDisplay} ${unitShort}`.trim();
}

// `detailLine` embeds the milestone's occurred date, which is already shown as
// the node's top line — strip it so the date is not repeated.
function milestoneDetail(milestone: GrowthMilestone): string {
  const occurredDate = milestone.occurredAt.split('T')[0] ?? '';
  return milestone.detailLine
    .split(occurredDate)
    .join('')
    .replace(/^[\s·→-]+/u, '')
    .replace(/[\s·→-]+$/u, '')
    .trim();
}

export interface GrowthMilestonesCardProps {
  milestones: GrowthMilestone[];
  headline: GrowthHeadline;
  nextCheck: GrowthNextCheck;
  /** Opens the next-check reschedule modal (PO-GROWTH-DETAIL-006). When omitted,
   *  or when the scheduled next-check carries a null `recheckRuleId`, the `更改`
   *  CTA is disabled (PO-GROWTH-DETAIL-009). */
  onReschedule?: () => void;
  /** When set, the card renders a "查看更多" affordance. The page wires this
   *  to scroll the full milestone list (the history table) into view; it is
   *  omitted when the preview already shows every milestone. */
  onViewMore?: () => void;
}

// A timeline node: a dot on the rail + arbitrary content to its right. The
// connecting line is drawn once by the parent so it spans the flex spacer.
function TimelineNode({
  dotClassName,
  children,
  testId,
}: {
  dotClassName: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <li className="relative pl-7 pb-5" data-testid={testId}>
      <span
        aria-hidden="true"
        className={`absolute left-0 top-1.5 h-3 w-3 rounded-full ${dotClassName}`}
      />
      {children}
    </li>
  );
}

export function GrowthMilestonesCard(props: GrowthMilestonesCardProps) {
  const { milestones, headline, nextCheck, onReschedule, onViewMore } = props;

  // Milestones oldest → newest, so the timeline reads top-down chronologically.
  const sortedMilestones = [...milestones].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const scheduled: GrowthNextCheckScheduled | null =
    nextCheck.state === 'scheduled' ? nextCheck : null;
  const hasCurrent = headline.state !== 'no_data';
  // Whether there is any node above the next-check node — drives the line.
  const hasUpperNodes = sortedMilestones.length > 0 || hasCurrent;

  return (
    <Surface
      tone="card"
      material="glass-regular"
      elevation="raised"
      padding="md"
      className="flex h-full flex-col rounded-3xl"
      data-testid="growth-milestones-card"
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-[var(--nimi-text-primary)]">生长重要节点</h3>
        {onViewMore ? (
          <button
            type="button"
            onClick={onViewMore}
            className="text-[12px] text-[var(--nimi-text-muted)] transition-colors hover:text-[var(--nimi-text-secondary)]"
            data-testid="growth-milestones-view-more"
          >
            查看更多
          </button>
        ) : null}
      </div>

      {sortedMilestones.length === 0 ? (
        <p className="mb-3 text-[13px] text-[var(--nimi-text-muted)]">{EMPTY_STATE_COPY}</p>
      ) : null}

      {/* Upper timeline (milestones + current). The flex-grow spacer absorbs
          any extra card height so the next-check node stays at the foot. */}
      <div className="relative flex flex-1 flex-col">
        {hasUpperNodes ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[5px] top-3 bottom-3 w-0.5 bg-[var(--nimi-border-subtle)]"
          />
        ) : null}
        <ol className="relative">
          {sortedMilestones.map((milestone) => (
            <TimelineNode
              key={milestone.milestoneId}
              testId={`growth-milestone-row-${milestone.milestoneId}`}
              dotClassName={`border-2 bg-[var(--nimi-surface-card)] ${MILESTONE_DOT_TONE[milestone.polarity]}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] text-[var(--nimi-text-muted)]">
                    {milestone.occurredAt.split('T')[0]}
                  </p>
                  <p className="mt-0.5 text-[13px] font-semibold leading-tight text-[var(--nimi-text-primary)]">
                    {milestone.title}
                  </p>
                  {milestoneDetail(milestone) ? (
                    <p className="mt-0.5 text-[12px] text-[var(--nimi-text-muted)]">
                      {milestoneDetail(milestone)}
                    </p>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${MILESTONE_BADGE_TONE[milestone.polarity]}`}
                >
                  {milestoneBadgeText(milestone)}
                </span>
              </div>
            </TimelineNode>
          ))}

          {headline.state !== 'no_data' ? (
            <TimelineNode dotClassName="bg-[var(--nimi-action-primary-bg)]">
              <p className="text-[11px] text-[var(--nimi-text-muted)]">
                {headline.measuredAt.split('T')[0]}
              </p>
              <p className="mt-0.5 text-[13px] font-semibold leading-tight text-[var(--nimi-text-primary)]">
                当前 {headline.currentValueDisplay}
              </p>
              <p className="mt-0.5 text-[12px] text-[var(--nimi-text-muted)]">
                {headline.currentPercentile != null
                  ? `${headline.currentPercentile}% · ${percentileBand(headline.currentPercentile)}`
                  : '参考数据未覆盖'}
              </p>
            </TimelineNode>
          ) : null}
        </ol>
        <div className="flex-1" aria-hidden="true" />
      </div>

      {/* Next-check node — pinned to the foot of the card. */}
      <div className="relative pl-7">
        {hasUpperNodes ? (
          <span
            aria-hidden="true"
            className="absolute left-[5px] -top-3 h-6 w-0.5 bg-[var(--nimi-border-subtle)]"
          />
        ) : null}
        {scheduled ? (
          <>
            <span
              aria-hidden="true"
              className="absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 border-[var(--nimi-status-success)] bg-[var(--nimi-surface-card)]"
            />
            <div
              className="flex items-center justify-between gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-success)_26%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_8%,var(--nimi-surface-card))] px-3 py-2.5"
              data-testid="growth-next-check-card"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">
                  {formatNextCheckDate(scheduled.nextRecordAt)} · {scheduled.badgeLabel}
                </p>
                <p
                  className="mt-0.5 text-[12px] text-[var(--nimi-text-muted)]"
                  data-testid="growth-next-check-badge"
                >
                  {formatDaysFromNow(scheduled.daysFromNow)}
                </p>
              </div>
              <Button
                onClick={onReschedule}
                disabled={!onReschedule || scheduled.recheckRuleId == null}
                tone="primary"
                size="sm"
                className="shrink-0 whitespace-nowrap rounded-full"
                data-testid="growth-next-check-cta-set-reminder"
              >
                {NEXT_CHECK_CTA_LABEL}
              </Button>
            </div>
          </>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 border-[var(--nimi-border-strong)] bg-[var(--nimi-surface-card)]"
            />
            <p
              className="text-[13px] text-[var(--nimi-text-muted)]"
              data-testid="growth-next-check-card-unscheduled"
            >
              暂无下次测量安排
            </p>
          </>
        )}
      </div>
    </Surface>
  );
}
