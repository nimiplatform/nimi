import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  GrowthNextCheck,
  GrowthNextCheckScheduled,
  GrowthTrendStat,
} from './growth-detail-projection.js';

// growth-next-check-card.tsx — PO-GROWTH-DETAIL-006 next-check card
// composition (wave-C). Pure render of the wave-A projection's
// `GrowthNextCheck` + `GrowthTrendStat[]`. CTA branches on
// `reminderActionability`:
//   - 'deep_link_only' (wave-C default): navigates to
//     /timeline?focus=growth&metric=<id> (route admitted in wave-0).
//   - 'has_writeback' (HALT branch in wave-C; wave-C entry probe 0.6
//     resolved deep_link_only because no user-driven writeback surface
//     is admitted today; if a future wave admits the writeback API,
//     that wave updates this branch). The branch body is a no-op early
//     return — NEVER synthesizes a `reminder_states` row, NEVER calls a
//     speculative writeback API, NEVER fakes reminder completion.
// No useState/useEffect for projection data, no AI, no bridge, no
// Date.now(). No predicted-adult-height chip.

const UNSCHEDULED_COPY = '暂无下次测量安排';
const CTA_LABEL = '设为提醒';

function formatNextRecordDate(iso: string): string {
  // Pure: take the date prefix from an ISO date string. Caller-supplied
  // ISO is the projection's `nextRecordAt`, which is itself derived from
  // `health-record-domain.ts#resolveNextRecordAt` via the wave-A
  // snapshot. No Date.now() here.
  return iso.split('T')[0] ?? iso;
}

function formatDaysFromNow(daysFromNow: number): string {
  if (daysFromNow < 0) return `已逾期 ${Math.abs(daysFromNow)} 天`;
  if (daysFromNow === 0) return '今天';
  if (daysFromNow === 1) return '明天';
  return `还有 ${daysFromNow} 天`;
}

function renderNextCheckLede(next: GrowthNextCheckScheduled): string {
  // Step-1 finding (worker prompt + entry probe): LEDE_TEMPLATES does
  // NOT include next_check_due_soon / next_check_overdue /
  // next_check_upcoming in growth-curve-page-shared.ts at wave-B
  // closure. Per worker prompt Step 1, we build a deterministic inline
  // string scoped to this file rather than extend the shared template
  // registry (which is wave-A territory). The string is descriptive-
  // vocabulary only — never alarming.
  switch (next.ledeTemplate) {
    case 'next_check_overdue':
      return `${formatNextRecordDate(next.nextRecordAt)} 已逾期 ${Math.abs(next.daysFromNow)} 天，建议尽快安排下一次测量。`;
    case 'next_check_due_soon':
      return `${formatNextRecordDate(next.nextRecordAt)} 还有 ${next.daysFromNow} 天，建议提前安排下一次测量。`;
    case 'next_check_upcoming':
    default:
      return `${formatNextRecordDate(next.nextRecordAt)} 还有 ${next.daysFromNow} 天，到时即可进行下一次测量。`;
  }
}

const BADGE_TONE_CLASSNAMES: Record<GrowthNextCheckScheduled['ledeTemplate'], string> = {
  next_check_overdue:
    'border-[color-mix(in_srgb,var(--nimi-status-warning)_36%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]',
  next_check_due_soon:
    'border-[color-mix(in_srgb,var(--nimi-status-info)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-info)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-info)]',
  next_check_upcoming:
    'border-[color-mix(in_srgb,var(--nimi-status-success)_28%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-success)]',
};

export interface GrowthNextCheckCardProps {
  nextCheck: GrowthNextCheck;
  trendStats: GrowthTrendStat[];
  childId: string;
  metricId: string;
}

export function GrowthNextCheckCard(props: GrowthNextCheckCardProps) {
  const { nextCheck, trendStats, childId, metricId } = props;
  const navigate = useNavigate();

  const handleSetReminder = useCallback(() => {
    if (nextCheck.state !== 'scheduled') return;
    if (nextCheck.reminderActionability === 'has_writeback') {
      // HALT branch (no-op early return).
      //
      // Wave-C entry probe 0.6 resolved `deep_link_only` because no
      // user-driven reminder writeback surface is admitted today
      // (grep over apps/parentos/src/shell/renderer for
      // useReminderWriteback|createUserReminder|insertUserReminder|
      // writeUserReminder|putUserReminder|reminderWriteback returns
      // zero matches). The projection's `reminderActionability` field
      // is therefore always 'deep_link_only' until a future wave
      // admits the writeback surface AND wires the projection to flip
      // the field to 'has_writeback'. This branch MUST NOT synthesize
      // a `reminder_states` row, MUST NOT call a speculative writeback
      // API, MUST NOT fake reminder completion. If a future wave
      // admits the writeback surface, that wave updates this branch
      // to invoke it with a typed payload (childId, metricId,
      // nextRecordAt, kind=growth_metric).
      return;
    }
    // deep_link_only branch
    navigate(`/timeline?focus=growth&metric=${encodeURIComponent(metricId)}`);
    void childId; // referenced so the prop participates in the type signature for future writeback payload construction
  }, [childId, metricId, navigate, nextCheck]);

  if (nextCheck.state === 'unscheduled') {
    return (
      <Surface
        tone="card"
        material="solid"
        elevation="base"
        padding="md"
        className="mb-5"
        data-testid="growth-next-check-card-unscheduled"
      >
        <div className="flex items-center gap-2">
          <span className="text-[16px]" aria-hidden="true">🗓️</span>
          <h3 className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">下次测量</h3>
        </div>
        <p className="mt-2 text-[13px] text-[var(--nimi-text-muted)]">{UNSCHEDULED_COPY}</p>
      </Surface>
    );
  }

  const next = nextCheck;
  const dateLabel = formatNextRecordDate(next.nextRecordAt);
  const daysLabel = formatDaysFromNow(next.daysFromNow);
  const lede = renderNextCheckLede(next);
  const badgeClass = BADGE_TONE_CLASSNAMES[next.ledeTemplate];

  return (
    <Surface
      tone="card"
      material="solid"
      elevation="raised"
      padding="md"
      className="mb-5"
      data-testid="growth-next-check-card"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[16px]" aria-hidden="true">🗓️</span>
          <h3 className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">下次测量</h3>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[12px] font-medium ${badgeClass}`}
          data-testid="growth-next-check-badge"
        >
          {next.badgeLabel}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-[24px] font-bold leading-none tracking-tight text-[var(--nimi-text-primary)]">
          {dateLabel}
        </p>
        <span className="text-[13px] text-[var(--nimi-text-muted)]">{daysLabel}</span>
      </div>

      <p className="mt-3 text-[14px] leading-relaxed text-[var(--nimi-text-primary)]">{lede}</p>

      <div className="mt-3">
        <Button
          onClick={handleSetReminder}
          tone="primary"
          size="sm"
          className="min-h-0 rounded-full px-3 py-1.5 text-[13px]"
          data-testid="growth-next-check-cta-set-reminder"
        >
          {CTA_LABEL}
        </Button>
      </div>

      {trendStats.length > 0 ? (
        <div
          className="mt-4 grid grid-cols-3 gap-3 border-t border-[var(--nimi-border-subtle)] pt-3"
          data-testid="growth-next-check-trend-stats"
        >
          {trendStats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-[var(--nimi-text-muted)]">
                {stat.label}
              </p>
              <p className="mt-1 text-[16px] font-semibold leading-none text-[var(--nimi-text-primary)]">
                {stat.value}
                {stat.unit ? (
                  <span className="ml-1 text-[12px] font-medium text-[var(--nimi-text-secondary)]">
                    {stat.unit}
                  </span>
                ) : null}
              </p>
              {stat.caption ? (
                <p className="mt-1 text-[11px] text-[var(--nimi-text-muted)]">{stat.caption}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Surface>
  );
}
