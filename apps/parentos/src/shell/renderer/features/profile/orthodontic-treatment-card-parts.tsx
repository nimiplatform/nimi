import { cn } from '@nimiplatform/nimi-kit/ui';
/**
 * Case-level chrome pieces shared by `orthodontic-case-shell`: the bottom
 * 疗程总进度 strip + stage stepper, the overall-progress projection, and the
 * small icons / helpers the shell and the appliance cards reuse.
 *
 * The per-appliance ring + sub-cards that used to live here were superseded by
 * the multi-appliance card family (`appliance-*`); only the genuinely
 * case-level chrome remains.
 */
import type { ReactNode } from 'react';
import type { OrthodonticCaseRow, OrthodonticStage } from '../../bridge/sqlite-bridge.js';
import { computeStageOptions, STAGE_ORDER, stageLabel } from './orthodontic-derive.js';

// ── Bottom progress strip ──────────────────────────────────

export function ProgressStrip({
  progressPct,
  stage,
  monthsElapsed,
  monthsTotal,
  trailingAction,
}: {
  progressPct: number;
  stage: OrthodonticStage;
  monthsElapsed: number;
  monthsTotal: number | null;
  /** Rendered at the far right of the header row (after the % readout). */
  trailingAction?: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <CapsLabel>疗程总进度</CapsLabel>
        <div className="inline-flex items-center gap-2.5">
          <span className="font-mono text-[13px] font-semibold text-[var(--nimi-text-primary)]">
            {progressPct}%
          </span>
          {trailingAction}
        </div>
      </div>
      <div className="relative mb-3.5 h-1.5">
        <div className="absolute inset-0 rounded-full bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)]" />
        <div
          className="absolute bottom-0 left-0 top-0 rounded-full bg-[var(--nimi-action-primary-bg)] transition-[width] duration-[var(--nimi-motion-medium)]"
          style={{
            width: `${progressPct}%`,
          }}
        />
      </div>
      <div
        role="list"
        aria-label="正畸阶段"
        className="flex items-center justify-between gap-3 text-[12px]"
      >
        {STAGE_ORDER.map((s) => {
          const isCurrent = s === stage;
          const isPast = STAGE_ORDER.indexOf(s) < STAGE_ORDER.indexOf(stage);
          const detail =
            isCurrent && s === 'active'
              ? ` (第 ${monthsElapsed}${monthsTotal !== null ? ` / ${monthsTotal}` : ''} 个月)`
              : '';
          return (
            <span
              key={s}
              role="listitem"
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap',
                isCurrent
                  ? 'font-semibold text-[var(--nimi-text-primary)]'
                  : 'font-medium',
                !isCurrent && (isPast ? 'text-[var(--nimi-text-secondary)]' : 'text-[var(--nimi-text-muted)]'),
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'shrink-0 rounded-full',
                  isCurrent && 'ortho-stage-active-dot',
                  isCurrent
                    ? 'h-2 w-2 ring-4 ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_22%,transparent)]'
                    : 'h-1.5 w-1.5',
                  isCurrent || isPast
                    ? 'bg-[var(--nimi-action-primary-bg)]'
                    : 'bg-[color-mix(in_srgb,var(--nimi-text-primary)_15%,transparent)]',
                )}
              />
              {stageLabel(s)}
              {detail}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Small bits ─────────────────────────────────────────────

function CapsLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--nimi-text-muted)]">
      {children}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

/** `YYYY-MM-DDTHH:mm` local-datetime input value for the checkin modals. */
export function toLocalDatetimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function blockedAdvanceReason(
  options: ReturnType<typeof computeStageOptions>,
): string | undefined {
  const nextFuture = options.find((o) => o.state === 'future');
  return nextFuture?.blockedReason ?? '已是最终阶段';
}

/**
 * Total-treatment progress projection used by the bottom strip. Day-level
 * resolution so the bar advances visibly within a month. Strategy in priority
 * order: (1) `plannedEndAt` exact span, (2) `monthsTotal × 30 days`,
 * (3) equal-weight stage progression. Clamped to [0, 100].
 */
export function computeOverallProgressPct(input: {
  caseRow: OrthodonticCaseRow;
  monthsTotal: number | null;
  nowIso: string;
}): number {
  const { caseRow, monthsTotal, nowIso } = input;
  const dayMs = 1000 * 60 * 60 * 24;
  const startMs = new Date(`${caseRow.startedAt}T00:00:00.000Z`).getTime();
  const nowMs = new Date(nowIso).getTime();
  const daysElapsed = Math.max(0, (nowMs - startMs) / dayMs);

  let daysTotal: number | null = null;
  if (caseRow.plannedEndAt) {
    const endMs = new Date(`${caseRow.plannedEndAt}T00:00:00.000Z`).getTime();
    const span = (endMs - startMs) / dayMs;
    if (span > 0) daysTotal = span;
  }
  if (daysTotal === null && monthsTotal !== null && monthsTotal > 0) {
    daysTotal = monthsTotal * 30;
  }

  if (daysTotal !== null) {
    const ratio = daysElapsed / daysTotal;
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  }

  const stageIdx = STAGE_ORDER.indexOf(caseRow.stage);
  if (stageIdx < 0) return 0;
  return Math.round((stageIdx / (STAGE_ORDER.length - 1)) * 100);
}

// ── Icons ──────────────────────────────────────────────────

export function DotsIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="6" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="12" cy="18" r="1.2" />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h.09a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.09a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}
