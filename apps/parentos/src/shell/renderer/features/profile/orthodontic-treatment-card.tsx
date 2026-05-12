import { useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  OverlayShell,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Surface,
  TextField,
} from '@nimiplatform/nimi-kit/ui';
import {
  closeUnwearInterval,
  deleteOrthodonticCase,
  insertOrthodonticCheckin,
  type OrthodonticApplianceRow,
  type OrthodonticCaseRow,
  type OrthodonticCheckinRow,
  type OrthodonticStage,
  type OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
import {
  applianceTypeLabel,
  computeCycleProgress,
  computeOpenIntervalState,
  computeStageOptions,
  defaultReviewIntervalDays,
  STAGE_ORDER,
  stageLabel,
} from './orthodontic-derive.js';
import {
  OrthodonticQuickTagStrip,
  type OrthodonticQuickTagId,
} from './orthodontic-quick-tag-strip.js';
import {
  advanceOrthodonticStage,
  OrthodonticStageConfirmDialog,
} from './orthodontic-stage-confirm-dialog.js';

/**
 * Unified orthodontic-treatment card. Wave-E composition: replaces the prior
 * 3-card stack (`OrthodonticWearingHero` + `OrthodonticTrayProgressCard` +
 * `OrthodonticNextVisitCard`) with a single Surface whose left half carries
 * the wearing ring and CTAs and whose right half stacks three sub-cards
 * (next-swap / next-visit / status-feedback). A bottom progress strip
 * surfaces `疗程总进度` plus the read-only stage stepper (PO-ORTHO-002).
 *
 * Logic preserved verbatim from the predecessor cards:
 *   - PO-ORTHO-005a wear-gap intervals drive the ring + `现在脱下`/`已戴回` CTA
 *   - PO-ORTHO-008 cycle math drives the ring countdown + next-swap date
 *   - PO-ORTHO-002 stage advance is parent-initiated via the ⋯ menu and goes
 *     through `OrthodonticStageConfirmDialog`
 *   - PO-ORTHO-010 fact-restatement boundary lives in `computeTreatmentRingCopy`
 *     (no prescriptive verbs anywhere, pinned by unit tests)
 */
interface Props {
  caseRow: OrthodonticCaseRow;
  primaryAppliance: OrthodonticApplianceRow | null;
  intervals: OrthodonticUnwearIntervalRow[];
  alignerChangeCheckins: OrthodonticCheckinRow[];
  /** Resolved next-review date across the case (yyyy-mm-dd). */
  nextReview: string | null;
  daysToReview: number | null;
  /** Months elapsed since `caseRow.startedAt`, computed upstream. */
  monthsElapsed: number;
  /** Estimated total course length in months. Null when projection has no answer. */
  monthsTotal: number | null;
  nowIso: string;
  onEditCase: () => void;
  onEditAppliance: () => void;
  onOpenUnwearBackfill: (defaultReason?: 'other') => void;
  onQuickTagClick: (id: OrthodonticQuickTagId) => void;
  /** Opens `OrthoClinicalEventModal` with no prefill — parent picks the type inside. */
  onOpenClinicalEvent: () => void;
  onCaseChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}

const GLASS_GRADIENT =
  'linear-gradient(135deg, rgba(167,243,208,0.36) 0%, rgba(191,219,254,0.30) 60%, rgba(221,214,254,0.32) 100%)';
const GLASS_GLOW_WEARING =
  'radial-gradient(ellipse at 70% 25%, rgba(78,204,163,0.22), transparent 60%)';
const GLASS_GLOW_UNWEAR =
  'radial-gradient(ellipse at 70% 25%, rgba(245,158,11,0.18), transparent 60%)';

export function OrthodonticTreatmentCard({
  caseRow,
  primaryAppliance,
  intervals,
  alignerChangeCheckins,
  nextReview,
  daysToReview,
  monthsElapsed,
  monthsTotal,
  nowIso,
  onEditCase,
  onEditAppliance,
  onOpenUnwearBackfill,
  onQuickTagClick,
  onOpenClinicalEvent,
  onCaseChanged,
  onError,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingStage, setPendingStage] = useState<
    { stage: OrthodonticStage } | null
  >(null);
  const [switchModal, setSwitchModal] = useState<
    | { open: true; defaultIndex: number; value: string; at: string }
    | { open: false }
  >({ open: false });
  const [switchError, setSwitchError] = useState<string | null>(null);

  const openState = useMemo(
    () => (primaryAppliance ? computeOpenIntervalState(intervals, nowIso) : null),
    [primaryAppliance, intervals, nowIso],
  );

  const cycle = useMemo(() => {
    if (!primaryAppliance || primaryAppliance.applianceType !== 'clear-aligner') {
      return null;
    }
    return computeCycleProgress({
      appliance: primaryAppliance,
      intervals,
      alignerChangeCheckins,
      nowIso,
    });
  }, [primaryAppliance, intervals, alignerChangeCheckins, nowIso]);

  const stageOptions = useMemo(() => computeStageOptions(caseRow), [caseRow]);
  const advanceTarget = useMemo(
    () => stageOptions.find((o) => o.state === 'future' && o.advanceable),
    [stageOptions],
  );

  const isOpen = openState?.hasOpen ?? false;

  const ringCopy = useMemo(
    () =>
      computeTreatmentRingCopy({
        primaryAppliance,
        cycle,
        openState,
      }),
    [primaryAppliance, cycle, openState],
  );

  const total = primaryAppliance?.totalAligners ?? null;
  const canSwitch =
    primaryAppliance !== null &&
    primaryAppliance.status === 'active' &&
    cycle !== null &&
    (total === null || cycle.currentAlignerIndex < total);

  const overallProgressPct = useMemo(
    () => computeOverallProgressPct({ caseRow, monthsTotal, nowIso }),
    [caseRow, monthsTotal, nowIso],
  );

  const handleResume = async () => {
    if (!openState?.intervalId) return;
    onError(null);
    try {
      await closeUnwearInterval({
        intervalId: openState.intervalId,
        endAt: nowIso,
        now: isoNow(),
      });
      await onCaseChanged();
    } catch (error) {
      catchLog('ortho', 'action:close-unwear-interval-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDeleteCase = async () => {
    if (
      !window.confirm(
        '确定删除该疗程？相关装置、打卡、未戴记录都会级联删除，操作不可撤销。',
      )
    ) {
      return;
    }
    setMenuOpen(false);
    try {
      await deleteOrthodonticCase(caseRow.caseId);
      await onCaseChanged();
    } catch (error) {
      catchLog('ortho', 'action:delete-case-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const openSwitchModal = () => {
    if (!cycle) return;
    const nextIndex = cycle.currentAlignerIndex + 1;
    if (total !== null && nextIndex > total) {
      onError(`已达到处方总副数 ${total}；无法继续更换`);
      return;
    }
    setSwitchError(null);
    setSwitchModal({
      open: true,
      defaultIndex: nextIndex,
      value: String(nextIndex),
      at: toLocalDatetimeInputValue(new Date()),
    });
  };

  const closeSwitchModal = () => {
    setSwitchModal({ open: false });
    setSwitchError(null);
  };

  const handleConfirmSwitch = async () => {
    if (!switchModal.open || !primaryAppliance) return;
    const alignerIndex = Number(switchModal.value.trim());
    if (!Number.isInteger(alignerIndex) || alignerIndex < 1) {
      setSwitchError('牙套序号必须为大于等于 1 的整数');
      return;
    }
    if (total !== null && alignerIndex > total) {
      setSwitchError(`牙套序号不能超过处方总副数 ${total}`);
      return;
    }
    const parsed = switchModal.at ? new Date(switchModal.at) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      setSwitchError('换套时间无效');
      return;
    }
    const checkinAtIso = parsed.toISOString();
    onError(null);
    try {
      await insertOrthodonticCheckin({
        checkinId: ulid(),
        childId: primaryAppliance.childId,
        caseId: primaryAppliance.caseId,
        applianceId: primaryAppliance.applianceId,
        checkinType: 'aligner-change',
        checkinDate: checkinAtIso.slice(0, 10),
        checkinAt: checkinAtIso,
        activationIndex: null,
        alignerIndex,
        notes: null,
        now: isoNow(),
      });
      closeSwitchModal();
      await onCaseChanged();
    } catch (error) {
      catchLog('ortho', 'action:aligner-change-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const wearingPanelBackground = isOpen ? GLASS_GLOW_UNWEAR : GLASS_GLOW_WEARING;

  return (
    <Surface
      as="section"
      material="glass-thick"
      padding="none"
      tone="card"
      className="overflow-hidden rounded-[28px] shadow-[0_18px_48px_rgba(15,23,42,0.08)]"
      style={{ position: 'relative', background: '#ffffff' }}
    >
      {/* Top split: left wearing panel + right 3 stacked sub-cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 0.95fr) minmax(320px, 1.05fr)',
          gap: 0,
        }}
      >
        {/* ── Left: wearing panel ──────────────────────── */}
        <div
          style={{
            position: 'relative',
            padding: '28px 32px 32px',
            background: GLASS_GRADIENT,
            overflow: 'hidden',
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background: wearingPanelBackground,
            }}
          />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 22,
                flexWrap: 'wrap',
              }}
            >
              {cycle ? (
                <span
                  style={{
                    fontSize: 14,
                    color: 'var(--nimi-text-muted)',
                    fontWeight: 500,
                  }}
                >
                  第 <strong style={{ color: 'var(--nimi-text-primary)', fontWeight: 700 }}>{cycle.currentAlignerIndex}</strong>
                  {total !== null ? ` / ${total} 副` : ''}
                </span>
              ) : primaryAppliance ? (
                <span
                  style={{
                    fontSize: 14,
                    color: 'var(--nimi-text-primary)',
                    fontWeight: 600,
                  }}
                >
                  {applianceTypeLabel(primaryAppliance.applianceType)}
                </span>
              ) : (
                <span aria-hidden />
              )}
              {primaryAppliance && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-label="装置设置"
                      title="装置设置"
                      className="data-[state=open]:bg-white/70 data-[state=open]:text-[var(--nimi-text-primary)]"
                      style={{
                        width: 28,
                        height: 28,
                        padding: 0,
                        border: 0,
                        borderRadius: 999,
                        display: 'inline-grid',
                        placeItems: 'center',
                        cursor: 'pointer',
                        color: 'var(--nimi-text-muted)',
                        background: 'transparent',
                        transition: 'all 160ms',
                      }}
                    >
                      <GearIcon />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="bottom" sideOffset={6} className="p-0">
                    <DeviceMetaPanel
                      appliance={primaryAppliance}
                      onEdit={onEditAppliance}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                marginBottom: 24,
              }}
            >
              <Ring
                copy={ringCopy}
                cycleRatio={cycle?.cycleProgressRatio ?? null}
                isOpen={isOpen}
              />
            </div>

            {primaryAppliance && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                {isOpen ? (
                  <button
                    type="button"
                    onClick={() => void handleResume()}
                    className="font-semibold text-white rounded-full transition-transform hover:-translate-y-0.5"
                    style={{
                      background: S.accent,
                      border: 0,
                      cursor: 'pointer',
                      boxShadow: '0 10px 24px rgba(78,204,163,0.34)',
                      fontSize: 15,
                      padding: '14px 56px',
                      minWidth: 240,
                    }}
                  >
                    已戴回
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenUnwearBackfill()}
                    className="font-semibold text-white rounded-full transition-transform hover:-translate-y-0.5"
                    style={{
                      background: 'var(--nimi-text-primary)',
                      border: 0,
                      cursor: 'pointer',
                      boxShadow: '0 6px 18px rgba(15,23,42,0.16)',
                      fontSize: 15,
                      padding: '14px 56px',
                      minWidth: 240,
                    }}
                  >
                    现在脱下
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenUnwearBackfill()}
                  style={{
                    border: 0,
                    background: 'transparent',
                    padding: '4px 10px',
                    borderRadius: 999,
                    cursor: 'pointer',
                    fontSize: 12,
                    color: 'var(--nimi-text-muted)',
                    fontFamily: 'inherit',
                  }}
                >
                  补记一次未戴时段
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: 3 stacked sub-cards ──────────────── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: '24px 24px 24px 18px',
            background: '#f1f5f9',
          }}
        >
          <NextSwapPanel
            cycle={cycle}
            canSwitch={canSwitch}
            onOpenSwitch={openSwitchModal}
          />

          <NextVisitPanel
            nextReviewDate={nextReview}
            daysAway={daysToReview}
            onLogClinicalEvent={onOpenClinicalEvent}
          />

          <StatusFeedbackPanel onQuickTagClick={onQuickTagClick} />
        </div>
      </div>

      {/* Bottom: total progress strip + stage stepper.
          Separator is the color step between the right column's slate-100
          panel above and this white panel — no horizontal rule. The ⋯ menu
          lives in the strip's top-right; its dropdown opens upward so it
          isn't clipped by the card's `overflow-hidden`. */}
      <div
        style={{
          padding: '20px 28px 24px',
          background: '#ffffff',
        }}
      >
        <ProgressStrip
          progressPct={overallProgressPct}
          stage={caseRow.stage}
          monthsElapsed={monthsElapsed}
          monthsTotal={monthsTotal}
          trailingAction={
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                aria-label="疗程管理菜单"
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-full p-1.5 transition-colors hover:bg-slate-100"
                style={{
                  background: 'transparent',
                  border: 0,
                  cursor: 'pointer',
                  color: 'var(--nimi-text-muted)',
                  display: 'inline-grid',
                  placeItems: 'center',
                }}
              >
                <DotsIcon />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 rounded-xl py-1 min-w-[220px]"
                  style={{
                    bottom: '100%',
                    marginBottom: 6,
                    background: '#ffffff',
                    border: '1px solid rgba(226,232,240,0.8)',
                    boxShadow: '0 -12px 32px rgba(15,23,42,0.12)',
                    zIndex: 5,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onEditCase();
                    }}
                    className="w-full text-left text-[14px] px-3 py-2 hover:bg-slate-50"
                    style={{ background: 'transparent', border: 0, color: S.text, cursor: 'pointer' }}
                  >
                    编辑当前疗程
                  </button>
                  {advanceTarget ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setPendingStage({ stage: advanceTarget.stage });
                      }}
                      className="w-full text-left text-[14px] px-3 py-2 hover:bg-slate-50"
                      style={{ background: 'transparent', border: 0, color: S.text, cursor: 'pointer' }}
                    >
                      推进到「{stageLabel(advanceTarget.stage)}」
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      disabled
                      className="w-full text-left text-[14px] px-3 py-2"
                      style={{
                        background: 'transparent',
                        border: 0,
                        color: 'var(--nimi-text-muted)',
                        cursor: 'not-allowed',
                        fontStyle: 'italic',
                      }}
                      title={blockedAdvanceReason(stageOptions)}
                    >
                      没有可推进的下一阶段
                    </button>
                  )}
                  <div
                    style={{
                      borderTop: '1px solid rgba(226,232,240,0.6)',
                      margin: '2px 0',
                    }}
                  />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void handleDeleteCase()}
                    className="w-full text-left text-[14px] px-3 py-2 hover:bg-rose-50"
                    style={{
                      background: 'transparent',
                      border: 0,
                      color: '#b91c1c',
                      cursor: 'pointer',
                    }}
                  >
                    删除当前疗程
                  </button>
                </div>
              )}
            </div>
          }
        />
      </div>

      {pendingStage && (
        <OrthodonticStageConfirmDialog
          stage={pendingStage.stage}
          onCancel={() => setPendingStage(null)}
          onConfirm={() => {
            const next = pendingStage.stage;
            setPendingStage(null);
            void advanceOrthodonticStage({
              caseRow,
              nextStage: next,
              onError,
              onAdvanced: onCaseChanged,
            });
          }}
        />
      )}

      <OverlayShell
        open={switchModal.open}
        onClose={closeSwitchModal}
        title="更换下一副牙套"
        footer={
          <div className="flex gap-3">
            <Button tone="secondary" fullWidth onClick={closeSwitchModal}>
              取消
            </Button>
            <Button tone="primary" fullWidth onClick={() => void handleConfirmSwitch()}>
              确认更换
            </Button>
          </div>
        }
      >
        {switchModal.open && (
          <div className="flex flex-col gap-3">
            <label
              className="flex flex-col gap-1.5"
              style={{ color: 'var(--nimi-text-secondary)' }}
            >
              <span className="text-[13px]">
                本次更换后的牙套序号（默认 {switchModal.defaultIndex}
                {total !== null ? `，共 ${total} 副` : ''}）
              </span>
              <TextField
                type="number"
                inputMode="numeric"
                min={1}
                max={total ?? undefined}
                value={switchModal.value}
                autoFocus
                onChange={(e) =>
                  setSwitchModal({
                    ...switchModal,
                    value: (e.target as HTMLInputElement).value,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleConfirmSwitch();
                  }
                }}
              />
            </label>
            <label
              className="flex flex-col gap-1.5"
              style={{ color: 'var(--nimi-text-secondary)' }}
            >
              <span className="text-[13px]">换牙套的时间</span>
              <TextField
                type="datetime-local"
                value={switchModal.at}
                onChange={(e) =>
                  setSwitchModal({
                    ...switchModal,
                    at: (e.target as HTMLInputElement).value,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleConfirmSwitch();
                  }
                }}
              />
            </label>
            {switchError && <InlineErrorBanner message={switchError} />}
          </div>
        )}
      </OverlayShell>

    </Surface>
  );
}

// ── Ring ───────────────────────────────────────────────────

function Ring({
  copy,
  cycleRatio,
  isOpen,
}: {
  copy: TreatmentRingCopy;
  cycleRatio: number | null;
  isOpen: boolean;
}) {
  const size = 220;
  const stroke = 14;
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
        borderRadius: 18,
        padding: '18px 20px',
        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
      }}
    >
      {children}
    </div>
  );
}

function NextSwapPanel({
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
              padding: '8px 16px',
              borderRadius: 999,
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
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              whiteSpace: 'nowrap',
            }}
          >
            <SwapIcon /> 换下一副
          </button>
        )}
      </div>
    </SubCardShell>
  );
}

function NextVisitPanel({
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

      {hasReview ? (
        <div
          style={{
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.1,
            color: 'var(--nimi-text-primary)',
            marginBottom: 14,
          }}
        >
          {formatHumanDate(nextReviewDate!)}
        </div>
      ) : (
        <p
          style={{
            margin: '0 0 14px',
            fontSize: 13,
            color: 'var(--nimi-text-muted)',
            lineHeight: 1.5,
          }}
        >
          还没有设置下次复诊。在装置详情里填入复诊周期后会自动算出，并自动加入提醒。
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onLogClinicalEvent}
          className="font-semibold text-white rounded-full transition-transform hover:-translate-y-0.5"
          style={{
            background: 'var(--nimi-text-primary)',
            border: 0,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            padding: '7px 16px',
            fontFamily: 'inherit',
            boxShadow: '0 4px 12px rgba(15,23,42,0.16)',
          }}
        >
          记录就诊
        </button>
      </div>
    </SubCardShell>
  );
}

function StatusFeedbackPanel({
  onQuickTagClick,
}: {
  onQuickTagClick: (id: OrthodonticQuickTagId) => void;
}) {
  return (
    <SubCardShell>
      <div style={{ marginBottom: 10 }}>
        <CapsLabel>本副状况反馈</CapsLabel>
      </div>
      <OrthodonticQuickTagStrip onTagClick={onQuickTagClick} />
    </SubCardShell>
  );
}

// ── Bottom progress strip ──────────────────────────────────

function ProgressStrip({
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
          display: 'grid',
          gridTemplateColumns: `repeat(${STAGE_ORDER.length}, 1fr)`,
          gap: 8,
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
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: isCurrent ? 8 : 6,
                  height: isCurrent ? 8 : 6,
                  borderRadius: 999,
                  background: dot,
                  boxShadow: isCurrent ? '0 0 0 3px rgba(78,204,163,0.2)' : 'none',
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

/**
 * Popover-shape device-meta panel. Designed to render inside a kit
 * `PopoverContent` (radix-portaled, anchored to the gear button). The kit
 * popover already supplies the surface chrome (border, shadow, radius), so
 * this component only renders the title row + label/value list + edit CTA.
 */
function DeviceMetaPanel({
  appliance,
  onEdit,
}: {
  appliance: OrthodonticApplianceRow;
  onEdit: () => void;
}) {
  const items: { label: string; value: string }[] = [
    { label: '装置类型', value: applianceTypeLabel(appliance.applianceType) },
    { label: '启用日期', value: appliance.startedAt },
  ];
  if (appliance.prescribedHoursPerDay !== null) {
    items.push({ label: '每日佩戴', value: `${appliance.prescribedHoursPerDay} 小时` });
  }
  if (appliance.reviewIntervalDays !== null) {
    items.push({ label: '复诊周期', value: `${appliance.reviewIntervalDays} 天` });
  } else {
    items.push({
      label: '复诊周期',
      value: `${defaultReviewIntervalDays(appliance.applianceType)} 天 · 默认`,
    });
  }
  if (appliance.totalAligners !== null) {
    items.push({ label: '总副数', value: String(appliance.totalAligners) });
  }
  if (appliance.daysPerAligner !== null) {
    items.push({ label: '每副天数', value: `${appliance.daysPerAligner} 天` });
  }
  return (
    <div style={{ width: 280, padding: '14px 16px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--nimi-text-muted)',
          }}
        >
          装置设置
        </span>
        <button
          type="button"
          onClick={onEdit}
          aria-label="编辑装置设置"
          title="编辑装置设置"
          style={{
            width: 24,
            height: 24,
            borderRadius: 999,
            border: 0,
            background: 'transparent',
            color: 'var(--nimi-text-muted)',
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
          }}
        >
          <PencilIcon />
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it) => (
          <div
            key={it.label}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: 'var(--nimi-text-muted)',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {it.label}
            </span>
            <span
              style={{
                fontSize: 13,
                color: 'var(--nimi-text-primary)',
                fontWeight: 500,
                textAlign: 'right',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
              }}
            >
              {it.value}
            </span>
          </div>
        ))}
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

// Pill palette: positive states use a saturated emerald tint so they read on
// white sub-card backgrounds; warning states (推后 / 已过期) use the same
// amber pair already used by the wearing-hero status badge so both pill
// families stay legible at the same saturation.
const PILL_POSITIVE_BG = 'rgba(16,185,129,0.18)';
const PILL_POSITIVE_TEXT = '#047857';
const PILL_WARNING_BG = 'rgba(245,158,11,0.18)';
const PILL_WARNING_TEXT = '#9a6404';

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

function InlineErrorBanner({ message }: { message: string }) {
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

function toLocalDatetimeInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatHumanDate(iso: string): string {
  const [, m, d] = iso.split('-');
  if (!m || !d) return iso;
  return `${Number(m)} 月 ${Number(d)} 日`;
}

function blockedAdvanceReason(
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
function computeOverallProgressPct(input: {
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

// ── Copy generator (PO-ORTHO-010 fact-restatement only) ────

export type TreatmentRingCopy =
  | {
      kind: 'cycle';
      caption: string;
      primaryNumber: string;
      unit: string;
      footer: string | null;
    }
  | { kind: 'message'; message: string };

/**
 * Single source of every parent-facing string the wearing ring shows. The
 * PO-ORTHO-010 boundary lives entirely here — no other layer rewrites the
 * wording. Tests pin every branch (`orthodontic-treatment-ring-copy.test.ts`)
 * so a future "small UX tweak" cannot silently resurrect a retired
 * prescriptive verb ("应该 / 建议 / 请加长 / 保持节奏").
 */
export function computeTreatmentRingCopy(input: {
  primaryAppliance: OrthodonticApplianceRow | null;
  cycle: ReturnType<typeof computeCycleProgress> | null;
  openState: ReturnType<typeof computeOpenIntervalState> | null;
}): TreatmentRingCopy {
  const { primaryAppliance, cycle, openState } = input;

  if (!primaryAppliance) {
    return {
      kind: 'message',
      message: '当前疗程还没有进行中的装置。',
    };
  }

  const isOpen = openState?.hasOpen ?? false;
  const ageHours = openState?.ageHours ?? 0;

  if (cycle) {
    const netHours = Math.round(cycle.cycleNetWearHours);
    const remaining = Math.max(0, cycle.cycleTargetHours - cycle.cycleNetWearHours);
    const remainingRounded = Math.round(remaining);
    const pct = Math.max(0, Math.min(100, Math.round(cycle.cycleProgressRatio * 100)));

    if (isOpen) {
      // 未戴中 — number = open-interval age; footer keeps the cycle wear
      // tally + percentage so the parent still sees progress despite being off.
      const ageHoursRounded = Math.max(0, Math.round(ageHours));
      return {
        kind: 'cycle',
        caption: '未戴中',
        primaryNumber: String(ageHoursRounded),
        unit: 'h',
        footer: `本副已戴 ${netHours}h · ${pct}%`,
      };
    }

    if (cycle.cycleProgressRatio >= 1) {
      return {
        kind: 'cycle',
        caption: '本副已达标',
        primaryNumber: String(netHours),
        unit: 'h',
        footer: '100%',
      };
    }

    return {
      kind: 'cycle',
      caption: '本副已戴',
      primaryNumber: String(netHours),
      unit: 'h',
      footer: `还差 ${remainingRounded}h · ${pct}%`,
    };
  }

  // Non clear-aligner — no cycle math; surface a single-line fact only.
  if (isOpen) {
    const prescribed = primaryAppliance.prescribedHoursPerDay;
    return {
      kind: 'message',
      message: prescribed
        ? `未戴中 · 医嘱每日佩戴 ${prescribed} 小时`
        : '未戴中',
    };
  }
  if (primaryAppliance.prescribedHoursPerDay) {
    return {
      kind: 'message',
      message: `医嘱每日佩戴 ${primaryAppliance.prescribedHoursPerDay} 小时`,
    };
  }
  return { kind: 'message', message: '装置使用中' };
}

// ── Icons ──────────────────────────────────────────────────

function DotsIcon() {
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

function GearIcon() {
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

function PencilIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

