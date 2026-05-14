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
import { S } from '../../app-shell/page-style.js';
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <CapsLabel>疗程总进度</CapsLabel>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              fontSize: 13,
              color: 'var(--nimi-text-primary)',
              fontWeight: 600,
              fontFamily: 'var(--nimi-font-mono)',
            }}
          >
            {progressPct}%
          </span>
          {trailingAction}
        </div>
      </div>
      <div style={{ position: 'relative', height: 6, marginBottom: 14 }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 999,
            background: 'rgba(15,23,42,0.06)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            borderRadius: 999,
            width: `${progressPct}%`,
            background: S.accent,
            transition: 'width 360ms',
          }}
        />
      </div>
      <div
        role="list"
        aria-label="正畸阶段"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          fontSize: 12,
        }}
      >
        {STAGE_ORDER.map((s) => {
          const isCurrent = s === stage;
          const isPast = STAGE_ORDER.indexOf(s) < STAGE_ORDER.indexOf(stage);
          const color = isCurrent
            ? 'var(--nimi-text-primary)'
            : isPast
            ? 'var(--nimi-text-secondary)'
            : '#94a3b8';
          const dot = isCurrent ? S.accent : isPast ? S.accent : 'rgba(15,23,42,0.15)';
          const detail =
            isCurrent && s === 'active'
              ? ` (第 ${monthsElapsed}${monthsTotal !== null ? ` / ${monthsTotal}` : ''} 个月)`
              : '';
          return (
            <span
              key={s}
              role="listitem"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color,
                fontWeight: isCurrent ? 600 : 500,
                whiteSpace: 'nowrap',
              }}
            >
              <span
                aria-hidden="true"
                className={isCurrent ? 'ortho-stage-active-dot' : undefined}
                style={{
                  width: isCurrent ? 8 : 6,
                  height: isCurrent ? 8 : 6,
                  borderRadius: 999,
                  background: dot,
                  boxShadow: isCurrent ? '0 0 0 3px rgba(78,204,163,0.22)' : 'none',
                  flexShrink: 0,
                }}
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
    <div
      style={{
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--nimi-text-muted)',
      }}
    >
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
