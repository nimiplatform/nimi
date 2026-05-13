import type { CSSProperties, ReactNode } from 'react';
import { S } from '../../app-shell/page-style.js';
import type { OrthodonticCaseRow, OrthodonticStage } from '../../bridge/sqlite-bridge.js';
import {
  computeCycleProgress,
  computeStageOptions,
  STAGE_ORDER,
  stageLabel,
} from './orthodontic-derive.js';
import type { TreatmentRingCopy } from './orthodontic-treatment-ring-copy.js';

// ── Ring ───────────────────────────────────────────────────

export function Ring({
  copy,
  cycleRatio,
  isOpen,
}: {
  copy: TreatmentRingCopy;
  cycleRatio: number | null;
  isOpen: boolean;
}) {
  const size = 220;
  const stroke = 18;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.max(0, Math.min(1, cycleRatio ?? 0));
  const dashOffset = circumference * (1 - ratio);
  const hasCycle = cycleRatio !== null;
  const strokeColor = isOpen ? '#f59e0b' : S.accent;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-90deg)' }}
        aria-label={`本副周期进度 ${Math.round(ratio * 100)}%`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(15,23,42,0.06)"
          strokeWidth={stroke}
          fill="none"
        />
        {hasCycle && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={strokeColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${dashOffset === circumference ? 0 : circumference - dashOffset} ${circumference}`}
            style={{ transition: 'stroke-dasharray 600ms ease, stroke 240ms' }}
          />
        )}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '0 24px',
        }}
      >
        {copy.kind === 'cycle' ? (
          <>
            <div
              style={{
                fontSize: 12,
                color: 'var(--nimi-text-muted)',
                letterSpacing: '0.04em',
                fontWeight: 500,
                marginBottom: 4,
              }}
            >
              {copy.caption}
            </div>
            <div
              style={{
                fontSize: 56,
                fontWeight: 700,
                letterSpacing: '-0.03em',
                lineHeight: 1,
                color: 'var(--nimi-text-primary)',
              }}
            >
              {copy.primaryNumber}
              <span
                style={{
                  fontSize: 22,
                  color: 'var(--nimi-text-muted)',
                  marginLeft: 2,
                  fontWeight: 600,
                }}
              >
                {copy.unit}
              </span>
            </div>
            {copy.footer && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--nimi-text-muted)',
                  marginTop: 8,
                  fontFamily: 'var(--nimi-font-mono)',
                }}
              >
                {copy.footer}
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              fontSize: 13,
              color: 'var(--nimi-text-muted)',
              lineHeight: 1.5,
            }}
          >
            {copy.message}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Right sub-cards ────────────────────────────────────────

function SubCardShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 20,
        padding: '20px 22px',
        boxShadow: '0 4px 14px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
        // Stretch to the slot height fed by the right column's `flex: 1`
        // wrappers so the two sub-cards end at the same baseline as the
        // wearing card on the left, regardless of content density.
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );
}

export function NextSwapPanel({
  cycle,
  canSwitch,
  onOpenSwitch,
}: {
  cycle: ReturnType<typeof computeCycleProgress> | null;
  canSwitch: boolean;
  onOpenSwitch: () => void;
}) {
  return (
    <SubCardShell>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <CapsLabel>下次换套</CapsLabel>
        {cycle && <ShiftPill daysShifted={cycle.daysShifted} />}
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            color: 'var(--nimi-text-primary)',
          }}
        >
          {cycle ? cycle.predictedSwitchDate.slice(0, 10) : '—'}
        </div>
        {cycle && (
          <button
            type="button"
            onClick={onOpenSwitch}
            disabled={!canSwitch}
            style={{
              ...PANEL_PRIMARY_PILL_BASE,
              border: canSwitch ? `1px solid ${S.accent}` : '1px solid var(--nimi-border-subtle)',
              background:
                cycle.cycleProgressRatio >= 1 && canSwitch ? S.accent : 'transparent',
              color:
                cycle.cycleProgressRatio >= 1 && canSwitch
                  ? 'var(--nimi-action-primary-text)'
                  : canSwitch
                  ? 'var(--nimi-text-primary)'
                  : 'var(--nimi-text-muted)',
              cursor: canSwitch ? 'pointer' : 'not-allowed',
              boxShadow: 'none',
            }}
          >
            <SwapIcon /> 换下一副
          </button>
        )}
      </div>
    </SubCardShell>
  );
}

export function NextVisitPanel({
  nextReviewDate,
  daysAway,
  onLogClinicalEvent,
}: {
  nextReviewDate: string | null;
  daysAway: number | null;
  onLogClinicalEvent: () => void;
}) {
  const hasReview = nextReviewDate !== null && daysAway !== null;
  return (
    <SubCardShell>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <CapsLabel>下次复诊</CapsLabel>
        {hasReview && daysAway !== null && <DaysAwayPill daysAway={daysAway} />}
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        {hasReview ? (
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              color: 'var(--nimi-text-primary)',
            }}
          >
            {formatHumanDate(nextReviewDate!)}
          </div>
        ) : (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: 'var(--nimi-text-muted)',
              lineHeight: 1.5,
              flex: 1,
              minWidth: 0,
            }}
          >
            还没有设置下次复诊。在装置详情里填入复诊周期后会自动算出，并自动加入提醒。
          </p>
        )}
        <button
          type="button"
          onClick={onLogClinicalEvent}
          className="hover:-translate-y-0.5"
          style={{
            ...PANEL_PRIMARY_PILL_BASE,
            background: 'var(--nimi-text-primary)',
            color: '#ffffff',
            border: '1px solid var(--nimi-text-primary)',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(15,23,42,0.16)',
          }}
        >
          记录就诊
        </button>
      </div>
    </SubCardShell>
  );
}

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
          // `space-between` anchors 初评 to the left edge and 已完成 to the
          // right edge, with 方案规划 / 治疗中 / 保持期 evenly distributed
          // between. Gaps between labels stay uniform regardless of the
          // 治疗中 row carrying an extra "(第 X / Y 月)" suffix.
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
                  // Static halo for the past/current resting state. The
                  // pulsing halo override comes from `.ortho-stage-active-dot`
                  // keyframes which animate `box-shadow` directly.
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

// ── Device meta strip ──────────────────────────────────────

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

// Pill palette: positive states use a saturated emerald tint so they read on
// white sub-card backgrounds; warning states (推后 / 已过期) use the same
// amber pair already used by the wearing-hero status badge so both pill
// families stay legible at the same saturation.
const PILL_POSITIVE_BG = 'rgba(16,185,129,0.18)';
const PILL_POSITIVE_TEXT = '#047857';
const PILL_WARNING_BG = 'rgba(245,158,11,0.18)';
const PILL_WARNING_TEXT = '#9a6404';

// Primary action pill in the right sub-cards (换下一副 / 记录就诊). The two
// buttons sit on different cards but visually share a row baseline with the
// big date on the left; this base ensures identical box-model so they line up
// to the pixel regardless of border/background variation.
const PANEL_PRIMARY_PILL_BASE: CSSProperties = {
  padding: '9px 18px',
  minHeight: 38,
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
  lineHeight: 1.2,
  transition: 'all 160ms',
};

function ShiftPill({ daysShifted }: { daysShifted: number }) {
  const isAhead = daysShifted < 0;
  const isBehind = daysShifted > 0;
  const label = isBehind
    ? `推后 ${daysShifted} 天`
    : isAhead
    ? `提前 ${-daysShifted} 天`
    : '按计划';
  const bg = isBehind ? PILL_WARNING_BG : PILL_POSITIVE_BG;
  const color = isBehind ? PILL_WARNING_TEXT : PILL_POSITIVE_TEXT;
  return (
    <span
      style={{
        fontSize: 11,
        padding: '3px 9px',
        borderRadius: 999,
        background: bg,
        color,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function DaysAwayPill({ daysAway }: { daysAway: number }) {
  const overdue = daysAway < 0;
  return (
    <span
      style={{
        fontSize: 11,
        padding: '3px 9px',
        borderRadius: 999,
        background: overdue ? PILL_WARNING_BG : PILL_POSITIVE_BG,
        color: overdue ? PILL_WARNING_TEXT : PILL_POSITIVE_TEXT,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {overdue ? `已过期 ${-daysAway} 天` : `还有 ${daysAway} 天`}
    </span>
  );
}

export function InlineErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="text-[12px] rounded-md px-3 py-2"
      style={{
        background: 'rgba(220,38,38,0.08)',
        color: 'var(--nimi-status-danger)',
        border: '1px solid rgba(220,38,38,0.2)',
      }}
    >
      {message}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

export function toLocalDatetimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatHumanDate(iso: string): string {
  const [, m, d] = iso.split('-');
  if (!m || !d) return iso;
  return `${Number(m)} 月 ${Number(d)} 日`;
}

export function blockedAdvanceReason(
  options: ReturnType<typeof computeStageOptions>,
): string | undefined {
  const nextFuture = options.find((o) => o.state === 'future');
  return nextFuture?.blockedReason ?? '已是最终阶段';
}

/**
 * Total-treatment progress projection used by the bottom strip. Day-level
 * resolution so the bar advances visibly within a month rather than snapping
 * 0 → ~12% on integer-month boundaries. Strategy in priority order:
 *   1. `plannedEndAt` — exact case span; `(now - startedAt) / (plannedEndAt - startedAt)`.
 *   2. `monthsTotal × 30 days` fallback (used when the case has no planned
 *      end but a clear-aligner schedule provides the projection upstream).
 *   3. Equal-weight stage progression as a last resort so the bar still moves
 *      between stages on cases with no schedule signal at all.
 * Clamped to [0, 100] and rounded for display.
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

function SwapIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 17l-4-4m0 0l4-4m-4 4h14M17 7l4 4m0 0l-4 4m4-4H7" />
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
