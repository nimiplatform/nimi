import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  OverlayShell,
  Surface,
  TextField,
} from '@nimiplatform/nimi-kit/ui';
import {
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
  stageLabel,
} from './orthodontic-derive.js';
import {
  advanceOrthodonticStage,
  OrthodonticStageConfirmDialog,
} from './orthodontic-stage-confirm-dialog.js';
import { computeTreatmentRingCopy } from './orthodontic-treatment-ring-copy.js';
import {
  blockedAdvanceReason,
  computeOverallProgressPct,
  DotsIcon,
  GearIcon,
  InlineErrorBanner,
  NextSwapPanel,
  NextVisitPanel,
  ProgressStrip,
  Ring,
  toLocalDatetimeInputValue,
} from './orthodontic-treatment-card-parts.js';

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
  /** Opens `OrthoClinicalEventModal` with no prefill — parent picks the type inside. */
  onOpenClinicalEvent: () => void;
  /** Opens `OrthoClinicalEventModal` with `eventType='ortho-issue'` prefilled. */
  onLogOrthoIssue: () => void;
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
  onOpenClinicalEvent,
  onLogOrthoIssue,
  onCaseChanged,
  onError,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Dismiss the ⋯ menu on outside click + Escape key. Standard dropdown
  // behavior — Radix would give us this for free if we adopted its Menu
  // primitive, but the menu lives inside `trailingAction` of `ProgressStrip`
  // and we want minimal indirection here.
  useEffect(() => {
    if (!menuOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);
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
      {/* Top split: left wearing panel + right 2 stacked sub-cards.
          Padded wrapper so each panel becomes its own rounded module instead
          of bleeding to the outer card's edges. Grid `align-items: stretch`
          (default) + sub-card `height: 100%` + per-child `flex: 1` keeps both
          columns the same height regardless of content density. */}
      <div style={{ padding: '20px 20px 4px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 0.95fr) minmax(320px, 1.05fr)',
            gap: 16,
          }}
        >
          {/* ── Left: wearing panel as its own rounded card ────── */}
          <div
            style={{
              position: 'relative',
              padding: '28px 32px 32px',
              background: GLASS_GRADIENT,
              overflow: 'hidden',
              borderRadius: 20,
              boxShadow: '0 4px 14px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
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
                <button
                  type="button"
                  onClick={onEditAppliance}
                  aria-label="装置设置"
                  title="装置设置"
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
                  className="hover:bg-white/70 hover:text-[var(--nimi-text-primary)]"
                >
                  <GearIcon />
                </button>
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
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  onClick={() => onOpenUnwearBackfill()}
                  className="hover:-translate-y-0.5"
                  style={{
                    border: `1px solid ${S.accent}`,
                    background: '#ffffff',
                    color: 'var(--nimi-text-primary)',
                    padding: '10px 22px',
                    borderRadius: 999,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    transition: 'all 160ms',
                  }}
                >
                  补记未戴时段
                </button>
                <button
                  type="button"
                  onClick={onLogOrthoIssue}
                  className="text-white hover:-translate-y-0.5"
                  style={{
                    background: 'var(--nimi-text-primary)',
                    border: 0,
                    padding: '11px 22px',
                    borderRadius: 999,
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    boxShadow: '0 6px 18px rgba(15,23,42,0.16)',
                    transition: 'all 160ms',
                  }}
                >
                  记录异常
                </button>
              </div>
            )}
          </div>
        </div>

          {/* ── Right: 2 stacked sub-cards, each filling half the column
               so their total height matches the wearing-card on the left.
               `flex: 1; minHeight: 0` makes them divide the grid row evenly;
               `SubCardShell` carries `height: 100%` so content-sparse cards
               still stretch to fill their slot. ── */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              background: 'transparent',
            }}
          >
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <div style={{ flex: 1, display: 'flex' }}>
                <NextSwapPanel
                  cycle={cycle}
                  canSwitch={canSwitch}
                  onOpenSwitch={openSwitchModal}
                />
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <div style={{ flex: 1, display: 'flex' }}>
                <NextVisitPanel
                  nextReviewDate={nextReview}
                  daysAway={daysToReview}
                  onLogClinicalEvent={onOpenClinicalEvent}
                />
              </div>
            </div>
          </div>
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
            <div ref={menuRef} style={{ position: 'relative' }}>
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
