import { useMemo, useState } from 'react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import {
  type OrthodonticApplianceRow,
  type OrthodonticCaseRow,
  deleteOrthodonticCase,
} from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';
import {
  caseTypeLabel,
  computeOpenIntervalState,
  defaultPrescribedHoursPerDay,
  stageLabel,
} from './orthodontic-derive.js';
import { OrthodonticStageProgress } from './orthodontic-stage-progress.js';

interface Props {
  caseRow: OrthodonticCaseRow;
  appliances: OrthodonticApplianceRow[];
  /** Map of applianceId -> intervals; used only to surface "open un-wear" subtitle. */
  intervalsByAppliance: Record<string, import('../../bridge/sqlite-bridge.js').OrthodonticUnwearIntervalRow[]>;
  nowIso: string;
  onCaseChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
  onEditCase: () => void;
}

/**
 * Hero card for the orthodontic surface — the parent's "where am I now" view.
 *
 * Layout:
 *  - Big title: caseTypeLabel · current stage · 第 N / 共 M 个月
 *  - Stage progress bar (5 segments, parent-clickable, PO-ORTHO-002)
 *  - Right-side: countdown to next clinical review + open-unwear hint
 *  - Top-right: ⋯ menu with management actions (delete current case only;
 *    "start a new course" lives in the EmptyState shown after the current
 *    case is completed/deleted, per PO-ORTHO-002b)
 */
export function OrthodonticHero({
  caseRow,
  appliances,
  intervalsByAppliance,
  nowIso,
  onCaseChanged,
  onError,
  onEditCase,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  const monthsElapsed = useMemo(() => {
    const start = new Date(`${caseRow.startedAt}T00:00:00.000Z`).getTime();
    const now = new Date(nowIso).getTime();
    const diffMonths = Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24 * 30)));
    return diffMonths;
  }, [caseRow.startedAt, nowIso]);

  const monthsTotal = useMemo(() => totalCaseMonths(caseRow, appliances), [caseRow, appliances]);

  // Earliest active appliance.nextReviewDate; clamp to "today or later".
  const nextReview = useMemo(() => {
    const dates = appliances
      .filter((a) => a.status === 'active' && a.nextReviewDate)
      .map((a) => a.nextReviewDate as string)
      .sort();
    return dates[0] ?? caseRow.nextReviewDate ?? null;
  }, [appliances, caseRow.nextReviewDate]);

  const daysToReview = useMemo(() => {
    if (!nextReview) return null;
    const ms = new Date(`${nextReview}T00:00:00.000Z`).getTime() - new Date(nowIso).getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24));
  }, [nextReview, nowIso]);

  // Any open un-wear interval across active appliances?
  const openUnwearAge = useMemo(() => {
    let max = 0;
    for (const a of appliances) {
      if (a.status !== 'active') continue;
      const state = computeOpenIntervalState(intervalsByAppliance[a.applianceId] ?? [], nowIso);
      if (state.hasOpen && state.ageHours > max) max = state.ageHours;
    }
    return max;
  }, [appliances, intervalsByAppliance, nowIso]);

  const handleDeleteCase = async () => {
    if (
      !window.confirm(
        '确定删除该疗程？相关装置、打卡、未戴记录都会级联删除，操作不可撤销。',
      )
    ) {
      return;
    }
    try {
      await deleteOrthodonticCase(caseRow.caseId);
      await onCaseChanged();
    } catch (error) {
      catchLog('ortho', 'action:delete-case-failed')(error);
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setMenuOpen(false);
    }
  };

  return (
    <Surface
      as="section"
      material="glass-thick"
      padding="none"
      tone="card"
      className="overflow-hidden rounded-[20px] p-6 shadow-[0_8px_32px_rgba(31,38,135,0.04)]"
      style={{
        background:
          'linear-gradient(135deg, rgba(167,243,208,0.32) 0%, rgba(191,219,254,0.28) 60%, rgba(221,214,254,0.30) 100%)',
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] uppercase tracking-[0.08em]" style={{ color: S.sub, letterSpacing: '0.08em' }}>
            正畸疗程
          </p>
          <h1
            className="mt-1 text-[26px] font-semibold tracking-tight"
            style={{ color: S.text, letterSpacing: '-0.02em' }}
          >
            {caseTypeLabel(caseRow.caseType)} · {stageLabel(caseRow.stage)}
          </h1>
          <p className="mt-1.5 text-[14px]" style={{ color: S.sub }}>
            {monthsTotal !== null
              ? `第 ${monthsElapsed} / 共 ${monthsTotal} 个月`
              : `已进行 ${monthsElapsed} 个月`}
            {caseRow.providerInstitution ? ` · ${caseRow.providerInstitution}` : ''}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          {nextReview && daysToReview !== null && (
            <div
              className="text-[12px] px-2.5 py-1 rounded-full"
              style={{
                background: daysToReview < 0 ? 'rgba(245,158,11,0.16)' : 'rgba(255,255,255,0.65)',
                color: daysToReview < 0 ? '#b45309' : S.text,
                fontWeight: 500,
              }}
            >
              {daysToReview < 0
                ? `复诊已过期 ${-daysToReview} 天`
                : `下次复诊 ${daysToReview} 天后 · ${nextReview}`}
            </div>
          )}
          {openUnwearAge >= 4 && (
            <div
              className="text-[12px] px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(245,158,11,0.16)', color: '#b45309', fontWeight: 500 }}
            >
              当前未戴 {Math.round(openUnwearAge)} 小时
            </div>
          )}

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              aria-label="疗程管理菜单"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-full p-1.5 transition-colors hover:bg-white/60"
              style={{ background: 'transparent', border: 0, cursor: 'pointer', color: S.sub }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="6" r="1.2" />
                <circle cx="12" cy="12" r="1.2" />
                <circle cx="12" cy="18" r="1.2" />
              </svg>
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1.5 z-10 rounded-xl py-1 min-w-[200px]"
                style={{
                  background: '#ffffff',
                  border: '1px solid rgba(226,232,240,0.8)',
                  boxShadow: '0 12px 32px rgba(15,23,42,0.12)',
                }}
              >
                {/* PO-ORTHO-002b: a child holds at most one non-completed case
                    at a time. The "start a new course" entry-point is the
                    EmptyState that surfaces only after the current case is
                    completed or deleted; it is intentionally absent from this
                    menu (Rust would fail-close anyway). */}
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
                <div style={{ borderTop: '1px solid rgba(226,232,240,0.6)', margin: '2px 0' }} />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleDeleteCase()}
                  className="w-full text-left text-[14px] px-3 py-2 hover:bg-rose-50"
                  style={{ background: 'transparent', border: 0, color: '#b91c1c', cursor: 'pointer' }}
                >
                  删除当前疗程
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <OrthodonticStageProgress caseRow={caseRow} onAdvanced={onCaseChanged} onError={onError} />
    </Surface>
  );
}

/**
 * Estimates the case's planned total months. Prefers `plannedEndAt` when set;
 * else for clear-aligners derives from `daysPerAligner * totalAligners` of the
 * primary appliance; else returns null (Hero falls back to "elapsed only").
 */
function totalCaseMonths(
  caseRow: OrthodonticCaseRow,
  appliances: OrthodonticApplianceRow[],
): number | null {
  if (caseRow.plannedEndAt) {
    const ms =
      new Date(`${caseRow.plannedEndAt}T00:00:00.000Z`).getTime() -
      new Date(`${caseRow.startedAt}T00:00:00.000Z`).getTime();
    return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24 * 30)));
  }
  // Clear-aligner heuristic.
  const aligner = appliances.find((a) => a.applianceType === 'clear-aligner');
  if (aligner && aligner.daysPerAligner && aligner.totalAligners) {
    const days = aligner.daysPerAligner * aligner.totalAligners;
    return Math.max(1, Math.round(days / 30));
  }
  // Suppress unused-helper warning when defaults are referenced.
  void defaultPrescribedHoursPerDay;
  return null;
}
